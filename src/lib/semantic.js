// 语义决策层（P4）：规则兜底 + LLM 直通合并
// 参考 gospel-video ab_generator.py 已验证的词表与匹配逻辑
// （STICKER_EMOTION_MAP / match_sticker / match_sfx / pick_animation）。
// 纯逻辑模块（浏览器 / Node 通用，无 DOM 依赖）：
//   - decideSemantics(messages)：规则兜底，返回每条消息的 { emotion, sticker, sfx, effect }
//   - applyDecisions(messages, decisions)：LLM 直通数组与消息一一对应合并，缺省项用规则兜底

// ---------- 词表 ----------

// 强情绪词 → 情绪标签（命中优先级：happy > sad > angry > surprise 按词表顺序）
const EMOTION_WORDS = {
  happy: ['哈哈哈', '哈哈', '开心', '高兴', '笑', '嘻', '哈皮', '棒', '好耶', '佩服', '厉害', '牛', '赞', '不错', '绝了', '优秀'],
  sad: ['难过', '伤心', '哭', '呜呜', '忧伤', '唉', '难受', '心累', '惨', '完蛋', '头疼', '委屈', 'emo'],
  angry: ['生气', '卧槽', '气死', '怒', '烦', '可恶', '滚', '揍', '无语', '顶嘴'],
  surprise: ['惊讶', '震惊', '哇', '天哪', '不是吧', '吓', '吃惊', '没想到', '？？？', '？？', '！！！', '难以置信'],
}

// 情绪 → 基础贴纸文件名（public/emojis 下）
const STICKER_EMOTION_MAP = {
  happy: 'happy_01.png',
  sad: 'sad_01.png',
  angry: 'angry_01.png',
  surprise: 'surprise_01.png',
}

// 疑问词 → pop_in
const QUESTION_WORDS = ['？', '?', '吗', '呢', '什么', '怎么', '为啥', '为什么', '哪个', '哪些', '谁', '是否', '能不能', '可以吗', '怎么办']

// 感叹号 → 侧滑（A 向右 / B 向左）
const EXCLAIM_RE = /[！!]/

// 相邻不重复时的轮换池（参考 pick_animation 的 [渐显, 侧滑, 弹入] 轮换）
const EFFECT_ROTATION = ['fade_in', 'slide_in_right', 'slide_in_left', 'pop_in']

// public/emojis 下的中文名贴纸清单（内容词匹配用；基础表情 angry_01 等由情绪映射覆盖）
const STICKER_FILES = [
  '一起哈皮.jpg', '一身正气.jpg', '上什么破班.jpg', '上班去了.jpg', '不听不听.jpg',
  '不好意思我戏比较多.png', '不存在的.png', '不知所措.jpg', '不禁陷入沉思.jpg',
  '为什么你们都那么有钱.png', '为何你是如此优秀.gif', '优秀牛马.jpeg', '你又开始放屁了.png',
  '你咋这么搞笑呢.webp', '你就是个小牛马.webp', '你想干嘛？.jpg', '你慢点放屁别呛着.webp',
  '你我届牛马.jpeg', '你撞币吗.gif', '你放屁.jpg', '你清醒一点.jpg', '你真的特别优秀.gif',
  '你算哪根葱.jpg', '你给我老实点.png', '你要什么面子.jpg', '你还要我怎样.jpg', '停一下.jpg',
  '再补一巴掌.jpg', '别惹我.jpg', '别说了，我不想听.jpg', '动态小表情-乖，不闹.gif',
  '动态小表情-你干什么.gif', '动态小表情-吓得我都怀孕了.gif', '动态小表情-哈哈.gif',
  '动态小表情-忧伤.gif', '动态小表情-我差点笑出声来.gif', '动态小表情-无语了.gif',
  '动态小表情-泰山压顶.gif', '动态小表情-深沉哈哈哈.gif', '动态小表情-牛皮哄哄.gif',
  '动态小表情-踹死.gif', '劳资举双手同意.jpg', '卑微.jpg', '可以，没问题.jpg',
  '可怜弱小又无助.jpg', '吃惊.jpg', '吃我Jo.jpg', '吃瓜-你还有瓜？.jpg', '吃瓜-强势围观.jpg',
  '吃瓜-看戏.jpg', '吃瓜-看热闹不嫌事大.jpg', '吃瓜-给我康康.jpg', '听，狗哭的声音.jpg',
  '呵女人.jpg', '哇哦.jpg', '哎，人生啊.jpg', '哟，这不是二狗么.jpg', '哥们中华来支.jpg',
  '啊~.jpg', '啪.png', '嗨不嗨皮.jpg', '嘻嘻嘻好好笑.jpg', '城里人，绝对是城里人.jpg',
  '大哥！对不起.jpg', '天生优秀惭愧惭愧.gif', '太虚假了.jpg', '好好好我走.jpg',
  '好气哟，可还是要保持微笑.jpg', '好，我鼓掌.jpg', '孤独.jpg', '完全生气.webp',
  '宝宝你又淘气了.jpg', '容我做个悲伤的表情.jpg', '对.png', '少废话.webp', '带我.jpg',
  '干杯.png', '干脆一油门撞死我算了.gif', '当场愣住.jpg', '很好，我生气了.webp',
  '快撤回！.jpg', '怀疑人生.jpg', '恩.jpg', '懂了，优秀.gif', '我不信.png',
  '我不要面子的吗.jpg', '我已经是天下无敌了.png', '我是一个没有感情的杀手.jpg',
  '我没有笑！.jpg', '我没有钱.jpg', '我爱你.jpg', '我看你就是来搞笑的.webp',
  '我见过很多傻逼你是最优秀的.gif', '手机-今天也是没人要的坏小孩.jpg', '手机-今晚那个吗.jpg',
  '手机-想谈恋爱了，大家劝劝我.jpg', '手机-我不能说累因为我还有梦想.jpg',
  '手机-我活的也不容易别总让我迁就你.jpg', '手机-欢迎哥哥踏上爱我这条不归路.jpg',
  '把你捧在手上.jpg', '把你捧在手上2.jpg', '抬起头不让眼泪留下来.jpg', '挠秃了.jpg',
  '放我出去.jpg', '明人不说暗话.jpg', '明白？.jpg', '有时候觉得很委屈.jpg',
  '有缘江湖再见.jpg', '正义必将得到伸张.jpg', '死会儿.gif', '每日早起上班的我.jpg',
  '求求你.jpg', '滚.jpg', '牛马领命.jpeg', '物理超度.jpg', '狂飙-who怕who.jpg',
  '狂飙-你二壁吧.jpg', '狂飙-你在教我做事？.jpg', '狂飙-你瞅啥？.jpg', '狂飙-偷窥.jpg',
  '狂飙-听不见.jpg', '狂飙-呸.jpg', '狂飙-嘁.jpg', '狂飙-太天真了.jpg', '狂飙-委屈巴巴.jpg',
  '狂飙-嫌弃.jpg', '狂飙-给爷死.jpg', '狂飙-观望.jpg', '狂飙-说的好.jpg', '生气2.webp',
  '生气！.webp', '看不撞不死你这都比.gif', '笑容逐渐扭曲.png', '算了我不生气.jpg',
  '糟了，是心动的感觉.jpg', '羡慕的要死.jpg', '聊天结束告辞.jpg', '莫生气.webp',
  '菜的抠脚啊弟弟.png', '装作笑的很开心.jpg', '装傻.jpg', '见鬼，难道这些人不用搬砖吗.jpg',
  '观望.jpg', '让人怪不好意思的.jpg', '让你还搞事！.jpg', '该不是我断网了吧.jpg',
  '请开始你的表演.jpg', '这个人挺搞笑的.webp', '这么刺激吗.png', '那又怎样.jpg',
  '那又怎样2.jpg', '那还在等什么.jpg', '错！.jpg', '难以置信.jpg', '面无表情青.jpg',
  '顶嘴，扣10分.jpg',
]

// 文件名核心词（去标点空白），用于反向匹配（文件名是文本的子串）
const STICKER_CORES = STICKER_FILES.map((f) => f.replace(/[！!？?，。,.、\s]/g, ''))

// ---------- 规则兜底 ----------

// 内容词匹配贴纸：先反向匹配（文件名核心词出现在文本中），再内容词匹配（文本 2 字 token 出现在文件名中）
function matchStickerByContent(text) {
  if (!text) return ''
  // 反向匹配：文件名核心词（去标点）是文本的子串
  for (let i = 0; i < STICKER_FILES.length; i++) {
    const core = STICKER_CORES[i]
    if (core.length >= 2 && text.includes(core)) return STICKER_FILES[i]
  }
  // 内容词匹配：文本中的 2 字以上中文 token 出现在文件名中
  const tokens = text.match(/[\u4e00-\u9fff]{2,}/g) || []
  for (const tok of tokens) {
    for (const name of STICKER_FILES) {
      if (name.includes(tok)) return name
    }
  }
  return ''
}

// 规则兜底：为每条消息决策 { emotion, sticker, sfx, effect }
// sfx：项目无 public/sfx 音效库，规则匹配一律空串（LLM 直通可填）
export function decideSemantics(messages = []) {
  const list = Array.isArray(messages) ? messages : []
  const out = []
  let lastEffect = ''
  list.forEach((m, i) => {
    const text = m.content || m.text || ''

    // emotion：强情绪词命中 → happy/sad/angry/surprise，否则 neutral
    let emotion = 'neutral'
    for (const [em, words] of Object.entries(EMOTION_WORDS)) {
      if (words.some((w) => text.includes(w))) {
        emotion = em
        break
      }
    }

    // sticker：情绪命中 → 基础表情；否则内容词匹配文件名；无匹配空串
    let sticker = ''
    if (emotion !== 'neutral') sticker = STICKER_EMOTION_MAP[emotion]
    if (!sticker) sticker = matchStickerByContent(text)

    // effect：疑问 → pop_in；感叹 → A 向右滑动 / B 向左滑动；否则 fade_in；相邻不重复轮换
    let effect = 'fade_in'
    if (QUESTION_WORDS.some((w) => text.includes(w))) effect = 'pop_in'
    else if (EXCLAIM_RE.test(text)) effect = m.speaker === 'B' ? 'slide_in_left' : 'slide_in_right'
    if (effect === lastEffect) {
      const pool = EFFECT_ROTATION.filter((e) => e !== effect)
      effect = pool[(i + 1) % pool.length]
    }
    lastEffect = effect

    out.push({ emotion, sticker, sfx: '', effect })
  })
  return out
}

// 决策统一入口：三种通道（①内置规则 ②AI 生成导入 ③深链接直传）最终都汇聚到这里消费。
// decisions（导入 / 深链接直传）存在则应用（缺省项规则兜底），否则内置规则兜底。
export function resolveDecisions(messages = [], decisions = null) {
  return Array.isArray(decisions) && decisions.length > 0
    ? applyDecisions(messages, decisions)
    : decideSemantics(messages)
}

// LLM 直通合并：decisions 为数组 [{ emotion, sticker, sfx, effect }]（与 messages 一一对应，可缺省），
// 缺省项用规则兜底；返回合并后的消息数组（每条消息带 emotion/sticker/sfx/effect 字段）。
export function applyDecisions(messages = [], decisions = []) {
  const list = Array.isArray(messages) ? messages : []
  const rules = decideSemantics(list)
  const decs = Array.isArray(decisions) ? decisions : []
  return list.map((m, i) => {
    const d = decs[i] || {}
    return {
      ...m,
      emotion: d.emotion || rules[i].emotion || 'neutral',
      sticker: d.sticker || rules[i].sticker || '',
      sfx: d.sfx || rules[i].sfx || '',
      effect: d.effect || rules[i].effect || '',
    }
  })
}