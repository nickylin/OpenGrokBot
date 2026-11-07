# Changelog

## v0.6.1 — 2026-11-07

The ego lite adapter is now verified against a real ego install — and
the docs-based first cut was wrong in three places, all fixed:

- **Invocation**: `ego-browser nodejs <file>` parses the path as code
  and dies with a regex SyntaxError; ego's runtime reads the script
  from stdin. The adapter now feeds the generated script via a small
  `sh -c` wrapper (`"$1" nodejs < "$2"`).
- **Page handle**: `taskSpace()` returns a Space whose `page` is a
  method that only refers to an *existing* managed page by label. The
  adapter now reuses `space.pages()[0]` or creates one with
  `space.newPage()` — the Space and its page persist across separate
  ego processes, so multi-step flows keep their tab.
- **API shape**: the Page object is Playwright-flavoured
  (`goto / snapshot / click / fill / screenshot({ path })`), and
  `page.snapshot()` returns a string. Scripts print it directly.
- Live test on macOS (ego lite, Space "opengrokbot"): open
  example.com → title + snapshot → click "Learn more" → landed on
  iana.org → fill a form field on httpbin → value read back → PNG
  screenshot written. All five `browser_*` actions confirmed.
- Shell/tool execution timeout raised 20s → 60s: real page loads in a
  linked browser routinely outlast 20s.

## v0.6.0 — 2026-11-07

Bots can drive a real browser — via MCP presets for everyone, and via a
linked local browser app for users who already run one.

- **Browser MCP presets (Settings → Browser)** — one click adds
  Microsoft's Playwright MCP (`--browser chromium`, its own profile at
  `~/.opengrokbot/browser-profile`; adding it also runs the one-time
  `install-browser chrome-for-testing` download, ~120 MB, idempotent) or
  Google's Chrome DevTools MCP (`--no-usage-statistics`). Bots use them
  through the existing `mcp_` tools; manage them later under Connectors.
  Live-verified: preset add → server ready with 25 tools → a Bot
  navigated a test page and got its title/snapshot back. (Two wrong
  turns on the way: the default `chrome` channel needs a system Chrome,
  and an older Chromium build in the cache does not satisfy the pinned
  version — the preset now always uses `chromium` + the install step.)
- **Linked browser apps (Settings → Browser, off by default)** — detect
  and explicitly link ego lite or agent-browser. Bots gain native
  `browser_open / browser_snapshot / browser_click / browser_fill /
  browser_screenshot` tools. Every action is translated to one CLI
  invocation and passes the same localExec gate as `run_shell`: in Ask
  mode each action raises an approval card naming the browser command.
  Live-verified with agent-browser 0.41.2: a scripted model opened a
  page, filled a field, clicked, read the changed page state back from a
  snapshot, and screenshotted it; in Ask mode the same flow produced 5
  approval cards and resumed after each Allow.
- **Computer pane shows live screenshots** — `browser_screenshot` saves
  to `~/.opengrokbot/browser/last-screenshot.png`; the pane polls
  `GET /api/browser` and renders the latest frame.
- **ego lite adapter** — implemented against Citro Labs' public JS SDK
  (taskSpace + page.* via `ego-browser nodejs <script>`), with the
  consent text calling out that the ego browser is closed-source.
  Not yet verified against a live ego install; errors surface verbatim
  so a version mismatch is visible rather than silent.

## v0.5.0 — 2026-11-07

A shared playbook for Bots, an on-ramp for another assistant's memory,
and a voice.

- **Skills library** — skills are markdown files with YAML frontmatter in
  `~/.opengrokbot/skills/` (seeded with deep-research and weekly-review),
  managed in the new Settings → Skills pane. Typing `/<skill-id> task` in
  chat preloads the skill as the turn's instructions (shown as a chip);
  skill descriptions are also listed in every Bot's system prompt, and
  Bots can load one mid-task with the new `skill_read` tool. The `/`
  picker now lists routines and skills together. (The first seeded
  weekly-review file shipped with an unquoted `: ` in its description,
  which made its frontmatter unparseable — caught and fixed in testing.)
- **Memory import** — `POST /api/bots/:id/memory/import` (and a paste box
  in Settings → Agent) merges a memory export from another assistant into
  the Bot's MEMORY.md: candidates are deduplicated line-by-line against
  existing memory and within the paste, and appended under a dated
  `## Imported memory` heading. Re-importing the same export adds 0.
- **Voice dictation** — the composer gains a mic button backed by the Web
  Speech API: interim results stream into the input box, finals append,
  nothing is auto-sent. The button stays hidden in browsers/shells
  without speech recognition support.

## v0.4.0 — 2026-11-06

Bots can finally reach outside the chat: MCP connectors, usable secrets,
and event-triggered routines.

- **MCP client (stdio)** — servers declared in `~/.opengrokbot/mcp.json` or
  Settings → Connectors are spawned lazily, and their tools are offered to
  every Bot as `mcp_<server>_<tool>` (HTTP harnesses: OpenAI-compatible and
  Ollama; CLI harnesses do not expose tools yet). Server status, restart and
  delete live in the same Settings pane.
- **`${secret:name}` substitution** — shell commands/args and MCP server env
  values may reference vault secrets. Substitution happens on this machine
  at execution/spawn time; approval cards keep showing the placeholder.
  Missing secrets fail the call with the missing names, never a value.
- **Output masking** — every tool result (shell, MCP, workspace, handoffs)
  is scanned for exact vault values before the model, the transcript, or
  the UI sees it; echoes come back as `•••`. Verified end-to-end with a
  fixture MCP server and a fake key: the key reached the child processes,
  and only ever appeared in `secrets.json` and the intended side-effect
  file — never in the transcript or the model's tool results.
- **Routine webhook triggers** — `POST /api/hooks/routines/<botId>/<routineId>`
  with the routine's `x-webhook-token` header (token generated/rotated in
  Settings → Agent) fires the routine immediately and returns 202; an
  optional `{ "text": "…" }` body is appended to the routine prompt.
- **Routine run history** — schedule, webhook, and manual `/name` runs are
  recorded in `~/.opengrokbot/routine-runs.json`, last 20 per routine
  (the official product's documented retention), shown in Settings → Agent.

## v0.3.0 — 2026-11-06

First tagged release since v0.1.0. Bundles the v0.2 desktop work (which shipped
in code but was never tagged) plus the interactive-forms feature merged in
PR #1 on 2026-11-01.

- **Interactive form cards** — a Bot can call `request_form` to collect
  structured input (text, textarea, number, date, select, multi-select,
  switch) in one card instead of question-by-question chat. Submitting resumes
  the paused turn with clean typed values; cancelling resumes with
  `{cancelled: true}`. Pending cards expire on restart, and a pending-forms
  reminder sits above the composer.
- **Secret fields that never reach the model** — `secret` form fields are
  stored straight into `~/.opengrokbot/secrets.json` (mode 0600). The
  transcript and the model only ever see a masked reference
  (`provided` / `ref` / `last4`). `GET /api/secrets` lists masked statuses and
  `DELETE /api/secrets/:name` removes one; no route returns a value.
- Server-side validation for form submissions (invalid values keep the card
  pending and never touch the secrets file).
- README: updated the official-plan comparison (Grok Bot is now bundled into
  paid X plans) and synced the Chinese README with the form/secret features.

Not yet in this release (planned): 24h timed expiry for pending forms, an OTP
consumer, form support for CLI harnesses, and `${secret:name}` placeholder
substitution at execution time.

## v0.2.1 — 2026-09-29 (code only, never tagged)

- Desktop app starts at login (macOS Login Item, background tray).
- Menu-bar tray with close-to-hide; quit from the tray menu.

## v0.2.0 — 2026-09-17 (code only, never tagged)

- macOS Electron desktop app.
- Token streaming, background notifications, scheduled routines.

## v0.1.0 — 2026-09-15

- First release: local Bot roster, group chats with coordinator routing,
  per-Bot markdown memory, shell approvals, harness switcher
  (OpenAI-compatible API / Ollama / Codex CLI / Cursor Agent / DeepSeek
  Harness).
