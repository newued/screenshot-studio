# AI 协作出片：脚本与决策格式

> 早期版本提供过「深链接 `export=mp4` 零确认自动渲染」协议，**该模式已移除**。本工具坚持人机协同：深链接只负责**注入脚本/音频**，渲染必须由 agent 调 `run` / `run-page` 在用户确认后触发。本文档保留对 agent 仍有用的**脚本语法**与**决策 JSON 格式**（用于 `run --decisions`）。

## 当前推荐流程（agent 侧）

1. **主题 → 脚本**：把用户主题扩展成有冲突/情绪起伏的对话，含红包/转账/语音等丰富类型。
2. **打开网页注入**（可选，让用户自行核对）：`node scripts/agent-bridge.mjs open wechat/single --script @剧本.txt --audio <URL>`，或 `genlink ... --open` 拼深链。
3. **用户在网页**：核对对话/头像/名称 → 选配音 → 点「确认页面信息」（网页落盘 `audio_path` + `page_confirmed`）。
4. **agent 跑后端**：
   - 网页模式：`run-page`（读取已确认状态，串对齐+渲染）。
   - 手动模式：`run --audio <URL> --script @剧本.txt [--decisions @决策.json] --out out.mp4`。
5. 若触发 `needs_review`：`run` 打印 `AI_HANDOFF_JSON` 并退出码 2；agent 基于交接包产 fixes，调 `apply-fixes` 写回（自动续渲染）。

## 深链接参数（仅注入，不再支持 `export`）

`open` / `genlink` 拼出的深链接形如 `http://localhost:5173/wechat/single?agent=1&script=<ENC>&audio=<ENC>`：

| 参数 | 必填 | 说明 |
|---|---|---|
| `agent` | 是 | 固定 `1`：以 agent 模式打开，暴露「确认页面信息」按钮 |
| `script` | 否 | 聊天脚本文本（`encodeURIComponent`），语法见下方 |
| `audio` | 否 | 配音文件 URL，浏览器 fetch 后载入供用户预览 |

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

## 决策 JSON 格式（`run --decisions @文件`）

数组元素与脚本消息一一对应；`run` 内部会把 `sticker` 的 **kind** 自动映射为 `effectsCatalog.js` 里的 **file**（如 `angry→angry_01.png`）：

```json
[
  { "emotion": "neutral", "sticker": "", "effect": "fade_in" },
  { "emotion": "angry", "sticker": "angry", "effect": "pop_in" }
]
```

省略 `--decisions` 也能出片，但无语义贴纸（可改用 `tag-stickers` 规则兜底，或 `apply-fixes` 补）。

## 路径

- 应用：`wechat/group`（群聊）、`wechat/single`（单聊）、`qq/chat`（QQ）
- 贴纸清单：`src/lib/effectsCatalog.js`（素材目录 `public/emojis/imgs/`）
- 深链接解析：`src/lib/deepLink.js`
- 确认/导出 UI：`src/components/ui/VideoPipelinePanel.jsx`
