// scripts/core/client.js
// MCP HTTP 客户端（从 agent-bridge.mjs 抽出，反馈⑤②共享）
// 仅负责与 mcp-server 的 HTTP 通信，不含编排逻辑。

const PORT = 9527
const BASE = `http://127.0.0.1:${PORT}/api`

export async function callTool(tool, params = {}) {
  const res = await fetch(`${BASE}/tool/${tool}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json().catch(() => ({}))
  if (data.error) throw new Error(`tool ${tool} failed: ${data.error}`)
  return data
}

export async function health() {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) })
    const data = await res.json()
    return data.status === 'ok'
  } catch {
    return false
  }
}

export { BASE }
