import html2canvas from 'html2canvas'

// 导出节点为 PNG 图片（自动展开滚动容器，确保捕获 chat-body 全部内容）
export async function exportImage(node, { filename = 'screenshot.png', scale = 2 } = {}) {
  if (!node) return
  document.documentElement.classList.add('html2canvas-export')
  const saved = expandForCapture(node)
  try {
    const canvas = await html2canvas(node, {
      backgroundColor: null,
      scale,
      useCORS: true,
      logging: false,
      windowWidth: node.scrollWidth,
      windowHeight: node.scrollHeight,
    })
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    restoreAfterCapture(saved)
    document.documentElement.classList.remove('html2canvas-export')
  }
}

// 逐条导出（切片）：将每个子节点分别截图，最终打包为 ZIP 下载
export async function exportSlices(nodes, baseName = 'slice') {
  document.documentElement.classList.add('html2canvas-export')
  try {
    const files = []
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      if (!node) continue
      const canvas = await html2canvas(node, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        logging: false,
      })
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) continue
      files.push({ name: `${baseName}-${String(i + 1).padStart(2, '0')}.png`, blob })
    }
    if (files.length === 0) return
    const zip = await zipFiles(files)
    const url = URL.createObjectURL(zip)
    const a = document.createElement('a')
    a.href = url
    a.download = `${baseName}-slices.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } finally {
    document.documentElement.classList.remove('html2canvas-export')
  }
}

// 临时展开滚动容器（含根节点），使 html2canvas 能捕获完整内容
function expandForCapture(root) {
  const saved = []
  const expand = (el) => {
    const cs = getComputedStyle(el)
    const scrollable =
      cs.overflowY === 'auto' || cs.overflowY === 'scroll' ||
      cs.overflow === 'auto' || cs.overflow === 'scroll' || cs.overflow === 'hidden'
    if (scrollable || el === root) {
      saved.push([el, { height: el.style.height, overflow: el.style.overflow, maxHeight: el.style.maxHeight }])
      el.style.height = 'auto'
      el.style.maxHeight = 'none'
      el.style.overflow = 'visible'
    }
  }
  expand(root)
  root.querySelectorAll('*').forEach(expand)
  return saved
}

function restoreAfterCapture(saved) {
  for (const [el, styles] of saved) {
    el.style.height = styles.height
    el.style.overflow = styles.overflow
    el.style.maxHeight = styles.maxHeight
  }
}

// ---------- 极简 ZIP 生成（仅存储，不压缩） ----------
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (~c) >>> 0
}

// files: [{ name, blob }]；返回 Blob(zip, application/zip)
export async function zipFiles(files) {
  const enc = new TextEncoder()
  const chunks = []
  const central = []
  let offset = 0
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer())
    const nameBytes = enc.encode(f.name)
    const crc = crc32(data)
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0, true)
    lv.setUint16(8, 0, true)
    lv.setUint16(10, 0, true)
    lv.setUint16(12, 0, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    chunks.push(local, data)

    const cd = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    cd.set(nameBytes, 46)
    central.push(cd)
    offset += local.length + data.length
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true)
  return new Blob([...chunks, ...central, end], { type: 'application/zip' })
}
