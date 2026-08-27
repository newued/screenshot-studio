/**
 * transcribe.js — 原生 faster-whisper ASR（Python 子进程）
 * 替代浏览器端 transformers.js WASM 推理，性能提升 10-50x。
 */
import { execFile } from "node:child_process";
import { writeFile, readFile, unlink, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { requirePython } from "./pyEnv.js";
import { loadAsrConfig } from "./asrModel.js";
import { normalizeAudio } from "./audio.js";

const execFileAsync = promisify(execFile);

/**
 * 调用 Python faster-whisper 转写音频并按脚本行对齐
 * @param {string} audioPath - 音频文件绝对路径
 * @param {string} scriptText - 脚本文本（A说：/B说： 格式）
 * @param {object} opts - 选项 { model:'small', device:'cpu', computeType:'int8' }
 * @returns {{ timeline: Array<{display_start,display_end}>, text: string[], raw: object[] }}
 */
export async function transcribe(audioPath, scriptText, opts = {}) {
  const cfg = loadAsrConfig();
  const {
    model = cfg.model,
    device = cfg.device,
    computeType = cfg.computeType,
    language = cfg.language,
    onProgress,
  } = opts;
  const promptText = String(scriptText || "")
    .replace(/^[^\n]*?说[：:]\s*/gm, "")
    .replace(/\s+/g, " ")
    .slice(0, 1800);

  if (!audioPath) {
    throw new Error(
      "transcribe 需要 audioPath（音频文件绝对路径）。浏览器上传的 File 无法直接传给 MCP Server，需先保存到磁盘。",
    );
  }

  const normalized = await normalizeAudio(audioPath);

  const py = await requirePython("faster_whisper");
  const models = [...new Set(opts.fallbackModels || [model, "base", "tiny"])];
  const computeTypes = [...new Set([computeType, "float32"])];
  const failures = [];
  onProgress?.("启动 faster-whisper 转写…");

  for (const attemptModel of models) {
    for (const attemptComputeType of computeTypes) {
      const tmpDir = await mkdtemp(join(tmpdir(), "screenshort-asr-"));
      const scriptPath = join(tmpDir, "transcribe.py");
      const outputPath = join(tmpDir, "result.json");
      const pyScript = `
import json, sys
from faster_whisper import WhisperModel

model = WhisperModel("${attemptModel}", device="${device}", compute_type="${attemptComputeType}")
segments, info = model.transcribe(
    "${normalized.path.replace(/\\/g, "\\\\")}",
    language="${language}",
    word_timestamps=True,
  beam_size=5,
  condition_on_previous_text=False,
  initial_prompt="以下是简体中文的对话或说唱歌词。${promptText.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"
)

result = []
for seg in segments:
    words = []
    if seg.words:
        for w in seg.words:
            words.append({"word": w.word, "start": w.start, "end": w.end})
    result.append({
        "text": seg.text.strip(),
        "start": seg.start,
        "end": seg.end,
        "words": words
    })

with open("${outputPath.replace(/\\/g, "\\\\")}", "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False)
print("OK")
`;

      await writeFile(scriptPath, pyScript, "utf-8");
      try {
        await execFileAsync(py, [scriptPath], {
          timeout: 300_000,
          maxBuffer: 1024 * 1024,
        });
        const raw = JSON.parse(await readFile(outputPath, "utf-8"));
        await rm(tmpDir, { recursive: true, force: true });
        raw.asr_runtime = {
          model: attemptModel,
          computeType: attemptComputeType,
        };
        return raw;
      } catch (error) {
        const detail = [
          error.code && `code=${error.code}`,
          error.stderr?.trim(),
          error.message,
        ]
          .filter(Boolean)
          .join("; ");
        failures.push(`${attemptModel}/${attemptComputeType}: ${detail}`);
      } finally {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  await normalized.cleanup();
  throw new Error(
    `faster-whisper 执行失败，已尝试 ${failures.length} 种运行配置：${failures.join(" | ")}`,
  );
}

/**
 * 按脚本行对齐 ASR 结果（word 级滑动窗口 + 字符 Jaccard）
 * 参考 e2e-word-align.mjs 的算法
 */
export function alignTimeline(rawSegments, scriptLines) {
  // 展平所有 words
  const words = [];
  for (const seg of rawSegments) {
    if (seg.words && seg.words.length) {
      for (const w of seg.words) {
        words.push({ start: w.start, end: w.end, text: w.word });
      }
    } else {
      words.push({ start: seg.start, end: seg.end, text: seg.text });
    }
  }

  if (!words.length) {
    // 无 word 数据，退回 segment 级
    return alignBySegments(rawSegments, scriptLines);
  }

  // 提取中文字符
  const extractChinese = (s) => {
    const chars = (s || "").match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
    return new Set(chars || []);
  };

  const results = [];
  let wordPtr = 0;

  for (const line of scriptLines) {
    const lineChars = extractChinese(line);
    if (!lineChars.size) {
      // 纯标点行，跳过
      const prevEnd = results.length
        ? results[results.length - 1].display_end
        : 0;
      results.push({ display_start: prevEnd, display_end: prevEnd + 0.3 });
      continue;
    }

    let bestScore = 0;
    let bestStart = wordPtr;
    let bestEnd = wordPtr;

    // 滑动窗口 1-15 词
    for (let k = 1; k <= Math.min(15, words.length - wordPtr); k++) {
      const windowWords = words.slice(wordPtr, wordPtr + k);
      const windowText = windowWords.map((w) => w.text).join("");
      const windowChars = extractChinese(windowText);
      if (!windowChars.size) continue;

      // Jaccard 相似度
      let intersection = 0;
      for (const c of lineChars) if (windowChars.has(c)) intersection++;
      const union = lineChars.size + windowChars.size - intersection;
      const score = union > 0 ? intersection / union : 0;

      if (score > bestScore) {
        bestScore = score;
        bestStart = wordPtr;
        bestEnd = wordPtr + k - 1;
      }
    }

    if (bestScore >= 0.15 && bestEnd >= bestStart) {
      const wStart = words[bestStart].start;
      const wEnd = words[bestEnd].end;
      const prevEnd = results.length
        ? results[results.length - 1].display_end
        : 0;
      const ds = Math.max(wStart, prevEnd);
      const de = Math.max(wEnd + 0.4, ds + 0.5);
      results.push({ display_start: ds, display_end: de });
      wordPtr = bestEnd + 1;
    } else {
      // 未命中，按字数估算
      const prevEnd = results.length
        ? results[results.length - 1].display_end
        : 0;
      const est = Math.max(0.5, Math.min(lineChars.size * 0.25, 8));
      results.push({ display_start: prevEnd, display_end: prevEnd + est });
      wordPtr = Math.min(wordPtr + 1, words.length);
    }
  }

  return results;
}

function alignBySegments(segments, scriptLines) {
  const results = [];
  let ptr = 0;
  for (const line of scriptLines) {
    if (ptr < segments.length) {
      const seg = segments[ptr];
      results.push({ display_start: seg.start, display_end: seg.end });
      ptr++;
    } else {
      const prevEnd = results.length
        ? results[results.length - 1].display_end
        : 0;
      results.push({ display_start: prevEnd, display_end: prevEnd + 1 });
    }
  }
  return results;
}
