# Changelog

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
