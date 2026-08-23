// 构建给 AI（codebuddy / codex）的时间轴生成提示词（模型直通，与决策通道对称）
// 让 AI 用本地 faster-whisper / SenseVoice（带 initial_prompt 偏置简体）转写配音音频，
// 按脚本每行对齐，输出 timeline.json，应用导入即可获得精确音画同步。
// 浏览器 Whisper 作为零配置默认；此提示词用于「AI 精修」拿到更高精度的时间轴。
export function buildTimelinePrompt(messages, audioName = '') {
  const list = messages.map((m, i) => ({
    index: i,
    speaker: m.speaker || 'A',
    content: m.content || m.text || '',
  }))
  const audioRef = audioName
    ? `音频文件：${audioName}（即用户选定的配音 MP3，请读取该文件进行转写）`
    : '音频文件：即用户选定的配音 MP3（请读取用户指定的音频文件进行转写）'
  return `你是一个聊天视频时间轴生成助手。我有一段配音音频和对应的聊天脚本，请转写音频并按脚本每行对齐，输出时间轴 JSON。

要求：
- 用 faster-whisper（推荐 small 模型，language='zh'）或 SenseVoice 转写音频；务必使用 initial_prompt='以下是简体中文的日常对话记录，请用简体中文输出。' 偏置简体输出，避免繁体。
- 将转写结果与下方脚本逐行对齐：每条消息的 display_start / display_end 对应其在音频中开始 / 结束的秒数（浮点，单位秒）。
- 若某条消息在音频中对应多段不连续语音，取最早开始与最晚结束。
- 末条消息的 display_end 应延伸到音频末尾。
- 只输出一个 JSON 对象，格式：{"messages":[{"display_start":0.78,"display_end":3.36}, ...]}，数组顺序与脚本消息一一对应，不要任何解释、不要 markdown 代码块。

${audioRef}

脚本（共 ${list.length} 条消息）：
${JSON.stringify(list, null, 2)}

输出格式示例：
{"messages":[{"display_start":0.78,"display_end":3.36},{"display_start":3.36,"display_end":6.54}]}`
}
