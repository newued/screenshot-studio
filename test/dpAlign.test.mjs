import { test } from "node:test";
import assert from "node:assert/strict";
import { alignDP } from "../src/lib/dpAlign.js";

test("一条脚本消息覆盖连续多个 ASR 词的完整时间跨度", () => {
  const result = alignDP(
    [{ text: "接口又报错了" }],
    [
      { text: "接口", start: 1.2, end: 1.5 },
      { text: "又报", start: 1.5, end: 1.8 },
      { text: "错了", start: 1.8, end: 2.1 },
    ],
    { threshold: 0.18, maxMergeUnits: 24 },
  );

  assert.equal(result.mapping.length, 1);
  assert.deepEqual(result.mapping[0].rap_span, { start: 1.2, end: 2.1 });
  assert.deepEqual(result.mapping[0].rap_words_ref, [0, 2]);
});
