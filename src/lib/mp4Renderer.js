// 浏览器端直出 MP4：WebCodecs（H.264 视频 + AAC 音频）+ mp4-muxer 封装
// 无需 Node / 剪映；浏览器端直接导出可播放、可发布的 MP4
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

const FPS = 30
const W = 1080
const H = 1920
const VIDEO_BITRATE = 4_000_000
const AUDIO_BITRATE = 128_000
const AUDIO_CHUNK_SEC = 1

// 候选 H.264 codec 列表（按优先级）：
// 1. High Profile L5.1：1080×1920 需要 Level ≥ 4.0（coded area 2088960 > L3.1 的 921600）
// 2. High Profile L5.0 / L4.2 / L4.0：逐级降，兼容较老硬件编码器
// 3. Baseline Profile L5.0：最保守的兜底
const CODEC_CANDIDATES = [
  'avc1.640033', // High L5.1
  'avc1.640032', // High L5.0
  'avc1.64002a', // High L4.2
  'avc1.640028', // High L4.0
  'avc1.420033', // Baseline L5.1
  'avc1.420028', // Baseline L4.0
]

// 探测浏览器实际支持的 codec（含分辨率/帧率），返回可用的 codec 字符串
async function pickVideoCodec() {
  if (!window.VideoEncoder || !window.VideoEncoder.isConfigSupported) {
    return CODEC_CANDIDATES[0]
  }
  for (const codec of CODEC_CANDIDATES) {
    try {
      const res = await window.VideoEncoder.isConfigSupported({
        codec,
        width: W,
        height: H,
        bitrate: VIDEO_BITRATE,
        framerate: FPS,
      })
      if (res && res.supported) return codec
    } catch {
      /* 该 codec 不可用，尝试下一个 */
    }
  }
  return CODEC_CANDIDATES[0]
}

// 探测浏览器实际支持的 AAC 编码器（含采样率/声道），返回 boolean
// 关键：Safari 等浏览器至今不支持 AudioEncoder AAC，若不探测直接 configure 会失败，
// 表现就是「无声视频」——用户能下到文件但只有画面，所以必须先探测
async function isAacSupported(sampleRate, numberOfChannels) {
  if (typeof window === 'undefined' || !window.AudioEncoder || !window.AudioEncoder.isConfigSupported) {
    return false
  }
  try {
    const res = await window.AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate,
      numberOfChannels,
      bitrate: AUDIO_BITRATE,
    })
    return !!(res && res.supported)
  } catch {
    return false
  }
}

// 渲染聊天视频为 MP4
// project: { duration(秒), audioFile?: File|Blob }
// renderFrame: async (t: 秒) => HTMLCanvasElement（1080×1920，内部可缓存）
// onProgress: (p: 0..1) => void
// 抛出统一 Error（含可读信息），保证所有 WebCodecs 资源在成功/失败路径都被释放
export async function renderChatVideoMP4({ project, renderFrame, onProgress }) {
  let audioBuffer = null
  let muxer = null
  let videoEncoder = null
  let audioEncoder = null
  // 收集编码器异步错误：error 回调里抛出的异常不会冒泡到主流程，
  // 记录后统一在状态检查时转成可读错误
  let videoError = null
  let audioError = null

  try {
    // 先解码音频（决定采样率/声道），再建 muxer
    if (project.audioFile) {
      audioBuffer = await decodeAudioFile(project.audioFile)
    }
    const sampleRate = audioBuffer?.sampleRate || 44100
    const channels = audioBuffer?.numberOfChannels || 2

    // 有音频时必须先探测 AAC 编码支持——Safari/部分 Chrome 不支持 WebCodecs AAC，
    // 不支持直接抛可读错误，避免产出一个无音轨的 MP4（用户能下载但没声音，最难排查）
    if (audioBuffer) {
      const ok = await isAacSupported(sampleRate, channels)
      if (!ok) {
        throw new Error(
          `当前浏览器不支持 WebCodecs AAC 编码（采样率 ${sampleRate}Hz / ${channels} 声道）。请改用 Chrome 120+ 桌面端，或在支持的浏览器中导出视频。`
        )
      }
    }

    muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: W, height: H, frameRate: FPS },
      audio: audioBuffer ? { codec: 'aac', sampleRate, numberOfChannels: channels } : undefined,
      fastStart: 'in-memory',
    })

    const codec = await pickVideoCodec()
    videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        videoError = e
        console.error('VideoEncoder 错误', e)
      },
    })
    videoEncoder.configure({
      codec,
      width: W,
      height: H,
      bitrate: VIDEO_BITRATE,
      framerate: FPS,
    })
    assertConfigured(videoEncoder, '视频编码器', videoError)

    const totalFrames = Math.max(1, Math.ceil(project.duration * FPS))
    // 背压阈值：编码器积压超过该值即等待消化，避免进度虚假到 100% 后 flush 卡十几秒
    const MAX_QUEUE = 20
    // 强制让出主线程的间隔（帧数）。Chrome 在主线程连续 ~5s 无响应时会显示"页面卡死"警告
    // 软件 H.264 编码 1080p 单帧可能 50-100ms，必须定期 yield 让浏览器知道页面还活着
    const YIELD_EVERY = 5
    for (let i = 0; i < totalFrames; i++) {
      // 编码器中途出错（如资源被回收）及时中断，避免在 closed codec 上继续 encode
      if (videoError || videoEncoder.state !== 'configured') {
        throw new Error(`视频编码器已关闭：${videoError ? videoError.message || videoError : '状态异常'}`)
      }
      // 背压：编码队列积压过多时让出主线程，等编码器消化部分帧
      // （Canvas 渲染快于编码时，若不限流会积压数百帧，flush 阶段才集中编码，表现为卡在"合成"）
      while (videoEncoder.encodeQueueSize > MAX_QUEUE) {
        await new Promise((r) => setTimeout(r, 30))
      }
      const t = i / FPS
      const canvas = await renderFrame(t)
      if (!canvas) throw new Error('帧渲染失败：未获得画布')
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(t * 1e6),
        duration: Math.round((1 / FPS) * 1e6),
      })
      try {
        videoEncoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 })
      } finally {
        // encode 失败也要释放 frame，避免 GC 警告
        frame.close()
      }
      onProgress?.((i + 1) / totalFrames)
      // 定期让出主线程，避免 Chrome 误判页面卡死；同时让编码器有机会输出 chunk
      if (i % YIELD_EVERY === 0) await new Promise((r) => setTimeout(r, 0))
    }
    await videoEncoder.flush()

    // 音频编码（AAC）。失败则整体失败并提示；无音频（audioBuffer 为空）则直接产出纯视频
    if (audioBuffer) {
      audioEncoder = await encodeAudio(audioBuffer, muxer)
      if (audioError) throw new Error(`音频编码器错误：${audioError.message || audioError}`)
    }

    muxer.finalize()
    return new Blob([muxer.target.buffer], { type: 'video/mp4' })
  } finally {
    // 无论成败，都释放编码器，防止实例累积触发 closed codec
    try {
      if (videoEncoder) videoEncoder.close()
    } catch {
      /* 已关闭则忽略 */
    }
    try {
      if (audioEncoder) audioEncoder.close()
    } catch {
      /* 已关闭则忽略 */
    }
  }
}

// 检查编码器 configure 后是否真正可用；closed 说明系统拒绝（常见于实例数超限）
function assertConfigured(encoder, label, pendingError) {
  if (encoder.state === 'configured') return
  if (pendingError) throw new Error(`${label}初始化失败：${pendingError.message || pendingError}`)
  throw new Error(`${label}初始化失败（状态 ${encoder.state}），可能已达浏览器编码器实例上限，请稍后重试`)
}

async function decodeAudioFile(file) {
  const ctx = new AudioContext()
  try {
    const buf = await file.arrayBuffer()
    return await ctx.decodeAudioData(buf)
  } finally {
    await ctx.close()
  }
}

// 返回 AudioEncoder 实例（调用方负责 close）；编码器错误会抛给调用方
async function encodeAudio(audioBuffer, muxer) {
  const { sampleRate, numberOfChannels, length } = audioBuffer
  let audioError = null
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => {
      audioError = e
      console.error('AudioEncoder 错误', e)
    },
  })
  encoder.configure({
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels,
    bitrate: AUDIO_BITRATE,
  })
  const planes = Array.from({ length: numberOfChannels }, (_, c) => audioBuffer.getChannelData(c))
  const chunkFrames = Math.round(sampleRate * AUDIO_CHUNK_SEC)
  for (let off = 0; off < length; off += chunkFrames) {
    if (audioError || encoder.state !== 'configured') {
      throw new Error(`音频编码器已关闭：${audioError ? audioError.message || audioError : '状态异常'}`)
    }
    const n = Math.min(chunkFrames, length - off)
    // f32-planar：data 需为单一缓冲区，按 [ch0 帧…, ch1 帧…, …] 顺序拼接所有声道平面
    const data = new Float32Array(n * numberOfChannels)
    for (let c = 0; c < numberOfChannels; c++) {
      data.set(planes[c].subarray(off, off + n), c * n)
    }
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: n,
      numberOfChannels,
      timestamp: Math.round((off / sampleRate) * 1e6),
      data,
    })
    try {
      encoder.encode(audioData)
    } finally {
      audioData.close()
    }
  }
  await encoder.flush()
  if (audioError) throw new Error(`音频编码错误：${audioError.message || audioError}`)
  return encoder
}
