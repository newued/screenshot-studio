/**
 * export.js — ffmpeg 编码（RGBA 帧序列 → MP4）
 * 复用 render-video.mjs 的 ffmpeg 管道逻辑。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureFfmpegPath } from "./pyEnv.js";
ensureFfmpegPath();
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * RGBA 帧序列 + 音频 → MP4
 * @param {string} framesDir - 包含 .rgba 文件的目录
 * @param {number} frameCount - 帧数
 * @param {number} duration - 时长（秒）
 * @param {string|null} audioPath - 音频文件路径
 * @param {string} outputPath - 输出 MP4 路径
 * @param {object} opts - { fps:30, width:1080, height:1920, onProgress }
 */
export async function encodeMP4(
  framesDir,
  frameCount,
  duration,
  audioPath,
  outputPath,
  opts = {},
) {
  const { fps = 30, width = 1080, height = 1920, onProgress } = opts;

  // 构建 ffmpeg 命令
  const args = [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${width}x${height}`,
    "-r",
    String(fps),
    "-i",
    join(framesDir, "%06d.rgba"),
  ];

  if (audioPath) {
    args.push("-i", audioPath);
    args.push("-c:a", "aac", "-b:a", "128k");
  }

  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-b:v", "4M");
  args.push("-movflags", "+faststart");
  args.push("-shortest");
  args.push(outputPath);

  onProgress?.({ status: "encoding", frameCount, duration });

  try {
    const { stdout, stderr } = await execFileAsync("ffmpeg", args, {
      timeout: 300_000,
    });
    return { success: true, outputPath, frameCount, duration };
  } catch (err) {
    throw new Error(`ffmpeg 编码失败: ${err.message}`);
  }
}

/**
 * 清理临时帧目录
 */
export async function cleanupFrames(framesDir) {
  try {
    const { readdirSync, unlinkSync, rmdirSync } = await import("node:fs");
    const files = readdirSync(framesDir);
    for (const f of files) {
      unlinkSync(join(framesDir, f));
    }
    rmdirSync(framesDir);
  } catch {
    // 忽略清理错误
  }
}
