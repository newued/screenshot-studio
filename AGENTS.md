# 项目最高规则：视频生产管线

> 本文件为项目最高优先级约束，覆盖所有视频相关开发。任何实现都不得违背以下要求。

## 1. 适用范围
- **单聊、群聊、QQ 对话等所有聊天模式，都必须支持「导出 / 生成视频」**。
- 核心硬要求：**音画同步**（配音与画面气泡严格对齐，配音是口播或歌曲对话均须满足）。
- 核心亮点：**语义驱动的智能贴纸 / 动效 / 转场插入**——系统根据对话语义，在合适的时间轴节点自动插入贴纸、画面动效与转场特效。

## 2. 技术实现偏好
- **优先在浏览器端直接完成视频渲染**（WebCodecs / Canvas / 浏览器内 Remotion 等）。
- 若浏览器端在「音画同步」或「语义驱动特效插入」上存在不可克服的限制，可接受退而求其次：在 **Coze / Workflow 这类 AI Agent 工具上运行，于本地环境生产视频**——但**同样必须满足音画同步与语义化特效插入的要求**。

## 3. 生产流程：队列式人机协同工作流
整体采用**队列任务**形式执行，全程人机协同、**可中断、可编辑、可继续**。每一步都必须经用户确认才能进入下一步；用户在任意环节可中断、修改该步骤结果、再继续向后执行。流程如下：

1. **提示词输入 → 脚本生成**：系统根据提示词生成脚本，用户确认 / 编辑后进入下一步。
2. **配音提示词确认 + 配音生成 / 选择**：确认配音提示词，生成配音或从素材库选择，用户确认。
3. **时间轴确认 + 动效确认**：用户审阅并调整时间轴与动效。
4. **语义决策**：系统根据语义自动判断在哪些时间点插入贴纸 / 动效 / 转场，用户审阅、修改并确认。
5. **最终视频生成**：生成最终视频。

- 每一步均可暂停、修改、确认；整个生产过程可控、透明、可迭代。
- 音画同步为强制要求，**无论配音是口播还是歌曲对话**（歌曲可能不严格对应对话文本，需智能分析歌曲与文本 / 画面的关系）。

## 4. 实现校验（当前状态）
- 核心渲染 / 音画同步 / 语义插入已具备基础能力（浏览器 WebCodecs + MCP server 渲染双通道）。
- **队列式人机协同工作流已实现**：`src/lib/pipelineState.js` 状态机（PENDING→AWAIT_CONFIRM→CONFIRMED→DONE，5 步 SCRIPT→VOICEOVER→TIMELINE→SEMANTIC→RENDER）+ `VideoPipelinePanel` 分步确认门（可中断 / 编辑 / 继续）。
- 待补项：节拍网格优先 + 有序 DP 全局对齐、独立本地预览页、歌曲对话智能分析、音效库。

## 5. Agent 编排协议（agent 优先的对话式工作流）

> 本节约束「agent（本会话大模型）在视频生成时的对话式行为」。任何会话的 agent 都必须遵守，不可跳过询问门。

### 5.1 总流程
```
① ensure        agent 起 mcp-server(:9527) + vite(:5173)
② 生成脚本      按主题写对话脚本（或用户给素材）
③ open 注入      node scripts/agent-bridge.mjs open wechat/single --script @脚本.txt
                 （群聊 wechat/group / QQ qq；浏览器开 ?agent=1&script=... 自动注入）
                 → agent 立即交还对话，不阻塞，等用户手动操作网页
④ ★ 显式询问     agent 必须明确问用户：「对话和配音都确认好了吗？」
                 答案二选一：【已确认】 / 【手动输入项】
        ├─【已确认】  → 分支 A（见 5.2）
        └─【手动输入项】→ 分支 B（见 5.3）
```

### 5.2 分支 A：已确认
- 用户在网页核对/微调对话、头像、名称、题目，选配音，点「确认页面信息」（MCP server 落盘音频 + 写 `pipeline_state.json`：`page_confirmed:true` + `audio_path` + 最新 messages/members）。
- agent 调 `node scripts/agent-bridge.mjs run-page`：读 `pipeline_state.json` 拿最新脚本/头像/名称/配音 → alignDP →（needs_review 出 AI 交接包 → `apply-fixes`）→ render → 交付 MP4。
- **守卫**：`run-page` 会校验 `page_confirmed`；若网页其实没点确认，agent 必须提示「请先在网页点『确认页面信息』」，不得臆造音频路径，可退回分支 B。

### 5.3 分支 B：手动输入项
- 用户未在网页确认，而是直接在对话里贴内容。agent **灵活解析**用户贴出的内容，缺哪块补哪块，最终组装成 `run` 的入参走同一后端：
  `node scripts/agent-bridge.mjs run --audio <路径/URL> --script <脚本文本> [--platform wechat] [--mode single|group] [--out out.mp4]`
- 用户可能贴的内容（都可能有，按实际灵活处理）：
  - 仅脚本文本 + 音频路径/URL → 直接 `run`
  - 完整项目 JSON（messages/members/audio 等）→ 解析后组装入参
  - 部分片段（如只给头像/名称/曲风）→ 与已有脚本合并，缺省项用默认或追问
- 解析后若关键项（脚本、音频）仍缺失，agent 应一次性追问，不反复打断。

### 5.4 不变约束
- ③ 之后 agent 不得自行续跑后端，必须先在 ④ 拿到用户明确答复。
- 音画同步、语义驱动特效、可中断可继续等第 1~3 节要求，在分支 A/B 的后续步骤中同样强制满足。
- **配音来源硬约束（不可动摇）**：配音（口播 / 歌曲）一律由**用户人工提供**——网页选配音风格并上传音频，或用户用外部 TTS 产出 MP3 后给 URL/路径。本工具**不内置、不自动合成音频**；任何实现都不得自行调用 TTS / 语音合成去生成配音。需要配音时，agent 只负责产出「TTS 提示词」交给用户去外部服务生成，再回传音频路径/URL。此条不是待补项，不要为「自动配音」写代码。

## 6. 架构分层（实现者必读，防止回归）

> 任何新增/修改都必须落在这套分层里，不得把职责塞回 `agent-bridge.mjs` 或 `index.js` 的传输层。

### 6.1 单一状态契约（消除双状态词表）
- `src/lib/pipelineContract.js` 是**唯一状态词表真相源**：`STEP_ORDER`、`UI_STATUS`（PENDING/AWAIT_CONFIRM/CONFIRMED/DONE）、`PROJECT_STATUS`（RUNNING/WAITING_USER/WAITING_AGENT/SUCCEEDED/FAILED/STALE/CANCELLED）、`STEP_ARTIFACTS`。
- 浏览器 `src/lib/pipelineState.js` 与 agent 端均从它导入；**禁止在别处硬编码状态字符串**。
- 活真相源仍是根目录 `pipeline_state.json`（浏览器轮询 `/api/state` 入口，不得改路径以免断握手）；`submitPage` 落盘 `page_confirmed/audio_path/messages/members`。

### 6.2 单一 MCP 核心 API
- `mcp-server/registry.js` 是**唯一工具注册表**（`TOOLS` + `TOOL_DESCRIPTIONS` + `TOOL_SCHEMAS` + `dispatchTool` + `listToolSpecs`）。
- HTTP(`/api/tool/:name`)、WebSocket(`/ws`)、MCP-stdio 三种传输**都只经 `dispatchTool` 调用**，不得各自写分发。
- `mcp-server/index.js` 只做传输层接线，不含工具实现。

### 6.3 agent 端分层（`scripts/core/`）
- `client.js`：MCP HTTP 客户端（`callTool`/`health`）。
- `state.js`：真相源读写 + Project Entity 路径（`persistArtifact` → `projects/<id>/artifacts/<step>.json`）。
- `project.js`：项目组装（`buildProject`/`buildScriptText`）。
- `decisions.js`：LLM 创意决策合并 + 贴纸确定性兜底。
- `planner.js`：生产计划 `PRODUCTION_PLAN` + 执行器 `runProductionPlan`（每步 RUNNING，失败标 FAILED，可 `cancelProductionPlan` 标 CANCELLED）。
- `agent-bridge.mjs`：仅做生命周期 + CLI 分发（`run`/`run-page`/`apply-fixes`/`tag-stickers`/`status`/`cancel`），编排一律委托 `planner.js`。

### 6.4 Project Entity 约定
- 项目目录：`<root>/projects/<project_id>/artifacts/`；每步产物为不可变文件：`script.json`/`voiceover.json`/`effects.json`/`final.mp4`，路径登记回 `pipeline_state.json.artifacts[step]`。
- 创意决策写回（`applyCreative`）支持：`index/id` + `sticker`(须在表情库) + `effect`(须在枚举) + `display_start/end` + 可选 `emotion/semantic/reason/confidence`；校验失败直接抛错，无静默兜底。
- **多项目并发 / 整目录迁移**尚未做：浏览器轮询路径仍按单个 `pipeline_state.json`，后续做需把前端 `project_id` 参数化（独立一轮，勿在传输层偷塞）。
