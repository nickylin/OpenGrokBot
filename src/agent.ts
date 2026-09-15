import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import {
  assertNever,
  type AgentEvent,
  type ApprovalDecision,
  type Bot,
  type ChatMessage,
  type LocalExec,
  type Settings,
} from "./types.js";
import { expandHome } from "./paths.js";
import {
  appendMessage,
  getBot,
  listBots,
  loadSettings,
  loadTranscript,
  readMemory,
  resolveApproval,
  saveSettings,
  setLiveStatus,
  writeMemory,
} from "./store.js";

const execFileAsync = promisify(execFile);
const MAX_ROUNDS = 12;
const MAX_NEST = 1;

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_bots",
      description: "List named teammate Bots on this roster (id, name, title, kind).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "message_bot",
      description: "Send a task to another named Bot and wait for its reply. Use for handoffs, not for talking to the user.",
      parameters: {
        type: "object",
        properties: {
          botId: { type: "string", description: "Target Bot id from list_bots" },
          message: { type: "string", description: "What the other Bot should do" },
        },
        required: ["botId", "message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_read",
      description: "Read this Bot's persistent markdown memory.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_write",
      description: "Replace this Bot's persistent markdown memory. Keep it short and durable.",
      parameters: {
        type: "object",
        properties: { content: { type: "string" } },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_ls",
      description: "List files in the shared workspace (official /workspace analogue).",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative path, default ." } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_read",
      description: "Read a UTF-8 file from the shared workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_write",
      description: "Write a UTF-8 file in the shared workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_shell",
      description: "Run a command with cwd = workspace. Honor localExec: never/ask/always.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          args: { type: "array", items: { type: "string" } },
        },
        required: ["command"],
      },
    },
  },
];

function jail(workspace: string, rel: string): string {
  const root = resolve(expandHome(workspace));
  const target = resolve(root, rel || ".");
  const relToRoot = relative(root, target);
  if (relToRoot.startsWith("..") || resolve(target) === resolve(join(root, ".."))) {
    throw new Error("path escapes workspace");
  }
  if (!target.startsWith(root + sep) && target !== root) {
    throw new Error("path escapes workspace");
  }
  return target;
}

function clientFor(settings: Settings): OpenAI {
  const local =
    settings.baseUrl.includes("127.0.0.1") || settings.baseUrl.includes("localhost");
  return new OpenAI({
    apiKey: settings.apiKey || (local ? "local" : ""),
    baseURL: settings.baseUrl.replace(/\/+$/, ""),
  });
}

function stripThink(text: string): string {
  return text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/<think\b[^>]*>[\s\S]*$/gi, "")
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function mentionExtra(text: string, selfId: string): Promise<string> {
  const roster = await listBots();
  const hits = roster.filter((b) => {
    if (b.kind === "group" || b.id === selfId) return false;
    return new RegExp(`@${escapeRegExp(b.name)}\\b`, "i").test(text);
  });
  if (hits.length === 0) return "";
  return `The user @mentioned these Bots and wants them assigned: ${hits
    .map((b) => `${b.name} (id: ${b.id})`)
    .join(", ")}. Call message_bot for each with a concrete task. Do not do their specialist work yourself.`;
}

function systemPrompt(bot: Bot, settings: Settings, extra?: string): string {
  const members = bot.kind === "group" ? `\nThis is a group chat. Members: ${(bot.members ?? []).join(", ")}. Coordinate with message_bot. Do not invent a status board.` : "";
  return [
    `You are ${bot.name}, ${bot.title}.`,
    bot.description.trim(),
    members,
    extra ?? "",
    "You are a persistent OpenGrokBot teammate. Other Bots are named people on the roster, not disposable subagents.",
    "When the user @mentions another Bot, treat that as an assignment: message_bot them. A focused Bot should only do its own job.",
    "Use tools for memory, workspace files, and handoffs. Prefer short structured answers over prose.",
    `Timezone: ${settings.timezone}.`,
    "Do not claim you sent external email, posted, or paid unless the user approved that exact action.",
    "If a connector is missing, say so and stop. Never invent credentials.",
  ]
    .filter(Boolean)
    .join("\n");
}

function toOpenAI(messages: ChatMessage[], system: string): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: m.id,
        content: m.content,
      });
      continue;
    }
    if (m.role === "assistant" && m.kind === "system") continue;
    if (m.role === "system") {
      out.push({ role: "system", content: m.content });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

async function emit(
  onEvent: (e: AgentEvent) => void,
  event: AgentEvent,
): Promise<void> {
  onEvent(event);
}

async function persistAssistant(
  botId: string,
  content: string,
  kind: ChatMessage["kind"] = "text",
): Promise<ChatMessage> {
  return appendMessage(botId, {
    id: randomUUID(),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
    kind,
  });
}

function localExecLabel(mode: LocalExec): string {
  switch (mode) {
    case "ask":
      return "ask";
    case "always":
      return "always";
    case "never":
      return "never";
    default:
      return assertNever(mode, "LocalExec");
  }
}

async function executeShell(command: string, args: string[], workspace: string): Promise<string> {
  const cwd = expandHome(workspace);
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      timeout: 20_000,
      maxBuffer: 512_000,
    });
    return JSON.stringify({ stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 2000) });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return JSON.stringify({
      error: e.message ?? String(err),
      stdout: (e.stdout ?? "").slice(0, 4000),
      stderr: (e.stderr ?? "").slice(0, 2000),
    });
  }
}

function formatShellResult(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { stdout?: string; stderr?: string; error?: string };
    const parts = [];
    if (parsed.stdout?.trim()) parts.push(parsed.stdout.trim());
    if (parsed.stderr?.trim()) parts.push(parsed.stderr.trim());
    if (parsed.error && !parts.length) parts.push(parsed.error);
    return parts.join("\n") || "Done.";
  } catch {
    return raw;
  }
}

function parseDecision(value: string): ApprovalDecision {
  if (value === "allow" || value === "always" || value === "deny") return value;
  return "deny";
}

export async function fulfillApproval(
  botId: string,
  rawDecision: string,
  messageId?: string,
): Promise<ChatMessage[]> {
  const decision = parseDecision(rawDecision);
  const resolved = await resolveApproval(botId, decision, messageId);
  if (!resolved) return [];
  if (!resolved.fresh) return [resolved.message];

  switch (decision) {
    case "deny":
      setLiveStatus(botId, "idle", "Idle");
      return [resolved.message];
    case "always":
      await saveSettings({ localExec: "always" });
      break;
    case "allow":
      break;
    default:
      return assertNever(decision, "ApprovalDecision");
  }

  let command = "";
  let args: string[] = [];
  try {
    const payload = JSON.parse(resolved.message.content) as { command?: string; args?: string[] };
    command = payload.command ?? "";
    args = Array.isArray(payload.args) ? payload.args : [];
  } catch {
    /* card is not JSON */
  }
  if (!command) {
    setLiveStatus(botId, "idle", "Idle");
    return [resolved.message];
  }
  const settings = await loadSettings();
  const output = await executeShell(command, args, settings.workspace);
  const result = await persistAssistant(botId, formatShellResult(output), "text");
  setLiveStatus(botId, "idle", "Idle");
  return [resolved.message, result];
}

async function runShell(
  settings: Settings,
  command: string,
  args: string[],
): Promise<string> {
  const mode = settings.localExec;
  if (mode === "never") {
    return JSON.stringify({ error: "localExec is never; shell is disabled" });
  }
  if (mode === "ask") {
    return JSON.stringify({
      needsApproval: true,
      localExec: localExecLabel(mode),
      command,
      args,
      hint: "Ask the user to Allow once in chat. Do not pretend the command ran.",
    });
  }
  if (mode !== "always") return assertNever(mode, "LocalExec");
  return executeShell(command, args, settings.workspace);
}

async function execTool(
  bot: Bot,
  settings: Settings,
  name: string,
  argsJson: string,
  nest: number,
  onEvent: (e: AgentEvent) => void,
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return JSON.stringify({ error: "invalid JSON arguments" });
  }

  try {
    switch (name) {
    case "list_bots": {
      const bots = await listBots();
      return JSON.stringify(
        bots.map((b) => ({ id: b.id, name: b.name, title: b.title, kind: b.kind })),
      );
    }
    case "message_bot": {
      const targetId = String(args.botId ?? "");
      const message = String(args.message ?? "");
      const target = await getBot(targetId);
      if (!target) return JSON.stringify({ error: `unknown bot ${targetId}` });
      if (target.id === bot.id) return JSON.stringify({ error: "cannot message self" });
      if (nest >= MAX_NEST) {
        await appendMessage(target.id, {
          id: randomUUID(),
          role: "user",
          content: `[from ${bot.name}] ${message}`,
          createdAt: new Date().toISOString(),
          kind: "text",
        });
        return JSON.stringify({ queued: true, botId: target.id, note: "nested depth cap; left in their inbox" });
      }
      const reply = await runTurn({
        botId: target.id,
        userText: `[Handoff from ${bot.name}] ${message}`,
        nest: nest + 1,
        onEvent,
      });
      return JSON.stringify({ botId: target.id, name: target.name, reply });
    }
    case "memory_read":
      return (await readMemory(bot.id)) || "(empty)";
    case "memory_write":
      await writeMemory(bot.id, String(args.content ?? ""));
      return "memory saved";
    case "workspace_ls": {
      const dir = jail(settings.workspace, String(args.path ?? "."));
      if (!existsSync(dir)) return JSON.stringify({ error: "not found" });
      const names = await readdir(dir);
      const rows = [];
      for (const n of names) {
        const st = await stat(join(dir, n));
        rows.push({ name: n, dir: st.isDirectory(), bytes: st.size });
      }
      return JSON.stringify(rows);
    }
    case "workspace_read": {
      const file = jail(settings.workspace, String(args.path ?? ""));
      const st = await stat(file);
      if (st.size > 200_000) return JSON.stringify({ error: "file too large" });
      return await readFile(file, "utf8");
    }
    case "workspace_write": {
      const file = jail(settings.workspace, String(args.path ?? ""));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, String(args.content ?? ""));
      return "written";
    }
    case "run_shell":
      return runShell(settings, String(args.command ?? ""), Array.isArray(args.args) ? args.args.map(String) : []);
    default:
      return JSON.stringify({ error: `unknown tool ${name}` });
  }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

export async function testConnection(settings: Settings): Promise<{ ok: boolean; error?: string; model?: string }> {
  if (!settings.baseUrl || !settings.model) {
    return { ok: false, error: "Need Base URL and Model." };
  }
  const local =
    settings.baseUrl.includes("127.0.0.1") || settings.baseUrl.includes("localhost");
  if (!settings.apiKey && !local) {
    return { ok: false, error: "API Key is empty. Open Settings → Models." };
  }
  try {
    const openai = clientFor(settings);
    const res = await openai.chat.completions.create({
      model: settings.model,
      messages: [{ role: "user", content: "Reply with the single word pong." }],
      max_tokens: 8,
    });
    return { ok: true, model: res.model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runTurn(opts: {
  botId: string;
  userText: string;
  nest?: number;
  onEvent?: (e: AgentEvent) => void;
}): Promise<string> {
  const onEvent = opts.onEvent ?? (() => undefined);
  const nest = opts.nest ?? 0;
  const bot = await getBot(opts.botId);
  if (!bot) {
    await emit(onEvent, { type: "error", botId: opts.botId, error: "Unknown Bot" });
    return "";
  }
  const settings = await loadSettings();
  const local =
    settings.baseUrl.includes("127.0.0.1") || settings.baseUrl.includes("localhost");

  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: "user",
    content: opts.userText,
    createdAt: new Date().toISOString(),
    kind: "text",
  };
  if (nest === 0) {
    await appendMessage(bot.id, userMsg);
    await emit(onEvent, { type: "message", botId: bot.id, message: userMsg });
  } else {
    await appendMessage(bot.id, userMsg);
  }

  if (!settings.apiKey && !local) {
    const msg = await persistAssistant(
      bot.id,
      "No API key yet. Open Settings (⌘,) → Models and paste a key for your OpenAI-compatible endpoint.",
      "system",
    );
    await emit(onEvent, { type: "message", botId: bot.id, message: msg });
    await emit(onEvent, { type: "error", botId: bot.id, error: "Missing API key" });
    await emit(onEvent, { type: "done", botId: bot.id });
    return msg.content;
  }

  setLiveStatus(bot.id, "thinking", "Thinking");
  await emit(onEvent, { type: "status", botId: bot.id, status: "thinking", action: "Thinking" });

  const openai = clientFor(settings);
  const model = nest > 0 && settings.subagentModel ? settings.subagentModel : settings.model;
  const history = await loadTranscript(bot.id);
  const usable = history.filter((m) => m.role === "user" || m.role === "assistant");
  const extra = nest === 0 ? await mentionExtra(opts.userText, bot.id) : "";
  const messages = toOpenAI(usable, systemPrompt(bot, settings, extra));
  let finalText = "";

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      setLiveStatus(bot.id, "working", round === 0 ? "Working" : `Tool round ${round}`);
      await emit(onEvent, {
        type: "status",
        botId: bot.id,
        status: "working",
        action: round === 0 ? "Working" : `Tool round ${round}`,
      });

      const completion = await openai.chat.completions.create({
        model,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
      });
      const choice = completion.choices[0];
      const msg = choice?.message;
      if (!msg) break;

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push({
          role: "assistant",
          content: msg.content ?? "",
          tool_calls: msg.tool_calls,
        });
        for (const call of msg.tool_calls) {
          if (call.type !== "function") continue;
          const input = call.function.arguments ?? "{}";
          const output = await execTool(bot, settings, call.function.name, input, nest, onEvent);
          await emit(onEvent, {
            type: "tool",
            botId: bot.id,
            name: call.function.name,
            input,
            output: output.slice(0, 2000),
          });
          if (call.function.name === "message_bot") {
            let label = "Asking teammate…";
            try {
              const parsed = JSON.parse(output) as { name?: string };
              if (parsed.name) label = `Messages from ${parsed.name}`;
            } catch {
              /* keep default */
            }
            const handoff = await persistAssistant(bot.id, label, "handoff");
            await emit(onEvent, { type: "message", botId: bot.id, message: handoff });
          }
          if (call.function.name === "run_shell") {
            try {
              const parsed = JSON.parse(output) as {
                needsApproval?: boolean;
                command?: string;
                args?: string[];
              };
              if (parsed.needsApproval) {
                const card = await persistAssistant(
                  bot.id,
                  JSON.stringify({
                    title: `Run \`${parsed.command ?? "command"}\` on this machine?`,
                    body: "localExec is Ask every time. Allow once only covers this command.",
                    command: parsed.command,
                    args: parsed.args ?? [],
                  }),
                  "approval",
                );
                await emit(onEvent, { type: "message", botId: bot.id, message: card });
                setLiveStatus(bot.id, "blocked", "Needs approval");
                await emit(onEvent, {
                  type: "status",
                  botId: bot.id,
                  status: "blocked",
                  action: "Needs approval",
                });
                await emit(onEvent, { type: "done", botId: bot.id });
                return card.content;
              }
            } catch {
              /* not an approval payload */
            }
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: output,
          });
        }
        continue;
      }

      finalText = stripThink((msg.content ?? "").trim()) || "Done.";
      const saved = await persistAssistant(bot.id, finalText, "text");
      await emit(onEvent, { type: "message", botId: bot.id, message: saved });
      break;
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const saved = await persistAssistant(bot.id, `Model error: ${error}`, "system");
    await emit(onEvent, { type: "message", botId: bot.id, message: saved });
    await emit(onEvent, { type: "error", botId: bot.id, error });
  }

  setLiveStatus(bot.id, "idle", "Idle");
  await emit(onEvent, { type: "status", botId: bot.id, status: "idle", action: "Idle" });
  await emit(onEvent, { type: "done", botId: bot.id });
  return finalText;
}
