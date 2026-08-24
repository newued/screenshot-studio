// scripts/core/doctor.js
// 环境冒烟自检（P0-2）：在 ensure / doctor 子命令处尽早暴露「未就绪」，
// 避免像本轮那样跑到 run-page 才因 STATE_PATH / ffmpeg / python 缺失而炸。
import { STATE_PATH, readState } from './state.js'
import { detectCapabilities } from './capabilities.js'
import { loadAsrConfig, isAsrModelCached } from '../../mcp-server/tools/asrModel.js'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function runDoctor() {
  const caps = detectCapabilities()
  const checks = []
  const warnings = []

  // 1) 状态文件路径与根目录合法性
  const root = dirname(STATE_PATH)
  const rootOk = existsSync(join(root, 'mcp-server')) && existsSync(join(root, 'src'))
  checks.push({
    name: 'STATE_PATH',
    detail: STATE_PATH,
    ok: rootOk && STATE_PATH.endsWith('pipeline_state.json') && !STATE_PATH.split(/[\\/]/).includes('scripts'),
  })
  if (!checks[0].ok) warnings.push('STATE_PATH 异常：' + STATE_PATH)

  // 2) 状态文件可读
  let stateReadable = true
  try {
    readState(STATE_PATH)
  } catch (e) {
    stateReadable = false
    warnings.push('pipeline_state.json 读取异常：' + e.message)
  }
  checks.push({
    name: '状态文件可读',
    detail: stateReadable ? (readState(STATE_PATH) ? '已存在' : '不存在(将自动创建)') : '读取失败',
    ok: stateReadable,
  })

  // 3) 能力探测
  const capItems = [
    ['ffmpeg(渲染/视频)', caps.ffmpeg],
    ['python(ASR)', caps.python],
    ['chat_video', caps.chat_video],
    ['render', caps.render],
    ['asr', caps.asr],
  ]
  for (const [n, v] of capItems) {
    checks.push({ name: n, detail: v ? '就绪' : '缺失', ok: v })
    if (!v) warnings.push(`${n} 未就绪：视频生成/ASR 会失败（图片导出仍可）`)
  }

  // ASR 模型权重（受管依赖）缓存状态
  const asrCfg = loadAsrConfig()
  const asrCached = isAsrModelCached(asrCfg.model)
  checks.push({
    name: `ASR 模型(${asrCfg.model})`,
    detail: asrCached ? '已缓存（可逐字对齐）' : '未预载（离线退化兜底）',
    ok: true,
  })
  if (!asrCached && caps.asr) {
    warnings.push(`ASR 模型 "${asrCfg.model}" 未预载：离线环境 alignDP 将退化为 VAD/长度加权兜底（近似同步）；可联网机器跑 \`setup-asr\` 预下载。`)
  }

  return { ok: warnings.length === 0, caps, checks, warnings }
}
