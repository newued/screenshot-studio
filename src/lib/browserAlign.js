/**
 * browserAlign.js — 浏览器端「节拍网格提取 + DP 全局对齐」支撑模块（V1.1 第 5 节）
 *
 * 不依赖 librosa / Python，纯 JS（Web Audio 已解码的波形）实现：
 *   1. extractBeatGrid   —— 能量/瞬态包络 + 自相关测 BPM + 相位对齐生成节拍时间数组
 *   2. buildRapUnits*    —— 把 ASR 段（或节拍网格）整理成 DP 可用的「rap 行级单元」
 *   3. estimateAsrQuality—— 估算 ASR 可用率（决定 alignment_mode）
 *
 * DP 全局对齐本身在 dpAlign.js（alignDP）实现，本文件只负责喂给它
 * 「节拍网格」与「rap 单元」两个上游输入，并做质量评估。
 *
 * 设计定位：浏览器是「节拍网格优先」主路径的兜底实现；ASR 不可用时
 * rap 单元退化为按节拍切分的空文本段，DP 将全部判 unmatched 并给出
 * 吸附到拍点的 proposed_at（符合 DESIGN_V1.1 §5.3 的 beat_grid 行为）。
 */

// 标准帧率相关常量
const SR = 16000        // decodeToMono16k 输出采样率
const HOP = 512         // 帧移
const FPS = SR / HOP    // 帧率 ≈ 31.25 Hz

/**
 * 从单声道 16k 波形提取节拍网格。
 *
 * 方法（经典轻量 beat tracking）：
 *   - 每帧算 RMS 能量 + 高频瞬态能量（rectified derivative，强调鼓/镲）
 *   - onset 包络 = 两者的正向差分（对数域）平滑
 *   - 自相关 onset 包络求主导周期 → BPM（含八度合并，折叠到 70–180）
 *   - 相位对齐：在所有可能偏移里，选与脉冲序列互相关最大的偏移作为第一拍
 *
 * @param {Float32Array} waveform - 16kHz 单声道波形
 * @returns {{ beatGrid: number[], bpm: number, beat_count: number, duration: number, method: string }}
 */
export function extractBeatGrid(waveform, sampleRate = SR) {
  const n = waveform ? waveform.length : 0
  const fps = sampleRate / HOP
  const frameCount = n > 0 ? Math.floor(n / HOP) : 0

  // 退化：无音频或太短 → 返回空网格（上游走纯均匀兜底）
  if (frameCount < 8) {
    const dur = n > 0 ? n / sampleRate : 0
    return { beatGrid: [], bpm: 0, beat_count: 0, duration: dur, method: 'browser-energy' }
  }

  // 1) 逐帧特征
  const rms = new Float32Array(frameCount)
  const hfc = new Float32Array(frameCount) // high-frequency content（瞬态）
  for (let f = 0; f < frameCount; f++) {
    const start = f * HOP
    let sumSq = 0, h = 0, prev = 0
    for (let i = 0; i < HOP; i++) {
      const idx = start + i
      const x = idx < n ? waveform[idx] : 0
      sumSq += x * x
      const d = x - prev
      h += d * d
      prev = x
    }
    rms[f] = Math.sqrt(sumSq / HOP)
    hfc[f] = h / HOP
  }

  // 2) onset 包络：对数域正向差分（能量 + 瞬态），再平滑
  const onset = new Float32Array(frameCount)
  for (let f = 1; f < frameCount; f++) {
    const rLog = Math.log(rms[f] + 1e-6) - Math.log(rms[f - 1] + 1e-6)
    const hLog = Math.log(hfc[f] + 1e-6) - Math.log(hfc[f - 1] + 1e-6)
    onset[f] = Math.max(0, rLog) * 0.5 + Math.max(0, hLog) * 0.5
  }
  const win = 2
  const sm = new Float32Array(frameCount)
  for (let f = 0; f < frameCount; f++) {
    let s = 0, c = 0
    for (let k = -win; k <= win; k++) {
      const j = f + k
      if (j >= 0 && j < frameCount) { s += onset[j]; c++ }
    }
    sm[f] = s / c
  }
  let mx = 0
  for (let i = 0; i < frameCount; i++) if (sm[i] > mx) mx = sm[i]
  if (mx > 0) for (let i = 0; i < frameCount; i++) sm[i] /= mx

  // 3) 自相关测 BPM（含八度合并，避免误判半个/双倍速）
  let mean = 0
  for (let i = 0; i < frameCount; i++) mean += sm[i]
  mean /= frameCount
  const ac = new Float32Array(frameCount)
  for (let lag = 1; lag < frameCount; lag++) {
    let s = 0
    for (let f = lag; f < frameCount; f++) {
      s += (sm[f] - mean) * (sm[f - lag] - mean)
    }
    ac[lag] = s
  }
  const minLag = Math.max(2, Math.floor(fps * 60 / 200)) // 200 BPM 上限
  const maxLag = Math.min(frameCount - 1, Math.floor(fps * 60 / 45)) // 45 BPM 下限
  let bestLag = minLag, bestVal = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let v = ac[lag]
    if (lag * 2 < frameCount) v += ac[lag * 2] * 0.5 // 八度增强
    if (v > bestVal) { bestVal = v; bestLag = lag }
  }
  let bpm = 60 * fps / bestLag
  while (bpm < 70) bpm *= 2
  while (bpm > 180) bpm /= 2
  const beatFrames = Math.max(1, Math.round(fps * 60 / bpm)) // 取整拍帧距

  // 4) 相位对齐：在 [0, beatFrames) 偏移中选脉冲序列互相关最大者
  let bestOffset = 0, bestOffsetVal = -Infinity
  for (let o = 0; o < beatFrames; o++) {
    let s = 0
    for (let k = o; k < frameCount; k += beatFrames) s += sm[k]
    if (s > bestOffsetVal) { bestOffsetVal = s; bestOffset = o }
  }

  // 5) 生成拍点时间（秒）
  const beatGrid = []
  for (let k = bestOffset; k < frameCount; k += beatFrames) {
    beatGrid.push(Math.round((k / fps) * 1000) / 1000)
  }
  // 兜底：若自相关极弱（近似静音）导致拍点异常少，强制均匀补拍
  if (beatGrid.length < 2) {
    const dur = n / sampleRate
    const step = 60 / bpm
    for (let t = 0; t < dur; t += step) beatGrid.push(Math.round(t * 1000) / 1000)
  }

  return {
    beatGrid,
    bpm: Math.round(bpm),
    beat_count: beatGrid.length,
    duration: Math.round((n / sampleRate) * 100) / 100,
    method: 'browser-energy',
  }
}

/**
 * 由 ASR 段构建 DP 用的 rap 行级单元。
 * @param {Array<{text:string,start:number,end:number}>} chunks - 已繁→简归一、去标点的段
 * @param {number} totalDuration
 * @returns {Array<{text:string,start:number,end:number}>}
 */
export function buildRapUnitsFromChunks(chunks, totalDuration = 0) {
  const valid = (chunks || []).filter(
    (c) => c && (c.text || (c.words && c.words.length)) && Number.isFinite(c.start)
  )
  if (!valid.length) return buildRapUnitsFromBeats(extractBeatGridEmpty(totalDuration), 0)
  return valid.map((c) => ({
    text: c.text || '',
    start: Math.max(0, c.start),
    end: Number.isFinite(c.end) && c.end > c.start ? c.end : c.start + 0.5,
  }))
}

/**
 * 无 ASR 时：按节拍网格把音频切成「行级单元」（空文本 → DP 将判 unmatched）
 * @param {number[]} beatGrid
 * @param {number} totalDuration
 * @returns {Array<{text:string,start:number,end:number}>}
 */
export function buildRapUnitsFromBeats(beatGrid, totalDuration = 0) {
  if (!beatGrid || beatGrid.length < 2) {
    // 无拍点：按 3s 均匀切（保证每段时长合理）
    const dur = totalDuration || 10
    const units = []
    for (let t = 0; t < dur; t += 3) {
      units.push({ text: '', start: t, end: Math.min(t + 3, dur) })
    }
    return units.length ? units : [{ text: '', start: 0, end: dur || 3 }]
  }
  const units = []
  for (let j = 0; j < beatGrid.length - 1; j++) {
    units.push({ text: '', start: beatGrid[j], end: beatGrid[j + 1] })
  }
  // 末拍到结尾也补一段
  if (totalDuration > beatGrid[beatGrid.length - 1]) {
    units.push({
      text: '',
      start: beatGrid[beatGrid.length - 1],
      end: totalDuration,
    })
  }
  return units
}

function extractBeatGridEmpty(totalDuration) {
  // 仅用于 buildRapUnitsFromChunks 的空兜底
  const dur = totalDuration || 10
  const grid = []
  for (let t = 0; t < dur; t += 3) grid.push(t)
  return grid
}

/**
 * 估算 ASR 可用率（决定 alignment_mode）。
 *   coverage = ASR 覆盖时长 / 总时长
 *   density  = ASR 段数 / (总时长 / 3)（说唱约 1 行/3s）
 *   score    = 0.55*coverage + 0.45*density，截断到 [0,1]
 * @param {Array<{start:number,end:number}>} chunks
 * @param {number} totalDuration
 * @returns {number} 0–1
 */
export function estimateAsrQuality(chunks, totalDuration = 0) {
  if (!chunks || !chunks.length || !totalDuration) return 0
  let covered = 0
  for (const c of chunks) {
    const s = Number.isFinite(c.start) ? c.start : 0
    const e = Number.isFinite(c.end) ? c.end : s + 0.5
    covered += Math.max(0, e - s)
  }
  const coverage = Math.min(1, covered / totalDuration)
  const density = Math.min(1, chunks.length / (totalDuration / 3))
  const score = 0.55 * coverage + 0.45 * density
  return Math.round(Math.min(1, Math.max(0, score)) * 100) / 100
}
