/**
 * asrModel.js — ASR 模型权重的「受管依赖」管理
 *
 * 背景：faster-whisper 的模型权重（如 small ≈ 240MB）不在 pip/requirements.txt 里，
 * 而是运行时从 HuggingFace 下载并缓存到 ~/.cache。此前没有统一管理：
 *   - 没有配置入口（模型名写死在 transcribe.js）；
 *   - 没有预下载机制（首次出片才联网下载，离线直接失败并静默退化）；
 *   - doctor/agent-up 不感知模型是否存在。
 *
 * 本模块把 ASR 模型当成受管依赖：
 *   1) 单一配置真相源：mcp-server/asr-config.json（model/device/computeType/language）；
 *   2) ensureAsrModel()：幂等预下载（已缓存则秒回），带失败原因与离线兜底说明；
 *   3) isAsrModelCached()：供 doctor 展示缓存状态。
 * 下载失败不抛错中断流程——调用方应转而使用 beat_grid/VAD 兜底（音画近似同步）。
 */
import { execFile } from 'node:child_process'
import { writeFile, readFile, unlink, mkdtemp } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { requirePython } from './pyEnv.js'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dirname, '..', 'asr-config.json')
const DEFAULT_CONFIG = { model: 'small', device: 'cpu', computeType: 'int8', language: 'zh', hfEndpoint: 'https://hf-mirror.com', disableXet: true }

// 单一配置真相源：mcp-server/asr-config.json
export function loadAsrConfig() {
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    return { ...DEFAULT_CONFIG, ...cfg }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

/**
 * 将 ASR 相关 HuggingFace 环境变量应用到当前进程（供后续 python 子进程继承）。
 * - hfEndpoint：HF 官方不可达时改用镜像（如 https://hf-mirror.com）。
 * - disableXet：禁用 xet/CAS 重建传输，规避部分镜像返回的 401，直接拉取权重文件。
 * 仅在用户未显式设置时才写入，避免覆盖调用方环境。
 */
export function applyAsrEnv() {
  const cfg = loadAsrConfig()
  if (cfg.disableXet && !process.env.HF_HUB_DISABLE_XET) process.env.HF_HUB_DISABLE_XET = '1'
  if (cfg.hfEndpoint && !process.env.HF_ENDPOINT) process.env.HF_ENDPOINT = cfg.hfEndpoint
}

/**
 * 幂等预下载 ASR 模型权重（受管依赖）。需联网；失败返回结构化原因。
 * @param {string} [model] 模型名（缺省读配置）
 * @returns {Promise<{ok:boolean, model?:string, reason?:string, message?:string}>}
 */
export async function ensureAsrModel(model = loadAsrConfig().model, { timeout = 600_000 } = {}) {
  applyAsrEnv()
  let py
  try {
    py = await requirePython('faster_whisper')
  } catch (e) {
    return { ok: false, reason: 'no_python', message: e.message }
  }
  const tmpDir = await mkdtemp(join(tmpdir(), 'screenshort-asr-dl-'))
  const scriptPath = join(tmpDir, 'dl.py')
  const pyScript = `
import sys
try:
    from faster_whisper import download_model
    download_model("${model}")
    print("OK")
except Exception as e:
    print("ERR:" + str(e))
`
  await writeFile(scriptPath, pyScript, 'utf-8')
  try {
    const { stdout } = await execFileAsync(py, [scriptPath], { timeout })
    if (stdout.includes('OK')) return { ok: true, model }
    return { ok: false, reason: 'download_failed', message: stdout.trim() || '未知下载错误' }
  } catch (e) {
    return { ok: false, reason: 'download_failed', message: e.message }
  } finally {
    unlink(scriptPath).catch(() => {})
  }
}

// 粗略判断模型是否已缓存（仅供 doctor 展示，非强校验）
export function isAsrModelCached(model = loadAsrConfig().model) {
  const home = homedir()
  const candidates = [
    join(home, '.cache', 'huggingface', 'hub', `models--Systran--faster-whisper-${model}`),
    join(home, '.cache', 'faster-whisper', model),
  ]
  return candidates.some((p) => existsSync(p))
}
