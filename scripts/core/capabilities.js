// scripts/core/capabilities.js
// 能力探测（单一真相源，registry.js 与 agent-bridge.mjs 共用）
// 服务存活 ≠ 能力就绪：MCP 起得来不代表 ffmpeg/python 可用，agent 据此判断能否出视频/ASR。
import { execSync } from 'node:child_process'

function hasBin(cmd) {
  // 用 where/command -v 探测「是否存在于 PATH」，不依赖各工具自己的版本 flag：
  // ffmpeg 只认 -version、python 只认 --version，混用 --version 会导致 ffmpeg 误判为未安装。
  const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`
  try { execSync(probe, { stdio: 'ignore' }); return true } catch { return false }
}

export function detectCapabilities() {
  const ffmpeg = hasBin('ffmpeg')
  const python = hasBin('python') || hasBin('python3')
  return {
    // 新手建议的语义化字段
    chat_image: true, // 图片导出始终可用（纯前端）
    chat_video: ffmpeg, // 视频导出依赖 ffmpeg
    asr: python, // ASR 依赖 python 运行时
    semantic: true, // 语义贴纸/动效（规则+LLM）始终可用
    // 底层字段（agent-up / 守卫仍引用）
    ffmpeg,
    python,
    render: ffmpeg, // 渲染依赖 ffmpeg
  }
}
