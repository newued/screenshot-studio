// Node 侧剪映草稿汇编器（供 AI 工具调用，无需浏览器）
// 用法：
//   node scripts/export-jianying.mjs --manifest manifest.json --slices-dir ./slices --out ./jianying-draft
// 说明：
//   - manifest.json 由本应用的“导出剪映草稿”或 ?export=jianying 深链接产出（含 slices 元数据）
//   - slices 目录放逐条消息截图，命名 001.png / 002.png ... 与 manifest.slices 顺序一致
//   - 输出草稿文件夹(<draft_id>/)：draft_content.json + global_config.json + draft_meta_info.json + manifest.json + slices/*.png
// 复用与浏览器完全相同的 buildDraft，保证两路产物一致。
import { readFile, writeFile, mkdir, copyFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { buildDraft } from '../src/lib/jianying/build.js'

function parseArgs(argv) {
  const a = {}
  for (let i = 2; i < argv.length; i++) {
    const m = argv[i].match(/^--([\w-]+)(?:=(.*))?$/)
    if (m) {
      const key = m[1]
      const val = m[2] !== undefined ? m[2] : argv[++i]
      a[key] = val
    }
  }
  return a
}

// 读 PNG IHDR 获取像素尺寸（无需额外依赖）
async function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return { width: 1080, height: 1920 }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

async function main() {
  const args = parseArgs(process.argv)
  const manifestPath = args.manifest
  if (!manifestPath) {
    console.error('缺少 --manifest 参数')
    process.exit(1)
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const base = dirname(manifestPath)
  const slicesDir = args['slices-dir'] ? join(process.cwd(), args['slices-dir']) : join(base, 'slices')
  const outDir = args.out ? join(process.cwd(), args.out) : join(process.cwd(), 'jianying-draft')

  const slicesMeta = manifest.slices || []
  const slices = []
  for (let i = 0; i < slicesMeta.length; i++) {
    const fileName = `${String(i + 1).padStart(3, '0')}.png`
    const buf = await readFile(join(slicesDir, fileName))
    const { width, height } = await pngSize(buf)
    const m = slicesMeta[i]
    slices.push({
      fileName: `slices/${fileName}`,
      width,
      height,
      type: m.type,
      speaker: m.speaker || '',
      text: m.text || '',
      amount: m.amount || '',
      recommendedDuration: m.recommendedDuration || 2,
    })
  }

  // 草稿文件夹以 draftId 命名，与浏览器导出结构一致；先算好绝对路径再交给 buildDraft，
  // 让素材 path 与 draft_fold_path 都是绝对路径，剪映才能定位媒介。
  const draftId = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `d-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
  const draftDir = join(outDir, draftId)

  const { files } = buildDraft({
    slices,
    meta: {
      projectTitle: manifest.projectTitle || '微信对话',
      platform: manifest.platform || 'wechat',
      mode: manifest.mode || 'single',
      baseDir: draftDir, // 绝对路径
      draftId,
    },
  })

  await mkdir(join(draftDir, 'slices'), { recursive: true })
  for (const f of files) {
    await writeFile(join(draftDir, f.name), f.content, 'utf8')
  }
  for (let i = 0; i < slicesMeta.length; i++) {
    const fileName = `${String(i + 1).padStart(3, '0')}.png`
    await copyFile(join(slicesDir, fileName), join(draftDir, 'slices', fileName))
  }
  console.log(`已生成剪映草稿：${draftDir}`)
  console.log(`草稿 ID：${draftId}`)
  console.log(`切片数：${slices.length}，总时长：${manifest.totalDuration || '?'}s`)
  console.log('将整个文件夹复制至：C:\\Users\\<用户名>\\AppData\\Local\\JianyingPro\\User Data\\Projects\\com.lveditor.draft\\ 后打开剪映即可看到。')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
