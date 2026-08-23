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
 *   run  --audio A --script S [--platform wechat] [--mode single|group]
 *        [--out out.mp4] [--skip-render]      跑 parseScript→alignDP→(render)
 *                                             needs_review 时打印交接包并以退出码 2 退出
 *   run-page [--platform wechat] [--mode single|group] [--out out.mp4]
 *                                             读网页已确认状态，串对齐+渲染
 *   apply-fixes --state FILE --fixes JSON     将 agent 产出的语义修正写入 mapping（调 aiApplyFix），重算 meta
 *   tag-stickers [--state FILE]               语义贴纸标注（情绪度阈值兜底）
 *   status [--state FILE]                     查看 pipeline_state.json 真相源
 *
 * 退出码：0=成功；2=需要 AI 语义干预（已打印交接包）；非 0 其他=失败。
 */

import { spawn, execSync } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECT_STATUS } from '../src/lib/pipelineContract.js'
import { readState, writeState, patchState } from './core/state.js'
import { buildProject, buildScriptText } from './core/project.js'
import { applyDecisionsToMessages, scoreEmotion, pickSticker, STICKER_THRESHOLD } from './core/decisions.js'
import { callTool, health } from './core/client.js'
import { runProductionPlan, cancelProductionPlan } from './core/planner.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SERVER_ENTRY = join(ROOT, 'mcp-server', 'index.js')
const STATE_PATH = join(ROOT, 'pipeline_state.json')
const DEV_PORT = 5173

const log = (...a) => console.log('[agent-bridge]', ...a)
const err = (...a) => console.error('[agent-bridge]', ...a)

// ====================== 生命周期 ======================
async function ensureServer() {
  if (await health()) {
    log('mcp-server 已在运行')
    return true
  }
  log('拉起 mcp-server (--http-only)...')
  const child = spawn('node', [SERVER_ENTRY, '--http-only'], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  // 轮询等待就绪
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    if (await health()) {
      log('mcp-server 就绪')
      return true
    }
  }
  throw new Error('mcp-server 启动超时')
}

function openUI(opts = {}) {
  const page = opts.page || 'wechat/single'
  const params = new URLSearchParams()
  params.set('agent', '1')
  if (opts.script) params.set('script', opts.script)
  if (opts.audio) params.set('audio', opts.audio)
  const url = `http://localhost:${DEV_PORT}/${page}?${params.toString()}`
  log('打开 UI:', url)
  // Windows：用默认浏览器打开
  try {
    execSync(`start "" "${url}"`, { stdio: 'ignore', windowsHide: true })
  } catch (e) {
    err('自动打开失败，请手动访问：', url, e.message)
  }
  return url
}

// ====================== 子命令实现 ======================
async function cmdRun(args) {
  await ensureServer()
  const audio = args['--audio']
  const script = readArgVal(args['--script'] || '')
  const platform = args['--platform'] || 'wechat'
  const mode = args['--mode'] || 'single'
  const out = args['--out'] || join(homedir(), 'Downloads', 'screenshot-studio', `agent-out-${Date.now()}.mp4`)
  const skipRender = !!args['--skip-render']

  if (!audio) throw new Error('run 需要 --audio <音频路径或URL>')
  if (!script) throw new Error('run 需要 --script <脚本文本>')

  // 委托给 Planner（scripts/core/planner.js）执行生产计划
  const res = await runProductionPlan({ statePath: STATE_PATH, projectId: 'default', audioPath: audio, scriptText: script, platform, mode, out, skipRender })
  if (res.needsReview) {
    console.log('\n=== AI_HANDOFF_JSON ===')
    console.log(JSON.stringify(res.handoff, null, 2))
    console.log('=== END_AI_HANDOFF ===\n')
    err('需要 AI 语义干预：请 agent 基于上面 AI_HANDOFF_JSON 产出 fixes，再调 `apply-fixes`。')
    process.exitCode = 2
    return
  }
  if (res.skipped) {
    log('已跳过 render（--skip-render）。align 结果见 pipeline_state.json。')
    return
  }
  log('完成，输出：', out)
}

async function cmdApplyFixes(args) {
  await ensureServer()
  const stateFile = args['--state'] || STATE_PATH
  const state0 = readState() || {}
  let fixes
  if (args['--fixes']) {
    const raw = args['--fixes']
    const text = raw.startsWith('@')
      ? readFileSync(resolve(raw.slice(1)), 'utf8')
      : raw
    fixes = JSON.parse(text)
  } else {
    // 从 stdin 读
    const stdin = readFileSync(0, 'utf8')
    fixes = JSON.parse(stdin)
  }
  const state = state0
  const mapping = state?.align_result?.mapping
  if (!mapping) throw new Error('pipeline_state.json 中无 align_result.mapping，请先 run。')
  const beatGrid = state.align_result.beat_grid || []
  log('aiApplyFix ...')
  const result = await callTool('aiApplyFix', { mapping, fixes: fixes.fixes || fixes, beatGrid })
  patchState({
    current_step: 'SEMANTIC',
    status: PROJECT_STATUS.WAITING_AGENT,
    needs_review: !!result.mapping_meta.needs_review,
    align_result: { ...state.align_result, mapping: result.mapping, mapping_meta: result.mapping_meta },
  })
  log('语义修正已写回，applied =', result.applied, 'needs_review =', result.mapping_meta.needs_review)

  // 若指定了音频/输出（或状态中已有），继续 render
  const audio = args['--audio'] || state.audio_path
  const out = args['--out'] || (state.output && isAbsolute(state.output) ? state.output : join(homedir(), 'Downloads', 'screenshot-studio', state.output || 'out.mp4'))
  if (audio && out) {
    const parse = state.script_messages ? { messages: state.script_messages } : { messages: state.messages || [] }
    await renderStage({
      align: state.align_result,
      parse,
      script: state.script_text || buildScriptText(parse.messages),
      audio,
      out,
      platform: state.platform || 'wechat',
      mode: state.mode || 'single',
      members: state.members || [],
    })
    patchState({ current_step: 'RENDER', status: PROJECT_STATUS.SUCCEEDED, output: out })
    log('完成，输出：', out)
  } else {
    log('未提供音频/输出，仅写回修正（render 可后续手动触发）。')
  }
}

async function renderStage({ align, parse, script, audio, out, platform, mode, members }) {
  patchState({ current_step: 'RENDER', status: PROJECT_STATUS.RUNNING })
  mkdirSync(dirname(out), { recursive: true })
  const project = buildProject({ parse, align, opts: { platform, mode, audio, script, members } })
  log('render ...')
  const r = await callTool('render', { project, audioPath: audio, outputPath: out })
  if (!r.success) throw new Error('render 失败: ' + JSON.stringify(r))
  log('render 完成：', r.outputPath, `(${r.frameCount} 帧, ${r.duration}s)`)
  return r
}

async function cmdRunPage(args) {
  await ensureServer()
  const platform = args['--platform'] || 'wechat'
  const mode = args['--mode'] || 'single'
  const out = args['--out'] || join(homedir(), 'Downloads', 'screenshot-studio', `agent-page-${Date.now()}.mp4`)

  // 读取网页用户已确认提交的真相源（page_confirmed 守卫，反馈⑨的硬约束）。
  const state = readState()
  if (!(state?.page_confirmed && state?.audio_path)) {
    throw new Error('网页尚未确认：请先打开 UI、选配音并点「确认页面信息」，再回来说「信息已确认」。')
  }
  log('页面已确认，读取最新提交的脚本/头像/名称/配音，进入后端...')
  const audio = state.audio_path
  const messages = state.messages || []
  const members = state.members || []
  const scriptText = buildScriptText(messages)

  // 委托给 Planner 执行（页面模式同样走统一生产计划）
  const res = await runProductionPlan({ statePath: STATE_PATH, projectId: state.project_id || 'default', audioPath: audio, scriptText, messages, members, platform, mode, out, skipRender: !!args['--skip-render'] })
  if (res.needsReview) {
    console.log('\n=== AI_HANDOFF_JSON ===')
    console.log(JSON.stringify(res.handoff, null, 2))
    console.log('=== END_AI_HANDOFF ===\n')
    err('需要 AI 语义干预：请 agent 基于交接包产出 fixes，再调 `apply-fixes`（会从状态自动取音频/输出）。')
    process.exitCode = 2
    return
  }
  if (res.skipped) {
    log('已跳过 render（--skip-render）。')
    return
  }
  log('完成，输出：', out)
}

function cmdStatus() {
  const s = readState()
  if (!s) {
    err('无 pipeline_state.json')
    process.exitCode = 1
    return
  }
  log('状态：', JSON.stringify(s, null, 2))
}

function cmdOpen(args) {
  let script = args['--script']
  if (script && script.startsWith('@')) {
    script = readFileSync(script.slice(1), 'utf8').trim()
  }
  openUI({ page: args._[0] || 'wechat/single', script, audio: args['--audio'] })
}

// ====================== 深链拼装 ======================
// 仅支持注入脚本/音频，打开网页让用户自己点「整图/切片导出」或「确认页面信息」。
// 不再支持 --export mp4|video（零确认全自动出片）。
function readArgVal(v) {
  if (v && v.startsWith('@')) {
    try {
      return readFileSync(resolve(v.slice(1)), 'utf8').trim()
    } catch (e) {
      throw new Error(`读取文件失败 ${v}: ${e.message}`)
    }
  }
  return v
}

function cmdGenlink(args) {
  const page = args._[0] || 'wechat/single'
  const script = readArgVal(args['--script'] || '')
  const audio = args['--audio'] || ''
  const doOpen = !!args['--open']

  const params = new URLSearchParams()
  params.set('agent', '1') // 始终以 agent 模式打开，暴露「确认页面信息」按钮
  if (script) params.set('script', script)
  if (audio) params.set('audio', audio)
  // 不再支持 decisions/timeline/export 参数

  const url = `http://localhost:${DEV_PORT}/${page}?${params.toString()}`
  console.log(url)
  if (doOpen) {
    try {
      execSync(`start "" "${url}"`, { stdio: 'ignore', windowsHide: true })
    } catch (e) {
      err('自动打开失败，请手动访问：', url)
    }
  }
  return url
}

// ====================== 语义贴纸标注 ======================
// 读 script_messages → 对每句做情绪强度打分 → 仅当 ≥ 阈值才从 emoji_scenes.md 预设库选贴纸写回。
// 阈值过滤作为确定性兜底；agent 的 LLM 语义层可覆盖打分/选择。
// scoreEmotion/pickSticker/STICKER_THRESHOLD 已抽到 scripts/core/decisions.js。

function cmdTagStickers(args) {
  const st = readState() || {}
  const base = st.script_messages || st.messages || []
  if (!base.length) throw new Error('pipeline_state.json 中无 script_messages，请先 open/run。')
  const tagged = base.map((m) => {
    const score = scoreEmotion(m.speaker, m.content)
    const sticker = pickSticker(score, m.content)
    return { ...m, _emo: +score.toFixed(2), sticker }
  })
  patchState({ script_messages: tagged, messages: tagged })
  log(`THRESHOLD=${STICKER_THRESHOLD}  贴纸标注完成：`)
  tagged.forEach((m, i) => log(`  ${i} [${m._emo}] ${m.speaker}: ${m.content} -> ${m.sticker || '(无贴纸)'}`))
  const n = tagged.filter((m) => m.sticker).length
  log(`共 ${n}/${tagged.length} 句带贴纸`)
}

// ====================== CLI 解析 ======================
function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        out[key] = next
        i++
      } else {
        out[key] = true
      }
    } else {
      out._.push(a)
    }
  }
  return out
}

async function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  const args = parseArgs(argv.slice(1))
  switch (cmd) {
    case 'ensure':
      await ensureServer()
      break
      case 'open':
        cmdOpen(args)
        break
      case 'genlink':
        cmdGenlink(args)
        break
      case 'run':
      await cmdRun(args)
      break
    case 'run-page':
      await cmdRunPage(args)
      break
    case 'apply-fixes':
      await cmdApplyFixes(args)
      break
    case 'status':
      cmdStatus()
      break
    case 'cancel':
      cancelProductionPlan(STATE_PATH, args._[0])
      log('已取消当前生产计划（CANCELLED）。')
      break
    case 'tag-stickers':
      cmdTagStickers(args)
      break
    default:
      console.log(`用法: node scripts/agent-bridge.mjs <ensure|open|run|run-page|apply-fixes|tag-stickers|status> [选项]`)
      console.log(`  ensure`)
      console.log(`  open [page] [--script S] [--audio URL]       打开网页注入脚本/音频（自动拉起浏览器，带 ?agent=1）`)
      console.log(`  genlink [page] [--script S] [--audio U] [--open]  拼装深链 URL（自动 encodeURIComponent）；--open 直接打开浏览器`)
      console.log(`  run --audio A --script S [--platform wechat] [--mode single|group] [--out out.mp4] [--skip-render]`)
      console.log(`  run-page [--platform wechat] [--mode single|group] [--out out.mp4]`)
      console.log(`           （用户回来说「信息已确认」后再调：读网页最新脚本/头像/名称/配音，串对齐+渲染）`)
      console.log(`  apply-fixes [--state FILE] --fixes JSON  （音频/输出自动从 pipeline_state.json 取）`)
      console.log(`  tag-stickers [--state FILE]           语义贴纸标注（情绪度≥${STICKER_THRESHOLD} 才带贴纸，写回 script_messages.sticker）`)
      console.log(`  status [--state FILE]`)
      process.exitCode = 1
  }
}

main().catch((e) => {
  err('失败：', e.message)
  process.exitCode = 1
})
