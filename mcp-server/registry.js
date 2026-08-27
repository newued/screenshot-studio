// mcp-server/registry.js
// 核心工具注册表（反馈⑥：单一 Core API）
//
// 此前 HTTP / WebSocket / MCP-stdio 三种传输各自直接访问嵌入在 index.js 的 TOOLS 对象。
// 现把「工具注册表 + 描述 + Schema + 统一分发」抽成独立模块，三种传输都通过 dispatchTool 调用，
// 确立唯一核心 API，避免多份工具定义/描述漂移。

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { detectCapabilities } from "../scripts/core/capabilities.js";
import { transcribe, alignTimeline } from "./tools/transcribe.js";
import { extractBeatGrid, gridToUnits, snapToBeat } from "./tools/beatGrid.js";
import { renderFrame, renderAllFrames } from "./tools/render.js";
import { encodeMP4, cleanupFrames } from "./tools/export.js";
import { loadAsrConfig, applyAsrEnv } from "./tools/asrModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ASR 依赖环境（镜像源 / 禁用 xet），确保 transcribe 运行前即生效（python 子进程继承）。
applyAsrEnv();

// 真相源：pipeline_state.json（前端轮询 + agent 读取）
const STATE_PATH = join(ROOT, "pipeline_state.json");
async function readPipelineState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf-8"));
  } catch {
    return {};
  }
}
async function writePipelineState(patch) {
  const prev = await readPipelineState();
  const next = { ...prev, ...patch, updated_at: new Date().toISOString() };
  await writeFile(STATE_PATH, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

async function loadSrcModule(name) {
  const mod = await import(
    pathToFileURL(join(ROOT, "src", "lib", `${name}.js`)).href
  );
  return mod;
}

function round(n, d = 2) {
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}

// 清理临时上传目录/文件（在 alignDP 返回后调用）
async function cleanupTmpAudio(tmpAudioPath) {
  if (!tmpAudioPath) return;
  const { unlink } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await unlink(tmpAudioPath).catch(() => {});
  await import("node:fs/promises")
    .then(({ rm }) =>
      rm(dirname(tmpAudioPath), { recursive: true, force: true }),
    )
    .catch(() => {});
}

// 内置工作流剧本（随 getWorkflow 返回，agent 零配置即可用）
const WORKFLOW_TEXT = `你是「截图工坊」视频生成的总导演。用户用一句话触发，你产出聊天视频 / 全图 / 切片。

## 工具链（全部是 MCP 工具，确定性体力活由 server 做，创意决策由你做）
1) getWorkflow —— 首次会话先调，拿本剧本 + 脚本格式 + 表情库 + 动效枚举 + 曲风列表。
2) parseScript(scriptText) —— 把对话脚本文本解析成 messages 数组。
3) beatGrid(audioPath) / alignDP(audioPath, scriptText) —— 用户给本地配音路径后，提取节拍网格 + DP 全局对齐，产出每条消息的初始时间窗。
4) aiReview(...) —— 拿对齐交接包，由你做语义仲裁。
5) applyCreative —— 基于语义 + 节拍 + ASR，为每条消息决定 sticker/effect/display_start,end。校验失败会报错，必须改对再写回。
6) render(project, audioPath, outputPath) —— 合成 MP4；或 exportImage(project, mode) 导出全图/切片。

## 铁律
- 贴纸 / 动效 / 时间轴只能由你（LLM）产出，禁止用关键词规则替代。
- applyCreative 校验严格：贴纸必须是表情库文件、动效必须在枚举内、时间窗 de>ds；失败直接报错提示用户，不得静默兜底。`;

const SCRIPT_FORMAT = `脚本格式（每行一条，parseScript 可解析）：
A说：第一句台词
B说：第二句台词
旁白：场景说明（可选）

支持字段：角色用“X说：”前缀；可含 system/time/redpacket/transfer/voice 等类型。`;

/**
 * 网页「确认页面信息」回调：浏览器把音频 base64 + 用户核对的消息/成员发来，
 * 服务端落盘音频（产生 agent 可读取的真实本地路径），并写入 pipeline_state.json。
 */
async function submitPage({
  audioBase64,
  audioName,
  messages,
  members,
  title,
  groupName,
}) {
  if (!audioBase64) throw new Error("缺少 audioBase64");
  const m = /^data:([^;]+);base64,(.*)$/.exec(audioBase64);
  const mime = m ? m[1] : "";
  const b64 = m ? m[2] : audioBase64;
  const baseName = (audioName || "audio").replace(/\.[^.]+$/, "");
  const extFromName =
    audioName && audioName.includes(".")
      ? audioName.split(".").pop().toLowerCase()
      : "";
  const ext =
    extFromName ||
    (mime.includes("mp3")
      ? "mp3"
      : mime.includes("wav")
        ? "wav"
        : mime.includes("ogg")
          ? "ogg"
          : mime.includes("m4a")
            ? "m4a"
            : "mp3");
  const upDir = join(tmpdir(), "screenshort-uploads");
  await mkdir(upDir, { recursive: true });
  const safeName = baseName.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
  const audioPath = join(upDir, `${Date.now()}-${safeName}.${ext}`);
  await writeFile(audioPath, Buffer.from(b64, "base64"));
  await writePipelineState({
    current_step: "VOICEOVER",
    page_confirmed: true,
    status: "await_agent",
    audio_path: audioPath,
    audio_name: audioName || "",
    title: title || "",
    groupName: groupName || "",
    messages: messages || [],
    members: members || [],
    submitted_at: new Date().toISOString(),
  });
  return {
    ok: true,
    audio_path: audioPath,
    audio_name: audioName || "",
    message_count: (messages || []).length,
    member_count: (members || []).length,
  };
}

// ==================== 工具注册表 ====================
const TOOLS = {
  transcribe: async ({
    audioPath,
    scriptText,
    model = loadAsrConfig().model,
  }) => {
    const raw = await transcribe(audioPath, scriptText, { model });
    const lines = scriptText
      .split("\n")
      .map((l) => l.replace(/^[AB]说[：:]\s*/, "").trim())
      .filter(Boolean);
    const timeline = alignTimeline(raw, lines);
    const duration = raw.length ? raw[raw.length - 1].end : 0;
    return { timeline, duration, rawSegments: raw };
  },

  render: async ({ project, audioPath, outputPath }) => {
    const { renderAndEncode } = await import("./tools/render.js");
    return await renderAndEncode(project, audioPath, outputPath, {
      onProgress: (p) => console.error(`[render] ${p.pct}%`),
    });
  },

  parseScript: async ({ scriptText, platform = "wechat", mode = "group" }) => {
    const { parseScript } = await loadSrcModule("parseScript");
    return { messages: parseScript(scriptText) };
  },

  decide: async ({ messages }) => {
    const { decideSemantics } = await loadSrcModule("semantic");
    return { decisions: decideSemantics(messages) };
  },

  readScript: async ({ scriptPath }) => {
    const text = await readFile(scriptPath, "utf-8");
    return { scriptText: text };
  },

  beatGrid: async ({ audioPath, hopLength = 512 }) => {
    return await extractBeatGrid(audioPath, { hopLength });
  },

  alignDP: async ({
    audioPath,
    audioBase64,
    scriptText,
    model = loadAsrConfig().model,
    hopLength = 512,
  }) => {
    let tmpAudioPath = null;
    let resolvedAudioPath = audioPath;
    if (!resolvedAudioPath && audioBase64) {
      const { writeFile: wf, unlink } = await import("node:fs/promises");
      const { join: jp, dirname: dn } = await import("node:path");
      const { tmpdir: td } = await import("node:os");
      const { mkdtemp } = await import("node:fs/promises");
      const { randomUUID } = await import("node:crypto");
      const base64 = String(audioBase64).includes(",")
        ? String(audioBase64).split(",")[1]
        : String(audioBase64);
      const m = String(audioBase64).match(/data:([^;]+);base64/);
      const ext = m
        ? m[1].includes("mp4")
          ? "m4a"
          : m[1].includes("ogg")
            ? "ogg"
            : m[1].includes("wav")
              ? "wav"
              : "mp3"
        : "mp3";
      const dir = await mkdtemp(jp(td(), "screenshort-up-"));
      tmpAudioPath = jp(dir, `audio-${randomUUID()}.${ext}`);
      await wf(tmpAudioPath, Buffer.from(base64, "base64"));
      resolvedAudioPath = tmpAudioPath;
    }
    if (!resolvedAudioPath)
      throw new Error("alignDP 需要 audioPath 或 audioBase64");

    try {
      const beatResult = await extractBeatGrid(resolvedAudioPath, {
        hopLength,
      });
      const { beat_grid, grid_meta, onset_times, segments, duration } =
        beatResult;
      const lines = scriptText
        .split("\n")
        .map((l) => l.replace(/^[AB]说[：:]\s*/, "").trim())
        .filter(Boolean);
      let rapUnits = [];
      let asrQualityScore = 0;
      let alignmentMode = "beat_grid";
      let asrSegments = null;
      let asrStatus = "failed";
      let asrError = null;
      try {
        const raw = await transcribe(resolvedAudioPath, scriptText, { model });
        asrSegments = raw;
        const words = raw
          .flatMap((seg) =>
            (seg.words || []).map((word) => ({
              text: word.word || "",
              start: word.start ?? seg.start ?? 0,
              end: word.end ?? seg.end ?? 0,
            })),
          )
          .filter((word) => word.text.trim() && word.end > word.start);
        rapUnits =
          words.length >= 2
            ? words
            : raw.map((seg) => ({
                text: seg.text || "",
                start: seg.start || 0,
                end: seg.end || 0,
              }));
        const validSegs = raw.filter((s) => s.text && s.text.trim());
        const coverage = raw.length > 0 ? validSegs.length / raw.length : 0;
        const hasWords = raw.filter(
          (s) => s.words && s.words.length > 0,
        ).length;
        const wordCoverage = raw.length > 0 ? hasWords / raw.length : 0;
        asrQualityScore = round(coverage * 0.5 + wordCoverage * 0.5, 2);
        if (asrQualityScore >= 0.5) alignmentMode = "asr_enhanced";
        asrStatus = "ok";
      } catch (err) {
        asrError = err.message;
        console.error(
          "[alignDP] ASR 不可用，退化为 VAD 语音分段兜底（音画同步）:",
          err.message,
        );
        const nLines = lines.length;
        const denom = Math.max(1, nLines - 1);
        // 优先用能量 VAD 把音频切成真实说话段，让气泡锚定到实际说话时刻
        try {
          const { detectSpeechSegments, buildRapUnitsFromSegments } =
            await import(
              pathToFileURL(join(ROOT, "mcp-server", "tools", "vad.js")).href
            );
          const segs = await detectSpeechSegments(resolvedAudioPath);
          if (segs && segs.length) {
            rapUnits = buildRapUnitsFromSegments(lines, segs, duration);
            alignmentMode = "vad";
            console.error(
              `[alignDP] VAD 命中 ${segs.length} 个语音段，用于对齐 ${nLines} 行`,
            );
          }
        } catch (e2) {
          console.error(
            "[alignDP] VAD 也失败，最终退化为「脚本文本 + 节拍网格均匀切片」:",
            e2.message,
          );
        }
        // 仍为空（VAD 不可用/无语音 / 音频为带伴奏歌曲）→ 兜底切片
        if (!rapUnits.length) {
          // 按文本长度加权分配时长：长句（如歌曲长句）占更多屏幕时间，提升音画观感同步
          const weights = lines.map((t) => Math.max(1, String(t).length));
          const totalW = weights.reduce((a, b) => a + b, 0) || nLines;
          let cursor = 0;
          rapUnits = lines.map((text, i) => {
            const dur =
              (duration > 0
                ? duration
                : beat_grid[beat_grid.length - 1] || nLines) *
              (weights[i] / totalW);
            const start = +cursor.toFixed(3);
            const end =
              i < nLines - 1
                ? +(cursor + dur).toFixed(3)
                : duration || +(cursor + dur).toFixed(3);
            cursor = end;
            return { text, start, end };
          });
        }
        asrQualityScore = 0;
        if (alignmentMode === "beat_grid") alignmentMode = "beat_grid";
      }
      const { alignDP: runAlignDP } = await import(
        pathToFileURL(join(ROOT, "src", "lib", "dpAlign.js")).href
      );
      const scriptMsgs = lines.map((text, i) => ({ text, id: i }));
      const dpResult = runAlignDP(scriptMsgs, rapUnits, {
        gapPenalty: 0.15,
        threshold: 0.18,
        ambiguousEpsilon: 0.05,
        maxMergeUnits: 24,
      });
      const { mappingToTimeline } = await import(
        pathToFileURL(join(ROOT, "src", "lib", "dpAlign.js")).href
      );
      const timeline = mappingToTimeline(dpResult.mapping, duration, beat_grid);
      const lowConfidenceCount = dpResult.mapping.filter(
        (m) =>
          m.match_type !== "unmatched" && (m.calibrated_confidence ?? 0) < 0.5,
      ).length;
      const mappingMeta = {
        ...dpResult.mapping_meta,
        low_confidence_count: lowConfidenceCount,
        asr_status: asrStatus,
        asr_error: asrError,
        needs_review:
          dpResult.mapping_meta.needs_review ||
          asrStatus !== "ok" ||
          lowConfidenceCount > 0,
      };
      return {
        beat_grid,
        grid_meta,
        onset_times,
        segments,
        mapping: dpResult.mapping,
        adlib_spans: dpResult.adlib_spans,
        mapping_meta: mappingMeta,
        timeline,
        alignment_mode: alignmentMode,
        asr_quality_score: asrQualityScore,
        duration,
        asr_segments: asrSegments,
        asr_status: asrStatus,
        asr_error: asrError,
        auto_fallback: asrSegments === null,
      };
    } finally {
      await cleanupTmpAudio(tmpAudioPath);
    }
  },

  aiReview: async ({
    scriptText,
    beatGrid,
    rawSegments,
    mapping,
    asrStatus,
    asrError,
  }) => {
    const { aiReview } = await import("./tools/aiReview.js");
    return await aiReview({
      scriptText,
      beatGrid,
      rawSegments,
      mapping,
      asrStatus,
      asrError,
    });
  },

  aiApplyFix: async ({ mapping, fixes, beatGrid }) => {
    const { aiApplyFix } = await import("./tools/aiReview.js");
    return await aiApplyFix({ mapping, fixes, beatGrid });
  },

  submitPage,

  applyCreative: async ({ scriptMessages, creative }) => {
    const { applyCreative } = await import("./tools/creative.js");
    return await applyCreative({ scriptMessages, creative });
  },

  exportImage: async ({ project, mode = "full", outputDir }) => {
    const { exportStills } = await import("./tools/render.js");
    return await exportStills(project, { mode, outputDir });
  },

  getWorkflow: async () => {
    const { buildEmojiCatalog, EFFECT_ENUM } =
      await import("./tools/creative.js");
    const catalog = await buildEmojiCatalog();
    const { VOICE_STYLES } = await import(
      pathToFileURL(join(ROOT, "src", "lib", "voicePrompt.js")).href
    );
    return {
      description: WORKFLOW_TEXT,
      script_format: SCRIPT_FORMAT,
      effects: EFFECT_ENUM,
      voice_styles: VOICE_STYLES.map((s) => ({ id: s.id, name: s.name })),
      emoji_catalog: catalog.map((it) => ({
        label: it.label,
        file: "/emojis/" + it.file,
      })),
      tools: Object.keys(TOOL_DESCRIPTIONS),
    };
  },
};

// 工具描述（供 AI Agent 理解用途）
const TOOL_DESCRIPTIONS = {
  transcribe: "ASR 转写：音频文件 → 时间轴 JSON。",
  beatGrid:
    "节拍网格提取：用 librosa 分析音频，输出 BPM、节拍时间数组、onset 包络、结构分段。",
  alignDP:
    "节拍网格+ASR联合DP对齐：先取节拍网格，再跑ASR（如可用），用有序DP全局对齐生成 mapping。",
  aiReview:
    "AI语义对齐交接（说唱/演唱ASR漂移场景）：把 needs_review 条目+上下文整理成交接包。",
  aiApplyFix: "AI写回：把 fixes 应用到 mapping 并重算 mapping_meta。",
  submitPage:
    "网页回调：用户确认页面信息并上传配音音频，写入 pipeline_state.json。",
  applyCreative: "LLM 导演写回：把创意决策应用到对话，校验严格。",
  exportImage: "导出全图/切片（node 侧纯渲染）。",
  getWorkflow:
    "内置工作流剧本：首次会话调用即可获得完整流程食谱 + 脚本格式 + 表情库 + 动效枚举 + 曲风列表。",
  render: "渲染视频：项目数据 + 可选音频 → MP4。",
  parseScript: "解析脚本：脚本文本 → 消息数组。",
  decide: "语义决策：消息数组 → 决策（贴纸/动效/音效）。",
  readScript: "读取脚本文件：文件路径 → 脚本文本。",
};

// 工具输入 Schema（供 AI Agent 知道参数）
const TOOL_SCHEMAS = {
  transcribe: {
    type: "object",
    properties: {
      audioPath: { type: "string" },
      scriptText: { type: "string" },
      model: { type: "string", default: loadAsrConfig().model },
    },
    required: ["audioPath", "scriptText"],
  },
  render: {
    type: "object",
    properties: {
      project: { type: "object" },
      audioPath: { type: "string" },
      outputPath: { type: "string" },
    },
    required: ["project", "outputPath"],
  },
  parseScript: {
    type: "object",
    properties: {
      scriptText: { type: "string" },
      platform: { type: "string" },
      mode: { type: "string" },
    },
    required: ["scriptText"],
  },
  decide: {
    type: "object",
    properties: { messages: { type: "array" } },
    required: ["messages"],
  },
  readScript: {
    type: "object",
    properties: { scriptPath: { type: "string" } },
    required: ["scriptPath"],
  },
  beatGrid: {
    type: "object",
    properties: {
      audioPath: { type: "string" },
      hopLength: { type: "number", default: 512 },
    },
    required: ["audioPath"],
  },
  alignDP: {
    type: "object",
    properties: {
      audioPath: { type: "string" },
      audioBase64: { type: "string" },
      scriptText: { type: "string" },
      model: { type: "string", default: loadAsrConfig().model },
      hopLength: { type: "number", default: 512 },
    },
    required: ["scriptText"],
  },
  aiReview: {
    type: "object",
    properties: {
      scriptText: { type: "string" },
      beatGrid: { type: "array", items: { type: "number" } },
      rawSegments: { type: "array" },
      mapping: { type: "array" },
    },
    required: ["scriptText", "beatGrid", "mapping"],
  },
  aiApplyFix: {
    type: "object",
    properties: {
      mapping: { type: "array" },
      fixes: { type: "array" },
      beatGrid: { type: "array", items: { type: "number" } },
    },
    required: ["mapping", "fixes"],
  },
  submitPage: {
    type: "object",
    properties: {
      audioBase64: { type: "string" },
      audioName: { type: "string" },
      messages: { type: "array" },
      members: { type: "array" },
      title: { type: "string" },
      groupName: { type: "string" },
    },
    required: ["audioBase64"],
  },
  applyCreative: {
    type: "object",
    properties: {
      scriptMessages: { type: "array" },
      creative: { type: "array" },
    },
    required: ["scriptMessages", "creative"],
  },
  exportImage: {
    type: "object",
    properties: {
      project: { type: "object" },
      mode: { type: "string", default: "full" },
      outputDir: { type: "string" },
    },
    required: ["project"],
  },
  getWorkflow: { type: "object", properties: {} },
};

// ==================== 工作流守卫（反馈：硬性防绕过） ====================
// 任何状态相关工具被调用前，先按 pipeline_state.json 校验前置步骤是否完成。
// 失败直接抛带码错误，agent 收到后自我纠正——系统不会执行越序操作。
// 仅对「有前置依赖」的工具设防；无依赖工具（parseScript/getWorkflow/submitPage 等）默认放行。

// 对齐是否完成：不依赖某个具体 step 的 _status 字段（planner 用扁平 status），
// 而以「产物已生成」的多种信号判断，避免漏判导致合法渲染被误拦。
function alignmentDone(st) {
  return !!(
    st.timeline_status === "SUCCEEDED" ||
    st.timeline_status === "GENERATED" ||
    st.align_result ||
    st.mapping_meta ||
    ["TIMELINE", "SEMANTIC", "RENDER"].includes(st.current_step)
  );
}

function guardTool(name, state) {
  const st = state || {};
  switch (name) {
    case "render":
      // 硬性前提：未对齐（VOICEOVER/时间轴未生成）绝不允许渲染。
      // 语义步为建议性（可由 agent 经 applyCreative/aiApplyFix 增强），不作为渲染硬阻断，
      // 以免阻塞正常 run/apply-fixes 后出片路径。
      if (!alignmentDone(st)) {
        return {
          ok: false,
          code: "RENDER_NOT_ALLOWED",
          message: "VOICEOVER/时间轴未对齐完成，禁止渲染（请先 alignDP）",
        };
      }
      return { ok: true };
    case "applyCreative":
    case "aiApplyFix":
      if (!alignmentDone(st)) {
        return {
          ok: false,
          code: "STEP_NOT_READY",
          message: "VOICEOVER/时间轴未对齐完成，先运行对齐再写回创意/修正",
        };
      }
      return { ok: true };
    case "aiReview":
      if (!st.align_result && !st.mapping_meta) {
        return {
          ok: false,
          code: "ALIGN_FIRST",
          message: "需先 alignDP 产出 mapping，才能 aiReview",
        };
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}

// 统一分发（所有传输 HTTP/WS/stdio 都经此调用，确立单一核心 API）
async function dispatchTool(name, args = {}) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`工具不存在: ${name}`);
  const guard = guardTool(name, await readPipelineState());
  if (!guard.ok) {
    const err = new Error(`[GUARD:${guard.code}] ${guard.message}`);
    err.code = guard.code;
    throw err;
  }
  return await tool(args);
}

function listToolSpecs() {
  return Object.keys(TOOLS).map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name] || `工具: ${name}`,
    inputSchema: TOOL_SCHEMAS[name] || { type: "object", properties: {} },
  }));
}

// 能力探测统一由 scripts/core/capabilities.js 提供（避免与 agent-bridge 重复实现）。
// detectCapabilities 已从该模块导入并随下方 export 重新导出。

export {
  TOOLS,
  TOOL_DESCRIPTIONS,
  TOOL_SCHEMAS,
  STATE_PATH,
  readPipelineState,
  writePipelineState,
  dispatchTool,
  listToolSpecs,
  detectCapabilities,
};
