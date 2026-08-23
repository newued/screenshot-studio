项目现状总结
一、是什么
screenshot-studio（本技能即完整可运行项目）：把微信/QQ 单聊、群聊对话导出成图片（全图/切片）和视频的工具。技术栈：React 前端 + Node mcp-server（:9527，内嵌 Python librosa/faster-whisper）+ canvasChat 渲染。

二、三层架构（agent 优先）
层	角色	职责
网页	薄壳	编排对话、选配音、微调头像/名称/题目、看进度
MCP server	体力层	解析、节拍、转写、DP对齐、渲染、落盘真相源（12 个 MCP 工具 + submitPage 回调）
LLM（agent，如我）	创意层	生成脚本、说唱语义归位、贴纸/动效决策
三、单聊 & 群聊的导出功能
纯网页导出（不需要 agent）：整图导出、切片导出——聊天页默认显示按钮。

视频生成（agent 模式，?agent=1 门控）：单聊/群聊流程完全一致，区别只在成员数：

单聊：2人，气泡左右分边
群聊：多成员，标题栏显示人数，按 speaker 区分头像
视频面板仅在 ?agent=1 会话下暴露。

四、结合 agent 使用的步骤（核心）
前置：agent 起 mcp-server（:9527）+ vite（:5173）。

以单聊为例（群聊同理）：

agent 生成脚本 — 按主题写对话脚本
agent 打开并注入 — node scripts/agent-bridge.mjs open wechat/single --script @脚本.txt
→ 浏览器打开 ?agent=1&script=... 自动注入 → agent 立即交还对话，不阻塞
用户手动操作网页 — 核对/微调对话、头像、名称、题目；选配音风格→复制 prompt 去 Suno 生成 MP3→上传→点「确认页面信息」→ 弹 toast「信息已确认，请回到 AI 助手对话继续」+ 写 pipeline_state.json
用户回来说"信息已确认"
agent 续跑 — run-page 读最新提交 → alignDP（节拍+转写+对齐）→ 若需仲裁打印交接包 → agent 用 LLM 语义归位 → apply-fixes 写回 → render 出 MP4
交付 MP4
群聊特别点：MembersEditor 可加/删/换头像；其余步骤与单聊一致。