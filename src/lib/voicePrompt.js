// 配音提示词生成器：把对话脚本转成 Suno / 妙响 可用的配音提示词
// 用户复制提示词 → 去外部生成配音 MP3 → 回到应用选择配音文件（自动 ASR 时间轴）
// 参考 gospel-video 的 suno 模式：曲风 Prompt + [A]/[B] 分行 + [Verse] + [Outro][End]

// 曲风预设（可扩展）
export const VOICE_STYLES = [
  {
    id: 'gospel-funk',
    name: '福音放克（吐槽）',
    prompt:
      'Gospel-infused funk, dual powerful black male lead vocals, raspy soulful vocal texture, intricate melismatic riffs and gospel ad-libs, conversational call and response delivery, lush gospel choir backing harmonies, tight slap bassline, chicken scratch rhythm guitar, punchy brass section, play full dialogue ONLY ONCE, never loop or repeat content, The prelude should not exceed 3 seconds',
  },
  {
    id: 'ballad',
    name: '抒情叙事',
    prompt:
      'Emotional ballad, warm male vocals, gentle piano and strings, slow tempo, heartfelt storytelling delivery, soft backing harmonies, play full dialogue ONLY ONCE, never loop or repeat content, The prelude should not exceed 3 seconds',
  },
  {
    id: 'rap',
    name: '说唱吐槽',
    prompt:
      'Upbeat hip-hop rap, energetic male vocals, punchy 808 bass, crisp hi-hats, conversational flow, playful ad-libs, play full dialogue ONLY ONCE, never loop or repeat content, The prelude should not exceed 3 seconds',
  },
  {
    id: 'pop',
    name: '流行轻快',
    prompt:
      'Catchy pop, bright male vocals, driving beat, synth hooks, cheerful delivery, tight backing vocals, play full dialogue ONLY ONCE, never loop or repeat content, The prelude should not exceed 3 seconds',
  },
]

// 把消息列表转成 Suno 配音提示词（只取文本消息，跳过时间/系统/红包/转账/语音等）
// 返回空串表示无可配音文本
export function buildVoicePrompt(messages, stylePrompt) {
  const lines = messages
    .filter((m) => m.type === 'text' && (m.content || m.text))
    .map((m) => `[${m.speaker || 'A'}] ${m.content || m.text}`)
  if (!lines.length) return ''
  return `${stylePrompt}\n\n[Verse]\n${lines.join('\n')}\n[Outro][End]`
}