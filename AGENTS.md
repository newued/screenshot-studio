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

## 4.1 ASR 模型（受管依赖）
- faster-whisper 权重**已纳入受管依赖**（与 Python 包同级处理），不再写死在 `transcribe.js`：
  - 单一配置真相源：`mcp-server/asr-config.json`（`model/device/computeType/language`，默认 `small`；`hfEndpoint` 默认 `https://hf-mirror.com`，`disableXet` 默认 `true`）；`transcribe.js` / `registry.js` / `doctor.js` 均从此读。HF 官方不可达时自动走镜像，并禁用 xet/CAS 重建以规避 401。
  - 预下载与兜底：`mcp-server/tools/asrModel.js` 的 `ensureAsrModel()` 幂等下载（已缓存秒回），失败返回结构化原因、**不中断流程**。
  - 命令行：`agent-bridge setup-asr [model]` 显式预载；`agent-up` 启动阶段自动 best-effort 预载；`doctor` 展示权重缓存状态。
  - 离线兜底：模型不可达时 `alignDP` 退化为「VAD 语音分段 → 长度加权节拍网格」（音画近似同步），并明确提示用户需联网机器补齐。
- 用户确认页面信息后，前端不再需要：`agent-bridge down` 关闭 vite(5173)，`down --all` 同时关 mcp(9527)；后续交互由 agent 在对话里完成。

## 5. Agent 编排协议（agent 优先的对话式工作流）

> 本节约束「agent（本会话大模型）在视频生成时的对话式行为」。任何会话的 agent 都必须遵守，不可跳过询问门。

### 5.1 总流程
```
① ensure/up     agent 用 `node scripts/agent-bridge.mjs up`（推荐）一键起 mcp-server(:9527) + vite(:5173)；或分步 `ensure` 仅起 mcp
② 生成脚本      按主题写对话脚本（或用户给素材）
③ open 注入      node scripts/agent-bridge.mjs open wechat/single --script @脚本.txt
                 （群聊 wechat/group / QQ qq；浏览器开 ?agent=1&script=... 自动注入）
                 → agent 立即交还对话，不阻塞，等用户手动操作网页
④ ★ 显式询问（暂停等待用户）
  agent 通过 `AskUserQuestion` 工具向用户发起确认，调用参数：
    - question: 「对话和配音都确认好了吗？（建议在网页核对/微调对话、头像、名称、题目，并上传配音后再确认）」
    - options: ["已确认对话剧本并上传配音"]
    - allow_free_text: true
    - multi_select: false
  等待用户应答后恢复流程：
    ├─ 用户点击「已确认对话剧本并上传配音」 → 分支 A（见 5.2）
    └─ 用户在自由输入中提供了信息           → 分支 B（见 5.3），agent 根据用户输入判断如何处理
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
- ③ 之后 agent 不得自行续跑后端，必须先在 ④ 用 `AskUserQuestion` 暂停等待用户明确答复。
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
- `agent-bridge.mjs`：仅做生命周期 + CLI 分发（`up`(推荐)/`ensure`/`open`/`run`/`run-page`/`apply-fixes`/`tag-stickers`/`status`/`doctor`/`cancel`），编排一律委托 `planner.js`。`up` 为一键拉起 mcp+vite 的推荐入口。

### 6.4 Project Entity 约定
- 项目目录：`<root>/projects/<project_id>/artifacts/`；每步产物为不可变文件：`script.json`/`voiceover.json`/`effects.json`/`final.mp4`，路径登记回 `pipeline_state.json.artifacts[step]`。
- 创意决策写回（`applyCreative`）支持：`index/id` + `sticker`(须在表情库) + `effect`(须在枚举) + `display_start/end` + 可选 `emotion/semantic/reason/confidence`；校验失败直接抛错，无静默兜底。
- **多项目并发 / 整目录迁移**尚未做：浏览器轮询路径仍按单个 `pipeline_state.json`，后续做需把前端 `project_id` 参数化（独立一轮，勿在传输层偷塞）。

### 6.5 单一工作流契约 + MCP 守卫（防漂移 / 防绕过）
- **唯一工作流定义**：`src/lib/pipelineContract.js` 的 `STEP_ORDER` + `WORKFLOW_STEPS` 是步骤顺序/工具/依赖的唯一真相源。**禁止在 SKILL.md / AGENTS.md / planner 中再硬编码一份步骤列表**（此前 `planner.PRODUCTION_PLAN` 漏掉 `TIMELINE` 即此问题）。`planner.PRODUCTION_PLAN` 由 `buildProductionPlan()` 从契约派生。
- **TIMELINE 是派生步**：时间轴由 `VOICEOVER/alignDP` 的 mapping 产出，`planner` 在 alignDP 成功后标记 `timeline_status: SUCCEEDED`，不单独执行工具。
- **MCP 守卫（硬性防绕过）**：`mcp-server/registry.js` 的 `guardTool` 在每次 `dispatchTool` 前按 `pipeline_state.json` 校验前置步骤；越序调用（如未对齐就 `render`、未对齐就 `applyCreative`/`aiApplyFix`、未 `alignDP` 就 `aiReview`）会抛 `[GUARD:<CODE>]` 错误并拒绝执行。agent 收到错误后自我纠正。
- **原则**：规则从「请 Agent 遵守」逐步转为「Runtime 不允许违反」。SKILL.md 只告诉 Agent 怎么做/何时问用户；流程约束由 State + Guard 在运行时强制。

## 7. 踩坑经验与教训（本轮迭代沉淀）

> 以下为已修复的反复踩坑点，凡改动相关模块须先读本节，避免回归。

### 7.1 ASR 模型必须当作受管依赖，且要过镜像 + 禁 xet
- 现象：faster-whisper 权重不在 pip 内，需从 HF 下载。直连 HF 常 `ConnectTimeout`；改走镜像 `https://hf-mirror.com` 后仍可能撞 xet/CAS 重建 `401 Unauthorized`。
- 修复：配置集中在 `mcp-server/asr-config.json`（`model/device/computeType/language/hfEndpoint/disableXet`）；`asrModel.js:applyAsrEnv()` 在「下载 + 运行」两处统一注入 `HF_ENDPOINT` 与 `HF_HUB_DISABLE_XET`；`setup-asr` / `agent-up` 预载、`doctor` 自检。`transcribe.js` / `registry.js` 的模型名一律读配置，不再写死 `'small'`。
- 离线兜底：`alignDP` 先试 ASR → 失败走 `vad.js` 的 VAD 分段 → 再退化「长度加权节拍网格」；`agent-up`/`doctor` 明确提示「需联网机器补模型」。

### 7.2 语义决策（贴纸/动效）必须贯穿整条管线，不能被重新解析丢弃
- 现象：贴纸/动效在视频里「整批消失」或全是同一种。
- 根因：`planner.runProductionPlan` 曾对 messages 重新 `parseScript`，把传入的 `sticker/effect` 整体丢弃；`project.buildProject` 又强制 `effect:'random'`。
- 修复：决策经 `decisions.applyDecisionsToMessages` 合并进解析后消息；`buildProject` 仅在无决策时回退随机；`run` / `run-page` 均经 `--decisions` 传入（`run` 还新增 emotion→入场动效枚举的 `EFFECT_MAP`）。

### 7.3 前端不得用共享 state 伪造「完成」
- 现象：用户点「确认页面信息」后，前端立即显示「视频已生成」，实际是读到上一次 `pipeline_state.json.output` 的脏结果。
- 修复：`VideoPipelinePanel` 去除假成功提示，结果一律由 agent 在对话返回；前端仅负责上传 + 确认闸门。确认后由 agent 调 `agent-bridge down` 关闭 vite(5173)，`down --all` 同关 mcp(9527)。

### 7.4 音画同步的边界是环境限制，不是 bug
- 真·逐句同步依赖 ASR；本机对 HF 离线即退化长度加权。音乐类配音能量持续，能量 VAD 只能切出单段，无法按句分段。需联网装模型，或用 `apply-fixes` 手动时间轴精修（手感闸门 `needs_review` 是设计内的，agent 须读 AI_HANDOFF 产出 fixes 再 `apply-fixes`）。

### 7.5 贴纸尺寸要与消息长度解耦，且允许放大填满
- 现象①：部分贴纸特别小、且长短消息忽大忽小。根因：贴纸高度由「白卡下方空隙 `gapH`」决定，长消息白卡高→空隙小→贴纸被压小。
- 修复①（`canvasChat.js`）：有贴纸时把白卡压到上方、预留固定「贴纸带」（屏高 42%，最小高度 500px），贴纸尺寸以带为准，与消息长度无关。
- 现象②：某张 6KB 低分辨率贴纸（`怀疑人生.jpg`）显得极小。根因：`drawSticker` 曾 `scale = min(..., 1)` 禁止放大，小源图按原始像素绘制。
- 修复②：去掉 `,1` 上限，contain 放大填满贴纸带。注意：源图分辨率低会被放大发虚，应替换为高清同名图（`dist/emojis/imgs/` 或 `public/emojis/imgs/`）。
