/**
 * mcpClient.js — 浏览器端 MCP 客户端
 * 连接本地 MCP Server（通过 Vite proxy /api → MCP /api）。
 * 不可用时降级到浏览器端 WASM。
 */

// 开发环境走 Vite proxy（避免跨域），生产环境直连
const IS_DEV = import.meta?.env?.DEV
const MCP_BASE = IS_DEV ? '/mcp-api' : 'http://127.0.0.1:9527/api'
const MCP_URL_DIRECT = 'http://127.0.0.1:9527'

let _connected = false
let _checking = false
let _mode = 'auto' // 'auto' | 'mcp' | 'browser'

/**
 * 检测 MCP Server 是否在线
 */
export async function checkMcpStatus() {
  if (_checking) return _connected
  _checking = true
  try {
    const res = await fetch(`${MCP_BASE}/health`, { signal: AbortSignal.timeout(2000) })
    await res.json().catch(() => ({}))
    // 连接状态只看「服务是否连通」：ok / degraded 都算在线（degraded 仅表示缺 ffmpeg/python 等依赖，
    // 能力就绪情况由 capabilities 单独表达，不应误报成「MCP 离线」）。只有真正连不上（非 2xx / 抛错）才离线。
    _connected = res.ok
  } catch {
    _connected = false
  }
  _checking = false
  return _connected
}

/**
 * 获取连接状态（同步）
 */
export function isMcpConnected() {
  return _connected
}

/**
 * 获取当前模式
 */
export function getMcpMode() {
  return _mode
}

/**
 * 设置模式：'auto'（自动检测）| 'mcp'（强制 MCP）| 'browser'（强制浏览器 WASM）
 */
export function setMcpMode(mode) {
  _mode = mode
}

/**
 * 判断当前是否应使用 MCP（考虑手动覆盖 + 自动检测）
 */
export function shouldUseMcp() {
  if (_mode === 'mcp') return true
  if (_mode === 'browser') return false
  return _connected // auto: 根据检测结果
}

/**
 * 调用 MCP 工具（HTTP API）
 * @param {string} tool - 工具名
 * @param {object} params - 参数
 * @returns {object} 工具返回结果
 */
export async function callMcpTool(tool, params = {}) {
  const res = await fetch(`${MCP_BASE}/tool/${tool}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}

/**
 * ASR 转写（原生 faster-whisper）
 * @param {string} audioPath - 音频文件绝对路径
 * @param {string} scriptText - 脚本文本
 * @param {object} opts - { model:'small', onProgress }
 * @returns {{ timeline, duration, rawSegments }}
 */
export async function mcpTranscribe(audioPath, scriptText, opts = {}) {
  return callMcpTool('transcribe', { audioPath, scriptText, model: opts.model || 'small' })
}

/**
 * 渲染并导出 MP4（原生 @napi-rs/canvas + ffmpeg）
 * @param {object} project - { messages, members, platform, mode, title, duration }
 * @param {string} audioPath - 音频文件路径
 * @param {string} outputPath - 输出 MP4 路径
 * @returns {{ success, outputPath, frameCount, duration }}
 */
export async function mcpRender(project, audioPath, outputPath) {
  return callMcpTool('render', { project, audioPath, outputPath })
}

/**
 * 解析脚本
 */
export async function mcpParseScript(scriptText, platform = 'wechat', mode = 'group') {
  return callMcpTool('parseScript', { scriptText, platform, mode })
}

/**
 * 语义决策
 */
export async function mcpDecide(messages) {
  return callMcpTool('decide', { messages })
}

/**
 * 节拍网格提取（librosa）
 * @param {string} audioPath - 音频文件绝对路径
 * @param {object} opts - { hopLength }
 * @returns {{ beat_grid, grid_meta, onset_envelope, onset_times, segments, duration }}
 */
export async function mcpBeatGrid(audioPath, opts = {}) {
  return callMcpTool('beatGrid', { audioPath, hopLength: opts.hopLength || 512 })
}

/**
 * 节拍网格 + ASR 联合 DP 对齐
 * @param {string} audioPath - 音频文件绝对路径
 * @param {string} scriptText - 脚本文本
 * @param {object} opts - { model, hopLength }
 * @returns {{ beat_grid, grid_meta, mapping, adlib_spans, mapping_meta, timeline, alignment_mode, asr_quality_score, duration }}
 */
export async function mcpAlignDP(audioPath, scriptText, opts = {}) {
  return callMcpTool('alignDP', {
    audioPath, scriptText,
    model: opts.model || 'small',
    hopLength: opts.hopLength || 512,
  })
}

/**
 * 节拍网格 + ASR 联合 DP 对齐（浏览器上传模式）
 * 浏览器把音频以 base64 发给 MCP Server，由服务端（Python faster-whisper）运行，
 * 模型只在本地磁盘缓存一次，不重复下载；浏览器端无需下载 transformers.js / WASM。
 * @param {Blob|File} file - 浏览器音频文件
 * @param {string} scriptText - 脚本文本
 * @param {object} opts - { model:'small', onProgress }
 * @returns {Promise<{beat_grid,grid_meta,mapping,adlib_spans,mapping_meta,timeline,alignment_mode,asr_quality_score,duration}>}
 */
export async function mcpAlignDPFile(file, scriptText, opts = {}) {
  const model = opts.model || 'small'
  // 读为 base64（含 MIME 前缀，服务端据此解码并落临时文件）
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
  // WS 实时进度（MCP Server 进度通过 WebSocket 推送）
  let ws = null
  try {
    ws = connectMcpWs((msg) => {
      if (msg?.progress && opts.onProgress) opts.onProgress(msg.progress)
    })
  } catch { /* WS 不可用时忽略，仅用 HTTP 结果 */ }
  try {
    const res = await fetch(`${MCP_BASE}/tool/alignDP`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64: dataUrl, scriptText, model, hopLength: opts.hopLength || 512 }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data
  } finally {
    if (ws) ws.close()
  }
}

/**
 * 网页「确认页面信息」回调：把音频 base64 + 用户核对的 messages/members 发给 MCP Server，
 * 服务端落盘音频（产生 agent 可读取的真实本地路径）并写入 pipeline_state.json。
 * 这是「用户在网页选音频 → agent 拿本地路径」的唯一可行通路（浏览器 File 无真实路径）。
 * @returns {Promise<{ok,audio_path,audio_name,message_count,member_count}>}
 */
export async function mcpSubmitPage({ audioBase64, audioName, messages, members, title }) {
  const res = await fetch(`${MCP_BASE}/tool/submitPage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64, audioName, messages, members, title }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}

/** 轮询读取 pipeline_state.json（agent 进度 / 回调结果）。 */
export async function fetchPipelineState() {
  const res = await fetch(`${MCP_BASE}/state`, { method: 'GET' })
  if (!res.ok) return null
  try { return await res.json() } catch { return null }
}

/**
 * WebSocket 连接（实时进度推送）
 * @param {function} onMessage - 消息回调
 * @returns {WebSocket} 连接对象
 */
export function connectMcpWs(onMessage) {
  const wsUrl = MCP_URL_DIRECT.replace('http', 'ws') + '/ws'
  const ws = new WebSocket(wsUrl)
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data))
    } catch {}
  }
  ws.onclose = () => { _connected = false }
  return ws
}
