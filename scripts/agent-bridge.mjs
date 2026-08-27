#!/usr/bin/env node
/**
 * agent-bridge.mjs —— agent（OpenCode / Codex / WorkBuddy / 本会话大模型）编排握手层
 *
 * 设计原则：仅保留「人机协同」单一流程
 *   1) UI 默认只有「整图/切片」；agent 以 ?agent=1 打开时暴露「确认页面信息」与「生成视频」。
 *   2) AI 交互前提是 UI 软件（后端 + 前端）已打开；行为/触发由 agent 控制优先。
 *   3) MCP Server 已暴露标准工具（transcribe/parseScript/beatGrid/alignDP/aiReview/aiApplyFix/render），
 *      本脚本只做「生命周期 + 编排握手 + 真相源」，不实现任何 AI 推理。
 *   4) 说唱/演唱等需要语义的步骤：脚本跑完 alignDP 后若 needs_review，
 *      打印交接包（reviewItems + context + prompt）交给调用方（agent 自带 LLM）做语义归位，
 *      调用方再调 apply-fixes 写回。全程不依赖外部 LLM key。
 *
 * 标准工作流（人机协同）：
 *   1) open [page] [--script @文件] [--audio URL]  → 打开网页注入脚本/音频
 *   2) 用户在网页：核对对话/头像/名称 → 选配音 → 点「确认页面信息」
 *   3) 用户回说「信息已确认」 → agent 调 run-page 完成对齐/渲染出片
 *   4) 若触发 needs_review：agent 基于 AI_HANDOFF_JSON 产出 fixes → apply-fixes → 继续渲染
 *
 * 子命令：
 *   ensure                     确保 mcp-server 在跑（不在则后台拉起 --http-only）
 *   open [page] [--script S] [--audio URL]   以 ?agent=1 打开 UI（Windows 用默认浏览器）
 *   genlink [page] [--script S] [--audio U] [--open]  拼装深链 URL（仅注入脚本/音频）
 *   run  --audio A --script S [--decisions @决策.json] [--platform wechat] [--mode single|group]
 *        [--out out.mp4] [--skip-render]      跑 parseScript→alignDP→(render)
 *                                             --decisions 把贴纸/动效写回每句；needs_review 时打印交接包并以退出码 2 退出
 *   run-page [--platform wechat] [--mode single|group] [--out out.mp4]
 *                                             读网页已确认状态，串对齐+渲染
 *   apply-fixes --state FILE --fixes JSON     将 agent 产出的语义修正写入 mapping（调 aiApplyFix），重算 meta
 *   tag-stickers [--state FILE]               语义贴纸标注（情绪度阈值兜底）
 *   status [--state FILE]                     查看 pipeline_state.json 真相源
 *
 * 退出码：0=成功；2=需要 AI 语义干预（已打印交接包）；非 0 其他=失败。
 */

import { spawn, execSync } from "node:child_process";
import http from "node:http";
import { readFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_STATUS } from "../src/lib/pipelineContract.js";
import {
  readState,
  writeState,
  patchState,
  projectsBase,
} from "./core/state.js";
import { buildProject, buildScriptText } from "./core/project.js";
import {
  applyDecisionsToMessages,
  scoreEmotion,
  pickSticker,
  STICKER_THRESHOLD,
} from "./core/decisions.js";
import { callTool, health } from "./core/client.js";
import { runProductionPlan, cancelProductionPlan } from "./core/planner.js";
import { detectCapabilities } from "./core/capabilities.js";
import { runDoctor } from "./core/doctor.js";
import {
  ensureAsrModel,
  isAsrModelCached,
  loadAsrConfig,
} from "../mcp-server/tools/asrModel.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SERVER_ENTRY = join(ROOT, "mcp-server", "index.js");
const STATE_PATH = join(ROOT, "pipeline_state.json");
const DEV_PORT = 5173;

const log = (...a) => console.log("[agent-bridge]", ...a);
const err = (...a) => console.error("[agent-bridge]", ...a);

// ====================== 生命周期 ======================
// 后端/前端静默拉起：用 PowerShell Start-Process 创建真正独立的进程（不被调用方进程树追踪），
// 否则命令结束时外层（bash 包装器）清理 detached child 会报 "Unknown: ChildProcess.kill"（#13）。
function launchServerDetached() {
  const entry = SERVER_ENTRY.replace(/\\/g, "/");
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Start-Process 'node' -ArgumentList '${entry}','--http-only' -WindowStyle Hidden"`,
      { stdio: "ignore" },
    );
  } else {
    const child = spawn("node", [SERVER_ENTRY, "--http-only"], {
      cwd: ROOT,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
}

function launchViteDetached() {
  if (process.platform === "win32") {
    const viteEntry = join(
      ROOT,
      "node_modules",
      "vite",
      "bin",
      "vite.js",
    ).replace(/'/g, "''");
    execSync(
      `powershell -NoProfile -Command "Start-Process '${process.execPath.replace(/'/g, "''")}' -ArgumentList '${viteEntry}' -WorkingDirectory '${ROOT.replace(/'/g, "''")}' -WindowStyle Hidden"`,
      { stdio: "ignore" },
    );
  } else {
    const child = spawn("npm", ["run", "dev"], {
      cwd: ROOT,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
}

function ping(port, pathname = "/") {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, method: "GET", timeout: 1500 },
      (r) => {
        r.resume();
        resolve(r.statusCode > 0 && r.statusCode < 500);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureServer() {
  if (await health()) {
    log("mcp-server 已在运行");
    return true;
  }
  log("拉起 mcp-server (--http-only)...");
  launchServerDetached();
  // 轮询等待就绪
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if (await health()) {
      log("mcp-server 就绪");
      const { warnings } = runDoctor();
      if (warnings.length) {
        err("环境自检警告（doctor）：");
        for (const w of warnings) err("  - " + w);
      }
      return true;
    }
  }
  throw new Error("mcp-server 启动超时");
}

function openUI(opts = {}) {
  const page = opts.page || "wechat/single";
  const params = new URLSearchParams();
  params.set("agent", "1");
  if (opts.script) params.set("script", opts.script);
  if (opts.audio) params.set("audio", opts.audio);
  const url = `http://localhost:${DEV_PORT}/${page}?${params.toString()}`;
  log("打开 UI:", url);
  // Windows：用默认浏览器打开
  try {
    execSync(`start "" "${url}"`, { stdio: "ignore", windowsHide: true });
  } catch (e) {
    err("自动打开失败，请手动访问：", url, e.message);
  }
  return url;
}

// ====================== 子命令实现 ======================
async function cmdRun(args) {
  await ensureServer();
  const audio = args["--audio"];
  const script = readArgVal(args["--script"] || "");
  const platform = args["--platform"] || "wechat";
  const mode = args["--mode"] || "single";
  const out =
    args["--out"] ||
    join(
      homedir(),
      "Downloads",
      "screenshot-studio",
      `agent-out-${Date.now()}.mp4`,
    );
  const skipRender = !!args["--skip-render"];
  const allowApproximate = !!args["--allow-approximate"];

  if (!audio) throw new Error("run 需要 --audio <音频路径或URL>");
  if (!script) throw new Error("run 需要 --script <脚本文本>");

  // 语义贴纸/动效决策（可选）：把 decisions 交给 Planner 合并进解析后的消息，渲染才会有贴纸。
  // 不传 --decisions 也能出片，但无语义贴纸（可用 tag-stickers 规则兜底或 apply-fixes 补）。
  let decisions = [];
  if (args["--decisions"]) {
    const raw = readArgVal(args["--decisions"]);
    decisions = typeof raw === "string" ? JSON.parse(raw) : raw;
  }

  // 委托给 Planner（scripts/core/planner.js）执行生产计划；解析与决策合并都在 Planner 内完成
  const res = await runProductionPlan({
    statePath: STATE_PATH,
    projectId: "default",
    audioPath: audio,
    scriptText: script,
    decisions,
    platform,
    mode,
    groupName: "",
    out,
    skipRender,
    allowApproximate,
  });
  if (res.needsReview) {
    console.log("\n=== AI_HANDOFF_JSON ===");
    console.log(JSON.stringify(res.handoff, null, 2));
    console.log("=== END_AI_HANDOFF ===\n");
    err(
      "需要 AI 语义干预：请 agent 基于上面 AI_HANDOFF_JSON 产出 fixes，再调 `apply-fixes`。",
    );
    process.exitCode = 2;
    return;
  }
  if (res.skipped) {
    log("已跳过 render（--skip-render）。align 结果见 pipeline_state.json。");
    return;
  }
  log(
    res.preview ? "近似同步预览已生成，未通过质量复核：" : "完成，输出：",
    out,
  );
}

async function cmdApplyFixes(args) {
  await ensureServer();
  const stateFile = args["--state"] || STATE_PATH;
  const state0 = readState() || {};
  let fixes;
  if (args["--fixes"]) {
    const raw = args["--fixes"];
    const text = raw.startsWith("@")
      ? readFileSync(resolve(raw.slice(1)), "utf8")
      : raw;
    fixes = JSON.parse(text);
  } else {
    // 从 stdin 读
    const stdin = readFileSync(0, "utf8");
    fixes = JSON.parse(stdin);
  }
  const state = state0;
  const mapping = state?.align_result?.mapping;
  if (!mapping)
    throw new Error(
      "pipeline_state.json 中无 align_result.mapping，请先 run。",
    );
  const beatGrid = state.align_result.beat_grid || [];
  log("aiApplyFix ...");
  const result = await callTool("aiApplyFix", {
    mapping,
    fixes: fixes.fixes || fixes,
    beatGrid,
  });
  patchState(STATE_PATH, {
    current_step: "SEMANTIC",
    status: PROJECT_STATUS.WAITING_AGENT,
    needs_review: !!result.mapping_meta.needs_review,
    align_result: {
      ...state.align_result,
      mapping: result.mapping,
      mapping_meta: result.mapping_meta,
    },
  });
  log(
    "语义修正已写回，applied =",
    result.applied,
    "needs_review =",
    result.mapping_meta.needs_review,
  );

  // 若指定了音频/输出（或状态中已有），继续 render
  const audio = args["--audio"] || state.audio_path;
  const out =
    args["--out"] ||
    (state.output && isAbsolute(state.output)
      ? state.output
      : join(
          homedir(),
          "Downloads",
          "screenshot-studio",
          state.output || "out.mp4",
        ));
  if (audio && out) {
    const parse = state.script_messages
      ? { messages: state.script_messages }
      : { messages: state.messages || [] };
    await renderStage({
      align: state.align_result,
      parse,
      script: state.script_text || buildScriptText(parse.messages),
      audio,
      out,
      platform: state.platform || "wechat",
      mode: state.mode || "single",
      members: state.members || [],
      groupName:
        state.mode === "group" ? state.groupName || state.title || "" : "",
    });
    patchState(STATE_PATH, {
      current_step: "RENDER",
      status: PROJECT_STATUS.SUCCEEDED,
      output: out,
    });
    log("完成，输出：", out);
  } else {
    log("未提供音频/输出，仅写回修正（render 可后续手动触发）。");
  }
}

async function renderStage({
  align,
  parse,
  script,
  audio,
  out,
  platform,
  mode,
  members,
  groupName = "",
}) {
  patchState(STATE_PATH, {
    current_step: "RENDER",
    status: PROJECT_STATUS.RUNNING,
  });
  mkdirSync(dirname(out), { recursive: true });
  const project = buildProject({
    parse,
    align,
    opts: { platform, mode, audio, script, members, groupName },
  });
  log("render ...");
  const r = await callTool("render", {
    project,
    audioPath: audio,
    outputPath: out,
  });
  if (!r.success) throw new Error("render 失败: " + JSON.stringify(r));
  log("render 完成：", r.outputPath, `(${r.frameCount} 帧, ${r.duration}s)`);
  return r;
}

async function cmdRunPage(args) {
  await ensureServer();
  const platform = args["--platform"] || "wechat";
  const mode = args["--mode"] || "single";
  const out =
    args["--out"] ||
    join(
      homedir(),
      "Downloads",
      "screenshot-studio",
      `agent-page-${Date.now()}.mp4`,
    );

  // 读取网页用户已确认提交的真相源（page_confirmed 守卫，反馈⑨的硬约束）。
  const state = readState();
  if (!(state?.page_confirmed && state?.audio_path)) {
    throw new Error(
      "网页尚未确认：请先打开 UI、选配音并点「确认页面信息」，再回来说「信息已确认」。",
    );
  }
  log("页面已确认，读取最新提交的脚本/头像/名称/配音，进入后端...");
  const audio = state.audio_path;
  const messages = state.messages || [];
  const members = state.members || [];
  // 群聊顶栏标题取群名称：state 里以 title 字段承载（网页确认时 group 模式传来的是群名）
  const groupName =
    mode === "group" ? state.groupName || state.title || "" : "";
  const scriptText = buildScriptText(messages);

  // 语义决策：优先用 --decisions 文件；否则从页面已确认的 messages（含 sticker/effect）重建
  let decisions = [];
  if (args["--decisions"]) {
    const raw = readArgVal(args["--decisions"]);
    decisions = typeof raw === "string" ? JSON.parse(raw) : raw;
  } else if (messages.length) {
    decisions = messages.map((m) => ({
      emotion: m.emotion || "neutral",
      sticker: m.sticker || "",
      effect: m.effect || "",
    }));
  }

  // 委托给 Planner 执行（页面模式同样走统一生产计划）
  const res = await runProductionPlan({
    statePath: STATE_PATH,
    projectId: state.project_id || "default",
    audioPath: audio,
    scriptText,
    messages,
    decisions,
    members,
    platform,
    mode,
    groupName,
    out,
    skipRender: !!args["--skip-render"],
    allowApproximate: !!args["--allow-approximate"],
  });
  if (res.needsReview) {
    console.log("\n=== AI_HANDOFF_JSON ===");
    console.log(JSON.stringify(res.handoff, null, 2));
    console.log("=== END_AI_HANDOFF ===\n");
    err(
      "需要 AI 语义干预：请 agent 基于交接包产出 fixes，再调 `apply-fixes`（会从状态自动取音频/输出）。",
    );
    process.exitCode = 2;
    return;
  }
  if (res.skipped) {
    log("已跳过 render（--skip-render）。");
    return;
  }
  log(
    res.preview ? "近似同步预览已生成，未通过质量复核：" : "完成，输出：",
    out,
  );
}

function cmdStatus() {
  const s = readState();
  if (!s) {
    err("无 pipeline_state.json");
    process.exitCode = 1;
  } else {
    log("状态：", JSON.stringify(s, null, 2));
  }
  // 能力探测（反馈⑤）：让 agent 在调用视频类命令前先看清 chat_video/asr 是否就绪。
  const caps = detectCapabilities();
  const ready = caps.ffmpeg && caps.python;
  log(
    `能力: chat_image=${caps.chat_image} chat_video=${caps.chat_video} asr=${caps.asr} semantic=${caps.semantic} ffmpeg=${caps.ffmpeg} python=${caps.python} (ready=${ready})`,
  );
  if (!ready)
    err(
      "能力未就绪：缺 ffmpeg 或 python 时视频生成/ASR 会失败（图片导出仍可）。",
    );
}

function cmdDoctor() {
  const { ok, caps, checks, warnings } = runDoctor();
  console.log("=== 环境自检 doctor ===");
  for (const c of checks) {
    console.log(`[${c.ok ? "OK" : "X"}] ${c.name}: ${c.detail}`);
  }
  console.log("能力:", JSON.stringify(caps));
  if (ok) {
    log("结果：全部就绪 ✓");
  } else {
    err("存在未就绪项：");
    for (const w of warnings) err("  - " + w);
    process.exitCode = 1;
  }
}

// 统一启动入口：后端(mcp) + 前端(vite) 一起静默拉起，并做自检。
// 关键：每次都先杀掉可能残留的旧进程再拉起，避免旧 mcp 进程缓存旧 canvasChat 等模块
// （跨会话重开时最容易踩的坑：旧进程仍在跑、serve 的是编辑前的旧代码）。
// 这样用户只需记 `up` 一个命令，无需手动 `down --all && up`。
async function cmdUp() {
  log("启动本地后端 + 前端（统一入口，强制拉起最新代码）...");
  killPort(9527);
  killPort(5173);
  await sleep(800);
  launchServerDetached();
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if (await health()) break;
  }
  if (await health()) {
    log("mcp-server 就绪");
  } else throw new Error("mcp-server 启动超时");
  launchViteDetached();
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    if (await ping(5173)) break;
  }
  if (await ping(5173)) {
    log("vite(5173) 就绪");
  } else err("vite 启动超时（可手动 npm run dev）");
  const { ok, warnings, caps } = runDoctor();
  log(
    `能力: chat_video=${caps.chat_video} asr=${caps.asr} ffmpeg=${caps.ffmpeg} python=${caps.python}`,
  );
  if (!ok) {
    err("环境自检有未就绪项：");
    for (const w of warnings) err("  - " + w);
  } else {
    log("全部就绪 ✓ 打开 http://localhost:5173 即可使用");
  }
}

// 重置工作流状态：清空 pipeline_state.json。跨会话重开时若想彻底丢弃半截旧状态、从干净起点开始可用。
// 默认只清状态文件；--all 额外清空项目 artifact 历史（用户数据目录 + 旧 <root>/projects）。
// 不会删除 ASR 模型缓存（~/.cache/huggingface，受管依赖、可复用）。该命令由 agent 在需要时使用，用户通常无需手动调用。
function cmdReset(args) {
  const all = !!args["--all"];
  if (existsSync(STATE_PATH)) {
    rmSync(STATE_PATH, { force: true });
    log("已清空 pipeline_state.json");
  } else log("pipeline_state.json 不存在，跳过");
  if (all) {
    const base = projectsBase();
    if (existsSync(base)) {
      rmSync(base, { recursive: true, force: true });
      log("已清空项目历史: " + base);
    }
    const old = join(ROOT, "projects");
    if (existsSync(old)) {
      rmSync(old, { recursive: true, force: true });
      log("已清空旧项目目录: " + old);
    }
  }
  log("ASR 模型缓存保留（~/.cache/huggingface）。");
  log("已重置；下次请重新 `open` / `run` 注入新素材。");
}

// 注入新脚本/音频时，强制让陈旧的人工确认闸门失效（防回归：跨会话残留的
// page_confirmed:true 会泄漏，导致 agent 直接 run-page 跳过「确认页面信息」闸门）。
// 仅在确实提供了新素材时才重置；清空 audio_path/audio_name 以强制重新上传配音。
function rearmGate() {
  const st = readState() || {};
  if (st.page_confirmed || st.audio_path) {
    patchState(STATE_PATH, {
      page_confirmed: false,
      audio_path: undefined,
      audio_name: undefined,
      status: PROJECT_STATUS.WAITING_USER,
      current_step: "SCRIPT",
      output: undefined,
    });
    log(
      "检测到旧的人工确认状态，已重置闸门（page_confirmed=false，已清空旧音频）。请在网页重新核对对话/头像/名称/配音并点「确认页面信息」。",
    );
    return true;
  }
  return false;
}

function cmdOpen(args) {
  let script = args["--script"];
  if (script && script.startsWith("@")) {
    script = readFileSync(script.slice(1), "utf8").trim();
  }
  // 注入了新脚本/音频 → 失效旧确认闸门，确保必须回网页重新确认（人机协同硬约束）。
  if (script || args["--audio"]) rearmGate();
  openUI({
    page: args._[0] || "wechat/single",
    script,
    audio: args["--audio"],
  });
}

// ====================== 深链拼装 ======================
// 仅支持注入脚本/音频，打开网页让用户自己点「整图/切片导出」或「确认页面信息」。
// 不再支持 --export mp4|video（零确认全自动出片）。
function readArgVal(v) {
  if (v && v.startsWith("@")) {
    try {
      return readFileSync(resolve(v.slice(1)), "utf8").trim();
    } catch (e) {
      throw new Error(`读取文件失败 ${v}: ${e.message}`);
    }
  }
  return v;
}

function cmdGenlink(args) {
  const page = args._[0] || "wechat/single";
  const script = readArgVal(args["--script"] || "");
  const audio = args["--audio"] || "";
  const doOpen = !!args["--open"];
  // 注入新脚本/音频 → 失效旧确认闸门，避免后续 run-page 跳过人工确认（与 open 一致）。
  if (script || audio) rearmGate();

  const params = new URLSearchParams();
  params.set("agent", "1"); // 始终以 agent 模式打开，暴露「确认页面信息」按钮
  if (script) params.set("script", script);
  if (audio) params.set("audio", audio);
  // 不再支持 decisions/timeline/export 参数

  const url = `http://localhost:${DEV_PORT}/${page}?${params.toString()}`;
  console.log(url);
  if (doOpen) {
    try {
      execSync(`start "" "${url}"`, { stdio: "ignore", windowsHide: true });
    } catch (e) {
      err("自动打开失败，请手动访问：", url);
    }
  }
  return url;
}

// ====================== 语义贴纸标注 ======================
// 读 script_messages → 对每句做情绪强度打分 → 仅当 ≥ 阈值才从 emoji_scenes.md 预设库选贴纸写回。
// 阈值过滤作为确定性兜底；agent 的 LLM 语义层可覆盖打分/选择。
// scoreEmotion/pickSticker/STICKER_THRESHOLD 已抽到 scripts/core/decisions.js。

function cmdTagStickers(args) {
  const st = readState() || {};
  const base = st.script_messages || st.messages || [];
  if (!base.length)
    throw new Error(
      "pipeline_state.json 中无 script_messages，请先 open/run。",
    );
  const tagged = base.map((m) => {
    const score = scoreEmotion(m.speaker, m.content);
    const sticker = pickSticker(score, m.content);
    return { ...m, _emo: +score.toFixed(2), sticker };
  });
  patchState(STATE_PATH, { script_messages: tagged, messages: tagged });
  log(`THRESHOLD=${STICKER_THRESHOLD}  贴纸标注完成：`);
  tagged.forEach((m, i) =>
    log(
      `  ${i} [${m._emo}] ${m.speaker}: ${m.content} -> ${m.sticker || "(无贴纸)"}`,
    ),
  );
  const n = tagged.filter((m) => m.sticker).length;
  log(`共 ${n}/${tagged.length} 句带贴纸`);
}

// ====================== ASR 模型依赖管理 ======================
// 用户确认「把 ASR 模型纳入受管依赖」：与 Python 包一样有配置(asr-config.json)、
// 预下载(setup-asr / agent-up)、doctor 自检与离线兜底。
async function cmdSetupAsr(args) {
  const model = args._[0] || loadAsrConfig().model;
  log(`预下载 ASR 模型 "${model}"（受管依赖，需联网）...`);
  const r = await ensureAsrModel(model);
  if (r.ok) {
    log(`✅ ASR 模型已就绪: ${r.model}（缓存于 ~/.cache/huggingface）`);
    log("后续 alignDP 将使用真实逐句/逐字对齐（asr_enhanced），音画严格同步。");
  } else {
    err(`❌ ASR 模型下载失败 [${r.reason}]: ${r.message}`);
    err(
      "离线环境下 alignDP 将退化为「VAD 语音分段 → 长度加权节拍网格」（音画近似同步）。",
    );
    err("在可联网的机器上重跑 `agent-bridge setup-asr` 即可补齐。");
    process.exitCode = 1;
  }
}

// 关闭前端（vite :5173）。用户确认页面信息后，前端不再需要，由 agent 接管后续交互。
function killPort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr :${port}`, {
        stdio: "pipe",
      }).toString();
      const pids = new Set();
      out.split("\n").forEach((line) => {
        if (!line.includes(`:${port}`)) return;
        const m = line.trim().split(/\s+/);
        const pid = m[m.length - 1];
        if (pid && /^\d+$/.test(pid)) pids.add(pid);
      });
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F /T`, { stdio: "ignore" });
        } catch {
          /* ignore */
        }
      }
    } else {
      execSync(`lsof -ti:${port} | xargs -r kill -9`, { stdio: "ignore" });
    }
  } catch {
    /* 端口未占用或无需关闭 */
  }
}

async function cmdDown(args) {
  const closeAll = !!args["--all"];
  log("关闭前端服务 vite(5173)（确认后由 agent 接管，前端不再需要）...");
  killPort(5173);
  if (closeAll) {
    log("同时关闭 mcp-server(9527)...");
    killPort(9527);
  }
  await sleep(800);
  if (await ping(5173)) err("⚠ 前端端口 5173 仍未关闭，请手动检查占用进程");
  else log("✅ 前端已关闭");
}

// ====================== CLI 解析 ======================
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a;
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  switch (cmd) {
    case "ensure":
      await ensureServer();
      break;
    case "open":
      cmdOpen(args);
      break;
    case "genlink":
      cmdGenlink(args);
      break;
    case "run":
      await cmdRun(args);
      break;
    case "run-page":
      await cmdRunPage(args);
      break;
    case "apply-fixes":
      await cmdApplyFixes(args);
      break;
    case "status":
      cmdStatus();
      break;
    case "doctor":
      cmdDoctor();
      break;
    case "up":
      await cmdUp();
      break;
    case "cancel":
      cancelProductionPlan(STATE_PATH, args._[0]);
      log("已取消当前生产计划（CANCELLED）。");
      break;
    case "reset":
      cmdReset(args);
      break;
    case "tag-stickers":
      cmdTagStickers(args);
      break;
    case "setup-asr":
      await cmdSetupAsr(args);
      break;
    case "down":
      await cmdDown(args);
      break;
    default:
      console.log(
        `用法: node scripts/agent-bridge.mjs <ensure|open|run|run-page|apply-fixes|tag-stickers|status|doctor|setup-asr|up|down|reset|cancel> [选项]`,
      );
      console.log(`  ensure`);
      console.log(
        `  open [page] [--script S] [--audio URL]       打开网页注入脚本/音频（自动拉起浏览器，带 ?agent=1）`,
      );
      console.log(
        `  genlink [page] [--script S] [--audio U] [--open]  拼装深链 URL（自动 encodeURIComponent）；--open 直接打开浏览器`,
      );
      console.log(
        `  run --audio A --script S [--decisions @决策.json] [--platform wechat] [--mode single|group] [--out out.mp4] [--skip-render]`,
      );
      console.log(
        `  run-page [--platform wechat] [--mode single|group] [--out out.mp4] [--decisions @决策.json]`,
      );
      console.log(
        `           （用户回来说「信息已确认」后再调：读网页最新脚本/头像/名称/配音，串对齐+渲染）`,
      );
      console.log(
        `  apply-fixes [--state FILE] --fixes JSON  （音频/输出自动从 pipeline_state.json 取）`,
      );
      console.log(
        `  tag-stickers [--state FILE]           语义贴纸标注（情绪度≥${STICKER_THRESHOLD} 才带贴纸，写回 script_messages.sticker）`,
      );
      console.log(`  status [--state FILE]`);
      console.log(
        `  doctor                        环境冒烟自检（STATE_PATH/能力就绪/ASR模型），用于排障`,
      );
      console.log(
        `  setup-asr [model]             预下载 ASR 模型权重（受管依赖，需联网；离线则提示兜底）`,
      );
      console.log(
        `  up                            统一启动本地后端(mcp) + 前端(vite)，强制拉起最新代码（推荐日常入口；每次先杀残留旧进程，无需手动 down --all）`,
      );
      console.log(
        `  down [--all]                  用户确认后关闭前端(vite 5173)，[--all] 同时关 mcp(9527)`,
      );
      console.log(
        `  reset [--all]                 清空工作流状态(pipeline_state.json)；--all 额外清空项目 artifact 历史（ASR 模型缓存保留）`,
      );
      process.exitCode = 1;
  }
}

main().catch((e) => {
  err("失败：", e.message);
  process.exitCode = 1;
});
