# AI 全自动出片：深链接协议

本应用支持「人只给主题，AI 全自动完成出片」。AI 系统（codex / workbuddy 等）按以下协议构造深链接，浏览器打开后自动完成：脚本注入 → 决策（贴纸/动画）→ 配音 → 时间轴 → 渲染 MP4。全程用户无需操作（除首次打开页面）。

## 深链接参数总览

| 参数 | 必填 | 说明 |
|---|---|---|
| `script` | 是 | 聊天脚本文本（`encodeURIComponent`），语法见下方 |
| `export` | 是 | `mp4` 或 `video`：浏览器直出 MP4 并自动下载 |
| `decisions` | 否 | 决策 JSON 数组（每消息 emotion/sticker/effect），AI 语义判断后直传 |
| `timeline` | 否 | 时间轴 JSON 数组（每消息 display_start/display_end），AI 精确对齐配音后直传 |
| `audio` | 否 | 配音文件 URL（AI 已放好的音频，浏览器 fetch 后自动载入） |

> **平台由 URL 路径决定（不是 query 参数）**：`/wechat/single`（单聊）、`/wechat/group`（群聊）、`/qq/chat`（QQ）。

## 脚本语法

```
时间：上午 9:41
A说：在吗？
B说：在的
A说：[红包：周末聚餐红包]
B说：[转账：200.00，AA餐费]
B说：[语音：3"]
A说：[语音转文字：收到]
A说：[视频已接：00:15]
B说：[视频未接]
系统：你已添加了张三
```

- 说话人 `A`=「我」；`B`/`C`... 依次为对方/群成员
- 特殊消息用 `[类型：内容]` 括号语法
- 决策 `sticker` 只填**贴纸文件名**（如 `angry_01.png`），不填完整路径；`effect` 取值 `pop_in` / `slide_in_left` / `slide_in_right` / `fade_in`；`emotion` 取值 `happy` / `sad` / `angry` / `surprise` / `neutral`

## 决策 JSON 格式

数组元素与脚本消息一一对应：

```json
[
  { "emotion": "neutral", "sticker": "", "effect": "fade_in" },
  { "emotion": "angry", "sticker": "angry_01.png", "effect": "pop_in" }
]
```

若省略 `decisions`，浏览器会用内置规则自动生成（用户零决策）。

## 时间轴 JSON 格式

用于精确音画同步（AI 已把配音按句切分、标注起止秒）：

```json
[
  { "display_start": 0.0, "display_end": 2.4 },
  { "display_start": 2.4, "display_end": 8.4 }
]
```

若省略 `timeline`，浏览器按文字长度估算，仍可出片（粗略同步）。

## 完整示例

AI 收到主题「朋友借钱不还」后，生成以下深链接并打开：

```
https://localhost:5173/wechat/group?script=<encodeURIComponent(脚本)>&decisions=<encodeURIComponent(决策JSON)>&timeline=<encodeURIComponent(时间轴JSON)>&audio=http://localhost:8899/voice.mp3&export=mp4
```

打开后浏览器自动：
1. 注入脚本、决策、时间轴、音频
2. 等待音频就绪（最多 8s，失败则静音兜底）
3. 自动触发「导出 MP4 直出」，完成渲染并下载

## 建议步骤（AI 侧）

1. **主题 → 脚本**：把用户主题扩展成有冲突/情绪起伏的对话，含红包/转账/语音等丰富类型
2. **脚本 → 时间轴**：若已生成配音，用配音时长切分每句的 `display_start/display_end`
3. **脚本 → 决策**：逐句判断情绪、选贴纸（贴纸清单见 `src/lib/effectsCatalog.js`，素材在 `public/emojis/imgs/`）、定入场动画
4. **配音**：TTS 生成后放置到本地静态服务器（如 `python -m http.server 8899`）或任意可达 URL
5. **构造深链接**：`encodeURIComponent` 各参数后拼接，浏览器打开即全自动出片

## 路径

- 应用：`wechat/group`（群聊）、`wechat/single`（单聊）、`qq/chat`（QQ）
- 贴纸清单：`src/lib/effectsCatalog.js`（素材目录 `public/emojis/imgs/`）
- 深链接解析：`src/lib/deepLink.js`
- 自动导出逻辑：`src/components/ui/VideoPipelinePanel.jsx`（`injectedTimeline`/`injectedAudio` + `autoRun`）
