# 截图工坊（screenshot-studio）

> 把微信/QQ 聊天记录变成**视频**（配音 + 音画同步 + 语义贴纸/动效）或**图片**（整图/切片导出）的自包含工具。全部逻辑在一个目录内，克隆即用。

## ✨ 特性

- **视频生成**：剧本 + 配音 → 自动对齐 → 生成 MP4（语义贴纸、动效、转场）
- **图片导出**：网页一键导出整图或按消息切片（PNG）
- **音画同步**：faster-whisper ASR + 节拍网格 + DP 全局对齐；演唱/说唱也能对齐（离线时退化为长度加权近似同步）
- **语义贴纸**：规则兜底 + LLM 语义决策，自动为每句匹配贴纸/动效
- **人机协作 / 纯 CLI 双模式**：既可用网页核对+确认，也可完全无浏览器用 CLI 出片
- **完全本地、零密钥**：不调用任何外部 API，不需要 API Key

## 📋 环境要求（Requirements）

| 依赖 | 版本 | 用途 | 是否自动安装 |
|------|------|------|------|
| Node.js | ≥ 18 | 跑 vite / mcp-server / CLI | 需自备 |
| npm | 随 Node | 安装前端 + 后端依赖 | 需自备 |
| Python | 3.8+（建议 3.10+） | ASR 转写 / 节拍网格（librosa, soundfile, numpy, faster-whisper） | `agent-up` 自动 `pip install` |
| ffmpeg | 最新 | 视频编码 + 音频提取（**视频生成必需**） | `agent-up` 尝试 winget/brew/apt；缺失时会提示手动安装 |
| 网络 | 首次运行 | 下载 npm / pip 包、以及 ASR 模型权重（~240MB） | — |
| 配音音频 | — | 用户自备 MP3（**不内置 TTS**，见硬约束） | — |

> 静态资源（贴纸 `public/emojis/` 175 张、头像 `public/avatars/` 422 张）已随仓库提交，克隆即有，无需额外下载。
> 渲染使用 Node 原生 canvas（`@napi-rs/canvas`，随 `npm install` 拉取预编译二进制），**不需要浏览器即可出片**；浏览器仅用于可选的「上传配音 + 确认」网页闸门。

## 🚀 快速开始

### 方式 A：一键启动（推荐，含自检）
```bash
cd screenshot-studio
node scripts/agent-up.mjs
```
`agent-up` 会依次：配置 npm 镜像 → `npm install`（根目录 + `mcp-server/`）→ 配置 pip 清华源并 `pip install` Python 依赖 → 尽量自动安装 ffmpeg → **预下载 ASR 模型权重**（经 `https://hf-mirror.com` 镜像，禁 xet）→ 后台拉起 vite(:5173) 与 mcp-server(:9527)。两端口就绪即返回。

看到「全部就绪」即可使用。此后日常起后端只需 `node scripts/agent-bridge.mjs up`。

### 方式 B：纯 CLI 出片（无需浏览器 / 无需开网页）
适合服务器、CI、或不想走网页确认闸门的用户：
```bash
# 剧本：A说：... / B说：... 每行一句；配音自备 MP3
node scripts/agent-bridge.mjs run \
  --audio "配音.mp3" \
  --script "@剧本.txt" \
  --decisions "@决策.json" \   # 可选：语义贴纸/动效决策；省略则走规则兜底
  --out out.mp4
```
- `--decisions` 是可选 JSON（`[{emotion, sticker, effect}, ...]` 与 messages 一一对应）；不给也能出片，只是贴纸/动效用规则兜底。
- 想先手动预载模型（避免首次出片才下载）：`node scripts/agent-bridge.mjs setup-asr`，或 `setup-asr base` 换更小模型。

### 人机协同模式（网页核对）
```bash
node scripts/agent-bridge.mjs open wechat/single --script @剧本.txt
# 浏览器自动打开 → 核对对话/头像/名称 → 上传配音 MP3 → 点「确认页面信息」
node scripts/agent-bridge.mjs run-page --out out.mp4   # 读网页确认状态出片
```
确认后无需保留前端，可 `node scripts/agent-bridge.mjs down` 关掉 vite，`down --all` 同关 mcp。

输出视频默认在 `~/Downloads/screenshot-studio/`（或在 `--out` 指定路径）。

## 🛠 CLI 速查

| 命令 | 说明 |
|------|------|
| `up` / `ensure` | 一键拉起 / 确保后端运行（推荐日常入口；**`up` 每次先杀残留旧进程再拉起最新代码**，跨会话重开无需手动 `down --all`） |
| `open [page] [--script] [--audio]` | 打开网页并注入脚本/音频 |
| `genlink [page] [--script] [--audio] [--open]` | 生成深链 URL |
| `run --audio --script [--decisions] [--out]` | **纯 CLI 直接出片**（无需浏览器） |
| `run-page [--out] [--decisions]` | 读取网页确认状态出片 |
| `apply-fixes --fixes` | 写回语义/时间轴修正（ASR 低置信句用此精修） |
| `setup-asr [model]` | 预下载 ASR 模型权重（受管依赖） |
| `tag-stickers` | 情绪打分 → 贴纸标注 |
| `status` / `doctor` | 查看状态 / 环境自检（含 ASR 模型缓存状态） |
| `down [--all]` | 关闭前端(vite)；`--all` 同关 mcp |
| `reset [--all]` | 清空工作流状态(`pipeline_state.json`)；`--all` 额外清空项目 artifact 历史（ASR 模型缓存保留） |

## ⚠️ 已知卡点 / 排错（开源部署必读）

1. **ffmpeg 缺失是最常见的阻断项**：它不在 npm/pip 内，`agent-up` 仅在系统有 winget/brew/apt 时尝试自动装；极简容器或无包管理器的机器需**手动安装**并加入 PATH，否则视频生成不可用（图片导出不受影响）。`doctor` 会在缺失时明确提示。
2. **首次运行要联网且较慢**：npm + pip + ASR 模型权重三段下载叠加，首次可能数分钟。ASR 模型默认 `small`（~240MB），可改 `mcp-server/asr-config.json` 的 `model` 或用 `setup-asr tiny` 减小。
3. **离线也能出片，但同步是近似的**：无网络/模型下载失败时，`alignDP` 退化为「VAD 语音分段 → 长度加权节拍网格」，气泡按文本长度分配时间（音画近似同步）。需要逐句严格同步请在有网机器跑 `setup-asr`。
4. **音乐类配音**：能量持续，能量 VAD 只能切出单段，无法按句分段；逐句对齐依赖 ASR 模型，必要时用 `apply-fixes` 手动精修时间轴。
5. **原生 canvas 二进制**：`@napi-rs/canvas` 提供主流平台预编译；冷门架构可能需本地 C++ 工具链编译。
6. **配音必须用户自备**：按设计不内置 TTS，工具只负责把你的 MP3 与画面对齐。

## 📁 目录结构
```
screenshot-studio/
├── SKILL.md              # 技能完整文档（agent 行为 + 工作流 + 踩坑经验）
├── AGENTS.md             # 项目硬约束（配音人工提供，不内置 TTS）
├── README.md             # 本文件
├── requirements.txt      # Python 后端依赖
├── src/                  # React + Vite 前端
├── public/               # 静态资源（贴纸/表情包/头像，已随仓库提交）
├── mcp-server/           # Node MCP + Python 调用后端
│   ├── asr-config.json   # ASR 模型受管依赖配置（model/镜像/禁xet）
│   └── tools/            # alignDP / aiReview / aiApplyFix / render / beatGrid / vad / asrModel ...
├── scripts/              # 编排 CLI（agent-bridge / agent-up）
└── docs/                 # 参考文档
```

## ⚙️ ASR 模型（受管依赖）
模型权重不在 pip 内，由 `mcp-server/asr-config.json` 统一管理（`model/device/computeType/language/hfEndpoint/disableXet`）。`agent-up` 与 `setup-asr` 负责预下载，运行时由 `asrModel.js` 注入镜像与禁 xet 环境变量。下载失败不中断流程，自动走兜底。

## 📄 许可证
MIT License

## 🤝 贡献
欢迎 PR / Issue。核心逻辑在 `mcp-server/tools/` 与 `src/lib/`。
