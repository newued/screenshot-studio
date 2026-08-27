/**
 * pyEnv.js — 解析可用的 Python 解释器
 *
 * 问题背景：MCP Server 以子进程方式调用 python 运行 librosa / faster-whisper，
 * 但系统里可能有多份 python（如 C:\Python313 没有 librosa，而 QClaw 自带的
 * Python 3.11 已装好依赖）。直接 execFile('python') 会落到 PATH 里第一份、
 * 未必带包的版本，导致 ModuleNotFoundError。
 *
 * 策略：按候选清单逐一探测，挑第一个能 import 目标模块（librosa / faster_whisper）的。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { delimiter, dirname, join } from "node:path";
import fs from "node:fs";

const execFileAsync = promisify(execFile);

export function ensureFfmpegPath() {
  const candidates = [process.env.FFMPEG_BIN];
  if (process.platform === "win32") {
    candidates.push("D:\\ffmpeg-9.0.1-full_build\\bin\\ffmpeg.exe");
  }
  const executable = candidates.find(
    (candidate) => candidate && fs.existsSync(candidate),
  );
  if (!executable) return;
  const binDir = dirname(executable);
  const pathEntries = (process.env.PATH || "").split(delimiter);
  if (!pathEntries.includes(binDir)) {
    process.env.PATH = [binDir, ...pathEntries].filter(Boolean).join(delimiter);
  }
}

ensureFfmpegPath();

// 候选解释器：先动态探测常见自带 Python（不写死具体版本/绝对路径），再回退 PATH 里的 python / python3
function candidatePythons() {
  const list = [];
  if (process.platform === "win32") {
    // 动态探测 QClaw 等工具自带的 Python（版本号不固定，避免写死绝对路径）
    try {
      const pf = process.env.ProgramFiles || "C:\\Program Files";
      const qclawDir = join(pf, "QClaw");
      if (fs.existsSync(qclawDir)) {
        for (const ver of fs.readdirSync(qclawDir)) {
          const p = join(qclawDir, ver, "resources", "python", "python.exe");
          if (fs.existsSync(p)) list.push(p);
        }
      }
    } catch {
      /* 探测异常则忽略，继续用通用候选 */
    }
    list.push(
      "C:\\Python311\\python.exe",
      "C:\\Python312\\python.exe",
      "C:\\Python313\\python.exe",
    );
    const localPrograms = process.env.LOCALAPPDATA;
    if (localPrograms) {
      for (const ver of ["Python313", "Python312", "Python311", "Python310"]) {
        list.push(join(localPrograms, "Programs", "Python", ver, "python.exe"));
      }
    }
  }
  list.push("python3", "python");
  return list;
}

let _cached = null;

/**
 * 解析能 import 指定模块的 python 可执行文件路径
 * @param {string} mod - 探测用模块名，如 'librosa' 或 'faster_whisper'
 * @returns {Promise<string|null>} python 路径，找不到返回 null
 */
export async function resolvePython(mod = "librosa") {
  if (_cached && _cached[mod]) return _cached[mod];
  const probe = `import importlib.util as u; import sys; m=sys.argv[1]; print('OK' if u.find_spec(m) else 'NO')`;
  for (const py of candidatePythons()) {
    try {
      const { stdout } = await execFileAsync(py, ["-c", probe, mod], {
        timeout: 15_000,
      });
      if (stdout.includes("OK")) {
        _cached = _cached || {};
        _cached[mod] = py;
        return py;
      }
    } catch {
      // 该解释器不可用/不存在，跳过
    }
  }
  return null;
}

/**
 * 同 resolvePython，但找不到时抛出清晰错误（提示用户安装依赖）。
 */
export async function requirePython(mod = "librosa") {
  const py = await resolvePython(mod);
  if (!py) {
    throw new Error(
      `未找到已安装 ${mod} 的 Python 解释器。请在含 ${mod} 的 Python 中安装：` +
        ` pip install ${mod === "faster_whisper" ? "faster-whisper librosa soundfile numpy" : "librosa soundfile numpy"}` +
        `（当前 PATH 的 python 可能未安装依赖）。`,
    );
  }
  return py;
}
