/**
 * MCP Server for 截图工坊
 *
 * 双协议：
 *   1. HTTP API + WebSocket（浏览器 UI 直接调用）
 *   2. MCP JSON-RPC over stdio（AI Agent codex/workbuddy 调用）
 *
 * 启动：
 *   node index.js              — 默认 HTTP + stdio 双模式
 *   node index.js --http-only  — 仅 HTTP（浏览器直连）
 *   node index.js --mcp-only   — 仅 MCP stdio（AI Agent 集成）
 */
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { transcribe, alignTimeline } from './tools/transcribe.js'
import { extractBeatGrid, gridToUnits, snapToBeat } from './tools/beatGrid.js'
import { renderFrame, renderAllFrames } from './tools/render.js'
import { encodeMP4, cleanupFrames } from './tools/export.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')
const PORT = parseInt(process.env.PORT || '9527', 10)
const args = process.argv.slice(2)
const httpOnly = args.includes('--http-only')
const mcpOnly = args.includes('--mcp-only')

// ==================== 工具定义 ====================

const TOOLS = {
  /**
   * ASR 转写：音频文件 → 时间轴 JSON
   * { audioPath, scriptText, model:'small' }
   * → { timeline:[{display_start,display_end}], duration, rawSegments }
   */
  async transcribe({ audioPath, scriptText, model = 'small' }) {
    const raw = await transcribe(audioPath, scriptText, { model })
    // 提取脚本行（A说：/B说： 格式 → 去掉前缀）
    const lines = scriptText.split('\n')
      .map(l => l.replace(/^[AB]说[：:]\s*/, '').trim())
      .filter(Boolean)
    const timeline = alignTimeline(raw, lines)
    // 计算音频时长（最后一个 segment 的 end）
    const duration = raw.length ? raw[raw.length - 1].end : 0
    return { timeline, duration, rawSegments: raw }
  },

  /**
   * 渲染帧：project.json + 可选音频 → MP4
   * { project, audioPath, outputPath }
   * → { success, outputPath, frameCount, duration }
   */
  async render({ project, audioPath, outputPath }) {
    const { renderAndEncode } = await import('./tools/render.js')
    return await renderAndEncode(project, audioPath, outputPath, {
      onProgress: (p) => console.error(`[render] ${p.pct}%`)
    })
  },

  /**
   * 解析脚本：脚本文本 → messages 数组
   * { scriptText, platform:'wechat', mode:'group' }
   * → { messages }
   */
  async parseScript({ scriptText, platform = 'wechat', mode = 'group' }) {
    const { parseScript } = await loadSrcModule('parseScript')
    const messages = parseScript(scriptText)
    return { messages }
  },

  /**
   * 语义决策：messages → decisions（贴纸/动效/音效）
   * { messages }
   * → { decisions }
   */
  async decide({ messages }) {
    const { decideSemantics } = await loadSrcModule('semantic')
    const decisions = decideSemantics(messages)
    return { decisions }
  },

  /**
   * 读取项目脚本（从深链接或文件）
   * { scriptPath }
   * → { scriptText }
   */
  async readScript({ scriptPath }) {
    const text = await readFile(scriptPath, 'utf-8')
    return { scriptText: text }
  },

  /**
   * 节拍网格提取：librosa 分析音频 → beat_grid + grid_meta + onset_envelope + segments
   * { audioPath, hopLength? }
   * → { beat_grid, grid_meta, onset_envelope, onset_times, segments, duration }
   */
  async beatGrid({ audioPath, hopLength = 512 }) {
    const result = await extractBeatGrid(audioPath, { hopLength })
    return result
  },

  /**
   * 节拍网格 + ASR 联合对齐：
   * 先取节拍网格，再跑 ASR（如可用），最后用 DP 全局对齐生成 mapping
   * { audioPath, scriptText, model?, hopLength? }
   * → { beat_grid, grid_meta, mapping, adlib_spans, mapping_meta, timeline, alignment_mode, asr_quality_score, duration }
   */
  async alignDP({ audioPath, audioBase64, scriptText, model = 'small', hopLength = 512 }) {
    // 浏览器上传模式：dataURL → 临时音频文件
    let tmpAudioPath = null
    let resolvedAudioPath = audioPath
    if (!resolvedAudioPath && audioBase64) {
      const { writeFile, unlink } = await import('node:fs/promises')
      const { join, dirname } = await import('node:path')
      const { tmpdir } = await import('node:os')
      const { mkdtemp } = await import('node:fs/promises')
      const { randomUUID } = await import('node:crypto')
      const base64 = String(audioBase64).includes(',') ? String(audioBase64).split(',')[1] : String(audioBase64)
      const mime = String(audioBase64).match(/data:([^;]+);base64/)
      const ext = mime ? (mime[1].includes('mp4') ? 'm4a' : mime[1].includes('ogg') ? 'ogg' : mime[1].includes('wav') ? 'wav' : 'mp3') : 'mp3'
      const dir = await mkdtemp(join(tmpdir(), 'screenshort-up-'))
      tmpAudioPath = join(dir, `audio-${randomUUID()}.${ext}`)
      await writeFile(tmpAudioPath, Buffer.from(base64, 'base64'))
      resolvedAudioPath = tmpAudioPath
    }
    if (!resolvedAudioPath) {
      throw new Error('alignDP 需要 audioPath 或 audioBase64')
    }

    try {
    // Stage A: 节拍网格（始终执行）
    const beatResult = await extractBeatGrid(resolvedAudioPath, { hopLength })
    const { beat_grid, grid_meta, onset_times, segments, duration } = beatResult

    // 提取脚本行
    const lines = scriptText.split('\n')
      .map(l => l.replace(/^[AB]说[：:]\s*/, '').trim())
      .filter(Boolean)

    let rapUnits = []
    let asrQualityScore = 0
    let alignmentMode = 'beat_grid'
    let asrSegments = null

    // Stage A-2: 可选 ASR（faster-whisper）
    try {
      const raw = await transcribe(resolvedAudioPath, scriptText, { model })
      asrSegments = raw

      // 构建 rap 行级单元（ASR segment 级）
      rapUnits = raw.map(seg => ({
        text: seg.text || '',
        start: seg.start || 0,
        end: seg.end || 0,
      }))

      // 计算 ASR 质量分：覆盖率（有文本的段占比）× 平均置信度
      const validSegs = raw.filter(s => s.text && s.text.trim())
      const coverage = raw.length > 0 ? validSegs.length / raw.length : 0
      // 简化置信度：有 word 级时间戳的段占比
      const hasWords = raw.filter(s => s.words && s.words.length > 0).length
      const wordCoverage = raw.length > 0 ? hasWords / raw.length : 0
      asrQualityScore = round(coverage * 0.5 + wordCoverage * 0.5, 2)

      if (asrQualityScore >= 0.5) {
        alignmentMode = 'asr_enhanced'
      }
    } catch (err) {
      console.error('[alignDP] ASR 失败，仅用节拍网格:', err.message)
      // ASR 不可用 → 用节拍网格切单元
      rapUnits = gridToUnits(beat_grid, 4, duration).map(u => ({
        text: '',  // 无文本
        start: u.start,
        end: u.end,
      }))
      asrQualityScore = 0
      alignmentMode = 'beat_grid'
    }

    // Stage B: DP 全局对齐
    const { alignDP: runAlignDP } = await import(pathToFileURL(join(ROOT, 'src', 'lib', 'dpAlign.js')).href)
    const scriptMsgs = lines.map((text, i) => ({ text, id: i }))
    const dpResult = runAlignDP(scriptMsgs, rapUnits, {
      gapPenalty: 0.15,
      threshold: 0.18,
      ambiguousEpsilon: 0.05,
      maxMergeUnits: 6,
    })

    // 转换为时间轴
    const { mappingToTimeline } = await import(pathToFileURL(join(ROOT, 'src', 'lib', 'dpAlign.js')).href)
    const timeline = mappingToTimeline(dpResult.mapping, duration, beat_grid)

    return {
      beat_grid,
      grid_meta,
      onset_times,
      segments,
      mapping: dpResult.mapping,
      adlib_spans: dpResult.adlib_spans,
      mapping_meta: dpResult.mapping_meta,
      timeline,
      alignment_mode: alignmentMode,
      asr_quality_score: asrQualityScore,
      duration,
      asr_segments: asrSegments,
    }
    return result
    } finally {
      await cleanupTmpAudio(tmpAudioPath)
    }
  },

  /**
   * AI 语义对齐（说唱/演唱等 ASR 漂移场景）—— 交接包生成，【不调 LLM、无需任何 key】。
   * MCP 只做确定性信号处理；语义仲裁由「主 agent（对话里的大模型）」用自己的 LLM 能力完成。
   * 本工具仅把 needs_review 条目 + 上下文（拍点/真实脚本/噪声ASR）+ 指令整理成交接包，供 agent 读取。
   * { scriptText, beatGrid, rawSegments, mapping }
   * → { available, needs_total, reviewItems, context, prompt }
   */
  async aiReview({ scriptText, beatGrid, rawSegments, mapping }) {
    const { aiReview } = await import('./tools/aiReview.js')
    return await aiReview({ scriptText, beatGrid, rawSegments, mapping })
  },

  /**
   * AI 写回：agent 完成语义归位后，把修正结果应用到 mapping。
   * 不需要任何 LLM key——fixes 由主 agent（自带 LLM）产出。
   * { mapping, fixes:[{index,message_id,start,end,match_type,calibrated_confidence,note}], beatGrid? }
   * → { mapping, mapping_meta, applied }
   */
  async aiApplyFix({ mapping, fixes, beatGrid }) {
    const { aiApplyFix } = await import('./tools/aiReview.js')
    return await aiApplyFix({ mapping, fixes, beatGrid })
  },

  /** 网页回调：确认页面信息 + 上传音频（落盘产生真实路径，写入真相源） */
  submitPage,

  /** 创意层写回（LLM 导演）：贴纸 / 动效 / 时间轴精修。校验失败直接抛错，无兜底。 */
  async applyCreative({ scriptMessages, creative }) {
    const { applyCreative } = await import('./tools/creative.js')
    return await applyCreative({ scriptMessages, creative })
  },

  /** 导出全图 / 切片（node 侧纯渲染，不依赖浏览器 DOM） */
  async exportImage({ project, mode = 'full', outputDir }) {
    const { exportStills } = await import('./tools/render.js')
    return await exportStills(project, { mode, outputDir })
  },

  /** 内置工作流剧本：agent 首次会话调用即可获得完整流程 + 脚本格式 + 表情库 + 动效枚举 + 曲风列表 */
  async getWorkflow() {
    const { buildEmojiCatalog, EFFECT_ENUM } = await import('./tools/creative.js')
    const catalog = await buildEmojiCatalog()
    const { VOICE_STYLES } = await import(pathToFileURL(join(ROOT, 'src', 'lib', 'voicePrompt.js')).href)
    return {
      description: WORKFLOW_TEXT,
      script_format: SCRIPT_FORMAT,
      effects: EFFECT_ENUM,
      voice_styles: VOICE_STYLES.map((s) => ({ id: s.id, name: s.name })),
      emoji_catalog: catalog.map((it) => ({ label: it.label, file: '/emojis/' + it.file })),
      tools: Object.keys(TOOL_DESCRIPTIONS),
    }
  },
}

// 内置工作流剧本（随 getWorkflow 返回，agent 零配置即可用）
const WORKFLOW_TEXT = `你是「截图工坊」视频生成的总导演。用户用一句话（如“以‘xx’为主题帮我生成一个微信对话记录”）触发，你产出聊天视频 / 全图 / 切片。

## 工具链（全部是 MCP 工具，确定性体力活由 server 做，创意决策由你做）
1) getWorkflow —— 首次会话先调，拿本剧本 + 脚本格式 + 表情库 + 动效枚举 + 曲风列表。
2) parseScript(scriptText) —— 把对话脚本文本解析成 messages 数组（A说：/B说：/旁白 格式）。
3) beatGrid(audioPath) / alignDP(audioPath, scriptText) —— 用户给本地配音路径后，提取节拍网格 + DP 全局对齐，产出每条消息的初始时间窗。
4) aiReview(...) —— 拿对齐交接包（语义/情绪/节拍/ASR 素材），由你做语义仲裁。
5) applyCreative —— 【你必做】基于语义 + 节拍 + ASR，为每条消息决定 sticker（从表情库选）/ effect（动效枚举）/ display_start,end（卡音画同步）。校验失败会报错，必须改对再写回。
6) render(project, audioPath, outputPath) —— 合成 MP4；或 exportImage(project, mode) 导出全图/切片。

## 端到端流程（视频）
- 用户说“生成微信对话”→ 你按 script_format 生成脚本，返回给用户 → 用户确认或改完再发回。
- 你用 submitPage 把定稿脚本注入网页（让用户看/微调头像名称）。提示用户生成配音：根据曲风列表生成配音提示词给用户复制去 Suno/妙响 等外部工具。
- 用户切回浏览器，选本地已下载的配音 MP3 点「确认页面信息」。服务端落盘产生真实音频路径并写入 pipeline_state.json。
- 你轮询 pipeline_state.json 直到 page_confirmed 为 true，拿到 audio_path。
- 调 beatGrid + alignDP 拿到初始时间窗 → aiReview 拿交接包 → 你做 applyCreative 创意决策 → render 出 MP4 → 把输出路径回给用户。

## 铁律
- 贴纸 / 动效 / 时间轴**只能由你（LLM）产出**，禁止用关键词规则替代。
- applyCreative 校验严格：贴纸必须是表情库文件、动效必须在枚举内、时间窗 de>ds；失败直接报错提示用户，不得静默兜底。
- 若用户没给配音：可先 exportImage 出全图/切片交付，并提示用户后续可加配音生成视频。

## 导出（对话里一句话触发）
- exportImage(project, 'full') → 整段对话全图 PNG
- exportImage(project, 'slices') → 每条消息一张切片 PNG`

const SCRIPT_FORMAT = `脚本格式（每行一条，parseScript 可解析）：
A说：第一句台词
B说：第二句台词
旁白：场景说明（可选）

支持字段：角色用“X说：”前缀；可含 system/time/redpacket/transfer/voice 等类型。
示例：
A说：这个按钮改红色。
B说：不改，设计稿是蓝色。
A说：我说了算，改。`

// 清理临时上传目录/文件（在 alignDP 返回后调用）
async function cleanupTmpAudio(tmpAudioPath) {
  if (!tmpAudioPath) return
  const { unlink } = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  await unlink(tmpAudioPath).catch(() => {})
  await import('node:fs/promises').then(({ rm }) => rm(dirname(tmpAudioPath), { recursive: true, force: true })).catch(() => {})
}

// 真相源：pipeline_state.json（前端轮询 + agent 读取）
const STATE_PATH = join(ROOT, 'pipeline_state.json')
async function readPipelineState() {
  try { return JSON.parse(await readFile(STATE_PATH, 'utf-8')) } catch { return {} }
}
async function writePipelineState(patch) {
  const prev = await readPipelineState()
  const next = { ...prev, ...patch, updated_at: new Date().toISOString() }
  await writeFile(STATE_PATH, JSON.stringify(next, null, 2), 'utf-8')
  return next
}

/**
 * 网页「确认页面信息」回调：浏览器把音频 base64 + 用户核对的消息/成员发来，
 * 服务端落盘音频（产生 agent 可读取的真实本地路径），并写入 pipeline_state.json。
 * 这一步即「回调」——agent 轮询该文件即可拿到音频路径与最终页面信息。
 * { audioBase64, audioName, messages, members }
 * → { ok, audio_path, audio_name, message_count, member_count }
 */
async function submitPage({ audioBase64, audioName, messages, members, title }) {
  if (!audioBase64) throw new Error('缺少 audioBase64')
  // 1) base64 → 落盘真实音频文件
  const m = /^data:([^;]+);base64,(.*)$/.exec(audioBase64)
  const mime = m ? m[1] : ''
  const b64 = m ? m[2] : audioBase64
  // 从 audioName 剥掉已有扩展名，避免重复后缀（test.mp3 → test.mp3.mp3）
  const baseName = (audioName || 'audio').replace(/\.[^.]+$/, '')
  const extFromName = (audioName && audioName.includes('.')) ? audioName.split('.').pop().toLowerCase() : ''
  const ext = extFromName
    || (mime.includes('mp3') ? 'mp3'
    : mime.includes('wav') ? 'wav'
    : mime.includes('ogg') ? 'ogg'
    : mime.includes('m4a') ? 'm4a'
    : 'mp3')
  const upDir = join(tmpdir(), 'screenshort-uploads')
  await mkdir(upDir, { recursive: true })
  const safeName = baseName.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
  const audioPath = join(upDir, `${Date.now()}-${safeName}.${ext}`)
  await writeFile(audioPath, Buffer.from(b64, 'base64'))
  // 2) 写真相源
  await writePipelineState({
    current_step: 'VOICEOVER',
    page_confirmed: true,
    status: 'await_agent',
    audio_path: audioPath,
    audio_name: audioName || '',
    title: title || '',
    messages: messages || [],
    members: members || [],
    submitted_at: new Date().toISOString(),
  })
  return {
    ok: true,
    audio_path: audioPath,
    audio_name: audioName || '',
    message_count: (messages || []).length,
    member_count: (members || []).length,
  }
}

async function loadSrcModule(name) {
  const mod = await import(pathToFileURL(join(ROOT, 'src', 'lib', `${name}.js`)).href)
  return mod
}

function round(n, d = 2) {
  const p = Math.pow(10, d)
  return Math.round(n * p) / p
}

// 工具描述（供 AI Agent 理解用途）
const TOOL_DESCRIPTIONS = {
  transcribe: 'ASR 转写：音频文件 → 时间轴 JSON。输入音频路径和脚本文本，输出每条消息的显示时间轴（display_start/display_end）。',
  beatGrid: '节拍网格提取：用 librosa 分析音频，输出 BPM、节拍时间数组、onset 包络、结构分段。是音画同步的基准。',
  alignDP: '节拍网格+ASR联合DP对齐：先取节拍网格，再跑ASR（如可用），用有序DP全局对齐生成 mapping（match_type/calibrated_confidence/ambiguous），输出 voiceover.json 完整结构。',
  aiReview: 'AI语义对齐交接（说唱/演唱ASR漂移场景）：MCP只做确定性信号，语义仲裁由主agent（自带LLM）完成，本工具不调LLM、不需要key。它把needs_review条目+上下文（beat_grid/真实脚本/噪声ASR）+指令整理成交接包供agent读取。输入 scriptText/beatGrid/rawSegments/mapping，输出 {needs_total,reviewItems,context,prompt}。',
  aiApplyFix: 'AI写回：主agent完成语义归位后，把fixes应用到mapping并重算mapping_meta（needs_review等）。无需任何key。输入 mapping/fixes/beatGrid?，输出 {mapping,mapping_meta,applied}。',
  submitPage: '网页回调：用户确认页面信息并上传配音音频。服务端落盘音频（产生真实本地路径）并写入 pipeline_state.json。agent 轮询该文件即可拿到 audio_path 与最终 messages/members。输入 audioBase64(网页File读出的dataURL)/audioName/messages/members，输出 {ok,audio_path,audio_name,message_count,member_count}。',
  applyCreative: '【LLM 导演写回】把创意决策应用到对话：每条消息决定 sticker(从表情库选文件名)/effect(动效枚举)/display_start,end(卡音画同步)。校验严格——贴纸不在表情库、动效不在枚举、时间窗非法会直接报错并提示，无关键词兜底。输入 scriptMessages(=parseScript 输出)/creative[{index,id?,sticker?,effect?,display_start?,display_end?}]，输出 {ok,applied,message_count}。',
  exportImage: '导出全图/切片（node 侧纯渲染，不依赖浏览器 DOM）。输入 project(消息/成员/平台/模式/标题)/mode（full 整屏一张 | slices 每条一张）/outputDir?，输出 {success,mode,files:[绝对路径]}。对话里一句话即可触发。',
  getWorkflow: '内置工作流剧本：首次会话调用即可获得完整流程食谱 + 脚本格式 + 表情库清单 + 动效枚举 + 曲风列表 + 工具清单。agent 零配置即可编排。无输入参数。',
  render: '渲染视频：项目数据 + 可选音频 → MP4。输入消息/成员/平台/模式/标题，输出 H.264 MP4 文件。',
  parseScript: '解析脚本：脚本文本 → 消息数组。支持 A说：/B说：/旁白 等格式。',
  decide: '语义决策：消息数组 → 决策（贴纸/动效/音效）。基于情绪词自动匹配。',
  readScript: '读取脚本文件：文件路径 → 脚本文本。',
}

// 工具输入 Schema（供 AI Agent 知道参数）
const TOOL_SCHEMAS = {
  transcribe: {
    type: 'object',
    properties: {
      audioPath: { type: 'string', description: '音频文件绝对路径（如 C:\\demo\\voice.mp3）' },
      scriptText: { type: 'string', description: '脚本文本，A说：/B说： 格式，每行一条' },
      model: { type: 'string', description: 'faster-whisper 模型，默认 small', default: 'small' },
    },
    required: ['audioPath', 'scriptText'],
  },
  render: {
    type: 'object',
    properties: {
      project: { type: 'object', description: '项目对象：{ messages, members, platform, mode, title, duration }' },
      audioPath: { type: 'string', description: '音频文件绝对路径（可选）' },
      outputPath: { type: 'string', description: '输出 MP4 绝对路径' },
    },
    required: ['project', 'outputPath'],
  },
  parseScript: {
    type: 'object',
    properties: {
      scriptText: { type: 'string', description: '脚本文本' },
      platform: { type: 'string', description: 'wechat/qq/alipay，默认 wechat' },
      mode: { type: 'string', description: 'group/single，默认 group' },
    },
    required: ['scriptText'],
  },
  decide: {
    type: 'object',
    properties: {
      messages: { type: 'array', description: '消息数组（parseScript 的输出）' },
    },
    required: ['messages'],
  },
  readScript: {
    type: 'object',
    properties: {
      scriptPath: { type: 'string', description: '脚本文件路径' },
    },
    required: ['scriptPath'],
  },
  beatGrid: {
    type: 'object',
    properties: {
      audioPath: { type: 'string', description: '音频文件绝对路径' },
      hopLength: { type: 'number', description: 'librosa hop_length，默认 512', default: 512 },
    },
    required: ['audioPath'],
  },
  alignDP: {
    type: 'object',
    properties: {
      audioPath: { type: 'string', description: '音频文件绝对路径（本地/AI Agent 模式）' },
      audioBase64: { type: 'string', description: '浏览器上传模式：dataURL（含 MIME 前缀），服务端解码落临时文件后运行' },
      scriptText: { type: 'string', description: '脚本文本，A说：/B说： 格式' },
      model: { type: 'string', description: 'faster-whisper 模型，默认 small', default: 'small' },
      hopLength: { type: 'number', description: 'librosa hop_length，默认 512', default: 512 },
    },
    required: ['scriptText'],
  },
  aiReview: {
    type: 'object',
    properties: {
      scriptText: { type: 'string', description: '脚本文本，A说：/B说： 格式（语义真值）' },
      beatGrid: { type: 'array', items: { type: 'number' }, description: '节拍网格拍点秒数组' },
      rawSegments: { type: 'array', description: 'faster-whisper 原始段 [{text,start,end}]，噪声参考' },
      mapping: { type: 'array', description: 'alignDP 输出的 mapping 数组（含 match_type/calibrated_confidence/ambiguous）' },
    },
    required: ['scriptText', 'beatGrid', 'mapping'],
  },
  aiApplyFix: {
    type: 'object',
    properties: {
      mapping: { type: 'array', description: 'alignDP 原始 mapping 数组' },
      fixes: { type: 'array', description: '主agent产出的修正 [{index,message_id,start,end,match_type,calibrated_confidence,note}]' },
      beatGrid: { type: 'array', items: { type: 'number' }, description: '可选，用于将 start/end 吸附到最近拍点' },
    },
    required: ['mapping', 'fixes'],
  },
  submitPage: {
    type: 'object',
    properties: {
      audioBase64: { type: 'string', description: '网页File读出的dataURL（含MIME前缀），服务端解码落盘' },
      audioName: { type: 'string', description: '原始文件名' },
      messages: { type: 'array', description: '用户核对后的对话消息数组' },
      members: { type: 'array', description: '用户核对后的成员（头像/名称）数组' },
    },
    required: ['audioBase64'],
  },
  applyCreative: {
    type: 'object',
    properties: {
      scriptMessages: { type: 'array', description: 'parseScript 输出的消息数组（含 message_id/index）' },
      creative: { type: 'array', description: 'LLM 创意决策数组，每条 {index,id?,sticker?,effect?,display_start?,display_end?}' },
    },
    required: ['scriptMessages', 'creative'],
  },
  exportImage: {
    type: 'object',
    properties: {
      project: { type: 'object', description: '项目对象 {messages,members,platform,mode,title,duration}' },
      mode: { type: 'string', description: 'full=整屏一张PNG；slices=每条消息一张PNG', default: 'full' },
      outputDir: { type: 'string', description: '输出目录（可选，默认 tmp/export）' },
    },
    required: ['project'],
  },
  getWorkflow: {
    type: 'object',
    properties: {},
  },
}

// ==================== HTTP API ====================

function startHttpServer() {
  const server = createServer(async (req, res) => {
    // CORS：所有响应（含 /api/state）统一带上，否则浏览器轮询会被 CORS 拦截
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    // 真相源读取（供网页轮询 agent 进度）
    if (req.method === 'GET' && req.url === '/api/state') {
      try {
        const st = await readPipelineState()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(st))
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{}')
      }
      return
    }


    // 健康检查
    if (req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', tools: Object.keys(TOOLS) }))
      return
    }

    // 工具调用
    if (req.method === 'POST' && req.url?.startsWith('/api/tool/')) {
      const toolName = req.url.split('/api/tool/')[1]
      if (!TOOLS[toolName]) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `工具不存在: ${toolName}` }))
        return
      }
      try {
        const body = await readBody(req)
        const result = await TOOLS[toolName](body)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
      return
    }

    res.writeHead(404)
    res.end('Not Found')
  })

  // WebSocket（进度推送）
  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (ws) => {
    console.log('[MCP] WebSocket 客户端已连接')
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data)
        if (msg.tool && TOOLS[msg.tool]) {
          const result = await TOOLS[msg.tool](msg.params || {})
          ws.send(JSON.stringify({ id: msg.id, result }))
        } else {
          ws.send(JSON.stringify({ id: msg.id, error: '未知工具' }))
        }
      } catch (err) {
        ws.send(JSON.stringify({ id: msg?.id, error: err.message }))
      }
    })
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[MCP] HTTP API + WebSocket 已启动: http://127.0.0.1:${PORT}`)
    console.log(`[MCP] 健康检查: http://127.0.0.1:${PORT}/api/health`)
    console.log(`[MCP] WebSocket: ws://127.0.0.1:${PORT}/ws`)
    console.log(`[MCP] 可用工具: ${Object.keys(TOOLS).join(', ')}`)
  })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => body += chunk)
    req.on('end', () => {
      try { resolve(JSON.parse(body)) }
      catch { reject(new Error('Invalid JSON')) }
    })
  })
}

// ==================== MCP stdio ====================

function startMcpStdio() {
  // MCP JSON-RPC over stdio（AI Agent 集成）
  process.stdin.setEncoding('utf-8')
  let buffer = ''

  process.stdin.on('data', async (chunk) => {
    buffer += chunk
    // 处理完整消息（\n 分隔）
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        const response = await handleMcpMessage(msg)
        process.stdout.write(JSON.stringify(response) + '\n')
      } catch (err) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32700, message: err.message },
          id: null,
        }) + '\n')
      }
    }
  })

  console.error('[MCP] stdio 模式已启动（AI Agent 集成）')
}

async function handleMcpMessage(msg) {
  const { method, params, id } = msg

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'screenshort-mcp', version: '1.0.0' },
      },
      id,
    }
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      result: {
        tools: Object.keys(TOOLS).map((name) => ({
          name,
          description: TOOL_DESCRIPTIONS[name] || `工具: ${name}`,
          inputSchema: TOOL_SCHEMAS[name] || { type: 'object', properties: {} },
        })),
      },
      id,
    }
  }

  if (method === 'tools/call') {
    const toolName = params?.name
    const toolArgs = params?.arguments || {}
    if (!TOOLS[toolName]) {
      return { jsonrpc: '2.0', error: { code: -32601, message: `工具不存在: ${toolName}` }, id }
    }
    try {
      const result = await TOOLS[toolName](toolArgs)
      return {
        jsonrpc: '2.0',
        result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
        id,
      }
    } catch (err) {
      return { jsonrpc: '2.0', error: { code: -32000, message: err.message }, id }
    }
  }

  return { jsonrpc: '2.0', error: { code: -32601, message: `未知方法: ${method}` }, id }
}

// ==================== 启动 ====================

if (mcpOnly) {
  startMcpStdio()
} else {
  startHttpServer()
  if (!httpOnly) startMcpStdio()
}
