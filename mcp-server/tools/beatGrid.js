/**
 * beatGrid.js — librosa 节拍网格提取（Python 子进程）
 *
 * Stage A（V1.1 设计文档 5.1 节）：
 *   - librosa.beat_track 取 BPM 与节拍时间点 → beat_grid
 *   - librosa.onset.onset_detect 叠加 onset 包络做细网格
 *   - librosa.segment 识别结构段（hook/副歌）
 *
 * 输出格式对应 voiceover.json 的 beat_grid / grid_meta 部分。
 */
import { execFile } from "node:child_process";
import { writeFile, readFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { requirePython } from "./pyEnv.js";
import { normalizeAudio } from "./audio.js";

const execFileAsync = promisify(execFile);

/**
 * 提取音频节拍网格
 * @param {string} audioPath - 音频文件绝对路径
 * @param {object} opts - { hopLength, onProgress }
 * @returns {{
 *   beat_grid: number[],
 *   grid_meta: { bpm: number, method: string, duration: number, beat_count: number },
 *   onset_envelope: number[],
 *   segments: Array<{ start: number, end: number, label: string }>,
 *   duration: number
 * }}
 */
export async function extractBeatGrid(audioPath, opts = {}) {
  const { hopLength = 512, onProgress } = opts;

  if (!audioPath) {
    throw new Error("extractBeatGrid 需要 audioPath（音频文件绝对路径）");
  }

  const normalized = await normalizeAudio(audioPath);
  const tmpDir = await mkdtemp(join(tmpdir(), "screenshort-beat-"));
  const scriptPath = join(tmpDir, "beatgrid.py");
  const outputPath = join(tmpDir, "result.json");

  // Python 脚本：librosa 节拍提取 + onset 包络 + 结构分段
  const pyScript = `
import json, sys, os
import librosa
import numpy as np

audio_path = r"${normalized.path.replace(/\\/g, "\\\\")}"
hop_length = ${hopLength}

# 加载音频：先用 ffmpeg 转 WAV，规避 MP3 VBR 头声明时长错误
# （soundfile/librosa 按 MP3 头加载会截断到错误时长；ffmpeg 读真实流时长）
import subprocess, tempfile
try:
    _wav = tempfile.mktemp(suffix=".wav")
    subprocess.run(["ffmpeg", "-y", "-i", audio_path, _wav],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    y, sr = librosa.load(_wav, sr=None, mono=True)
    duration = len(y) / sr
except Exception:
    # ffmpeg 不可用则回退直接加载
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    duration = len(y) / sr
finally:
    try:
        if '_wav' in dir() and os.path.exists(_wav):
            os.remove(_wav)
    except Exception:
        pass

# Stage A-1: BPM 估计（librosa 0.11 的 beat_track 已废弃且稀疏信号会返回 0 拍，
# 改用 feature.tempo 取中位数，更鲁棒）
try:
    tempo_arr = librosa.feature.tempo(y=y, sr=sr, hop_length=hop_length)
    if hasattr(tempo_arr, "__len__") and len(tempo_arr):
        tempo = float(np.median(tempo_arr))
    else:
        tempo = float(tempo_arr)
    if tempo <= 0 or not np.isfinite(tempo):
        tempo = 120.0
except Exception:
    tempo = 120.0

# Stage A-2: onset 包络 + 拍点放置（从首个强 onset 锚定，按 BPM 周期铺排）
onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=hop_length)
onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop_length)

spb = 60.0 / tempo
first_beat = float(onset_times[0]) if len(onset_times) > 0 else 0.0
beat_times = []
t = first_beat
while t <= duration + 1e-6:
    beat_times.append(t)
    t += spb

# 兜底：若 onset 检测失败导致拍点过少，用自相关重估 BPM
if len(beat_times) <= 1 and len(onset_env) > 0:
    ac = librosa.autocorrelate(onset_env, max_size=len(onset_env))
    ac[: max(1, int(sr / hop_length / 4))] = 0
    lag = int(np.argmax(ac)) if len(ac) else 0
    if lag > 0:
        bpm2 = 60.0 * (sr / hop_length) / lag
        if bpm2 > 0 and np.isfinite(bpm2):
            tempo = bpm2
            spb = 60.0 / tempo
            beat_times = []
            t = first_beat
            while t <= duration + 1e-6:
                beat_times.append(t)
                t += spb

# 降采样 onset 包络用于前端展示（取 200 个采样点）
target_samples = 200
step = max(1, len(onset_env) // target_samples)
onset_env_sampled = []
for i in range(0, len(onset_env), step):
    t = librosa.frames_to_time(i, sr=sr, hop_length=hop_length)
    onset_env_sampled.append({"t": round(float(t), 3), "v": round(float(onset_env[i]), 4)})

# Stage A-3: 结构分段（识别 hook/副歌，非关键，失败兜底为整段）
try:
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length)
    k = max(2, min(8, int(duration / 15)))
    bound_frames = librosa.segment.agglomerative(chroma, k=k)
    bound_times = librosa.frames_to_time(bound_frames, sr=sr, hop_length=hop_length)

    segments = []
    for i in range(len(bound_times)):
        start = float(bound_times[i])
        end = float(bound_times[i + 1]) if i + 1 < len(bound_times) else duration
        # 简单标签：根据段落位置
        if i == 0:
            label = "intro"
        elif i == len(bound_times) - 1:
            label = "outro"
        else:
            label = f"section_{i}"
        segments.append({"start": round(start, 3), "end": round(end, 3), "label": label})
except Exception as e:
    segments = [{"start": 0.0, "end": round(duration, 3), "label": "full"}]

result = {
    "beat_grid": [round(float(t), 4) for t in beat_times],
    "grid_meta": {
        "bpm": round(tempo, 1),
        "method": "librosa.beat_track",
        "duration": round(duration, 3),
        "beat_count": len(beat_times),
        "hop_length": hop_length,
        "sr": sr,
    },
    "onset_envelope": onset_env_sampled,
    "onset_times": [round(float(t), 4) for t in onset_times],
    "segments": segments,
    "duration": round(duration, 3),
}

with open(r"${outputPath.replace(/\\/g, "\\\\")}", "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False)
print("OK")
`;

  await writeFile(scriptPath, pyScript, "utf-8");
  onProgress?.("启动 librosa 节拍提取…");

  const py = await requirePython("librosa");
  try {
    await execFileAsync(py, [scriptPath], { timeout: 120_000 });
  } catch (err) {
    throw new Error(`librosa 节拍提取失败: ${err.message}`);
  } finally {
    unlink(scriptPath).catch(() => {});
    await normalized.cleanup();
  }

  const raw = JSON.parse(await readFile(outputPath, "utf-8"));
  unlink(outputPath).catch(() => {});
  // 清理临时目录
  try {
    await import("node:fs").then((fs) => fs.rmdirSync(tmpDir));
  } catch {
    /* */
  }

  return raw;
}

/**
 * 将节拍网格吸附到最近的拍点
 * @param {number} time - 原始时间
 * @param {number[]} beatGrid - 节拍时间数组
 * @returns {number} 吸附后的时间
 */
export function snapToBeat(time, beatGrid) {
  if (!beatGrid || beatGrid.length === 0) return time;
  let best = beatGrid[0];
  let bestDist = Math.abs(time - best);
  for (const t of beatGrid) {
    const d = Math.abs(time - t);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

/**
 * 从节拍网格推算段落级单元（无 ASR 时用作 rap 行级单元）
 * 按节拍间隔分组：连续拍点间距接近的归为一段，
 * 或按固定拍数（默认 4 拍 = 1 小节）切分。
 * @param {number[]} beatGrid - 节拍时间数组
 * @param {number} beatsPerUnit - 每单元拍数（默认 4）
 * @param {number} duration - 音频总时长
 * @returns {Array<{ start: number, end: number, beat_index: number }>}
 */
export function gridToUnits(beatGrid, beatsPerUnit = 4, duration = 0) {
  if (!beatGrid || beatGrid.length === 0) return [];
  const units = [];
  for (let i = 0; i < beatGrid.length; i += beatsPerUnit) {
    const start = beatGrid[i];
    const endIdx = Math.min(i + beatsPerUnit, beatGrid.length - 1);
    const end =
      i + beatsPerUnit < beatGrid.length
        ? beatGrid[i + beatsPerUnit]
        : duration || beatGrid[beatGrid.length - 1];
    units.push({
      start: round(start),
      end: round(end),
      beat_index: i,
    });
  }
  // 确保最后一个单元延伸到音频末尾
  if (units.length > 0 && duration > 0) {
    units[units.length - 1].end = round(duration);
  }
  return units;
}

function round(n, d = 4) {
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}
