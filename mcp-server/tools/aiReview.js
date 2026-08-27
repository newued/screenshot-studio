// aiReview.js —— 把待仲裁数据交接给「主 agent（大模型）」做语义对齐
//
// 设计原则（关键修正）：
//   - MCP 只做确定性信号处理（librosa 节拍 / faster-whisper 转写 / DP 对齐），不碰 LLM、不需要任何 key。
//   - 语义仲裁由「主 agent（即对话里的大模型）」完成：它背后已有 LLM，无需用户额外提供 key。
//   - 因此本文件【不调用任何 LLM、不需要任何 API key】。它只负责：
//       1) aiReview  —— 把 needs_review 的条目 + 上下文（拍点/真实脚本/噪声ASR）整理成结构化交接包，
//                       供 agent 读取后用其自身 LLM 能力做语义归位。
//       2) aiApplyFix —— agent 完成语义归位后，把修正结果写回 mapping（含 mapping_meta 重算）。
//
// 说唱/演唱场景：ASR 漂移严重，纯字符相似度 DP 会固化错误；agent 基于「台词语义 + 上下文顺序 +
// 节拍锚点」归位，比逐字匹配可靠。

function parseScriptLines(scriptText) {
  return (scriptText || "")
    .split("\n")
    .map((l) =>
      l
        .replace(/^[AB]说[：:]\s*/, "")
        .replace(/^\[.+\]\s*/, "")
        .trim(),
    )
    .filter(Boolean);
}

// 提取待仲裁条目（DP 自动对齐后 needs_review 的部分）
function pickReviewItems(mapping) {
  return (mapping || [])
    .map((m, i) => ({ _index: i, ...m }))
    .filter(
      (m) =>
        m.match_type === "unmatched" ||
        m.ambiguous ||
        (m.calibrated_confidence ?? 1) < 0.5,
    );
}

function normalizeAudioText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\s，。！？、,.!?；;：:"'（）()《》…—\-~～·]/g, "");
}

function findRepeatedSegments(rawSegments) {
  const repeated = [];
  for (let i = 1; i < (rawSegments || []).length; i++) {
    const previous = normalizeAudioText(rawSegments[i - 1]?.text);
    const current = normalizeAudioText(rawSegments[i]?.text);
    if (
      previous &&
      current &&
      (previous === current ||
        previous.includes(current) ||
        current.includes(previous))
    ) {
      repeated.push({
        first: i - 1,
        second: i,
        reason: "相邻重复，可能是副歌或复唱，不应直接判为错误",
      });
    }
  }
  return repeated;
}

/**
 * 交接包：供主 agent 读取并做语义对齐（不调 LLM）
 * @returns {Promise<{available:boolean, needs_total:number, reviewItems:Array, context:object, prompt:string}>}
 */
export async function aiReview({
  scriptText,
  beatGrid,
  rawSegments,
  mapping,
  asrStatus,
  asrError,
}) {
  const scriptLines = parseScriptLines(scriptText);
  const reviewItems = pickReviewItems(mapping);

  // 结构化上下文（agent 据此推理，无需再调外部模型）
  const context = {
    asr_status: asrStatus || "unknown",
    asr_error: asrError || "",
    beat_grid: (beatGrid || []).map((b) => +(+b).toFixed(3)),
    script_lines: scriptLines.map((t, i) => ({ message_id: i, text: t })),
    raw_segments: (rawSegments || []).map((s) => ({
      start: s.start,
      end: s.end,
      text: (s.text || "").trim(),
      words: (s.words || []).map((w) => ({
        word: w.word,
        start: w.start,
        end: w.end,
      })),
    })),
    repeated_segments: findRepeatedSegments(rawSegments),
    mapping: mapping || [],
  };

  // 给 agent 的指令（agent 用自己的 LLM 能力执行）
  const prompt =
    "你是音视频字幕/歌词对齐专家。输入音频可能是说唱/演唱，ASR 转写已严重漂移，不能逐字匹配。\n" +
    "请把整条时间轴作为一个整体审阅，基于【脚本权威文本 + ASR真实时间 + 顺序】归位；拖音、复唱、副歌重复和 ad-lib 不是错误：\n" +
    "1) 严格保持脚本原始顺序（message_id 升序）；\n" +
    "2) 每条 start/end 落在相邻拍点之间，start 对齐或略早于某拍，end 不超过下一条 start；\n" +
    "3) 若确实无法定位（纯 adlib/哼唱），match_type 标 unmatched 并给 proposed_at 取最近拍；\n" +
    "4) 复唱句必须结合出现轮次和时间位置判断，不要把重复内容全部合并；拖音的 end 应覆盖实际发声，不要按字数截断；\n" +
    '5) 输出 JSON：{ "fixes": [ { "index":<原mapping索引>, "message_id":<n>, "start":<秒>, "end":<秒>, ' +
    '"match_type":"exact|paraphrase|partial|adlib|unmatched", "calibrated_confidence":<0-1>, "note":"<理由>" } ] }';

  return {
    available: true,
    needs_total: reviewItems.length,
    reviewItems: reviewItems.map((m) => ({
      index: m._index,
      message_id: m.message_id,
      rap_span: m.rap_span || null,
      proposed_at: m.proposed_at ?? null,
      match_type: m.match_type,
      calibrated_confidence: m.calibrated_confidence ?? 0,
      ambiguous: !!m.ambiguous,
    })),
    context,
    prompt,
  };
}

/**
 * 写回：agent 完成语义归位后，把 fixes 应用到 mapping
 * @param {object} params
 * @param {Array} params.mapping        alignDP 原始 mapping
 * @param {Array} params.fixes         agent 产出的修正 [{index,message_id,start,end,match_type,calibrated_confidence,note}]
 * @param {Array} [params.beatGrid]    可选，用于把 start/end 吸附到最近拍点
 * @returns {Promise<{mapping:Array, mapping_meta:object, applied:number}>}
 */
export async function aiApplyFix({
  mapping,
  fixes,
  beatGrid,
  snapToBeat = false,
}) {
  const beats = (beatGrid || []).map((b) => +b).sort((a, b) => a - b);
  const snap = (t) => {
    if (!beats.length || t == null) return t;
    let best = beats[0];
    let bd = Math.abs(t - best);
    for (const b of beats) {
      const d = Math.abs(t - b);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return +best.toFixed(3);
  };

  const fixMap = new Map();
  for (const f of fixes || []) {
    if (f && f.index != null) fixMap.set(Number(f.index), f);
  }

  const newMapping = (mapping || []).map((m, i) => {
    const f = fixMap.get(i);
    if (!f) return m;
    const start =
      f.start != null
        ? snapToBeat
          ? snap(f.start)
          : +Number(f.start).toFixed(3)
        : (m.rap_span?.start ?? m.proposed_at ?? null);
    const end =
      f.end != null
        ? snapToBeat
          ? snap(f.end)
          : +Number(f.end).toFixed(3)
        : (m.rap_span?.end ?? m.proposed_at ?? null);
    return {
      ...m,
      rap_span:
        start != null && end != null ? { start, end } : m.rap_span || null,
      proposed_at: start != null ? start : (m.proposed_at ?? null),
      match_type: f.match_type || m.match_type || "paraphrase",
      calibrated_confidence:
        f.calibrated_confidence != null
          ? +f.calibrated_confidence
          : (m.calibrated_confidence ?? 0.6),
      ambiguous: false,
      ai_reviewed: true,
      review_note: f.note || m.review_note || "",
    };
  });

  // 重算 mapping_meta
  const total = newMapping.length;
  const matched = newMapping.filter(
    (m) => m.match_type && m.match_type !== "unmatched",
  ).length;
  const unmatched = total - matched;
  const ambiguous = newMapping.filter((m) => m.ambiguous).length;
  const needs_review = unmatched > 0 || ambiguous > 0;

  return {
    mapping: newMapping,
    mapping_meta: {
      matched_count: matched,
      unmatched_count: unmatched,
      ambiguous_count: ambiguous,
      total_messages: total,
      total_rap_units: newMapping.length,
      needs_review,
      ai_reviewed: true,
    },
    applied: fixMap.size,
  };
}

export { parseScriptLines, pickReviewItems };
