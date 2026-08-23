// 聊天页面统一逻辑 hook：脚本/成员/群名 state、导出、随机头像、深链接、AI 面板、草稿保存
// 供微信群聊 / 微信单聊 / QQ 对话共用；不同平台仅渲染与截图样式不同
import { useRef, useState, useEffect, useMemo } from 'react'
import { parseScript } from './parseScript'
import { exportImage, exportSlices } from './exportImage'
import { defaultMembers, randomAvatars } from '../data/avatars'
import { readDeepLink } from './deepLink'
import { ts } from './time'

const DRAFT_PREFIX = 'draft:'

export function useChatPage({ defaultScript, defaultMemberNames, defaultGroupName, filename, exportBase }) {
  const DEEP = useMemo(() => readDeepLink(defaultScript), [defaultScript])
  const draftKey = `${DRAFT_PREFIX}${filename}`

  // 初始化优先级：深链接显式 script > 本地草稿 > 默认脚本
  const [script, setScript] = useState(() => {
    if (DEEP.hasScript) return DEEP.script
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) || 'null')
      if (d && d.script) return d.script
    } catch {
      /* 忽略损坏草稿 */
    }
    return defaultScript
  })
  const [members, setMembers] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) || 'null')
      if (d && Array.isArray(d.members) && d.members.length) return d.members
    } catch {
      /* 忽略损坏草稿 */
    }
    return defaultMembers(defaultMemberNames)
  })
  const [groupName, setGroupName] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) || 'null')
      if (d && d.groupName) return d.groupName
    } catch { /* 忽略损坏草稿 */ }
    return defaultGroupName
  })
  // 项目标题（可独立于群名，主要影响导出文件名）
  const [title, setTitle] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) || 'null')
      if (d && d.title) return d.title
    } catch { /* 忽略损坏草稿 */ }
    return defaultGroupName
  })
  const [aiOpen, setAiOpen] = useState(false)
  const screenRef = useRef(null)
  const didAuto = useRef(false)
  const messages = parseScript(script)

  // 自动保存草稿（脚本/成员/群名/标题）
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ script, members, groupName, title }))
    } catch { /* 存储满时忽略 */ }
  }, [script, members, groupName, title, draftKey])

  // 导出文件名语义化：优先 title，其次 groupName，再回退 filename
  const base = typeof exportBase === 'function' ? exportBase(groupName, members) : exportBase || title || defaultGroupName || filename
  const onExport = () => exportImage(screenRef.current, { filename: `${base}-${ts()}.png` })
  const onExportSlices = () => {
    const nodes = screenRef.current?.querySelectorAll('[data-slice]')
    if (nodes && nodes.length) exportSlices(Array.from(nodes), `${base}-${ts()}-slice`)
  }

  const randomizeAvatars = () => {
    const urls = randomAvatars(members.length)
    setMembers(members.map((m, i) => ({ ...m, avatar: urls[i] })))
  }

  // 深链接自动导出（等待布局与字体就绪）
  useEffect(() => {
    if (!DEEP.autoExport || didAuto.current) return
    didAuto.current = true
    const t = setTimeout(() => {
      if (DEEP.autoExport === 'slices') onExportSlices()
      else if (DEEP.autoExport === 'full') onExport()
    }, 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  return {
    DEEP,
    script,
    setScript,
    members,
    setMembers,
    groupName,
    setGroupName,
    title,
    setTitle,
    aiOpen,
    setAiOpen,
    screenRef,
    messages,
    onExport,
    onExportSlices,
    randomizeAvatars,
  }
}