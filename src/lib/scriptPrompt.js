// 脚本生成提示词（V1.1 设计文档第 4.1 节 SCRIPT 步骤）
// 用户输入自然语言提示词 → 复制给 AI 生成脚本 JSON → 导入应用
// 浏览器不调 LLM 接口，走模型直通（复制提示词给 codex/codebuddy）

/**
 * 构建给 AI 的脚本生成提示词
 * @param {string} userPrompt - 用户的自然语言描述
 * @param {string} mode - 'single' | 'group'
 * @param {string[]} speakerNames - 说话人名称列表
 * @returns {string} 提示词文本
 */
export function buildScriptPrompt(userPrompt, mode = 'single', speakerNames = []) {
  const modeDesc = mode === 'group'
    ? '群聊模式（多人群聊，3人以上）'
    : '单聊模式（双人对话）'

  const speakerHint = speakerNames.length > 0
    ? `说话人：${speakerNames.join('、')}`
    : '说话人：A、B（单聊）或 A、B、C…（群聊）'

  return `你是一个聊天对话脚本生成助手。请根据用户的描述，生成一段${modeDesc}的对话脚本。

要求：
- ${speakerHint}
- 对话自然、有生活气息，包含日常口语、表情、情绪起伏
- 每条消息标注情绪标签（neutral/happy/sad/angry/surprise）
- 可包含特殊消息类型：[红包：描述]、[转账：金额，备注]、[语音：时长"]、时间：XX:XX
- 消息条数 8-15 条为宜
- 只输出一个 JSON 对象，格式如下，不要任何解释、不要 markdown 代码块：

{
  "mode": "${mode}",
  "title": "对话标题",
  "speakers": [{"id":"A","name":"名字","color":"#4F8CFF","avatar":null}],
  "messages": [
    {"id":1,"speaker":"A","text":"对话内容","emotion":"neutral"},
    {"id":2,"speaker":"B","text":"对话内容","emotion":"happy"}
  ]
}

用户的描述：
${userPrompt}

输出格式示例：
{"mode":"single","title":"周末约饭","speakers":[{"id":"A","name":"小明","color":"#4F8CFF","avatar":null},{"id":"B","name":"小红","color":"#FF6B6B","avatar":null}],"messages":[{"id":1,"speaker":"A","text":"在吗？周末有空吗","emotion":"neutral"},{"id":2,"speaker":"B","text":"在的，怎么了","emotion":"neutral"},{"id":3,"speaker":"A","text":"想约你吃饭","emotion":"happy"},{"id":4,"speaker":"B","text":"好啊！吃什么","emotion":"happy"}]}`
}

/**
 * 将脚本 JSON 转为应用内脚本格式（parseScript 可解析的文本格式）
 * @param {object} scriptJson - AI 生成的脚本 JSON
 * @returns {string} 脚本文本
 */
export function scriptJsonToText(scriptJson) {
  if (!scriptJson || !Array.isArray(scriptJson.messages)) return ''
  const lines = []
  for (const msg of scriptJson.messages) {
    if (msg.type === 'time' || (msg.text && msg.text.startsWith('时间：'))) {
      lines.push(msg.text || `时间：${msg.content}`)
      continue
    }
    if (msg.type === 'system') {
      lines.push(`[系统]${msg.text || msg.content}`)
      continue
    }
    const speaker = msg.speaker || 'A'
    const text = msg.text || msg.content || ''
    lines.push(`${speaker}说：${text}`)
  }
  return lines.join('\n')
}

/**
 * 从脚本 JSON 中提取说话人列表
 * @param {object} scriptJson - AI 生成的脚本 JSON
 * @param {string[]} fallbackNames - 解析失败时的回退名称
 * @returns {Array} 说话人数组 [{id, name, color, avatar}]
 */
export function extractSpeakers(scriptJson, fallbackNames = []) {
  if (scriptJson?.speakers && Array.isArray(scriptJson.speakers)) {
    return scriptJson.speakers.map((s, i) => ({
      id: s.id || String.fromCharCode(65 + i),
      name: s.name || fallbackNames[i] || `成员${i + 1}`,
      color: s.color || '#4F8CFF',
      avatar: s.avatar || null,
    }))
  }
  // 从 messages 中推断
  if (scriptJson?.messages && Array.isArray(scriptJson.messages)) {
    const speakerIds = [...new Set(scriptJson.messages.map(m => m.speaker).filter(Boolean))]
    return speakerIds.map((id, i) => ({
      id,
      name: fallbackNames[i] || `成员${i + 1}`,
      color: '#4F8CFF',
      avatar: null,
    }))
  }
  return []
}

/**
 * 构建脚本产物（script.json，V1.1 第 4.1 节）
 * @param {object} params
 * @param {string} params.mode - 'single' | 'group'
 * @param {string} params.title - 标题
 * @param {Array} params.speakers - 说话人列表
 * @param {Array} params.messages - 消息列表（parseScript 输出格式）
 * @param {string} params.prompt - 原始提示词
 * @returns {object} script.json 产物
 */
export function buildScriptArtifact({ mode, title, speakers, messages, prompt = '' }) {
  return {
    mode,
    title,
    speakers: speakers.map((s, i) => ({
      id: s.id || String.fromCharCode(65 + i),
      name: s.name || `成员${i + 1}`,
      color: s.color || '#4F8CFF',
      avatar: s.avatar || null,
    })),
    messages: messages.map((m, i) => ({
      id: i + 1,
      speaker: m.speaker || 'A',
      text: m.content || m.text || '',
      emotion: m.emotion || 'neutral',
      type: m.type || 'text',
    })),
    meta: {
      prompt,
      generated_at: new Date().toISOString(),
    },
  }
}
