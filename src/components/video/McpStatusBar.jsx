/**
 * McpStatusBar — MCP Server 连接状态 + 模式切换
 * 显示在视频面板顶部，提供连接状态指示和手动切换。
 */
import { useState, useEffect, useCallback } from 'react'
import { checkMcpStatus, isMcpConnected, getMcpMode, setMcpMode, shouldUseMcp } from '../../lib/mcpClient'

const MODES = [
  { value: 'auto', label: '自动检测', desc: 'MCP 可用时走原生，否则用浏览器' },
  { value: 'mcp', label: '强制 MCP', desc: '使用原生 faster-whisper（需 MCP Server 运行）' },
  { value: 'browser', label: '浏览器', desc: '使用浏览器端 WASM（无需 MCP Server）' },
]

export default function McpStatusBar() {
  const [connected, setConnected] = useState(isMcpConnected())
  const [mode, setModeState] = useState(getMcpMode)
  const [showMenu, setShowMenu] = useState(false)

  // 定期检测
  useEffect(() => {
    let timer
    const check = async () => {
      const ok = await checkMcpStatus()
      setConnected(ok)
    }
    check()
    timer = setInterval(check, 10000)
    return () => clearInterval(timer)
  }, [])

  const handleModeChange = useCallback((newMode) => {
    setMcpMode(newMode)
    setModeState(newMode)
    setShowMenu(false)
  }, [])

  const using = shouldUseMcp()
  const serverOnline = connected

  // 状态指示
  let dotColor, statusText
  if (mode === 'mcp') {
    dotColor = serverOnline ? '#07c160' : '#fa5151'
    statusText = serverOnline ? 'MCP 原生' : 'MCP 离线'
  } else if (mode === 'browser') {
    dotColor = '#999'
    statusText = '浏览器 WASM'
  } else {
    // auto
    dotColor = serverOnline ? '#07c160' : '#999'
    statusText = serverOnline ? 'MCP 原生' : '浏览器 WASM'
  }

  return (
    <div className="mcp-status-bar">
      <div
        className="mcp-status-indicator"
        onClick={() => setShowMenu(!showMenu)}
        title="点击切换渲染模式"
      >
        <span className="mcp-dot" style={{ backgroundColor: dotColor }} />
        <span className="mcp-status-text">{statusText}</span>
        <span className="mcp-chevron">{showMenu ? '▲' : '▼'}</span>
      </div>

      {showMenu && (
        <div className="mcp-mode-menu">
          {MODES.map(m => (
            <div
              key={m.value}
              className={`mcp-mode-item ${mode === m.value ? 'active' : ''}`}
              onClick={() => handleModeChange(m.value)}
            >
              <span className="mcp-mode-label">{m.label}</span>
              <span className="mcp-mode-desc">{m.desc}</span>
            </div>
          ))}
          {!serverOnline && mode === 'mcp' && (
            <div className="mcp-hint">
              启动 MCP Server：<code>node mcp-server/index.js --http-only</code>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
