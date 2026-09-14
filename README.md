# OpenGrokBot

[English](README.md) · [中文](README.zh-CN.md)

**AI teammates that finish the work — on your machine.**

Message Bots like teammates. Give one a job, keep it around, add another when the work grows. They remember how you work, hand off to each other, and come back when something needs your approval.

OpenGrokBot is the open-source **[Grok Bot](https://x.ai/bot) alternative**. Same product. Same primitives. Your computer instead of theirs.

> Unofficial. Not affiliated with xAI or Cursor. Source ships after local testing — this README is the public cut.

## Same Bot. Your computer.

Official Grok Bot ([docs](https://docs.x.ai/grok-bot/overview)): named teammates with jobs and compounding context. Each one works a persistent computer — browser, filesystem, terminal — and messages you like iMessage, not like a chatbot dump.

| | Grok Bot | OpenGrokBot |
|---|---|---|
| What you talk to | Named Bots with jobs | Same |
| Sidebar | Bot roster, not chat history | Same |
| Computer | Cursor cloud VM, keeps running when the laptop sleeps | **Your machine.** Sleep stops work. That’s the trade. |
| Workspace | One `/workspace` for every Bot | One folder on disk, same sharing model |
| Model | Cursor / Grok picks | You bring any OpenAI-compatible API |
| Setup | A message, not a workflow builder | Same |
| Price | Cursor / SuperGrok plan | Free. MIT when the code ships |

Everything else is the official shape.

## What you get (the official list)

**Message Bots like teammates.** Create a Bot, describe the job in a sentence, start talking. Chief of Staff, Sales Outbound, Inbox, Account Manager, Talent Scout — focused Bots beat a General Helper.

**Work with many Bots at once.** They run in parallel. Put 2–6 in a group thread and they pass work with `message_bot`. You are not the router.

**Come back when approval is needed.** Outbound, publish, pay, shell: Allow once / Always allow / Deny. A yes covers that action, not the past.

**Context compounds.** Each Bot keeps its own memory, thread, and routines. Files, cookies, and logins sit on the shared computer so handoffs don’t mean re-login.

**Show a Bot how it’s done.** Walk it through once, save a Skill, pin a Routine on that Bot. The schedule belongs to the teammate, not to a random cron tab.

**The computer has three levels.** Purple status by default. Pin a preview of its screen. Take over only for password / 2FA / CAPTCHA, then hand it back. You never type secrets into chat.

**Connectors first, computer-use when you must.** MCP and APIs where they exist; the local browser profile when they don’t. All Bots share that profile — one user, one browser — matching official isolation (between users, not between Bots).

## A good first handoff

Same prompt the official docs start with:

> Pull this week’s pipeline review list. Skip anyone already in an active sequence. Research the top five accounts, draft outreach in my voice, and leave me drafts to approve by tomorrow morning.

Tell it what to do, where to work, what finished looks like. Correct it. Turn the stable path into a routine.

## The one thing we will not copy

Official Bots keep working when your laptop is closed. That needs their cloud computer.

OpenGrokBot runs on the host OS. Close the lid, the team stops. In exchange: no $120–300/month seat, no logins sitting in someone else’s VM, no waiting on a Bot API that does not exist.

If you need 24/7, keep a small machine awake — or stay on official Grok Bot.

## Status

README-only on GitHub on purpose. The app is in local testing. Code follows when that loop is solid.

License: MIT, when it ships.
