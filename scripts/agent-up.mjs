#!/usr/bin/env node
/**
 * agent-up.mjs —— 「截图工坊」一键拉起全部后端
 * 后台拉起 vite(:5173) 与 mcp-server(:9527)，就绪后打印地址并退出（不阻塞调用方）。
 * 启动前自检并自动补齐依赖：ffmpeg / Node 依赖 / Python 依赖。
 * 支持国内镜像源加速、自动配置源、进度显示、清晰报错。
 */
import { spawn, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureAsrModel, loadAsrConfig } from '../mcp-server/tools/asrModel.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const NPM_REGISTRY = 'https://registry.npmmirror.com'
const PIP_INDEX = 'https://pypi.tuna.tsinghua.edu.cn/simple'

const log = (...a) => console.log('[agent-up]', ...a)
const err = (...a) => console.error('[agent-up]', ...a)
const step = (msg) => console.log('\n[agent-up] ▶', msg)
const ok = (msg) => console.log('[agent-up] ✅', msg)
const warn = (msg) => console.log('[agent-up] ⚠', msg)
const fail = (msg) => console.error('[agent-up] ❌', msg)

function run(cmd, opts = {}) {
  const fullCmd = typeof cmd === 'string' ? cmd : cmd.join(' ')
  log('>', fullCmd)
  try {
    execSync(fullCmd, { cwd: ROOT, stdio: 'inherit', ...opts })
    return true
  } catch (e) {
    return false
  }
}

function runQuiet(cmd, opts = {}) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'pipe', ...opts })
    return { ok: true, stdout: '' }
  } catch (e) {
    return { ok: false, stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || e.message }
  }
}

// ---------- 1) ffmpeg ----------
async function ensureFfmpeg() {
  step('检查 ffmpeg...')
  const r = runQuiet('ffmpeg -version')
  if (r.ok) { ok('ffmpeg 已就绪'); return true }

  warn('未检测到 ffmpeg，尝试自动安装...')
  const installed = await installFfmpeg()
  if (installed) { ok('ffmpeg 安装成功'); return true }
  warn('ffmpeg 自动安装失败，视频生成功能不可用（仅图片导出可用）')
  return false
}

async function installFfmpeg() {
  const platform = process.platform
  try {
    if (platform === 'win32') {
      const hasWinget = runQuiet('winget --version').ok
      if (!hasWinget) return false
      log('使用 winget 安装 ffmpeg...')
      return run('winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements', { timeout: 300000 })
    } else if (process.platform === 'darwin') {
      return run('brew install ffmpeg', { timeout: 600000 })
    } else {
      return run('sudo apt update && sudo apt install -y ffmpeg', { timeout: 300000 })
    }
  } catch { return false }
}

// ---------- 2) Node 依赖 ----------
async function ensureNodeDeps() {
  step('检查 Node 依赖...')

  // 配置 npm 镜像源
  const npmrc = runQuiet(`npm config get registry`)
  if (npmrc.ok && !npmrc.stdout.includes(NPM_REGISTRY)) {
    log(`配置 npm 镜像源: ${NPM_REGISTRY}`)
    run(`npm config set registry ${NPM_REGISTRY}`)
  }

  const dirs = [
    { name: '前端', path: ROOT },
    { name: 'mcp-server', path: resolve(ROOT, 'mcp-server') }
  ]

  for (const d of dirs) {
    const nm = resolve(d.path, 'node_modules')
    if (!existsSync(nm)) {
      log(`安装 ${d.name} 依赖...`)
      if (!run(`npm install`, { cwd: d.path })) {
        fail(`${d.name} npm install 失败`)
        return false
      }
      ok(`${d.name} 依赖就绪`)
    } else {
      ok(`${d.name} 依赖已就绪`)
    }
  }
  return true
}

// ---------- 3) Python 依赖 ----------
async function ensurePythonDeps() {
  step('检查 Python 环境...')

  // 检测 Python 可用性
  const pyBin = await detectPython()
  if (!pyBin) {
    warn('Python 未安装或不在 PATH')
    printPythonInstallGuide()
    return false
  }

  const version = runQuiet(`${pyBin} --version`)
  log(`使用 Python: ${version.stdout.trim()}`)

  // 配置 pip 镜像源
  await configurePipIndex(pyBin)

  const needed = ['librosa', 'soundfile', 'numpy', 'faster_whisper']
  const missing = []
  for (const m of needed) {
    const r = runQuiet(`${pyBin} -c "import ${m}"`)
    if (!r.ok) missing.push(m)
  }

  if (missing.length === 0) {
    ok('Python 依赖齐全: ' + needed.join(', '))
    return true
  }

  log(`缺少 Python 包: ${missing.join(', ')}，正在安装...`)

  // 尝试多种安装方式
  const methods = [
    { cmd: `${pyBin} -m pip install -i ${PIP_INDEX} ${missing.join(' ')}`, name: `${pyBin} -m pip (清华源)` },
    { cmd: `pip install -i ${PIP_INDEX} ${missing.join(' ')}`, name: `pip (清华源)` },
    { cmd: `pip3 install -i ${PIP_INDEX} ${missing.join(' ')}`, name: `pip3 (清华源)` },
    // 回退：无镜像源
    { cmd: `${pyBin} -m pip install ${missing.join(' ')}`, name: `${pyBin} -m pip (官方源)` }
  ]

  for (const m of methods) {
    log(`尝试: ${m.name} ...`)
    if (run(m.cmd, { timeout: 300000 })) {
      // 验证
      const stillMissing = missing.filter(pkg => !runQuiet(`${pyBin} -c "import ${pkg}"`).ok)
      if (stillMissing.length === 0) {
        ok('Python 依赖安装完成')
        return true
      }
      warn(`${m.name} 安装后仍缺: ${stillMissing.join(', ')}`)
    } else {
      warn(`${m.name} 失败`)
    }
  }

  fail('Python 依赖自动安装失败')
  printManualInstallGuide(pyBin, missing)
  return false
}

async function detectPython() {
  // 仅探测 PATH 中的解释器，不硬编码任何机器专属路径（跨平台通用）。
  const candidates = ['python', 'python3', 'py']
  for (const py of candidates) {
    if (runQuiet(`${py} --version`).ok) return py
  }
  return null
}

async function configurePipIndex(pyBin) {
  const r = runQuiet(`${pyBin} -m pip config get global.index-url`)
  if (r.ok && !r.stdout.includes(PIP_INDEX)) {
    log(`配置 pip 镜像源: ${PIP_INDEX}`)
    run(`${pyBin} -m pip config set global.index-url ${PIP_INDEX}`)
  }
}

function printPythonInstallGuide() {
  warn('请先安装 Python 3.8+:')
  console.log('  Windows: https://www.python.org/downloads/ (勾选 "Add Python to PATH")')
  console.log('  macOS:   brew install python')
  console.log('  Linux:   sudo apt install python3 python3-pip')
}

function printManualInstallGuide(pyBin, missing) {
  console.log('')
  warn('自动安装失败，请手动执行:')
  console.log(`  ${pyBin} -m pip install -i ${PIP_INDEX} ${missing.join(' ')}`)
  console.log('')
  console.log('若权限不足:')
  console.log(`  ${pyBin} -m pip install --user -i ${PIP_INDEX} ${missing.join(' ')}`)
  console.log('')
  console.log('或使用 requirements.txt:')
  console.log(`  ${pyBin} -m pip install -i ${PIP_INDEX} -r requirements.txt`)
}

// ---------- 主流程 ----------
async function main() {
  console.log('\n╔══════════════════════════════════════╗')
  console.log('║     截图工坊 · 一键启动后端          ║')
  console.log('╚══════════════════════════════════════╝\n')

  const ffmpegOk = await ensureFfmpeg()
  const nodeOk = await ensureNodeDeps()
  const pythonOk = await ensurePythonDeps()

  // 汇总报告
  console.log('\n┌────────────────────────────────────────┐')
  console.log('│           依赖安装总结                  │')
  console.log('├────────────────────────────────────────┤')
  console.log(`│ ${ffmpegOk ? '✅' : '❌'} ffmpeg           ${ffmpegOk ? '已就绪' : '未安装 (视频功能不可用)'} │`)
  console.log(`│ ${nodeOk ? '✅' : '❌'} Node 依赖         ${nodeOk ? '已就绪' : '安装失败'} │`)
  console.log(`│ ${pythonOk ? '✅' : '❌'} Python 依赖      ${pythonOk ? '已就绪' : '安装失败 (ASR/对齐不可用)'} │`)
  console.log('└────────────────────────────────────────┘')

  if (!ffmpegOk || !pythonOk) {
    console.log('')
    log('⚠ 部分依赖缺失，但不影响网页界面访问: http://localhost:5173/')
    log('  图片导出可用；视频生成需要 ffmpeg + Python 依赖完整。\n')
  }

  // ---------- 启动后端 ----------
  step('启动后端服务...')
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const vite = spawn(npmBin, ['run', 'dev'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true, shell: true })
  vite.unref()
  const mcp = spawn('node', ['mcp-server/index.js', '--http-only'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true })
  mcp.unref()

  async function mcpHealth() {
    try {
      const res = await fetch('http://127.0.0.1:9527/api/health', { signal: AbortSignal.timeout(2000) })
      const data = await res.json()
      return data
    } catch { return null }
  }
  async function viteHealth() {
    try {
      const res = await fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(2000) })
      return res.ok
    } catch { return false }
  }

  log('等待服务就绪...')
  let ok = false
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000))
    if (await mcpHealth() && await viteHealth()) { ok = true; break }
    if (i % 5 === 0) log(`等待中... (${i + 1}/60s)`)
  }

  if (ok) {
    const health = await mcpHealth()
    const caps = (health && health.capabilities) || {}
    const cap = (b) => (b ? '✓' : '✗')
    console.log('\n┌────────────────────────────────────────┐')
    console.log('│         🎉 服务已启动                    │')
    console.log('├────────────────────────────────────────┤')
    console.log('│ 网页: http://localhost:5173/           │')
    console.log('│ MCP : http://127.0.0.1:9527/api        │')
    console.log('├────────────────────────────────────────┤')
    console.log(`│ 能力: ffmpeg ${cap(caps.ffmpeg)}  python ${cap(caps.python)} │`)
    console.log(`│ 视频生成: ${caps.render ? 'READY' : 'NOT_READY（缺 ffmpeg/python，仅图片导出可用）'} │`)
    console.log(`│ ASR     : ${caps.asr ? 'READY' : 'NOT_READY'} │`)
    console.log('└────────────────────────────────────────┘')
    log('服务在后台运行，可继续调用 agent-bridge 命令')
   } else {
    const mcpUp = await mcpHealth()
    const viteUp = await viteHealth()
    const down = [!mcpUp && 'mcp-server(9527)', !viteUp && 'vite(5173)'].filter(Boolean).join('、')
    fail(`后端未完全就绪: ${down} 未启动，请检查端口占用与依赖`)
    process.exitCode = 1
  }

  // ---------- 预下载 ASR 模型（受管依赖）----------
  // 与 ffmpeg/python 同级的依赖补齐：尽量在服务启动阶段把模型拉到本地缓存，
  // 避免首次出片才联网下载；离线则跳过并提示后续对齐会退化为兜底。
  step('预下载 ASR 模型（受管依赖）...')
  const asrCfg = loadAsrConfig()
  try {
    const asrR = await ensureAsrModel(asrCfg.model)
    if (asrR.ok) ok(`ASR 模型 ${asrR.model} 已预载（~/.cache/huggingface）`)
    else warn(`ASR 模型未预载[${asrR.reason}]: ${asrR.message}；离线时 alignDP 退化为 VAD/长度加权兜底（近似同步）`)
  } catch (e) {
    warn(`ASR 模型预下载异常: ${e.message}（不影响启动，离线对齐将走兜底）`)
  }
}

main().catch(e => { fail(e.message); process.exit(1) })