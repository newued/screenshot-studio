# 截图工坊

> 把微信/QQ 聊天记录变成**视频**（配音+音画同步+语义贴纸/动效）或**图片**（整图/切片导出）的自包含工具。

## ✨ 特性

- **视频生成**：输入剧本 + 配音 → 自动对齐 → 生成 MP4（含语义贴纸、动效、转场）
- **图片导出**：网页一键导出整图或按消息切片（PNG）
- **音画同步**：基于 faster-whisper ASR + 节拍网格 + DP 全局对齐，演唱/说唱也能精准同步
- **语义贴纸**：规则兜底 + LLM 语义决策，自动为每句匹配贴纸/动效
- **人机协作**：网页核对脚本/头像/配音 → 确认 → 后端渲染，全程可控
- **零外部依赖**：前端+后端+CLI 全在一个目录，`node scripts/agent-up.mjs` 一键就绪

## 🚀 快速开始

### 环境要求
- Node.js ≥ 18
- Python 3.10+（含 `librosa`, `soundfile`, `numpy`, `faster-whisper`）
- ffmpeg（视频渲染必需）

### 一键安装与启动
```bash
cd screenshot-studio
node scripts/agent-up.mjs
```
脚本会自动：
1. 检测并安装 ffmpeg（Windows 用 winget）
2. `npm install` 前端与 mcp-server 依赖（自动配置淘宝镜像源）
3. `pip install` Python 依赖（自动配置清华源）
4. 后台拉起 Vite (5173) + mcp-server (9527)

看到「全部就绪」即可使用。

## 📖 使用流程（人机协同模式）

```bash
# 1. 准备剧本（A说：... 格式）
# 2. 打开网页并注入剧本
node scripts/agent-bridge.mjs open wechat/single --script @剧本.txt

# 3. 浏览器自动打开：核对对话/头像/名称 → 上传配音 MP3 → 点「确认页面信息」

# 4. 用户确认后，生成视频
node scripts/agent-bridge.mjs run-page --out out.mp4
```

输出视频默认在 `~/Downloads/screenshot-studio/`。

### 图片导出
直接打开 `http://localhost:5173/wechat/single`，注入脚本后点「整图导出」或「切片导出」。

## 🛠 CLI 命令

| 命令 | 说明 |
|------|------|
| `ensure` | 确保 mcp-server 运行 |
| `open [page] [--script] [--audio]` | 打开网页并注入脚本/音频 |
| `genlink [page] [--script] [--audio] [--open]` | 生成深链 URL |
| `run --audio --script [--out]` | 直接跑对齐/渲染（需音频） |
| `run-page [--out]` | 读取网页确认状态跑后端 |
| `apply-fixes --fixes` | 写回语义修正 |
| `tag-stickers` | 情绪打分→贴纸标注 |
| `status` | 查看 pipeline 状态 |

## 📁 目录结构
```
screenshot-studio/
├── SKILL.md              # 技能完整文档
├── AGENTS.md             # 硬约束（配音人工提供，不内置 TTS）
├── package.json          # 前端依赖
├── requirements.txt      # Python 依赖
├── src/                  # React + Vite 前端
├── public/               # 静态资源（贴纸/表情包）
├── mcp-server/           # Node MCP + Python 调用后端
│   ├── index.js
│   ├── package.json
│   └── tools/            # alignDP / beatGrid / transcribe / render ...
├── scripts/              # 编排 CLI
│   ├── agent-up.mjs      # 一键环境检查+启动
│   └── agent-bridge.mjs  # 命令入口
└── docs/                 # 参考文档
```

## ⚠️ 硬约束（必读）
- **配音必须用户人工提供**（上传 MP3 或给 URL），工具不内置 TTS，不自动合成音频
- 视频生成需要 ffmpeg，仅图片导出可无 ffmpeg
- Python 依赖安装失败时请手动执行：`python -m pip install -r requirements.txt`

## 📄 许可证
MIT License

## 🤝 贡献
欢迎 PR / Issue。核心逻辑在 `mcp-server/tools/` 与 `src/lib/`。