/**
 * vad.js — 基于能量的语音活动检测（VAD）兜底对齐
 *
 * 背景：alignDP 默认依赖 faster-whisper ASR 产出逐句真实演唱/说话时刻，
 * 但 ASR 首次运行需联网下载模型，离线/受限环境下会失败并退化为「节拍网格均匀切片」，
 * 导致气泡按均等时间排开、与真实说话时刻错位（音画不同步）。
 *
 * 本模块用已就绪的 Python+librosa 做轻量能量 VAD，把音频切成实际说话时间段，
 * 让气泡对齐到真实说话时刻，无需联网/大模型，离线可用。
 */
import { execFile } from 'node:child_process'
import { writeFile, readFile, unlink, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { requirePython } from './pyEnv.js'

const execFileAsync = promisify(execFile)

/**
 * 检测音频的语音时间段（能量 VAD）
 * @param {string} audioPath - 音频文件绝对路径
 * @param {object} opts - { hop=0.1, threshold=0.06, minDur=0.25, mergeGap=0.3 }
 * @returns {Promise<Array<[number, number]>>} 语音段 [[start, end], ...]
 */
export async function detectSpeechSegments(audioPath, opts = {}) {
  const { hop = 0.1, threshold = 0.06, minDur = 0.25, mergeGap = 0.3 } = opts
  const tmpDir = await mkdtemp(join(tmpdir(), 'screenshort-vad-'))
  const scriptPath = join(tmpDir, 'vad.py')
  const outputPath = join(tmpDir, 'vad.json')
  const py = `
import json
import librosa, numpy as np
audio_path = r"${audioPath.replace(/\\/g, '\\\\')}"
y, sr = librosa.load(audio_path, sr=16000, mono=True)
hop = int(${hop} * sr)
if len(y) < hop:
    y = np.pad(y, (0, hop - len(y)))
frames = librosa.util.frame(y, frame_length=hop, hop_length=hop)
rms = np.sqrt(np.mean(frames ** 2, axis=0) + 1e-12)
rms = rms / (rms.max() + 1e-9)
speech = rms > ${threshold}
segs = []
i = 0
n = len(speech)
while i < n:
    if speech[i]:
        j = i
        while j < n and speech[j]:
            j += 1
        segs.append([float(i * ${hop}), float(min(j * ${hop}, len(y) / sr))])
        i = j
    else:
        i += 1
merged = []
for s in segs:
    if merged and s[0] - merged[-1][1] <= ${mergeGap}:
        merged[-1][1] = max(merged[-1][1], s[1])
    else:
        merged.append(list(s))
merged = [s for s in merged if s[1] - s[0] >= ${minDur}]
json.dump(merged, open(r"${outputPath.replace(/\\/g, '\\\\')}", "w"))
`
  await writeFile(scriptPath, py, 'utf-8')
  const python = await requirePython('librosa')
  try {
    await execFileAsync(python, [scriptPath], { timeout: 120_000 })
    const raw = JSON.parse(await readFile(outputPath, 'utf-8'))
    return Array.isArray(raw) ? raw : []
  } catch (e) {
    throw new Error('VAD 分段失败: ' + e.message)
  } finally {
    unlink(scriptPath).catch(() => {})
    unlink(outputPath).catch(() => {})
  }
}

/**
 * 把脚本各行文本分配到语音段上，产出 rap units（带真实时间窗）
 * - 段数 === 行数：逐行一一对应
 * - 不等：在「首段起点~末段终点」的实际说话覆盖区内按行数均匀切片（仍锚定真实说话区间）
 */
export function buildRapUnitsFromSegments(lines, segs, duration) {
  const N = lines.length
  const S = (segs || []).length
  if (S === 0) return []
  if (S === N) {
    return lines.map((text, i) => ({ text, start: +segs[i][0].toFixed(3), end: +segs[i][1].toFixed(3) }))
  }
  const t0 = segs[0][0]
  const t1 = segs[S - 1][1]
  const span = Math.max(0.5, t1 - t0)
  const denom = Math.max(1, N - 1)
  return lines.map((text, i) => {
    const k0 = t0 + (span * i) / denom
    const k1 = t0 + (span * (i + 1)) / denom
    return { text, start: +k0.toFixed(3), end: +k1.toFixed(3) }
  })
}
