# OpenGrokBot

Local-first, open-source **Grok Bot**. A roster of named teammates — not a chat-history sidebar — that live on your machine.

> **Status:** claiming the name and the cut. Source lands after local testing. Not affiliated with xAI, Cursor, or [Grok Bot](https://x.ai/bot).

中文：这是本地优先的开源 Grok Bot：侧栏是 Bot 花名册，不是会话列表。代码还在本机打磨，测完再推。

## Why this exists

Official Grok Bot is a Cursor product: one user-scoped computer, many Bots, thin clients. There is no public Bot API.

OpenGrokBot is the self-hosted slice:

| Official | OpenGrokBot |
| --- | --- |
| Cloud VM, keeps running when the laptop sleeps | Your OS. Sleep stops work. |
| Cursor picks the model | You bring an OpenAI-compatible key (DeepSeek, MiniMax, …) |
| One `/workspace` shared by every Bot | Same idea, a directory on disk |
| Subagents are children of a turn | Named Bots are persistent teammates (`message_bot`, per-Bot memory) |

## Product primitives

Same vocabulary as the official docs: **Bot**, **Chat**, **Prompt** (Skill / Routine), **Tool**, **Artifact**.

v0 cut (in testing, not in this repo yet):

- Named Bots + group chat (2–6)
- Per-Bot markdown memory
- Shared workspace jail
- Settings for Base URL / API key / local exec (Ask / Always / Never)

Later: standing routines that outlive the UI, real browser with a dedicated profile.

## Repo layout (when source is published)

```
design/     interactive UI prototype
public/     app shell
src/        local server + agent loop
data/bots/  seed roster
```

Until then this repository is README-only on purpose.

## License

MIT, when the code ships.
