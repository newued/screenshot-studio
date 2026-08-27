/**
 * render.js — 流式帧渲染 + ffmpeg 编码（零临时文件）
 * frame → ctx.getImageData → ffmpeg stdin (rawvideo) → MP4
 */
import { createCanvas, loadImage as napiLoadImage } from "@napi-rs/canvas";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { ensureFfmpegPath } from "./pyEnv.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

async function loadModule(name) {
  const mod = await import(
    pathToFileURL(join(ROOT, "src", "lib", `${name}.js`)).href
  );
  return mod;
}

function setupRenderer(project, canvas, ctx, canvasChat) {
  async function loadImage(urlOrPath) {
    if (!urlOrPath) return null;
    // dataURL（头像 SVG / 上传图）：解码成 Buffer 喂给 napiLoadImage（支持 SVG）
    if (urlOrPath.startsWith("data:")) {
      try {
        const m = /^data:([^;]+);(base64|utf8|charset=utf-8),(.*)$/.exec(
          urlOrPath,
        );
        let buf;
        if (m && m[2] === "base64") buf = Buffer.from(m[3], "base64");
        else if (m && (m[2] === "utf8" || m[2] === "charset=utf-8"))
          buf = Buffer.from(decodeURIComponent(m[3]), "utf8");
        else buf = Buffer.from(urlOrPath.split(",")[1], "base64");
        return await napiLoadImage(buf);
      } catch {
        return null;
      }
    }
    if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
      try {
        const res = await fetch(urlOrPath);
        return napiLoadImage(Buffer.from(await res.arrayBuffer()));
      } catch {
        return null;
      }
    }
    try {
      return await napiLoadImage(urlOrPath);
    } catch {
      return null;
    }
  }
  function resolveAsset(src) {
    if (!src) return "";
    if (src.startsWith("http://") || src.startsWith("https://")) return src;
    if (src.startsWith("/")) return join(ROOT, "public", src);
    return src;
  }
  return canvasChat.createChatFrameRenderer({
    width: 1080,
    height: 1920,
    title: project.title || "截图工坊",
    project: { members: project.members || [] },
    canvas,
    ctx,
    loadImage,
    resolveAsset,
  });
}

function buildTiming(messages, duration) {
  // 优先用 mapping 风格 rap_span/proposed_at；其次 display_start/end；
  // 最后退化按字数估算并链式衔接。每个字段派生为 {ds, de} 供 canvasChat.render 消费。
  const n = messages.length;
  const withSpan = messages.map((m, i) => {
    const rap = m.rap_span || null;
    const ds =
      rap && rap.start != null
        ? +rap.start
        : m.display_start != null
          ? +m.display_start
          : m.start != null
            ? +m.start
            : null;
    const de =
      rap && rap.end != null
        ? +rap.end
        : m.display_end != null
          ? +m.display_end
          : m.end != null
            ? +m.end
            : null;
    const proposed = m.proposed_at != null ? +m.proposed_at : null;
    return { ds, de, proposed, i };
  });
  const arr = withSpan.map((x) => {
    let ds = x.ds;
    let de = x.de;
    const explicit = de != null && de > ds;
    if (ds == null) ds = x.proposed;
    if (ds == null) ds = 0;
    // 仅对“无显式 end”的做兜底；已有 end（matched 或人工仲裁的 unmatched）原样保留，
    // 不再做链式裁剪——同 rap 段内前后句本就允许时间窗重叠。
    if (de == null || de <= ds) {
      const nextDs = i + 1 < n ? (arr[i + 1]?.ds ?? null) : null;
      de = Math.max(ds + 0.6, Math.min(nextDs ?? ds + 12, 12));
    }
    return { ds, de, explicit };
  });
  // 末条消息持续到音频结尾，避免最后一句消失后留空白
  if (arr.length > 0 && duration && duration > arr[arr.length - 1].de) {
    arr[arr.length - 1].de = +duration.toFixed(3);
  }
  return arr.map((x) => ({ ds: +x.ds.toFixed(3), de: +x.de.toFixed(3) }));
}

/**
 * renderAndEncode — 流式渲染 + 编码（零临时文件）
 * @param {object} project - { messages, members, platform, mode, title, duration, audioDuration }
 * @param {string|null} audioPath
 * @param {string} outputPath
 * @param {object} opts - { fps, width, height, onProgress }
 * @returns {{ success, outputPath, frameCount, duration }}
 */
export async function renderAndEncode(
  project,
  audioPath,
  outputPath,
  opts = {},
) {
  const canvasChat = await loadModule("canvasChat");
  const fps = opts.fps || 30;
  const W = opts.width || 1080;
  const H = opts.height || 1920;

  const messages = project.messages || [];
  const duration =
    project.duration ||
    project.audioDuration ||
    messages.reduce((max, m) => Math.max(max, m.display_end || 0), 10);
  const totalFrames = Math.ceil(duration * fps);
  const timing = buildTiming(messages, duration);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const renderer = setupRenderer(project, canvas, ctx, canvasChat);
  // 关键：渲染前预加载头像/图标/贴纸，否则 imgCache 为空、头像永远走字母兜底
  await renderer.preload(messages, project.members || []);
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  ensureFfmpegPath();

  // ffmpeg: rawvideo pipe → MP4
  const ffmpegArgs = [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${W}x${H}`,
    "-r",
    String(fps),
    "-i",
    "pipe:0",
  ];
  if (audioPath) {
    ffmpegArgs.push("-i", audioPath, "-c:a", "aac", "-b:a", "128k");
  }
  ffmpegArgs.push(
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    "4M",
    "-movflags",
    "+faststart",
    "-shortest",
    outputPath,
  );

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  ffmpeg.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    renderer.render(t, {
      messages,
      members: project.members || [],
      platform: project.platform || "wechat",
      mode: project.mode || "group",
      title: project.title || "",
      timing,
      duration,
      centered: !!project.centered,
    });
    const img = ctx.getImageData(0, 0, W, H);
    const buf = Buffer.from(
      img.data.buffer,
      img.data.byteOffset,
      img.data.byteLength,
    );
    if (!ffmpeg.stdin.write(buf)) await once(ffmpeg.stdin, "drain");
    if (i % 30 === 0)
      opts.onProgress?.({
        frame: i,
        total: totalFrames,
        pct: Math.round((i / totalFrames) * 100),
      });
  }
  if (ffmpeg.exitCode !== null) {
    throw new Error(
      `ffmpeg 提前退出 (code ${ffmpeg.exitCode}): ${stderr.slice(-500)}`,
    );
  }
  ffmpeg.stdin.end();
  await once(ffmpeg, "close");

  if (ffmpeg.exitCode !== 0) {
    throw new Error(
      `ffmpeg 编码失败 (code ${ffmpeg.exitCode}): ${stderr.slice(-500)}`,
    );
  }
  return { success: true, outputPath, frameCount: totalFrames, duration };
}

// 保留向后兼容的导出
export { renderAndEncode as renderAllFrames };
export async function renderFrame(frameIndex, fps, project) {
  const canvasChat = await loadModule("canvasChat");
  const canvas = createCanvas(1080, 1920);
  const ctx = canvas.getContext("2d");
  const renderer = setupRenderer(project, canvas, ctx, canvasChat);
  const timing = buildTiming(
    project.messages || [],
    project.duration || project.audioDuration,
  );
  await renderer.preload(project.messages || [], project.members || []);
  const fdur = project.duration || project.audioDuration || 0;
  renderer.render(frameIndex / fps, {
    messages: project.messages || [],
    members: project.members || [],
    platform: project.platform || "wechat",
    mode: project.mode || "group",
    title: project.title || "",
    timing,
    duration: fdur,
  });
  const img = ctx.getImageData(0, 0, 1080, 1920);
  return Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
}

// ==================== 导出全图 / 切片（node 侧，复用 canvasChat 渲染器） ====================
// mode: 'full'  = 把整段对话结尾帧（全部气泡在画面里）合成一张 PNG
//       'slices'= 把每条消息在“登场峰值”时刻渲染为单张切片 PNG（每条一个文件），方便用户分享某句
// 返回 { success, mode, files:[绝对路径], duration }
// 注意：此导出不依赖浏览器 DOM，纯 node 渲染，可被 MCP 工具直接调用。
export async function exportStills(project, opts = {}) {
  const canvasChat = await loadModule("canvasChat");
  const fps = 30;
  const W = opts.width || 1080;
  const H = opts.height || 1920;
  const messages = project.messages || [];
  const duration =
    project.duration ||
    project.audioDuration ||
    messages.reduce(
      (max, m) => Math.max(max, m.display_end || m.rap_span?.end || 0),
      10,
    );
  const timing = buildTiming(messages, duration);
  const outDir =
    opts.outputDir ||
    join(os.homedir(), "Downloads", "screenshot-studio", "export");
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(outDir, { recursive: true }),
  );
  const files = [];

  const renderOne = async (t, name) => {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    const renderer = setupRenderer(project, canvas, ctx, canvasChat);
    await renderer.preload(messages, project.members || []);
    renderer.render(t, {
      messages,
      members: project.members || [],
      platform: project.platform || "wechat",
      mode: project.mode || "group",
      title: project.title || "",
      timing,
      duration,
      centered: !!project.centered,
    });
    const out = join(outDir, name);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(out, canvas.toBuffer("image/png"));
    return out;
  };

  if (opts.mode === "slices") {
    for (let i = 0; i < messages.length; i++) {
      const tk = timing[i];
      const t = tk ? tk.ds + Math.min(0.3, (tk.de - tk.ds) / 2) : i * 0.5;
      const f = await renderOne(t, `slice-${String(i).padStart(3, "0")}.png`);
      files.push(f);
    }
  } else {
    // full：像真实截图——所有气泡同时出现在画面里（覆盖整段时长），不被逐条收起
    const fullTiming = messages.map((m, i) => ({
      ds: +(i * 0.01).toFixed(3),
      de: +duration.toFixed(3),
    }));
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    const renderer = setupRenderer(project, canvas, ctx, canvasChat);
    await renderer.preload(messages, project.members || []);
    renderer.render(Math.max(0.1, duration - 0.1), {
      messages,
      members: project.members || [],
      platform: project.platform || "wechat",
      mode: project.mode || "group",
      title: project.title || "",
      timing: fullTiming,
      duration,
      centered: !!project.centered,
      showAll: true,
    });
    const fullOut = join(outDir, "full.png");
    await (
      await import("node:fs/promises")
    ).writeFile(fullOut, canvas.toBuffer("image/png"));
    files.push(fullOut);
  }
  return { success: true, mode: opts.mode || "full", files, duration };
}
