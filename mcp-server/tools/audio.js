import { execFile } from "node:child_process";
import { mkdtemp, unlink, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { ensureFfmpegPath } from "./pyEnv.js";

const execFileAsync = promisify(execFile);

export async function normalizeAudio(audioPath) {
  if (!audioPath) throw new Error("normalizeAudio 需要 audioPath");
  ensureFfmpegPath();
  const dir = await mkdtemp(join(tmpdir(), "screenshort-audio-"));
  const outputPath = join(dir, "normalized.wav");
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        audioPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        outputPath,
      ],
      { timeout: 300_000 },
    );
    return {
      path: outputPath,
      cleanup: async () => rm(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new Error(
      `音频标准化失败（请检查音频格式和 FFmpeg）：${error.stderr || error.message}`,
    );
  }
}
