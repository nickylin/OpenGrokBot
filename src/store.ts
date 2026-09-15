import { mkdir, readdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { randomUUID } from "node:crypto";
import {
  type ApprovalDecision,
  type Bot,
  type BotKind,
  type BotStatus,
  type ChatMessage,
  type Settings,
} from "./types.js";
import { ensureHome, expandHome, homeDir, SEED_BOTS_DIR } from "./paths.js";

const PALETTE = ["#5EC8B5", "#F5A54A", "#4A6FA5", "#8B6CF7", "#3D8BFF", "#E07A3D", "#c9a227"];

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function defaultProfileName(): string {
  try {
    const raw = userInfo().username || "You";
    const base = raw.split(/[._-]/)[0] || raw;
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return "You";
  }
}

export const DEFAULT_SETTINGS: Settings = {
  provider: "openai-compatible",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-chat",
  subagentModel: "deepseek-chat",
  reviewModel: "",
  workspace: "~/.opengrokbot/workspace",
  memoryDir: "~/.opengrokbot/memory",
  dshProfile: "headless",
  browserProfile: "~/.opengrokbot/chrome-profile",
  localExec: "ask",
  timezone: defaultTimezone(),
  scheduler: "on",
  appearance: "dark",
  autoReview: "on",
  requireSend: "on",
  profileName: "You",
  profileColor: "#E8B86D",
};

const live = new Map<string, { status: BotStatus; action: string }>();

export function setLiveStatus(botId: string, status: BotStatus, action: string): void {
  if (status === "idle" || status === "done") {
    live.delete(botId);
    return;
  }
  live.set(botId, { status, action });
}

export function getLiveStatus(botId: string): { status: BotStatus; action: string } {
  return live.get(botId) ?? { status: "idle", action: "Idle" };
}

function settingsPath(): string {
  return join(homeDir(), "settings.json");
}

function botsDir(): string {
  return join(homeDir(), "bots");
}

function transcriptPath(botId: string): string {
  return join(homeDir(), "transcripts", `${botId}.json`);
}

export async function loadSettings(): Promise<Settings> {
  await ensureHome();
  if (!existsSync(settingsPath())) {
    return { ...DEFAULT_SETTINGS, profileName: defaultProfileName() };
  }
  const raw = JSON.parse(await readFile(settingsPath(), "utf8")) as Partial<Settings>;
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  if (typeof raw.profileName !== "string" || !raw.profileName.trim()) {
    merged.profileName = defaultProfileName();
  }
  return merged;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await writeFile(settingsPath(), JSON.stringify(next, null, 2));
  await mkdir(expandHome(next.workspace), { recursive: true });
  await mkdir(expandHome(next.memoryDir), { recursive: true });
  return next;
}

function asKind(value: unknown): BotKind {
  if (value === "bot" || value === "group") return value;
  return "bot";
}

function parseBot(raw: unknown, fallbackId: string): Bot {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const routinesRaw = Array.isArray(rec.routines) ? rec.routines : [];
  return {
    id: String(rec.id ?? fallbackId),
    name: String(rec.name ?? fallbackId),
    title: String(rec.title ?? rec.name ?? fallbackId),
    color: String(rec.color ?? PALETTE[0]),
    description: String(rec.description ?? ""),
    kind: asKind(rec.kind),
    members: Array.isArray(rec.members) ? rec.members.map(String) : undefined,
    routerId: rec.routerId ? String(rec.routerId) : undefined,
    routines: routinesRaw.map((item, i) => {
      const r = item as Record<string, unknown>;
      return {
        id: String(r.id ?? `rt-${i}`),
        name: String(r.name ?? "Routine"),
        schedule: String(r.schedule ?? ""),
        prompt: String(r.prompt ?? ""),
        enabled: r.enabled !== false,
      };
    }),
  };
}

export async function seedIfNeeded(): Promise<void> {
  await ensureHome();
  const dir = botsDir();
  const existing = (await readdir(dir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (existing.length > 0) return;
  if (!existsSync(SEED_BOTS_DIR)) return;
  const seeds = (await readdir(SEED_BOTS_DIR)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const file of seeds) {
    await copyFile(join(SEED_BOTS_DIR, file), join(dir, file));
  }
  const settings = await loadSettings();
  await mkdir(expandHome(settings.workspace), { recursive: true });
  await mkdir(expandHome(settings.memoryDir), { recursive: true });
  const seeded = await listBots();
  for (const bot of seeded) {
    const existing = await loadTranscript(bot.id);
    if (existing.length > 0) continue;
    const hello =
      bot.kind === "group"
        ? `Group · ${(bot.members ?? []).join(", ")} · ready when you are.`
        : `Hey — I'm ${bot.name}. ${bot.title}. What do you want me around for?`;
    await appendMessage(bot.id, {
      id: randomUUID(),
      role: "assistant",
      content: hello,
      createdAt: new Date().toISOString(),
      kind: bot.kind === "group" ? "system" : "text",
    });
  }
}

export async function listBots(): Promise<Bot[]> {
  await seedIfNeeded();
  const files = (await readdir(botsDir())).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const bots: Bot[] = [];
  for (const file of files) {
    const raw = parse(await readFile(join(botsDir(), file), "utf8"));
    bots.push(parseBot(raw, file.replace(/\.ya?ml$/, "")));
  }
  const order = ["chief", "sales", "inbox", "acct", "talent", "exp", "crew"];
  bots.sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    if (ia === -1 && ib === -1) return a.name.localeCompare(b.name);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return bots;
}

export async function getBot(id: string): Promise<Bot | undefined> {
  return (await listBots()).find((b) => b.id === id);
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `bot-${Date.now()}`;
}

export async function createBot(input: {
  name: string;
  title: string;
  description: string;
  color?: string;
}): Promise<Bot> {
  const bots = await listBots();
  let id = slugify(input.name);
  if (bots.some((b) => b.id === id)) id = `${id}-${Date.now().toString(36)}`;
  const bot: Bot = {
    id,
    name: input.name.trim() || "Bot",
    title: input.title.trim() || input.name.trim() || "Bot",
    color: input.color ?? PALETTE[bots.length % PALETTE.length],
    description: input.description.trim(),
    kind: "bot",
    routines: [],
  };
  await writeFile(join(botsDir(), `${id}.yaml`), stringify(bot));
  await appendMessage(id, {
    id: randomUUID(),
    role: "assistant",
    content: `Hey — I'm ${bot.name}. ${bot.title}. What do you want me around for?`,
    createdAt: new Date().toISOString(),
    kind: "text",
  });
  return bot;
}

export async function loadTranscript(botId: string): Promise<ChatMessage[]> {
  const path = transcriptPath(botId);
  if (!existsSync(path)) return [];
  const raw = JSON.parse(await readFile(path, "utf8")) as ChatMessage[];
  return Array.isArray(raw) ? raw : [];
}

export async function saveTranscript(botId: string, messages: ChatMessage[]): Promise<void> {
  await writeFile(transcriptPath(botId), JSON.stringify(messages, null, 2));
}

export async function appendMessage(botId: string, message: ChatMessage): Promise<ChatMessage> {
  const messages = await loadTranscript(botId);
  messages.push(message);
  await saveTranscript(botId, messages);
  return message;
}

export async function resolveApproval(
  botId: string,
  decision: ApprovalDecision,
  messageId?: string,
): Promise<{ message: ChatMessage; fresh: boolean } | undefined> {
  const messages = await loadTranscript(botId);
  let idx = -1;
  if (messageId) idx = messages.findIndex((m) => m.id === messageId && m.kind === "approval");
  if (idx < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].kind === "approval") {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) return undefined;
  if (messages[idx].decision) return { message: messages[idx], fresh: false };
  messages[idx] = { ...messages[idx], decision };
  await saveTranscript(botId, messages);
  return { message: messages[idx], fresh: true };
}

function relativeTime(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 45_000) return "Now";
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m`;
  if (diff < 86_400_000) return `${Math.max(1, Math.round(diff / 3_600_000))}h`;
  if (diff < 172_800_000) return "Yesterday";
  return new Date(iso).toLocaleDateString();
}

function previewOf(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "system" || m.role === "tool") continue;
    const text = m.content.replace(/\s+/g, " ").trim();
    if (!text) continue;
    return text.slice(0, 72);
  }
  return "No messages yet";
}

export type RosterItem = Bot & {
  status: BotStatus;
  action: string;
  preview: string;
  time: string;
  memberColors: string[];
};

export async function listRoster(): Promise<RosterItem[]> {
  const bots = await listBots();
  const byId = new Map(bots.map((b) => [b.id, b]));
  const items: RosterItem[] = [];
  for (const bot of bots) {
    const messages = await loadTranscript(bot.id);
    const last = [...messages].reverse().find((m) => m.role !== "tool");
    const liveStatus = getLiveStatus(bot.id);
    const memberColors = (bot.members ?? [])
      .map((id) => byId.get(id)?.color)
      .filter((c): c is string => Boolean(c));
    items.push({
      ...bot,
      status: liveStatus.status,
      action: liveStatus.action,
      preview: previewOf(messages),
      time: relativeTime(last?.createdAt),
      memberColors: memberColors.length ? memberColors : [bot.color],
    });
  }
  return items;
}

export async function memoryFile(botId: string): Promise<string> {
  const settings = await loadSettings();
  const dir = join(expandHome(settings.memoryDir), botId);
  await mkdir(dir, { recursive: true });
  return join(dir, "MEMORY.md");
}

export async function readMemory(botId: string): Promise<string> {
  const file = await memoryFile(botId);
  if (!existsSync(file)) return "";
  return readFile(file, "utf8");
}

export async function writeMemory(botId: string, content: string): Promise<void> {
  await writeFile(await memoryFile(botId), content);
}
