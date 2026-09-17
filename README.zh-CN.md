# OpenGrokBot

<img src="./docs/icon.svg" alt="OpenGrokBot" width="128" />

[English](README.md) · [中文](README.zh-CN.md)

**能把活干完的 AI 同事，跑在你自己电脑上。**

给 Bot 派活，就像给同事发消息。先设一个岗位，用着顺手就留下；活变多了，再加一个。它们记得你怎么干活，会互相交接，真要你拍板才回来找你。

OpenGrokBot 是开源的 **[Grok Bot](https://x.ai/bot) 平替**。产品形态一样，干活的方式一样，电脑换成你自己的。

<img src="./docs/screenshot.png" alt="本机跑着的 OpenGrokBot：左边 Bot 花名册，中间是和 Chief 的对话" width="720" />

> 社区做的学习项目，不是官方产品。跟 xAI、Grok、Cursor 不是一家。详见[免责声明](#免责声明)。

## 如何使用

模型你自己带。OpenGrokBot 不内置模型。可以接本机 **Ollama**（`/v1`），也可以接任何 **OpenAI 兼容接口**（DeepSeek、OpenRouter，以及同类 endpoint）。

1. 安装 Node 20+ 和 [pnpm](https://pnpm.io)。
2. 克隆，安装，启动：

```bash
git clone https://github.com/nickylin/OpenGrokBot.git
cd OpenGrokBot
pnpm install
pnpm start
```

3. 打开 [http://127.0.0.1:3088](http://127.0.0.1:3088)。
4. Settings → Harness：选执行器（OpenAI 兼容接口、Ollama、Codex CLI、Cursor Agent、DeepSeek Harness）。本机 CLI 没装的话，复制安装命令自己装。HTTP 引擎再到 Settings → Models 填 Base URL、API key、model。**Ollama：** Base URL 写成 `http://127.0.0.1:11434/v1` 这种。服务端不校验 key 的话，随便填一个占位即可。
5. 先点 Test connection。
6. 左边花名册点一个 Bot，发一条消息。

密钥只存在这台机器的 `~/.opengrokbot/settings.json`。别提交进 git，也别写进 Bot 描述或聊天。

默认监听 `127.0.0.1:3088`。要改的话用 `OPENGROKBOT_HOST`、`OPENGROKBOT_PORT`、`OPENGROKBOT_HOME`。`pnpm dev` 会盯着文件变。`pnpm typecheck` 跑 `tsc --noEmit`。

## 桌面应用（macOS）

OpenGrokBot 提供未签名的 Electron `.dmg`，方便本机使用。桌面版会自动启动 Fastify 服务，并在窗口里打开 UI。

**环境要求：** macOS；系统 `PATH` 里要有 Node 20+（打包版会调用本机 `node`）；pnpm。

**构建 DMG：**

```bash
pnpm install
pnpm build:dmg
```

产物在 `release/`（例如 `release/OpenGrokBot-0.2.0.dmg`、`release/OpenGrokBot-0.2.0-mac.zip`，以及 `release/mac/OpenGrokBot.app`）。

若 `electron-builder` 在 DMG 步骤卡住，app 和 zip 仍然可用。可手动打 DMG：

```bash
hdiutil create -volname "OpenGrokBot" -srcfolder release/mac/OpenGrokBot.app -ov -format UDZO release/OpenGrokBot-0.2.0.dmg
```

**安装未签名包：** macOS 可能拦截首次打开。请右键 **OpenGrokBot → 打开**，或执行：

```bash
xattr -cr /Applications/OpenGrokBot.app
```

**Electron 开发模式：**

```bash
pnpm dev:desktop
```

会先跑 TypeScript 开发服务，等 `/api/health` 就绪后再打开 Electron 窗口。

**v0.2 限制：** 系统 `PATH` 里要有 Node 20+（应用会调用本机 `node` 跑服务）。无代码签名、自动更新或菜单栏托盘。CLI 执行器（`codex`、`cursor`、`dsh`）仍需在本机单独安装。用户数据仍在 `~/.opengrokbot/`。

### 后台通知

标签页或 Electron 窗口在后台时，OpenGrokBot 可以在以下情况提醒你：

- Bot 回复完成
- Bot 需要审批（`Blocked`）
- 定时 routine 触发（通过花名册轮询）

在 **Settings → Agent → Background notifications** 打开。首次开启时浏览器或 macOS 会请求权限。点击通知会聚焦应用并打开对应 Bot。前台正在看应用时不会弹通知。

## 官方那套，跑在你电脑上

官方 Grok Bot（[文档](https://docs.x.ai/grok-bot/overview)）是这样的：每个 Bot 有名字、有岗位，上下文会越攒越厚。各自守着一台电脑——浏览器、文件系统、终端——跟你聊天像 iMessage，不是把草稿全堆在对话框里。

| | Grok Bot | OpenGrokBot |
|---|---|---|
| 你在跟谁说话 | 有岗位、有名字的 Bot | 一样 |
| 侧栏 | Bot 花名册，不是聊天记录 | 一样 |
| 电脑 | Cursor 云电脑，合上笔记本也继续跑 | **你这台机器。** 休眠就停。就这一处取舍。 |
| 工作区 | 所有 Bot 共用一份 `/workspace` | 磁盘上一个目录，共享方式相同 |
| 模型 | Cursor / Grok 指定 | 自备任何 OpenAI 兼容接口 |
| 上手 | 发一条消息，不是去搭工作流编辑器 | 一样 |
| 价格 | Cursor / SuperGrok 订阅 | 免费。MIT |

## v0.2 现在有什么

这是能跑起来的本机应用，不是只有一篇 README。

**这个版本有**

- **macOS 桌面应用** — 未签名的 Electron `.dmg`；自动启动本机服务并在窗口里打开 UI
- 带名字的花名册，可以新建 Bot（选颜色、形状、表情）
- **Harness 切换** — OpenAI 兼容 HTTP、Ollama、Codex CLI、Cursor Agent、DeepSeek Harness；本机 CLI 没装会给出安装命令
- **头像** — 8 种形状、8 种表情；idle / thinking / working / waiting / blocked / done 六种状态动效长在脸上，不用额外转圈
- **Token 流式输出** — OpenAI 兼容执行器会把回复逐 token 流进气泡（CLI 执行器仍是整段返回）
- 一对一和群聊；群消息经协调 Bot 路由，成员回复会镜像进同一条线程
- `@` 提及（聊天里可点击跳转）和 `message_bot` 交接，交接条是系统样式，不是用户气泡
- **气泡 Markdown** — 表格、分隔线、标题、列表、粗体、行内代码、代码块、链接
- 每个 Bot 一份 markdown 记忆，磁盘上还有一份共用工作区
- 跑 Shell 要过 Allow once / Always allow / Deny；**点 Allow 后会带着命令输出继续跑 agent 循环**
- **`/routine` 选择器** — 输入框里打 `/` 可触发 Bot 的 routine 提示词
- **定时 Routine** — 进程内调度器在应用打开时到点触发启用的 routine（Settings → Agent → Host scheduler）
- **后台通知** — 浏览器或 macOS 在回复完成、需要审批或 routine 触发时提醒
- Settings → Agent：清空花名册，或重置为 `data/bots/` 里的 starter 配置
- 右边「电脑」栏是状态预览（干活时图标变紫、壁纸跟时间走），不是一台真在跑的虚拟机

**还没有**

- 真浏览器 / computer-use
- 应用关闭后的 launchd / 登录项定时
- MCP 连接器
- Auto Review 模型
- 合上笔记本还继续干活

下面那份官方清单是方向，不是「今天每一项都接好了」。

<img src="./docs/map.svg" alt="v0.2 产品图：花名册、聊天、记忆和文件、shell 审批" width="640" />

## 界面与在场感

侧栏是产品本体，状态长在头像上，界面尽量别给你加负担。

### Harness（一轮对话怎么跑）

Settings → **Harness** 选执行器：

| 引擎 | 依赖 |
|---|---|
| OpenAI-compatible | 你在 Models 里填的 Base URL + API key + model（DeepSeek、OpenRouter、vLLM 等） |
| Ollama | 本机 `/v1` 接口 |
| Codex CLI | 本机 `codex` |
| Cursor Agent | 本机 `cursor` CLI / agent |
| DeepSeek Harness | 本机 `dsh` |

CLI 类引擎若未安装，设置页会给可复制安装命令。HTTP 引擎仍在 Settings → **Models** 里配模型。

### 头像

新建 Bot → 选 **Color**、**Shape**、**Expression**。

**形状：** circle、oval、squircle、pill、triangle、hexagon、cloud、teardrop — 纯色轮廓 + 斜线眼睛，贴近官方那套。

**表情：** smile、calm、grin、sleepy、wink、wide、glasses、dots。

**生命周期动效**（花名册 + 输入时那一行）：idle 安静；thinking / working / waiting / blocked 换眼睛和节奏；done 停一下再回 idle。悬停花名册行可看当前 action，不用另挂状态灯。

### 聊天与线程

- Bot 回复支持 **Markdown**，含 `---` 分隔线和 `| 表格 |`。
- **群聊**（2–6 个 Bot）：你的消息交给 router（如 Chief）；成员回复带名字和头像出现在同一线程。
- **交接**（`[Handoff from …]`）居中系统条，不像用户发言。
- 线程里点 **`@Bot`**  chip 跳到该 Bot 私聊。

### 花名册操作

- **+** 菜单：New Bot、New conversation、New group。
- **Settings → Agent → Roster：** 清空全部 Bot（含 transcript），或重置为 `data/bots/` 种子配置。

## 后面想做成什么样

**像给同事发消息。** 新建一个 Bot，一句话写清岗位，开始聊。Chief of Staff、Sales Outbound、Inbox、Account Manager、Talent Scout——岗位清楚的 Bot，比一个万能助手更能攒上下文。

**可以同时用好几个。** 它们并行干活。两到六个放进一个群，用 `message_bot` 交接。你不用当路由器。

**要批准才回来找你。** 外发、发布、付钱、跑 shell：Allow once / Always allow / Deny。你点同意，只覆盖这一次动作，不会把已经做完的事撤销。

**上下文会越用越厚。** 每个 Bot 自己的记忆、会话、Routine。文件、Cookie、登录放在共用电脑上，交接不用重新登录。

**做一遍，它就会了。** 带着走完一次，存成 Skill，把 Routine 钉在这个 Bot 上。日程属于这名同事，不是随便一条 cron。

**电脑分三档。** 默认只亮一个紫色状态。可以钉住屏幕预览。碰到密码 / 2FA / CAPTCHA 才接管，做完交回去。密钥不要打进聊天。

**能接接口就接接口，不行再用电脑。** 有 MCP / API 走接口；没有就用本机那份独立浏览器配置。所有 Bot 共用这一份——一个用户、一个浏览器——隔离发生在用户之间，不在 Bot 之间，这点和官方一样。

## 第一次可以这样派活

官方文档开头就是这句：

> 把这周的 pipeline 名单拉下来。已经在跟进的跳过。研究前五个客户，用我的口吻起草触达，明早之前把草稿留给我批。

说清干什么、在哪干、怎样算完。不对就改。走顺的流程存成 Routine，钉在这个 Bot 上。

## 合上盖子，它就停了

官方 Grok Bot 合上笔记本还在干活。那是因为它们有云电脑。

OpenGrokBot 跑在你这台机器上。盖子一合，团队就停。

换来的是：不用每月付 $120–300 的席位费，登录信息也不用丢进别人的虚拟机。

如果你必须 24 小时不停，留一台小机器别休眠——或者继续用官方 Grok Bot。

## 数据放在哪

| 路径 | 内容 |
|---|---|
| `~/.opengrokbot/settings.json` | API key、模型、路径 |
| `~/.opengrokbot/bots/` | 花名册 YAML（首次从 `data/bots/` 拷贝） |
| `~/.opengrokbot/transcripts/` | 聊天记录 |
| `~/.opengrokbot/memory/` | 每个 Bot 一份 `MEMORY.md` |
| `~/.opengrokbot/workspace/` | Bot 可读写的共享文件 |

许可证：[MIT](LICENSE)。

## 免责声明

OpenGrokBot 是独立的、非官方的**开源学习项目**。它不是 xAI、Grok 或 Cursor 的产品，也没有得到它们的认可、赞助或认证。

**Grok**、**Grok Bot**、**xAI**、**Cursor** 是各自权利人的商标或产品名。文里提到它们，只是为了说清楚这个项目在研究什么、和官方差在哪。我们不主张这些标识的任何权利，**和官方不是一家公司**。

这个仓库不提供官方 Grok Bot、Cursor 账号，也不提供 xAI 云电脑。你在这里跑的一切，都在自己的硬件上，用自己的密钥，风险自负。
