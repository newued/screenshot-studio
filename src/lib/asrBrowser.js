// 浏览器端语音识别（ASR）+ 节拍网格 + DP 全局对齐（V1.1 第 5 节）
//
// 参考 gospel-video ab_generator.py 的 run_asr / asr_align / build_timeline 逻辑，
// 移植为纯浏览器实现（transformers.js Whisper + 能量法节拍网格 + dpAlign DP 对齐）。
// 动态 import @huggingface/transformers，避免拖慢首屏；仅在用户选择配音时加载。
//
// 关键容错（针对国内网络）：
//   1. 模型加载依次尝试多个 host（HF 主站 → 国内镜像 hf-mirror → 公共代理镜像），
//      每次都显式重置 env.remoteHost，避免「主站失败却偷偷用镜像 URL 再试一次主站」的 bug。
//   2. 区分「网络下载失败」与「WebGPU/WASM 推理失败」：前者才提示镜像问题；
//      后者如实报后端原因，不误报「模型下载失败」。
//   3. 即便所有镜像都不可用，也绝不僵死：自动退回「节拍网格 + DP 对齐」生成卡点时间轴
//      （即 DESIGN_V1.1 的 beat_grid 主路径），并提示可改用「AI 精修时间轴」导入更高精度结果。

import { alignDP, mappingToTimeline } from './dpAlign.js'
import {
  extractBeatGrid,
  buildRapUnitsFromChunks,
  buildRapUnitsFromBeats,
  estimateAsrQuality,
} from './browserAlign.js'

// 繁→简转换器（懒加载，避免拖慢首屏；仅在 ASR 运行时初始化一次）。
// 浏览器 Whisper 可能输出繁体（与 faster-whisper 一致），而脚本多为简体，
// 不做归一化会让相似度全 0 → 对齐全部退回插值 → 音画脱节。
// gospel-video 用 initial_prompt 偏置简体输出规避；transformers.js 不支持该参数，故在此归一。
let toSimplified = null
async function ensureToSimplified() {
  if (!toSimplified) {
    const { Converter } = await import('opencc-js')
    toSimplified = Converter({ from: 'tw', to: 'cn' })
  }
  return toSimplified
}

// 解码音频文件为 16kHz 单声道 Float32Array（Whisper 要求 16kHz）
async function decodeToMono16k(file) {
  const arrayBuffer = await file.arrayBuffer()
  const AC = window.AudioContext || window.webkitAudioContext
  const ctx = new AC()
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))
  const srcRate = decoded.sampleRate
  const src =
    decoded.numberOfChannels > 1
      ? mixToMono(decoded)
      : decoded.getChannelData(0)
  const targetRate = 16000
  const ratio = srcRate / targetRate
  const newLen = Math.max(1, Math.floor(src.length / ratio))
  const out = new Float32Array(newLen)
  for (let i = 0; i < newLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, src.length - 1)
    const frac = pos - i0
    out[i] = src[i0] * (1 - frac) + src[i1] * frac
  }
  ctx.close()
  return out
}

function mixToMono(decoded) {
  const ch0 = decoded.getChannelData(0)
  const ch1 = decoded.getChannelData(1)
  const out = new Float32Array(ch0.length)
  for (let i = 0; i < ch0.length; i++) out[i] = (ch0[i] + ch1[i]) / 2
  return out
}

// ==================== 模型加载（多 host 容错） ====================

// 模型加载 host 列表（按顺序尝试）。HF 主站放最前，国内网络不可达时会快速失败；
// 之后依次尝试国内镜像 hf-mirror 与公共代理镜像。任意一个成功即停止。
const MODEL_HOSTS = [
  { name: 'HuggingFace 主站', url: 'https://huggingface.co' },
  { name: 'hf-mirror 镜像', url: 'https://hf-mirror.com' },
  { name: 'hf-mirror 备用域名', url: 'https://hf-mirror.com.cn' },
  { name: 'ghproxy 代理镜像', url: 'https://mirror.ghproxy.com/https://huggingface.co' },
]

let _env = null
let transcriber = null
let transcriberModelId = null

// 浏览器端模型缓存：用 Cache API 持久化 transformers.js 下载的模型文件，
// 只在首次下载一次，之后从本地缓存读取，不会每次都去拉取。
const MODEL_CACHE_NAME = 'screenshort-transformer-models'

async function enableModelCache() {
  if (typeof caches === 'undefined') return false
  try {
    const cache = await caches.open(MODEL_CACHE_NAME)
    // 让 transformers.js 的 env 走 Cache API 缓存层
    if (_env) {
      _env.useBrowserCache = true
      _env.browserCache = cache
    }
    return true
  } catch {
    return false
  }
}

/**
 * 加载 Whisper 转写器，依次尝试多个 host。
 * @returns {Promise<object>} transcriber 实例
 * @throws 网络下载失败时抛出的 Error 带 isNetwork=true；后端推理失败带 isNetwork=false
 */
async function getTranscriber(onProgress, modelId = 'Xenova/whisper-tiny') {
  if (transcriber && transcriberModelId === modelId) return transcriber

  const { pipeline, env } = await import('@huggingface/transformers')
  _env = env
  env.allowLocalModels = false
  // 关键：开启浏览器缓存，模型文件只下载一次（断电/重开会话都不再拉取）
  await enableModelCache()

  // 逐 host 尝试；WebGPU 不可用时自动回退 WASM
  let lastNetworkErr = null
  let lastBackendErr = null

  for (const host of MODEL_HOSTS) {
    env.remoteHost = host.url
    try {
      const inst = await tryLoadWithFallback(host.name, modelId, onProgress)
      transcriber = inst
      transcriberModelId = modelId
      return transcriber
    } catch (e) {
      const msg = String(e?.message || e)
      const isNet = /Failed to fetch|NetworkError|network|load|download|404|Failed|timeout|abort/i.test(msg)
        || !e?.name // 后端抛出的异常通常带 name；裸字符串多来自 fetch
      if (isNet) {
        lastNetworkErr = e
        console.warn(`[ASR] ${host.name}（${host.url}）加载失败，尝试下一个 host`, e)
      } else {
        // WebGPU/WASM 后端本身报错（如不支持的配置），不应被当成“下载失败”
        lastBackendErr = e
        console.error(`[ASR] ${host.name} 推理后端失败`, e)
        // 后端问题通常与 host 无关，全部 host 都会失败 → 直接抛出
        break
      }
    }
  }

  if (lastBackendErr) {
    throw Object.assign(
      new Error(`语音识别后端失败（非网络问题）：${lastBackendErr.message}`),
      { isNetwork: false }
    )
  }
  const hostsTried = MODEL_HOSTS.map((h) => h.name).join('、')
  const reason = lastNetworkErr?.message || '所有镜像均无法连接'
  throw Object.assign(
    new Error(`模型下载失败（已尝试：${hostsTried} 均不可用）。可改用「AI 精修时间轴」导入 JSON。原因: ${reason}`),
    { isNetwork: true }
  )
}

async function tryLoadWithFallback(hostName, modelId, onProgress) {
  const run = (device) =>
    import('@huggingface/transformers').then(({ pipeline }) =>
      pipeline('automatic-speech-recognition', modelId || 'Xenova/whisper-tiny', {
        dtype: 'q8',
        device,
        progress_callback: onProgress,
      })
    )
  try {
    const inst = await run('webgpu')
    if (!inst?.model) throw new Error('模型加载不完整')
    return inst
  } catch (e) {
    console.warn(`[ASR] ${hostName} WebGPU 不可用，回退 WASM 推理`, e)
    const inst = await run('wasm')
    if (!inst?.model) throw new Error('WASM 模型加载不完整')
    return inst
  }
}

// ==================== 文本相似度 / 归一化 ====================

// 字符级相似度（difflib.SequenceMatcher.ratio 的近似实现）
function similarity(a, b) {
  a = (a || '').trim()
  b = (b || '').trim()
  const m = a.length
  const n = b.length
  if (!m && !n) return 1
  if (!m || !n) return 0
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
  }
  return (m + n - dp[m][n]) / (m + n)
}

// 去除空白与标点，仅保留文字，用于相似度比较（参考 gospel-video normalize_text）
// 先做繁→简归一化，保证脚本（简体）与 ASR（可能繁体）可对齐
function normalizeText(s) {
  const t = toSimplified ? toSimplified(s || '') : s || ''
  return t.replace(
    /[\s，。！？、,.!?；;：:“”"'‘’（）()《》<>…—\-~～·[\]【】]/g,
    ''
  )
}

/**
 * 把 transformers 的 output.chunks 解析成 [{text, start, end}]（已归一化）。
 * 优先用词级时间戳（细粒度），无词则退回段级。
 */
function resolveChunks(chunks, totalDuration = 0) {
  const raw = (chunks || []).filter(
    (c) => (c.text && normalizeText(c.text)) || (c.words && c.words.length)
  )
  const useWords = raw.some((c) => c.words && c.words.length)
  const out = []
  for (const c of raw) {
    if (useWords && c.words && c.words.length) {
      for (const w of c.words) {
        const t = normalizeText(w.text || '')
        if (t) out.push({ text: t, start: w.timestamp?.[0] ?? 0, end: w.timestamp?.[1] ?? (totalDuration || 0) })
      }
    } else {
      const t = normalizeText(c.text || '')
      if (t) out.push({ text: t, start: c.timestamp?.[0] ?? 0, end: c.timestamp?.[1] ?? (totalDuration || (c.timestamp?.[0] ?? 0)) })
    }
  }
  return out
}

// ==================== 兜底：贪心前向对齐（DP 异常时备用） ====================
// 关键：用「文本相似度」而非「精确相等」匹配 ASR 段——浏览器 Whisper 转写文本与脚本
// 文本几乎不会逐字相等，精确匹配会让所有消息退回按字数估算（与真实语音完全脱钩 → 音画不同步）。
function alignTimelineGreedy(chunks, messages, totalDuration = 0) {
  const asr = (chunks || []).filter((c) => c && c.text).map((c) => ({ ...c }))
  const dialogs = (messages || []).map((m) => ({ text: normalizeText(m.content || m.text || '') }))
  const n = dialogs.length
  if (!n) return []

  const totalAsr = asr.length
  if (!totalAsr) {
    return fallbackByDuration(dialogs, totalDuration)
  }

  const MIN_RATIO = 0.12
  const MAX_K = asr.some((c) => (c.text || '').length > 6) ? 6 : 3
  let ptr = 0
  const aligned = []
  for (let d = 0; d < n; d++) {
    const dtxt = dialogs[d].text
    let best = null
    for (let k = 1; k <= MAX_K && ptr + k <= totalAsr; k++) {
      const merged = asr.slice(ptr, ptr + k).map((s) => s.text).join('')
      const r = similarity(dtxt, merged)
      if (r >= MIN_RATIO) {
        const dur = asr[ptr + k - 1].end - asr[ptr].start
        const exp = Math.max(0.6, dtxt.length * 0.25)
        const over = Math.max(0, dur - exp * 1.5)
        const cost = 1 - r + over * 0.3
        if (!best || cost < best.cost) best = { k, cost, start: asr[ptr].start, end: asr[ptr + k - 1].end }
      }
    }
    if (best) {
      ptr += best.k
      aligned.push({ audio_start: best.start, audio_end: best.end })
    } else {
      const est = Math.max(0.5, Math.min(dtxt.length * 0.25, 8.0))
      const base = ptr < totalAsr ? asr[ptr].start : aligned.length ? aligned[aligned.length - 1].audio_end : 0
      aligned.push({ audio_start: base, audio_end: base + est })
      if (ptr < totalAsr) ptr += 1
    }
  }
  return buildTimeline(aligned, totalDuration)
}

function fallbackByDuration(dialogs, totalDuration) {
  const totalChars = dialogs.reduce((s, d) => s + Math.max(1, d.text.length), 0) || 1
  const dur = totalDuration || 10
  let cursor = 0
  return dialogs.map((d) => {
    const d2 = Math.max(0.3, (Math.max(1, d.text.length) / totalChars) * dur)
    const ds = cursor
    const de = Math.min(cursor + d2, dur)
    cursor = de
    return { display_start: ds, display_end: de }
  })
}

function buildTimeline(aligned, totalDuration) {
  return aligned.map((o, i) => {
    let ds = o.audio_start
    let de = o.audio_end
    if (i > 0 && ds < aligned[i - 1].audio_start) ds = aligned[i - 1].audio_start
    if (de <= ds) de = ds + 0.3
    const nextStart = aligned[i + 1]?.audio_start
    if (nextStart != null && de < nextStart) de = nextStart
    if (i === aligned.length - 1 && totalDuration) de = Math.max(de, totalDuration)
    return { display_start: ds, display_end: de }
  })
}

// 超时包装：避免模型下载卡死无提示（国内访问 HF 主站常超时）
function withTimeout(promise, ms, msg) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms)
    promise.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) }
    )
  })
}

// ==================== 主入口 ====================

// 选择配音文件后调用：解码 → 节拍网格 → (可选)Whisper 转写 → DP 全局对齐 → 返回时间轴 + 对齐产物
// onStatus(文本) 用于 UI 提示进度；onProgress({status,file,loaded,total}) 用于模型下载进度上屏
// modelId 可选：'Xenova/whisper-tiny'（快，默认）/ 'Xenova/whisper-small'（更准但慢）
// 返回: {
//   timeline: [{display_start, display_end, match_type?, source?, ...}],
//   audioDuration: number,
//   beatGrid: number[], gridMeta: object,
//   mapping: Array, mappingMeta: object,
//   alignmentMode: 'beat_grid' | 'asr_enhanced',
//   asrQualityScore: number,
//   usedFallback: boolean,        // 是否因 ASR 失败退回节拍网格
//   fallbackReason: string|null,  // 退回原因（提示用）
// }
export async function transcribeAndAlign(file, messages, onStatus, onProgress, modelId = 'Xenova/whisper-tiny') {
  onStatus?.('解码音频…')
  const waveform = await decodeToMono16k(file)
  const audioDuration = waveform.length / 16000

  // —— 阶段 A：始终提取节拍网格（V1.1 主路径基准） ——
  onStatus?.('提取节拍网格…')
  const gridMeta = extractBeatGrid(waveform, 16000)
  const beatGrid = gridMeta.beatGrid || []

  // 初始化繁→简转换器（仅首次），保证脚本与 ASR 繁简一致可对齐
  await ensureToSimplified()

  const scriptMsgs = (messages || []).map((m, i) => ({
    id: i,
    text: m.content || m.text || '',
  }))

  let rapUnits, quality = 0, alignmentMode = 'beat_grid'
  let resolved = [], asrOk = false, fallbackReason = null

  // —— 阶段 A(可选)：尝试 Whisper 转写 ——
  const modelSizeMB = modelId.includes('tiny') ? 75 : 250
  try {
    onStatus?.(`加载语音识别模型…（首次需下载约 ${modelSizeMB}MB）`)
    const inst = await withTimeout(
      getTranscriber((p) => {
        if (p?.status === 'progress' && p.total) {
          const pct = Math.round((p.loaded / p.total) * 100)
          onStatus?.(`下载模型 ${pct}%（${Math.round(p.loaded / 1048576)} / ${Math.round(p.total / 1048576)} MB）`)
        }
        onProgress?.(p)
      }, modelId),
      180000,
      '模型下载超时（无法访问 HuggingFace 主站，国内常见）。将自动退回「节拍网格 + DP 对齐」生成卡点时间轴（可改用「AI 精修时间轴」导入更高精度结果）。'
    )
    onStatus?.('识别语音中…')
    const startT = Date.now()
    const heartbeat = setInterval(() => {
      const sec = Math.round((Date.now() - startT) / 1000)
      onStatus?.(`识别语音中…（已 ${sec}s）`)
    }, 5000)
    let output
    try {
      output = await withTimeout(
        inst(waveform, {
          chunk_length_s: 30,
          stride_length_s: 5,
          return_timestamps: 'word',
          language: 'chinese',
          task: 'transcribe',
        }),
        120000,
        '语音识别超时（>2分钟）。浏览器端 Whisper 受限于 WASM 性能，将自动退回「节拍网格 + DP 对齐」（可改用「AI 精修时间轴」导入更高精度结果）。'
      )
    } finally {
      clearInterval(heartbeat)
    }
    resolved = resolveChunks(output.chunks || [], audioDuration)
    asrOk = resolved.length > 0
  } catch (err) {
    // ASR 失败：网络/超时/后端都不再致命，转入节拍网格兜底
    console.warn('[ASR] 转写失败，转入节拍网格兜底', err)
    fallbackReason = err?.message || String(err)
  }

  // —— 构建 rap 单元 + 评估质量 ——
  if (asrOk) {
    rapUnits = buildRapUnitsFromChunks(resolved, audioDuration)
    quality = estimateAsrQuality(resolved, audioDuration)
    alignmentMode = quality >= 0.5 ? 'asr_enhanced' : 'beat_grid'
  } else {
    rapUnits = buildRapUnitsFromBeats(beatGrid, audioDuration)
    quality = 0
    alignmentMode = 'beat_grid'
  }

  // —— 阶段 B：有序 DP 全局对齐 ——
  onStatus?.('DP 全局对齐…')
  let dpResult
  try {
    dpResult = alignDP(scriptMsgs, rapUnits, {
      gapPenalty: 0.15,
      threshold: 0.18,
      ambiguousEpsilon: 0.05,
      maxMergeUnits: 6,
    })
  } catch (e) {
    console.error('[ASR] DP 对齐异常，退回贪心对齐', e)
    const greedy = alignTimelineGreedy(resolved, messages, audioDuration)
    return {
      timeline: greedy,
      audioDuration,
      beatGrid,
      gridMeta,
      mapping: null,
      mappingMeta: null,
      alignmentMode,
      asrQualityScore: quality,
      usedFallback: !!fallbackReason,
      fallbackReason,
    }
  }

  const timeline = mappingToTimeline(dpResult.mapping, audioDuration, beatGrid)

  return {
    timeline,
    audioDuration,
    beatGrid,
    gridMeta,
    mapping: dpResult.mapping,
    mappingMeta: dpResult.mapping_meta,
    alignmentMode,
    asrQualityScore: quality,
    usedFallback: !!fallbackReason,
    fallbackReason,
  }
}
