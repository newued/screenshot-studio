import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAudio } from "../mcp-server/tools/audio.js";

test("音频标准化输出 16kHz 单声道 WAV", async () => {
  const input = "test/fixtures-normalize-input.wav";
  const output = "test/fixtures-normalize-output.wav";
  const { execFileSync } = await import("node:child_process");
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.2",
    input,
  ]);
  const normalized = await normalizeAudio(input);
  try {
    const probe = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=sample_rate,channels,codec_name",
        "-of",
        "default=noprint_wrappers=1",
        normalized.path,
      ],
      { encoding: "utf8" },
    );
    assert.match(probe, /sample_rate=16000/);
    assert.match(probe, /channels=1/);
    assert.match(probe, /codec_name=pcm_s16le/);
  } finally {
    await normalized.cleanup();
    const { unlink } = await import("node:fs/promises");
    await unlink(input).catch(() => {});
    await unlink(output).catch(() => {});
  }
});
