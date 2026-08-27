import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readState } from "../scripts/core/state.js";

test("状态中的脚本、音频和对齐产物可作为断点续跑依据", () => {
  const dir = mkdtempSync(join(tmpdir(), "screenshort-planner-test-"));
  const statePath = join(dir, "pipeline_state.json");
  const state = {
    project_id: "p1",
    script_text: "A说：你好",
    audio_path: "C:\\audio.wav",
    script_messages: [{ speaker: "A", content: "你好" }],
    align_result: {
      mapping: [{ message_id: 0, rap_span: { start: 1, end: 2 } }],
    },
  };
  writeFileSync(statePath, JSON.stringify(state), "utf8");
  const saved = readState(statePath);
  assert.ok(saved?.align_result?.mapping);
  assert.equal(saved.project_id, "p1");
  assert.equal(saved.script_text, "A说：你好");
  rmSync(dir, { recursive: true, force: true });
});
