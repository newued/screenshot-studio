import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScript } from "../src/lib/parseScript.js";

test("A说：/B说： 解析为对应说话人文本", () => {
  const msgs = parseScript("A说：hello\nB说：world");
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs[0], { type: "text", speaker: "A", content: "hello" });
  assert.deepEqual(msgs[1], { type: "text", speaker: "B", content: "world" });
});

test("兼容 [A]、A: 和 A说：三种说话人前缀", () => {
  const msgs = parseScript("[A] hello\nB: world\nA说：again");
  assert.deepEqual(msgs, [
    { type: "text", speaker: "A", content: "hello" },
    { type: "text", speaker: "B", content: "world" },
    { type: "text", speaker: "A", content: "again" },
  ]);
});

test("未知方括号内容仍解析为 system", () => {
  const msgs = parseScript("[角色] hello\n[系统] world");
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].type, "system");
  assert.equal(msgs[1].type, "system");
});

test("系统/时间/红包等特殊行解析正确", () => {
  const msgs = parseScript("系统：xxx\n时间：12:00\nA说：[红包：祝福]");
  assert.equal(msgs[0].type, "system");
  assert.equal(msgs[1].type, "time");
  assert.equal(msgs[2].type, "redpacket");
  assert.equal(msgs[2].speaker, "A");
});
