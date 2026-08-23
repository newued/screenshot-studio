// 深链接解析：?script=<encodeURIComponent> 预填脚本；?export=slices|full|mp4|video 自动导出；
// ?decisions=<encodeURIComponent(JSON)> 由 AI 工具直传决策（模型直通，零后端）；
// ?timeline=<encodeURIComponent(JSON)> AI 直传时间轴（精确音画同步）；
// ?audio=<encodeURIComponent(URL)> AI 提供配音文件 URL（浏览器 fetch 后自动加载）
//
// 门控：视频生成能力（生成视频按钮 / VideoPipelinePanel）只在「agent 会话」下暴露。
// agent 进程以特定 query 触发打开本 UI 时才带 ?agent=1（或 ?agent=<token>），
// 此时才允许进入视频流程；行为与触发均由 agent 控制，UI 本身不主动提供视频入口。
export const AGENT_QUERY = 'agent'

export function readDeepLink(defaultScript = '') {
  const p = new URLSearchParams(window.location.search)
  const scriptParam = p.get('script')
  let decisions = null
  const decParam = p.get('decisions')
  if (decParam) {
    try {
      const d = JSON.parse(decodeURIComponent(decParam))
      decisions = Array.isArray(d) ? d : d.decisions || null
    } catch {
      /* 忽略非法 decisions */
    }
  }
  let timeline = null
  const tlParam = p.get('timeline')
  if (tlParam) {
    try {
      const tl = JSON.parse(decodeURIComponent(tlParam))
      timeline = Array.isArray(tl) ? tl : tl.messages || tl.timeline || null
    } catch {
      /* 忽略非法 timeline */
    }
  }
  const audioParam = p.get('audio')
  const agentParam = p.get(AGENT_QUERY)
  return {
    script: scriptParam ? decodeURIComponent(scriptParam) : defaultScript,
    hasScript: !!scriptParam,
    autoExport: p.get('export') || '',
    decisions,
    timeline,
    audio: audioParam ? decodeURIComponent(audioParam) : '',
    // 仅当 URL 携带 ?agent 参数（由本地 agent 进程以特定 query 触发打开）才视为 agent 会话
    isAgentSession: !!agentParam,
    agentToken: agentParam || '',
  }
}

/** 是否为 agent 触发的会话：决定是否暴露「生成视频」入口。 */
export function isAgentSession() {
  try {
    return !!new URLSearchParams(window.location.search).get(AGENT_QUERY)
  } catch {
    return false
  }
}