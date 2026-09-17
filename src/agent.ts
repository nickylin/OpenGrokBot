import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
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
  cliPrompt,
  inferHarness,
  runHarnessCli,
  testHarness,
} from "./harness.js";
import {
  appendMessage,
  getBot,
  getLiveStatus,
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

type LoopContext = {
  agent: Bot;
  threadId: string;
  group: Bot | null;
  groupThreadId?: string;
  settings: Settings;
  model: string;
  nest: number;
};

type PendingTurn = {
  ctx: LoopContext;
  messages: ChatCompletionMessageParam[];
  pendingToolCallId: string;
};

const pendingTurns = new Map<string, PendingTurn>();

export function hasPendingTurn(botId: string): boolean {
  return pendingTurns.has(botId);
}

function resolveRoutineInput(
  bot: Bot,
  userText: string,
): { display: string; modelText: string; kind: ChatMessage["kind"]; routineName?: string } {
  const m = userText.trim().match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/);
  if (!m) return { display: userText, modelText: userText, kind: "text" };
  const key = m[1].toLowerCase();
  const routine = bot.routines?.find(
    (r) =>
      r.id.toLowerCase() === key ||
      r.name.toLowerCase() === key ||
      r.name.toLowerCase().replace(/\s+/g, "-") === key,
  );
  if (!routine) return { display: userText, modelText: userText, kind: "text" };
  const tail = (m[2] ?? "").trim();
  const modelText = tail ? `${routine.prompt}\n\n${tail}` : routine.prompt;
  return {
    display: `/${routine.name}${tail ? ` ${tail}` : ""}`,
    modelText,
    kind: "routine",
    routineName: routine.name,
  };
}

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_bots",
      description: "List named teammate Bots on this roster (id, name, title, kind, status, description).",
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

function botOneLiner(b: Bot): string {
  const { status, action } = getLiveStatus(b.id);
  const desc = b.description.trim().replace(/\s+/g, " ").slice(0, 100);
  const statusPart = status === "idle" ? "idle" : `${status} (${action})`;
  return `${b.name} (id: ${b.id}, ${b.title}) · ${statusPart}: ${desc}`;
}

function findMentionedBots(text: string, roster: Bot[], selfId: string): Bot[] {
  return roster.filter((b) => {
    if (b.kind === "group" || b.id === selfId) return false;
    return new RegExp(`@${escapeRegExp(b.name)}\\b`, "i").test(text);
  });
}

function findUnknownMentions(text: string, roster: Bot[]): string[] {
  const known = new Set(
    roster.filter((b) => b.kind !== "group").map((b) => b.name.toLowerCase()),
  );
  const seen = new Set<string>();
  const unknown: string[] = [];
  for (const m of text.matchAll(/@([\w][\w-]*)/g)) {
    const name = m[1];
    if (known.has(name.toLowerCase()) || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    unknown.push(name);
  }
  return unknown;
}

async function rosterBlock(selfId: string, group?: Bot | null): Promise<string> {
  const roster = await listBots();
  const byId = new Map(roster.map((b) => [b.id, b]));
  const parts: string[] = [];

  if (group?.members?.length) {
    const lines = group.members
      .filter((id) => id !== selfId)
      .map((id) => {
        const b = byId.get(id);
        return b ? `- ${botOneLiner(b)}` : `- ${id} (missing from roster)`;
      });
    if (lines.length) {
      parts.push(
        `Group "${group.name}" members (live status):\n${lines.join("\n")}\nUse message_bot with their id to assign work or pull status.`,
      );
    }
  }

  const teammates = roster.filter((b) => b.kind !== "group" && b.id !== selfId);
  if (teammates.length && !group) {
    parts.push(
      `Teammates on roster (live status):\n${teammates.map((b) => `- ${botOneLiner(b)}`).join("\n")}`,
    );
  }

  return parts.join("\n\n");
}

async function mentionExtra(text: string, selfId: string, group?: Bot | null): Promise<string> {
  const roster = await listBots();
  const hits = findMentionedBots(text, roster, selfId);
  const parts: string[] = [];
  if (hits.length > 0) {
    parts.push(
      `The user @mentioned these Bots and wants them assigned:\n${hits.map((b) => `- ${botOneLiner(b)}`).join("\n")}\nCall message_bot for each with a concrete task. Do not do their specialist work yourself.`,
    );
  }
  const unknown = findUnknownMentions(text, roster).filter(
    (name) => !hits.some((b) => b.name.toLowerCase() === name.toLowerCase()),
  );
  if (unknown.length) {
    parts.push(
      `The user @mentioned ${unknown.map((n) => `@${n}`).join(", ")} but no Bot with that name exists on the roster. Call list_bots for the full roster or ask the user which Bot they mean.`,
    );
  }
  if (group?.members?.length) {
    const others = group.members.filter((id) => id !== selfId);
    if (others.length && shouldFanOutGroup(text)) {
      parts.push(
        `The user is addressing the whole group. After your brief reply, call message_bot for each other member (${others.join(", ")}) so they can greet or answer in this thread. Do not claim they are offline.`,
      );
    }
  }
  return parts.join("\n");
}

function shouldFanOutGroup(text: string): boolean {
  const t = text.trim();
  if (/^(你们好|大家好|hello everyone|hi everyone|hey all|morning everyone|你们)$/i.test(t)) return true;
  if (/其他人|怎么不说话|everyone else|where are the others|其他人呢/i.test(t)) return true;
  if (/^(你好|hi|hey)$/i.test(t)) return true;
  return false;
}

function groupAgentDescription(agent: Bot, group: Bot | null, rosterContext?: string): string {
  if (!group) return agent.description.trim();
  const roster = rosterContext?.trim()
    ? `\n\n${rosterContext.trim()}`
    : `\n\nMembers: ${(group.members ?? []).join(", ")}.`;
  return `${agent.description.trim()}\n\nYou are the router in group "${group.name}".${roster} When the user speaks to the group, keep your reply short and use message_bot so other members can answer here too.`;
}

function systemPrompt(
  agent: Bot,
  settings: Settings,
  extra?: string,
  group?: Bot | null,
  rosterContext?: string,
): string {
  const members =
    group?.kind === "group"
      ? `\nThis is a group chat (${group.name}). Their replies appear in this thread when you message_bot them.`
      : "";
  const roster = !group && rosterContext?.trim() ? `\n${rosterContext.trim()}` : "";
  return [
    `You are ${agent.name}, ${agent.title}.`,
    group ? groupAgentDescription(agent, group, rosterContext) : agent.description.trim(),
    members,
    roster,
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
  fromBotId?: string,
): Promise<ChatMessage> {
  return appendMessage(botId, {
    id: randomUUID(),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
    kind,
    fromBotId,
  });
}

async function mirrorGroupReply(
  groupThreadId: string,
  speakerId: string,
  content: string,
  onEvent: (e: AgentEvent) => void,
): Promise<ChatMessage | undefined> {
  const text = content.trim();
  if (!text) return undefined;
  const saved = await persistAssistant(groupThreadId, text, "text", speakerId);
  await emit(onEvent, { type: "message", botId: groupThreadId, message: saved });
  return saved;
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
  onEvent?: (e: AgentEvent) => void,
): Promise<ChatMessage[]> {
  const emitEvent = onEvent ?? (() => undefined);
  const decision = parseDecision(rawDecision);
  const resolved = await resolveApproval(botId, decision, messageId);
  if (!resolved) return [];
  if (!resolved.fresh) return [resolved.message];

  switch (decision) {
    case "deny":
      pendingTurns.delete(botId);
      setLiveStatus(botId, "idle", "Idle");
      await emit(emitEvent, { type: "status", botId, status: "idle", action: "Idle" });
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
    pendingTurns.delete(botId);
    setLiveStatus(botId, "idle", "Idle");
    await emit(emitEvent, { type: "status", botId, status: "idle", action: "Idle" });
    return [resolved.message];
  }

  const settings = await loadSettings();
  const output = await executeShell(command, args, settings.workspace);
  const shellMsg = await persistAssistant(botId, formatShellResult(output), "text");
  await emit(emitEvent, { type: "message", botId, message: shellMsg });

  const pending = pendingTurns.get(botId);
  if (pending) {
    pendingTurns.delete(botId);
    pending.messages.push({
      role: "tool",
      tool_call_id: pending.pendingToolCallId,
      content: output,
    });
    setLiveStatus(pending.ctx.agent.id, "working", "Working");
    await emit(emitEvent, {
      type: "status",
      botId,
      status: "working",
      action: "Working",
    });
    await runAgentLoop(pending.ctx, pending.messages, emitEvent);
    setLiveStatus(pending.ctx.agent.id, "idle", "Idle");
    await emit(emitEvent, { type: "status", botId, status: "idle", action: "Idle" });
    await emit(emitEvent, { type: "done", botId });
    return [resolved.message, shellMsg];
  }

  setLiveStatus(botId, "idle", "Idle");
  await emit(emitEvent, { type: "status", botId, status: "idle", action: "Idle" });
  return [resolved.message, shellMsg];
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
  agent: Bot,
  settings: Settings,
  name: string,
  argsJson: string,
  nest: number,
  onEvent: (e: AgentEvent) => void,
  groupThreadId?: string,
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
        bots.map((b) => {
          const { status, action } = getLiveStatus(b.id);
          return {
            id: b.id,
            name: b.name,
            title: b.title,
            kind: b.kind,
            status,
            action,
            description: b.description.trim().replace(/\s+/g, " ").slice(0, 200),
          };
        }),
      );
    }
    case "message_bot": {
      const targetId = String(args.botId ?? "");
      const message = String(args.message ?? "");
      const target = await getBot(targetId);
      if (!target) return JSON.stringify({ error: `unknown bot ${targetId}` });
      if (target.id === agent.id) return JSON.stringify({ error: "cannot message self" });
      if (nest >= MAX_NEST) {
        await appendMessage(target.id, {
          id: randomUUID(),
          role: "user",
          content: `[from ${agent.name}] ${message}`,
          createdAt: new Date().toISOString(),
          kind: "handoff",
          fromBotId: agent.id,
        });
        return JSON.stringify({ queued: true, botId: target.id, note: "nested depth cap; left in their inbox" });
      }
      const reply = await runTurn({
        botId: target.id,
        userText: `[Handoff from ${agent.name}] ${message}`,
        nest: nest + 1,
        onEvent,
        fromBotId: agent.id,
        groupThreadId,
      });
      if (groupThreadId && reply.trim()) {
        await mirrorGroupReply(groupThreadId, target.id, reply, onEvent);
      }
      return JSON.stringify({ botId: target.id, name: target.name, reply });
    }
    case "memory_read":
      return (await readMemory(agent.id)) || "(empty)";
    case "memory_write":
      await writeMemory(agent.id, String(args.content ?? ""));
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
  const id = inferHarness(settings);
  if (id === "codex" || id === "cursor" || id === "dsh") {
    return testHarness(settings);
  }
  if (id === "ollama") {
    const probe = await testHarness(settings);
    if (!probe.ok) return probe;
  }
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

async function fanOutBotsCli(opts: {
  targets: Bot[];
  group: Bot | null;
  threadId: string;
  settings: Settings;
  userText: string;
  taskHint: string;
  onEvent: (e: AgentEvent) => void;
}): Promise<void> {
  const { targets, group, threadId, settings, userText, taskHint, onEvent } = opts;
  for (const member of targets) {
    setLiveStatus(member.id, "working", "Working");
    await emit(onEvent, {
      type: "status",
      botId: threadId,
      status: "working",
      action: `${member.name} · Working`,
    });
    const groupLine = group
      ? `\n\nYou are in group chat "${group.name}". ${taskHint}`
      : `\n\n${taskHint}`;
    const prompt = cliPrompt(
      member.name,
      member.title,
      `${member.description.trim()}${groupLine}`,
      userText,
    );
    const result = await runHarnessCli(settings, prompt);
    setLiveStatus(member.id, "idle", "Idle");
    if (result.ok && result.text.trim()) {
      await mirrorGroupReply(threadId, member.id, result.text, onEvent);
    }
  }
}

async function fanOutGroupCli(opts: {
  group: Bot;
  agent: Bot;
  threadId: string;
  settings: Settings;
  userText: string;
  onEvent: (e: AgentEvent) => void;
}): Promise<void> {
  const { group, agent, threadId, settings, userText, onEvent } = opts;
  const roster = await listBots();
  const byId = new Map(roster.map((b) => [b.id, b]));
  const others = (group.members ?? [])
    .filter((id) => id !== agent.id)
    .map((id) => byId.get(id))
    .filter((b): b is Bot => Boolean(b));
  await fanOutBotsCli({
    targets: others,
    group,
    threadId,
    settings,
    userText,
    taskHint: "Reply briefly in character to the user's latest message.",
    onEvent,
  });
}

async function runCliTurn(opts: {
  agent: Bot;
  threadId: string;
  group: Bot | null;
  settings: Settings;
  userText: string;
  onEvent: (e: AgentEvent) => void;
  fanOut?: boolean;
  rosterContext?: string;
  mentionContext?: string;
}): Promise<string> {
  const {
    agent,
    threadId,
    group,
    settings,
    userText,
    onEvent,
    fanOut = false,
    rosterContext = "",
    mentionContext = "",
  } = opts;
  setLiveStatus(agent.id, "working", "Working");
  await emit(onEvent, {
    type: "status",
    botId: threadId,
    status: "working",
    action: "Working",
  });
  const cliHarnessNote =
    "\n\nThis harness has no message_bot tool. Teammate names and statuses are listed above. When the user @mentions a teammate, acknowledge the assignment; their harness will reply separately in this thread.";
  const description = `${groupAgentDescription(agent, group, rosterContext)}${cliHarnessNote}`;
  const userBlock = mentionContext ? `${userText}\n\n[Coordination context]\n${mentionContext}` : userText;
  const prompt = cliPrompt(agent.name, agent.title, description, userBlock);
  const result = await runHarnessCli(settings, prompt);
  const content = result.text;
  const saved = await persistAssistant(threadId, content, result.ok ? "text" : "system", agent.id);
  await emit(onEvent, { type: "message", botId: threadId, message: saved });
  if (!result.ok) {
    await emit(onEvent, { type: "error", botId: threadId, error: result.text });
  } else if (fanOut) {
    const roster = await listBots();
    const mentioned = findMentionedBots(userText, roster, agent.id);
    if (mentioned.length) {
      await fanOutBotsCli({
        targets: mentioned,
        group,
        threadId,
        settings,
        userText,
        taskHint: "The user @mentioned you. Take the assignment and reply briefly in character.",
        onEvent,
      });
    } else if (group && shouldFanOutGroup(userText)) {
      await fanOutGroupCli({ group, agent, threadId, settings, userText, onEvent });
    }
  }
  setLiveStatus(agent.id, "idle", "Idle");
  await emit(onEvent, { type: "status", botId: threadId, status: "idle", action: "Idle" });
  await emit(onEvent, { type: "done", botId: threadId });
  return saved.content;
}

async function processToolCalls(
  ctx: LoopContext,
  messages: ChatCompletionMessageParam[],
  toolCalls: NonNullable<ChatCompletionMessage["tool_calls"]>,
  onEvent: (e: AgentEvent) => void,
): Promise<"continue" | "approval"> {
  const { agent, threadId, groupThreadId, settings, nest } = ctx;
  for (const call of toolCalls) {
    if (call.type !== "function") continue;
    const input = call.function.arguments ?? "{}";
    const output = await execTool(agent, settings, call.function.name, input, nest, onEvent, groupThreadId);
    await emit(onEvent, {
      type: "tool",
      botId: threadId,
      name: call.function.name,
      input,
      output: output.slice(0, 2000),
    });
    if (call.function.name === "message_bot" && !groupThreadId) {
      let label = "Asking teammate…";
      try {
        const parsed = JSON.parse(output) as { name?: string };
        if (parsed.name) label = `${parsed.name} replied`;
      } catch {
        /* keep default */
      }
      const handoff = await persistAssistant(threadId, label, "handoff", agent.id);
      await emit(onEvent, { type: "message", botId: threadId, message: handoff });
    }
    if (call.function.name === "run_shell") {
      try {
        const parsed = JSON.parse(output) as {
          needsApproval?: boolean;
          command?: string;
          args?: string[];
        };
        if (parsed.needsApproval) {
          pendingTurns.set(threadId, {
            ctx,
            messages: structuredClone(messages),
            pendingToolCallId: call.id,
          });
          const card = await persistAssistant(
            threadId,
            JSON.stringify({
              title: `Run \`${parsed.command ?? "command"}\` on this machine?`,
              body: "localExec is Ask every time. Allow once only covers this command.",
              command: parsed.command,
              args: parsed.args ?? [],
            }),
            "approval",
          );
          await emit(onEvent, { type: "message", botId: threadId, message: card });
          setLiveStatus(agent.id, "blocked", "Blocked");
          await emit(onEvent, {
            type: "status",
            botId: threadId,
            status: "blocked",
            action: "Blocked",
          });
          return "approval";
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
  return "continue";
}

type StreamedToolCall = NonNullable<ChatCompletionMessage["tool_calls"]>[number];

async function streamCompletionRound(
  openai: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  threadId: string,
  fromBotId: string,
  onEvent: (e: AgentEvent) => void,
): Promise<{ content: string; toolCalls: StreamedToolCall[] }> {
  const stream = await openai.chat.completions.create({
    model,
    messages,
    tools: TOOLS,
    tool_choice: "auto",
    stream: true,
  });

  let content = "";
  const toolCallsByIndex = new Map<number, { id: string; name: string; arguments: string }>();
  let toolCallStarted = false;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.tool_calls?.length) {
      if (!toolCallStarted) {
        toolCallStarted = true;
        await emit(onEvent, { type: "stream_clear", botId: threadId });
      }
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        let acc = toolCallsByIndex.get(idx);
        if (!acc) {
          acc = { id: "", name: "", arguments: "" };
          toolCallsByIndex.set(idx, acc);
        }
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        if (tc.function?.arguments) acc.arguments += tc.function.arguments;
      }
    }

    if (delta.content && !toolCallStarted) {
      content += delta.content;
      await emit(onEvent, {
        type: "delta",
        botId: threadId,
        text: delta.content,
        fromBotId,
      });
    }
  }

  const toolCalls: StreamedToolCall[] = [...toolCallsByIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    }))
    .filter((tc) => tc.id && tc.type === "function" && tc.function.name);

  return { content, toolCalls };
}

async function runAgentLoop(
  ctx: LoopContext,
  messages: ChatCompletionMessageParam[],
  onEvent: (e: AgentEvent) => void,
): Promise<string> {
  const { agent, threadId, settings, model } = ctx;
  const openai = clientFor(settings);
  let finalText = "";

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      setLiveStatus(agent.id, "working", "Working");
      await emit(onEvent, {
        type: "status",
        botId: threadId,
        status: "working",
        action: "Working",
      });

      const { content, toolCalls } = await streamCompletionRound(
        openai,
        model,
        messages,
        threadId,
        agent.id,
        onEvent,
      );

      if (toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: content || "",
          tool_calls: toolCalls,
        });
        const result = await processToolCalls(ctx, messages, toolCalls, onEvent);
        if (result === "approval") return "";
        continue;
      }

      finalText = stripThink(content.trim()) || "Done.";
      await emit(onEvent, { type: "stream_clear", botId: threadId });
      const saved = await persistAssistant(threadId, finalText, "text", agent.id);
      await emit(onEvent, { type: "message", botId: threadId, message: saved });
      break;
    }
  } catch (err) {
    await emit(onEvent, { type: "stream_clear", botId: threadId });
    const error = err instanceof Error ? err.message : String(err);
    const saved = await persistAssistant(threadId, `Model error: ${error}`, "system");
    await emit(onEvent, { type: "message", botId: threadId, message: saved });
    await emit(onEvent, { type: "error", botId: threadId, error });
  }

  return finalText;
}

export async function runTurn(opts: {
  botId: string;
  userText: string;
  nest?: number;
  onEvent?: (e: AgentEvent) => void;
  fromBotId?: string;
  groupThreadId?: string;
}): Promise<string> {
  const onEvent = opts.onEvent ?? (() => undefined);
  const nest = opts.nest ?? 0;
  const bot = await getBot(opts.botId);
  if (!bot) {
    await emit(onEvent, { type: "error", botId: opts.botId, error: "Unknown Bot" });
    return "";
  }

  let group: Bot | null = null;
  let agent = bot;
  let threadId = opts.groupThreadId ?? bot.id;
  if (bot.kind === "group" && nest === 0) {
    group = bot;
    threadId = bot.id;
    const routerId = bot.routerId ?? bot.members?.[0];
    const router = routerId ? await getBot(routerId) : undefined;
    if (!router) {
      await emit(onEvent, { type: "error", botId: bot.id, error: "Group has no router Bot" });
      return "";
    }
    agent = router;
  } else if (opts.groupThreadId) {
    const g = await getBot(opts.groupThreadId);
    if (g?.kind === "group") group = g;
  }

  const settings = await loadSettings();
  const harness = inferHarness(settings);
  const local =
    settings.baseUrl.includes("127.0.0.1") || settings.baseUrl.includes("localhost");
  const groupThreadId = group ? group.id : opts.groupThreadId;

  const input =
    nest === 0
      ? resolveRoutineInput(bot, opts.userText)
      : { display: opts.userText, modelText: opts.userText, kind: "handoff" as const };

  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: "user",
    content: input.kind === "routine" ? input.modelText : input.display,
    createdAt: new Date().toISOString(),
    kind: nest > 0 ? "handoff" : input.kind,
    fromBotId: opts.fromBotId,
    routineName: input.routineName,
  };
  if (nest === 0) {
    await appendMessage(threadId, userMsg);
    await emit(onEvent, { type: "message", botId: threadId, message: userMsg });
  } else {
    await appendMessage(agent.id, userMsg);
    await emit(onEvent, { type: "message", botId: agent.id, message: userMsg });
  }

  const rosterContext = nest === 0 ? await rosterBlock(agent.id, group) : "";
  const mentionContext = nest === 0 ? await mentionExtra(input.modelText, agent.id, group) : "";

  if (harness === "codex" || harness === "cursor" || harness === "dsh") {
    if (nest > 0) {
      return runCliTurn({
        agent,
        threadId: agent.id,
        group: null,
        settings,
        userText: input.modelText,
        onEvent,
        rosterContext,
      });
    }
    return runCliTurn({
      agent,
      threadId,
      group,
      settings,
      userText: input.modelText,
      onEvent,
      fanOut: true,
      rosterContext,
      mentionContext,
    });
  }

  if (!settings.apiKey && !local) {
    const msg = await persistAssistant(
      threadId,
      "No API key yet. Open Settings (⌘,) → Models and paste a key for your OpenAI-compatible endpoint.",
      "system",
    );
    await emit(onEvent, { type: "message", botId: threadId, message: msg });
    await emit(onEvent, { type: "error", botId: threadId, error: "Missing API key" });
    await emit(onEvent, { type: "done", botId: threadId });
    return msg.content;
  }

  setLiveStatus(agent.id, "thinking", "Thinking");
  await emit(onEvent, { type: "status", botId: threadId, status: "thinking", action: "Thinking" });

  const model = nest > 0 && settings.subagentModel ? settings.subagentModel : settings.model;
  const history = await loadTranscript(nest === 0 ? threadId : agent.id);
  const usable = history.filter((m) => m.role === "user" || m.role === "assistant");
  const extra = mentionContext;
  const messages = toOpenAI(usable, systemPrompt(agent, settings, extra, group, rosterContext));
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      messages[i] = { ...messages[i], content: input.modelText };
      break;
    }
  }

  const ctx: LoopContext = {
    agent,
    threadId,
    group,
    groupThreadId,
    settings,
    model,
    nest,
  };
  const finalText = await runAgentLoop(ctx, messages, onEvent);

  if (pendingTurns.has(threadId)) {
    await emit(onEvent, { type: "done", botId: threadId });
    return "";
  }

  setLiveStatus(agent.id, "idle", "Idle");
  await emit(onEvent, { type: "status", botId: threadId, status: "idle", action: "Idle" });
  await emit(onEvent, { type: "done", botId: threadId });
  return finalText;
}
