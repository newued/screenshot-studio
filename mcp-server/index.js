/**
 * MCP Server for 截图工坊
 *
 * 双协议：
 *   1. HTTP API + WebSocket（浏览器 UI 直接调用）
 *   2. MCP JSON-RPC over stdio（AI Agent codex/workbuddy 调用）
 *
 * 核心工具注册表已抽到 mcp-server/registry.js（反馈⑥：单一 Core API）。
 * 本文件只负责传输层（HTTP / WebSocket / stdio），三种传输都经 dispatchTool 调用同一份工具。
 *
 * 启动：
 *   node index.js              — 默认 HTTP + stdio 双模式
 *   node index.js --http-only  — 仅 HTTP（浏览器直连）
 *   node index.js --mcp-only   — 仅 MCP stdio（AI Agent 集成）
 */
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import {
  STATE_PATH,
  readPipelineState,
  dispatchTool,
  listToolSpecs,
  detectCapabilities,
} from './registry.js'

const PORT = parseInt(process.env.PORT || '9527', 10)
const args = process.argv.slice(2)
const httpOnly = args.includes('--http-only')
const mcpOnly = args.includes('--mcp-only')

// ==================== HTTP API ====================
function startHttpServer() {
  const server = createServer(async (req, res) => {
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

    // 健康检查（含能力探测：服务存活 ≠ 能力就绪）
    if (req.method === 'GET' && req.url === '/api/health') {
      const caps = detectCapabilities()
      const ready = caps.ffmpeg && caps.python
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: ready ? 'ok' : 'degraded',
        ready,
        capabilities: caps,
        tools: listToolSpecs().map((t) => t.name),
      }))
      return
    }

    // 工具调用（统一经 dispatchTool）
    if (req.method === 'POST' && req.url?.startsWith('/api/tool/')) {
      const toolName = req.url.split('/api/tool/')[1]
      try {
        const body = await readBody(req)
        const result = await dispatchTool(toolName, body)
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

  // WebSocket（进度推送，同样经 dispatchTool）
  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (ws) => {
    console.log('[MCP] WebSocket 客户端已连接')
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data)
        if (msg.tool) {
          const result = await dispatchTool(msg.tool, msg.params || {})
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
    console.log(`[MCP] 可用工具: ${listToolSpecs().map((t) => t.name).join(', ')}`)
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
  process.stdin.setEncoding('utf-8')
  let buffer = ''

  process.stdin.on('data', async (chunk) => {
    buffer += chunk
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
    return { jsonrpc: '2.0', result: { tools: listToolSpecs() }, id }
  }

  if (method === 'tools/call') {
    const toolName = params?.name
    const toolArgs = params?.arguments || {}
    try {
      const result = await dispatchTool(toolName, toolArgs)
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
