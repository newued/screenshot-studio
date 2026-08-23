---
name: screenshot-studio
description: 把微信/QQ 单聊、群聊对话导出成图片（全图/切片）或生成带配音、音画同步、语义贴纸的视频。当用户要求"生成聊天视频""导出聊天截图""做微信对话视频""打开聊天导出页让用户自己导出""聊天记录转视频""截图工坊"时使用。触发词：聊天视频、对话视频、微信截图、聊天记录、导出切片、全图导出、音画同步、语义贴纸、screenshot-studio、聊天导出页。
---

# 截图工坊（screenshot-studio）技能

把一段对话（微信/QQ 单聊或群聊）变成两种产物：
1. **视频**：配音 + 音画同步 + 语义贴纸/动效/转场，浏览器直出 MP4。
2. **图片**：整图或按消息切片导出（用户自己在网页点按钮）。

## 0. 自包含说明（重要）
**本技能目录 = 完整可运行项目，不是只放指令。** 它内含网页 UI、能力后端、编排 CLI、静态资源与全部依赖清单。把本目录放到 OpenCode 技能目录（或任意位置由 agent 指向），跑一次 `node scripts/agent-up.mjs` 即可就绪并产出视频/图片。

> 底层三件套都在本目录内，无需外部仓库：
> - 网页 UI：`src/`（vite 开发服务器 `http://localhost:5173/`）
> - 能力后端：`mcp-server/`（HTTP `http://127.0.0.1:9527/api`，内含 ASR/对齐/渲染/导出，后端再调 Python 做节拍网格与转写）
> - 编排 CLI：`scripts/agent-bridge.mjs` + `scripts/agent-up.mjs`

## 1. 自包含目录结构
```
screenshot-studio/
├── SKILL.md              # 本文件（技能说明 + 工作流 + 排错）
├── AGENTS.md             # 项目硬约束（配音须用户人工提供，不内置 TTS）
├── package.json          # 前端依赖 + dev/build 脚本
├── package-lock.json
├── vite.config.js
├── index.html
├── requirements.txt      # Python 后端依赖（faster-whisper/librosa/soundfile/numpy）
├── src/                  # 网页 UI（React + vite）
├── public/               # 静态资源（贴纸图片 emojis 等，渲染必需）
├── mcp-server/           # 能力后端（Node MCP + 调 Python）
│   ├── index.js
│   ├── package.json
│   └── tools/            # alignDP / aiReview / aiApplyFix / render / beatGrid ...
├── scripts/              # 编排 CLI
│   ├── agent-bridge.mjs  # ensure/open/run/run-page/apply-fixes/genlink/status/tag-stickers
│   └── agent-up.mjs      # 一键拉起 + 依赖自检
└── docs/                 # ai-automation.md / PRD 等参考
```

## 2. 环境依赖（前置，必须）
- **Node ≥ 18** + `npm`（跑 vite / mcp-server / CLI）。
- **Python 3.10+** 且含：`librosa`、`soundfile`、`numpy`、`faster-whisper`（mcp-server 的 `alignDP` 做节拍网格与 ASR 用）。
- **ffmpeg**（视频渲染编码 + beatGrid 转 WAV；需在 PATH 中）。
- **用户自备配音音频**（URL 或本地路径）。工具**不内置 TTS**，见 §13 硬约束。

## 3. 一键 setup（首次 / 新机器）
```bash
cd <本技能目录>
node scripts/agent-up.mjs
```
`agent-up.mjs` 会依次：**检测 ffmpeg**（缺失给安装提示）→ **自动 `npm install`**（根目录 + `mcp-server/`，缺才装）→ **自动 `pip install`**（缺 Python 包才装）→ 后台拉起 vite(:5173) 与 mcp-server(:9527)，两端口都就绪才返回。

手动等价步骤（排查时用）：
```bash
npm install
cd mcp-server && npm install && cd ..
python -m pip install -r requirements.txt
# ffmpeg 需系统安装（见 §11 排错）
```

## 4. 标准 agent 工作流（两目标）

> **默认带确认闸门的工作流**
> 1. 先拉起后端：`node scripts/agent-up.mjs`（后台起 vite:5173 + mcp:9527，两端口都就绪才返回）。
> 2. 用 `open` / `genlink --open` 打开浏览器（命令自带 `start` 调起默认浏览器，**不要**把裸 URL 丢给用户手动开）。
> 3. 默认走 **路径 B（人机协同）**：用户点「确认页面信息」后，agent 才跑 `run-page` 出片。
> 4. **禁止**对"需用户确认"的场景用 `export=mp4` 深链自动出片——它会绕过「确认页面信息」闸门直接渲染。

### 目标一：快速生成视频
#### 路径 B —— 人机协同（默认，带确认闸门）
适合绝大多数"帮我生成视频"请求。配音由用户提供（工具不内置 TTS），用户在网页核对/选音频/点确认。
1. **拉起后端并注入打开**：
   ```bash
   node scripts/agent-up.mjs
   node scripts/agent-bridge.mjs open wechat/single --script @剧本.txt
   ```
   `open` 以 `?agent=1` 打开并注入脚本，且自动调起浏览器；agent **立即把对话交还用户**，不阻塞。
2. **用户在网页操作**：核对/微调对话、头像、名称、题目 → 选配音文件 → 点「确认页面信息」（写 `pipeline_state.json`：`page_confirmed:true` + `audio_path`）。
3. **agent 用问题工具向用户确认**（打开浏览器后**必须**这样做，不要只发一句话）：
   - 用 question 工具提问：「页面信息（对话 / 头像 / 配音）是否已确认好？」
   - 选项放「已经确认好」+ 开启自由输入框（custom）。
   - 用户**点击「已经确认好」** → 直接执行下一步 `run-page`。
   - 用户在输入框**输入了内容** → 按内容处理（如给出修改意见则先改脚本/决策再重开；若文字表示已确认则等同点击）。
   ```bash
   node scripts/agent-bridge.mjs run-page --out out.mp4
   ```
   读最新提交 → `alignDP`（ASR+DP 对齐）→ 若 `needs_review` 打印 `AI_HANDOFF_JSON` 并以退出码 2 退出。
4. **语义决策（贴纸/动效，不可跳过）**：`run-page` / `apply-fixes` **只修正时间轴，不会自动加贴纸**。必须给每条消息写入 `sticker`（库内文件名，见 `src/lib/effectsCatalog.js` 的 `STICKERS[].file`），否则视频无贴纸。
   - 规则兜底：`node scripts/agent-bridge.mjs tag-stickers`（情绪度≥0.4 才带贴纸）。**注意**：对「发疯吐槽 / 黑色幽默」类脚本常触发不了（脚本里没有它预设的"滚/闭嘴/我说了算"等触发词），此时必须用 LLM 决策。
   - LLM 决策（推荐用于演唱体 / 黑色幽默）：用 `src/lib/decisionPrompt.js` 的提示词产出 `decisions` 数组（emotion/sticker/effect），把 `sticker` 的 **kind** 映射为 `effectsCatalog.js` 里的 **file**（如 `angry→angry_01.png`、`shock→surprise_01.png`、`question→怀疑人生.jpg`、`speechless→动态小表情-无语了.gif`、`laugh→happy_01.png`、`awesome→懂了，优秀.gif`），写回 `pipeline_state.json` 的 `script_messages[i].sticker`，再渲染。
   - **一步出带贴纸视频（推荐）**：用 `run` 命令直接带 `--decisions @决策文件.json` 即可一步完成「对齐 + 贴纸 + 渲染」（`run` 内部会把 `sticker` 的 kind 自动映射为文件名，且 needs_review 时自动用 ASR 真实演唱时刻修正并渲染，不再退出等干预）：
     ```bash
      node scripts/agent-bridge.mjs run --audio <URL或路径> --script @剧本.txt --decisions @决策.json --out out.mp4
      ```
      > 不传 `--out` 时，视频/图片默认输出到用户本机 `~/Downloads/screenshot-studio/`（Windows 即 `C:\Users\<用户>\Downloads\screenshot-studio\`），**不写入技能目录**，避免污染技能包。
     决策文件格式（`src/lib/decisionPrompt.js`）：`[{ "emotion":"angry", "sticker":"angry", "effect":"shake" }, ...]`（与消息一一对应，sticker 用 kind）。
5. **若 `run-page` 触发 `needs_review`**：用 `apply-fixes` 修时间轴。关键：**演唱/说唱类音频，修正包时间必须基于 ASR 真实演唱时刻**（`pipeline_state.json` 的 `align_result.asr_segments` 每条带 `start/end`），**不要按节拍网格均匀均分**——均分会让气泡与歌声对不上（音画不同步）。`apply-fixes` 会把时间**吸附到最近拍点**，所以修正包时间须落在拍点范围内（工具现已修复时长：beatGrid 先用 ffmpeg 转 WAV 再分析，`duration` 取真实音频长，不再被 MP3 头截断）。
   ```bash
   node scripts/agent-bridge.mjs apply-fixes --fixes <JSON或@文件>
   ```
   `apply-fixes` 写回修正后会**自动渲染**；贴纸来自步骤 4 写回的 `script_messages`。
6. 交付 MP4。

#### 路径 A —— 零确认全自动（仅限用户明确要求"全自动/零操作"且已给音频 URL）
> ⚠ 该模式用 `export=mp4` 深链，**会绕过「确认页面信息」闸门直接渲染**，仅当用户主动要求零确认时使用。
1. **主题 → 脚本**：按 `docs/ai-automation.md` 语法写对话（含红包/转账/语音等类型更生动）。
2. **生成配音**：Suno/妙响 产出 MP3，放到本地静态服务（如 `python -m http.server 8899`），得到 `audio` URL。
3. **LLM 决策**：用模型产出
   - `decisions`：每句 `{emotion, sticker, effect}`（贴纸清单见 `src/lib/effectsCatalog.js`）
   - `timeline`：每句 `{display_start, display_end}`（按配音时长切分，做精确音画同步）
4. **拼深链并打开**（用 `genlink` 自动 encode，且 `--open` 直接开浏览器）：
   ```bash
   node scripts/agent-bridge.mjs genlink wechat/single --script @剧本.txt --audio <URL> --decisions @d.json --timeline @t.json --export mp4 --open
   ```
   浏览器自动注入 → 等音频就绪 → 渲染 MP4 并下载。
   > 省略 `decisions`/`timeline` 时浏览器用内置规则兜底，仍可出片（粗略同步）。

> 群聊把路径里的 `wechat/single` 换成 `wechat/group`（成员在网页 MembersEditor 增删）。

### 目标二：打开网页让用户自己导出全图/切片
图片导出（整图/切片）是网页**默认按钮**，不需要 `?agent=1`。
- 直接打开：`http://localhost:5173/wechat/single`（或 `/wechat/group`、`/qq/chat`）
- 注入脚本再开：`http://localhost:5173/wechat/single?script=<ENC>`（或用 `genlink wechat/single --script @剧本.txt` 生成）
- 用户自行点「整图导出 / 切片导出」。
- agent 也可代开（只注入、不自动出片）：
  ```bash
  node scripts/agent-bridge.mjs open wechat/single --script @剧本.txt
  ```

---

## 5. CLI 速查（scripts/agent-bridge.mjs）
| 命令 | 作用 |
|---|---|
| `ensure` | 确保 mcp-server 在跑（不在则后台拉起） |
| `open [page] [--script S] [--audio U] [--export video]` | 开网页并注入（不带 `--export` 即只注入）；自动调起浏览器 |
| `genlink [page] [--script S] [--audio U] [--decisions J] [--timeline J] [--export mp4\|video\|full\|slices] [--open]` | 拼装深链 URL（自动 encode）；`--export mp4/video` = 零确认自动出片(含 ?agent=1，绕过确认闸门，仅限用户明确要求时)；`--open` 直接开浏览器 |
| `run --audio A --script S [--decisions D] [--platform wechat] [--mode single\|group] [--out O] [--skip-render]` | 脚本+音频直接跑对齐/渲染；`--decisions @文件` 一步带上语义贴纸/动效并自动出片（needs_review 时自动用 ASR 真实时刻修正，不再退出等干预） |
| `run-page [--out O]` | 读网页已确认状态跑后端 |
| `apply-fixes --fixes JSON` | 写回 LLM 语义修正 |
| `tag-stickers` | 情绪打分 → 贴纸标注写回 |
| `status` | 查看 `pipeline_state.json` 真相源 |

## 6. MCP 工具（:9527，OpenCode/Codex 可直接 tool-call）
`parseScript` / `alignDP` / `aiReview` / `aiApplyFix` / `render` / `transcribe` / `beatGrid` / `export` / `creative`
> 优先用上面封装好的 CLI；需要细粒度控制（如单独取 ASR 段落）再直接调 MCP。

## 7. 内容生成提示词（可选，给 LLM 写剧本 / 配音用）
> 以下模板让 agent 产出的剧本与配音提示词直接符合本工具格式（脚本用 `A说：内容` 文本，配音用 Suno `[Verse]` 格式）。

### 对话脚本生成提示词（优化版）
你是短视频剧本编剧。生成一段微信聊天对话短视频脚本，风格：黑色职场幽默 + 发疯吐槽。
【角色】主角=互联网小厂开发(A)，敢于炸毛/阴阳/当面怼/逼急发疯；配角=老板/产品/同事(B/C)。主角严禁唯唯诺诺、只说"好的收到"、被动承受。
【硬性约束】
1. 微信对话形式，纯文字，禁止语音消息。
2. 每条消息 ≤30 字（含标点）。
3. 只输出消息本身（带说话人），禁止情绪值/内心OS/动作描写/@/表情包。
4. 有故事跌宕：画饼→反转→炸毛→摆烂式同意→金句。
5. 最后一条必须是主角(A)发出，≤30 字，自嘲式黑色幽默金句。
【输出格式】每行 `说话人字母说：内容`（说话人用 A/B/C 单字母；群聊可到 C/D）：
A说：……
B说：……
生成后可直接 `node scripts/agent-bridge.mjs genlink wechat/single --script @剧本.txt --export mp4 --open`。

### 福音放克斯配音提示词（优化版，Suno 可用）
曲风 Prompt（首行，已补 Mandarin Chinese 发音约束，避免 Suno 唱成英文）：
Gospel-infused funk, dual powerful black male lead vocals, raspy soulful vocal texture, Mandarin Chinese vocal pronunciation with clear conversational Chinese diction, intricate melismatic riffs and gospel ad-libs, conversational call and response delivery, lush gospel choir backing harmonies, tight slap bassline, chicken scratch rhythm guitar, punchy brass section, play full dialogue ONLY ONCE, never loop or repeat content, The prelude should not exceed 3 seconds

[Verse]
[A] <A台词>
[B] <B台词>
...
[Outro][End]
> 全部对话原文一字不改；每个发言人 `[X]` 分行；文案结束追加 `[Outro][End]` 杜绝重复播放。网页「复制配音提示词」按钮即按此格式输出（见 src/lib/voicePrompt.js）。

---

## 8. 已知坑与已修复（给别人用时也请先读）
本技能在实测中踩过以下坑，均已修复或固化进流程，列在此处避免复发：

1. **视频被截断 + 音画不同步（最严重）**
   - 现象：生成的 MP4 只有前 ~22s，后段消息丢失，且气泡与歌声对不上。
   - 根因：`beatGrid` 用 `librosa.load` 直接读 MP3，而该 MP3 是 VBR，**文件头声明时长错误**（22.766s），soundfile 按头加载只载入了前半段；`duration` 与 `beat_grid` 都只到 22.766s，导致视频被截断、气泡按错误时长均分。
   - 已修复：`mcp-server/tools/beatGrid.js` 改为**先用 ffmpeg 把音频转成 WAV 再 `librosa.load`**（ffmpeg 读真实流时长），`duration` 现在取完整音频长（≈38.9s）。已验证 `duration` 从 22.766 → 39.76。
   - **开发注意**：改完 `mcp-server/` 下任何代码后，必须重启 mcp-server（`node scripts/agent-up.mjs` 重拉）才能生效——Node 会缓存已加载模块，旧进程仍跑旧代码（本次定位时就踩过：单元测试已修好，但跑中的旧 mcp 仍返回 22.766）。普通使用者无需关心，代码已是修复态。

2. **演唱/说唱类音频：时间轴不要"均匀均分"**
   - 现象：把 N 条消息按节拍网格均匀排开，结果气泡与歌声错位（音画不同步）。
   - 根因：歌声不是等间隔的，均分 ≠ 真实演唱时刻。
   - 正确做法：`alignDP` 默认用 faster-whisper 做 ASR，`asr_segments` 带**逐句真实演唱时刻**（0–37.7s），`mapping` 已据此对齐。需要 `apply-fixes` 时，**修正包时间必须基于 `asr_segments` 的真实 `start/end`**，不要均分。
   - 注意：`apply-fixes` 会把时间**吸附到最近拍点**，所以修正包时间须落在拍点范围内（时长已修复后拍点覆盖全曲，此问题基本消除）。

3. **视频没有贴纸**
   - 现象：渲染出来完全没有语义贴纸/动效。
   - 根因：① 语义决策步骤被跳过；② `tag-stickers` 规则打分（阈值 0.4）对「发疯吐槽/黑色幽默」类脚本**触发不了**（脚本里没有它预设的"滚/闭嘴/我说了算"等触发词）。
   - 已固化：见 §4 路径 B 步骤 4——**语义决策不可跳过**，黑色幽默类必须用 LLM 决策把 `sticker` 的 kind 映射成 `effectsCatalog.js` 里的 file 写回 `script_messages`。最省事的是直接用 `run --decisions @文件` 一步出带贴纸视频。

4. **`run --script @文件` 把文件路径当成了脚本内容**
   - 现象：`run` 读到的脚本只有 1 行且内容是文件路径。
   - 根因：`cmdRun` 用 `args['--script']` 直接取值，未走 `readArgVal`（后者支持 `@文件` 读取）。
   - 已修复：`cmdRun` 改为 `readArgVal(args['--script'] || '')`，现在 `--script @文件` 正确读取文件内容。

5. **`needs_review` 退出码 2 卡住，无法自动出片**
   - 现象：演唱体音频 ASR 漂移触发 `needs_review`，`run-page` 退出码 2 打印交接包后停下，等人工干预。
   - 已修复：新增 `--decisions` 参数。带 `--decisions` 时，`run` 在 `needs_review` 分支**自动用 ASR 真实演唱时刻生成修正并直接渲染**，不再退出等干预（见 §4 步骤 4 一步出片）。不带 `--decisions` 时维持原 exit 2 交 agent 干预。

6. **`agent-up` 启动后端失败：ENOENT / EINVAL**
   - 现象：`spawn npm ENOENT`（Windows 上 npm 实为 `npm.cmd`）；改成 `npm.cmd` 后又 `spawn EINVAL`（`.cmd` 不能直接 detached）。
   - 已修复：`agent-up.mjs` 在 Windows 用 `npm.cmd` 且加 `shell:true` 让 cmd.exe 包裹；mcp-server 用 `node` 直接 detached。现在 `node scripts/agent-up.mjs` 可一键拉起。

7. **深链双重编码 / 页面参数 off-by-one**
   - 现象：深链里 `script` 参数变成 `%25...`（双重编码）导致前端解码出乱码；`wechat/group` 被静默降级成 `wechat/single`。
   - 根因：`URLSearchParams.set` 已自动 encode，原代码又手动 `encodeURIComponent`；`main()` 用 `parseArgs(argv.slice(1))` 去掉命令名，页面应是 `args._[0]` 而非 `args._[1]`。
   - 已修复：`open`/`genlink` 改为传原始值；页面参数取 `args._[0]`。

8. **端口 5173 / 9527 被占用**
   - 现象：后端起不来或网页打不开。
   - 预案：`agent-up.mjs` 会分别探测两端口健康，未起会精确报哪个没起。先关掉占用端口的进程再跑；或确认没有上一次没退出的 vite/mcp 残留。

9. **ffmpeg 缺失**
   - 现象：渲染报错或 beatGrid 失败。
   - 预案：`agent-up.mjs` 启动时会检测 ffmpeg，缺失会打印按系统的安装命令（Windows `winget install ffmpeg` / macOS `brew install ffmpeg` / Linux `sudo apt install ffmpeg`）。仅图片导出可跳过，生成视频必须。

10. **Python 依赖缺失**
    - 现象：mcp-server 的 `alignDP` 报 ImportError。
    - 预案：`agent-up.mjs` 启动时会检测 `librosa/soundfile/numpy/faster_whisper`，缺失自动 `pip install`。也可手动 `python -m pip install -r requirements.txt`。

11. **Node 依赖缺失（node_modules 不存在）**
    - 现象：vite 或 mcp-server 起不来。
    - 预案：`agent-up.mjs` 启动时会检测根目录与 `mcp-server/` 的 `node_modules`，缺失自动 `npm install`。也可手动按 §3 执行。

12. **用户未提供音频就要求出视频**
    - 现象：渲染无声音或报错。
    - 预案：本工具**不内置 TTS**（见 §13）。agent 只产出「配音提示词」交用户去 Suno/妙响生成 MP3，再回传音频 URL/路径。缺少音频时先向用户要，不要臆造。

---

## 9. 新机器部署 + 排错树（小白用户必读）
把本技能目录丢到一台**只装了 OpenCode + Node + Python** 的机器上，按下面排查即可跑通：

| 现象 | 可能原因 | 解决 |
|---|---|---|
| `node scripts/agent-up.mjs` 报 `npm install` 失败/很慢 | 网络/镜像问题 | 配置 npm 镜像（`npm config set registry https://registry.npmmirror.com`）后重跑；或手动 `npm install` + `cd mcp-server && npm install` |
| 启动报 Python `ImportError: No module named librosa` | 缺 Python 包 | 自动安装失败时可手动 `python -m pip install -r requirements.txt`；注意用对的 python（虚拟环境要激活） |
| 启动报 `ffmpeg: command not found` 或渲染失败 | 没装 ffmpeg | 按系统装：Win `winget install ffmpeg` / Mac `brew install ffmpeg` / Linux `sudo apt install ffmpeg`；装完重跑 agent-up |
| 网页打不开 `localhost:5173` | vite 没起 / 端口被占 | 看 agent-up 输出哪个端口没起；关掉占用进程重跑 |
| 视频只有前半段 / 气泡对不上歌声 | MP3 头时长错误（旧代码） | 已修复（beatGrid 先转 WAV）。若仍出现，确认 `mcp-server/` 代码是最新版并**重启 agent-up** |
| 视频完全没有贴纸 | 语义决策被跳过 | 用 `run --decisions @决策.json` 一步出带贴纸视频；或手动把 `sticker` 写回 `script_messages` |
| `run-page` 退出码 2 打印 AI_HANDOFF_JSON 后停下 | 演唱体 ASR 漂移触发 needs_review | 带 `--decisions` 重跑 `run` 即可自动过；或按交接包产 fixes 再 `apply-fixes` |
| 渲染出来没声音 | 没给音频 / 音频路径错 | 确认 `--audio` 指向有效 MP3；用户须自备音频（不内置 TTS） |
| 改了 `mcp-server/` 代码不生效 | Node 缓存旧模块 | 重启 `agent-up.mjs` 重拉后端 |
| 深链打开后脚本是乱码 | 双重编码（旧代码） | 已修复；用 `genlink` 生成链接，不要手拼 |

**最小可跑通路径（验证技能本身没问题）**：
1. 装好 Node / Python / ffmpeg。
2. `node scripts/agent-up.mjs` → 看到「全部就绪」。
3. 准备一份 `剧本.txt`（`A说：…` 格式）和一个用户自备的 `音频.mp3`。
4. `node scripts/agent-bridge.mjs run --audio 音频.mp3 --script @剧本.txt --decisions @决策.json --out out.mp4` → 得到 `out.mp4`。

---

## 10. 临时文件规范（保持技能目录纯净）
- 生成视频过程中产生的**一切临时文件**（剧本、决策 JSON、修正包 fixes、音频等）**一律写入系统临时目录**（如 `C:\Users\<user>\AppData\Local\Temp\opencode\`），**禁止写入技能目录或项目根目录**。
- `genlink` / `open` / `run` 需要的 `--script @文件` 也指向临时目录里的文件；渲染完成后可清理。

## 11. 注册到各 Agent 系统（让"简单方便"成立）
- **OpenCode**：把本目录放到 `~/.config/opencode/skills/screenshot-studio/`（本技能已在此），重启即自动加载，agent 看到描述即触发。也可放项目内 `.opencode/skills/`。
- **Codex**：将**整个技能目录**作为指令+代码包导入（AGENTS 文件或 skills 目录）；agent 通过 `node scripts/agent-bridge.mjs` 跑 shell 调用。
- **WorkBuddy**：作为「自定义技能/指令」导入**整个技能目录**；后端统一用 CLI 调用。

## 12. 注意（Windows 环境）
- 自动开浏览器已用 `start ""` 处理；若失败会打印 URL 让你手动访问。
- 本地静态音频服务注意端口可达（防火墙）。
- 深链所有参数必须 `encodeURIComponent`（已用 `URLSearchParams` 自动处理，勿手拼）。
- `run`/`run-page` 遇 `needs_review` 退出码为 2，属正常「等 LLM 干预」信号，不是失败（带 `--decisions` 可避免）。

---

## 13. AGENTS.md 硬约束（配音人工提供）
- 配音（口播 / 歌曲）一律由**用户人工提供**——网页选配音风格并上传音频，或用户用外部 TTS 产出 MP3 后给 URL/路径。
- 本工具**不内置、不自动合成音频**；任何实现都不得自行调用 TTS / 语音合成去生成配音。
- 需要配音时，agent 只负责产出「TTS 提示词」（见 §7 福音放克斯配音提示词）交给用户去外部服务生成，再回传音频路径/URL。此条不是待补项，不要为「自动配音」写代码。
