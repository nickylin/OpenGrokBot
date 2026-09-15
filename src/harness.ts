import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { assertNever, type HarnessId, type Settings } from "./types.js";
import { expandHome } from "./paths.js";

export type HarnessInstall = {
  npm?: string;
  command: string;
  docs?: string;
  hint: string;
};

export type HarnessInfo = {
  id: HarnessId;
  label: string;
  blurb: string;
  kind: "http" | "cli";
  installed: boolean;
  ready: boolean;
  binary?: string;
  version?: string;
  install: HarnessInstall;
};

export class HarnessSwitchError extends Error {
  readonly harness: HarnessInfo;
  constructor(harness: HarnessInfo) {
    super(`${harness.label} is not installed on this machine.`);
    this.name = "HarnessSwitchError";
    this.harness = harness;
  }
}

const HARNESS_IDS: HarnessId[] = ["openai-compatible", "ollama", "codex", "cursor", "dsh"];

export function parseHarnessId(value: unknown): HarnessId | undefined {
  if (typeof value !== "string") return undefined;
  return HARNESS_IDS.find((id) => id === value);
}

function extraBinDirs(): string[] {
  return [
    join(homedir(), ".local", "bin"),
    join(homedir(), ".cursor", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
}

function realPath(bin: string): string {
  try {
    return realpathSync(bin);
  } catch {
    return bin;
  }
}

function isWebpackishPath(bin: string): boolean {
  const real = realPath(bin);
  return /Caskroom\/cursor-cli/i.test(real) || /dist-package\/index\.js$/i.test(real);
}

export function looksLikeJsDump(text: string): boolean {
  const s = String(text ?? "").slice(0, 8_000);
  if (/try\s*\{\s*!function/.test(s)) return true;
  if (/__webpack_require__|webpackBootstrap|webpackJsonp/.test(s)) return true;
  if (/dist-package\/index\.js:\d+/.test(s)) return true;
  if (/index\.js:\d+/.test(s) && /try\s*\{\s*!function/.test(s)) return true;
  if (/\/usr\/local\/Caskroom/.test(s)) return true;
  return false;
}

function looksLikeInternalDump(text: string): boolean {
  const s = String(text ?? "");
  if (looksLikeJsDump(s)) return true;
  if (/\/usr\/local\/Caskroom/.test(s)) return true;
  if (/dist-package\/index\.js/.test(s)) return true;
  if (/\bat\s+\S+\s+\([^)]+:\d+:\d+\)/.test(s)) return true;
  if (/node_modules\//.test(s) && /\bat\s+/.test(s)) return true;
  if (/protobuf|PROTOBUF/.test(s) && s.length > 80) return true;
  if (/sentry/i.test(s) && /index\.js/.test(s)) return true;
  return false;
}

function looksLikeAuthError(text: string): boolean {
  return /not logged in|unauthoriz|authentication|auth(?:entication)? (?:error|failed|required)|please log in|not authenticated|\b401\b|CURSOR_API_KEY|invalid api key|api key (?:missing|invalid|required)/i.test(
    text,
  );
}

function harnessFailureCopy(id: HarnessId): string {
  switch (id) {
    case "cursor":
      return "Cursor couldn’t run this turn. Check Harness, or switch engine.";
    case "codex":
      return "Codex couldn’t run this turn. Check Harness, or switch engine.";
    case "dsh":
      return "DeepSeek Harness couldn’t run this turn. Check Harness, or switch engine.";
    case "openai-compatible":
      return "This engine couldn’t run this turn. Check Settings → Models.";
    case "ollama":
      return "Ollama couldn’t run this turn. Check that it’s running, or switch engine.";
    default:
      return assertNever(id, "HarnessId");
  }
}

function harnessAuthCopy(id: HarnessId): string | undefined {
  switch (id) {
    case "cursor":
      return "Cursor Agent needs login (`cursor-agent login` or CURSOR_API_KEY).";
    case "codex":
      return "Codex needs login (`codex login`).";
    case "dsh":
      return "DeepSeek Harness needs a valid API key. Open Settings → Models.";
    case "openai-compatible":
    case "ollama":
      return undefined;
    default:
      return assertNever(id, "HarnessId");
  }
}

function harnessMissingCopy(id: HarnessId): string {
  switch (id) {
    case "cursor":
      return "Cursor Agent isn’t installed. Open Settings → Harness.";
    case "codex":
      return "Codex isn’t installed. Open Settings → Harness.";
    case "dsh":
      return "DeepSeek Harness isn’t installed. Open Settings → Harness.";
    case "openai-compatible":
    case "ollama":
      return harnessFailureCopy(id);
    default:
      return assertNever(id, "HarnessId");
  }
}

export function sanitizeHarnessOutput(
  id: HarnessId,
  raw: string,
  opts: { ok: boolean },
): { ok: boolean; text: string } {
  const text = String(raw ?? "").trim();
  if (looksLikeInternalDump(text)) {
    if (looksLikeAuthError(text)) {
      return { ok: false, text: harnessAuthCopy(id) ?? harnessFailureCopy(id) };
    }
    return { ok: false, text: harnessFailureCopy(id) };
  }
  if (!opts.ok) {
    if (looksLikeAuthError(text)) {
      return { ok: false, text: harnessAuthCopy(id) ?? harnessFailureCopy(id) };
    }
    if (!text || text.length > 240) return { ok: false, text: harnessFailureCopy(id) };
    return { ok: false, text };
  }
  return { ok: true, text: text || "Done." };
}

async function binaryLooksLikeWebpackDump(bin: string): Promise<boolean> {
  if (isWebpackishPath(bin)) return true;
  const help = await runCapture(bin, ["--help"], { timeoutMs: 2_500 });
  return looksLikeJsDump(`${help.stdout}\n${help.stderr}`);
}

async function findBin(names: string[], opts: { rejectWebpack?: boolean } = {}): Promise<string | undefined> {
  const pathDirs = (process.env.PATH ?? "").split(delimiter);
  const dirs = [...extraBinDirs(), ...pathDirs];
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const name of names) {
    if (name.includes("/")) {
      candidates.push(name);
      continue;
    }
    for (const dir of dirs) {
      if (!dir) continue;
      candidates.push(join(dir, name));
    }
  }
  for (const candidate of candidates) {
    if (seen.has(candidate) || !existsSync(candidate)) continue;
    seen.add(candidate);
    if (isWebpackishPath(candidate)) continue;
    if (opts.rejectWebpack && (await binaryLooksLikeWebpackDump(candidate))) continue;
    return candidate;
  }
  return undefined;
}

function runCapture(
  bin: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        PATH: `${dirname(bin)}${delimiter}${process.env.PATH ?? ""}`,
        ...opts.env,
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? 8_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 400_000) stdout = stdout.slice(-200_000);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 80_000) stderr = stderr.slice(-40_000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function probeVersion(bin: string, args: string[]): Promise<string | undefined> {
  const res = await runCapture(bin, args, { timeoutMs: 3_000 });
  const line = (res.stdout || res.stderr).trim().split("\n")[0]?.trim();
  if (!line || line.length > 120) return undefined;
  return line.replace(/^v/i, "").trim();
}

function catalog(): Record<
  HarnessId,
  { label: string; blurb: string; kind: "http" | "cli"; bins: string[]; versionArgs: string[]; install: HarnessInstall }
> {
  return {
    "openai-compatible": {
      label: "OpenAI-compatible API",
      blurb: "Cloud or local HTTP. DeepSeek, OpenRouter, MiniMax, vLLM, anything with /v1.",
      kind: "http",
      bins: [],
      versionArgs: [],
      install: {
        command: "",
        hint: "No extra install. Paste Base URL and API key in Models.",
      },
    },
    ollama: {
      label: "Ollama",
      blurb: "Local models on this machine. Uses the OpenAI-compatible /v1 endpoint.",
      kind: "http",
      bins: ["ollama"],
      versionArgs: ["--version"],
      install: {
        command: "brew install ollama",
        docs: "https://ollama.com/download",
        hint: "Ollama is an app, not an npm package. Install it, then pull a model (ollama pull llama3.2).",
      },
    },
    codex: {
      label: "Codex CLI",
      blurb: "OpenAI Codex on this machine. Uses the login you already did in the CLI.",
      kind: "cli",
      bins: ["codex"],
      versionArgs: ["--version"],
      install: {
        npm: "@openai/codex",
        command: "npm install -g @openai/codex",
        docs: "https://github.com/openai/codex",
        hint: "Then run `codex login` once if this machine is not signed in yet.",
      },
    },
    cursor: {
      label: "Cursor Agent",
      blurb: "The Cursor CLI agent (`cursor-agent`), using the account already logged in on this Mac.",
      kind: "cli",
      bins: [join(homedir(), ".local", "bin", "cursor-agent"), "cursor-agent"],
      versionArgs: [],
      install: {
        npm: "@cursor/sdk",
        command: "curl https://cursor.com/install -fsS | bash",
        docs: "https://cursor.com/docs/cli/overview",
        hint: "The runnable CLI is `cursor-agent` (install script, not npm). Optional SDK: npm install -g @cursor/sdk. Then `agent login` if needed.",
      },
    },
    dsh: {
      label: "DeepSeek Harness",
      blurb: "Official dsh profile. One-shot headless runs in the shared workspace.",
      kind: "cli",
      bins: ["dsh"],
      versionArgs: ["-V"],
      install: {
        npm: "@deepseek-ai/dsh",
        command: "npm install -g @deepseek-ai/dsh",
        docs: "https://www.npmjs.com/package/@deepseek-ai/dsh",
        hint: "Needs Node 22.19+ or 24+. After install, `dsh --profile headless \"ping\"` should print a reply.",
      },
    },
  };
}

export async function inspectHarness(id: HarnessId): Promise<HarnessInfo> {
  const meta = catalog()[id];
  if (id === "openai-compatible") {
    return {
      id,
      label: meta.label,
      blurb: meta.blurb,
      kind: meta.kind,
      installed: true,
      ready: true,
      install: meta.install,
    };
  }
  const binary = await findBin(meta.bins, { rejectWebpack: id === "cursor" });
  const version =
    binary && meta.versionArgs.length > 0 ? await probeVersion(binary, meta.versionArgs) : undefined;
  let installed = Boolean(binary);
  if (id === "ollama" && !installed) {
    installed = await ollamaHttpUp();
  }
  return {
    id,
    label: meta.label,
    blurb: meta.blurb,
    kind: meta.kind,
    installed,
    ready: installed,
    binary,
    version,
    install: meta.install,
  };
}

async function ollamaHttpUp(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listHarnesses(): Promise<HarnessInfo[]> {
  const out: HarnessInfo[] = [];
  for (const id of HARNESS_IDS) {
    out.push(await inspectHarness(id));
  }
  return out;
}

export function inferHarness(settings: Settings): HarnessId {
  if (parseHarnessId(settings.harness)) return settings.harness;
  const url = settings.baseUrl ?? "";
  if (url.includes("11434") || settings.provider === "ollama") return "ollama";
  return "openai-compatible";
}

export function patchForHarness(id: HarnessId, current: Settings): Partial<Settings> {
  const patch: Partial<Settings> = { harness: id };
  switch (id) {
    case "openai-compatible":
      patch.provider = current.provider === "ollama" ? "openai-compatible" : current.provider;
      return patch;
    case "ollama":
      patch.provider = "ollama";
      patch.baseUrl = "http://127.0.0.1:11434/v1";
      if (!current.model || current.model === "deepseek-chat") patch.model = "llama3.2";
      if (!current.subagentModel || current.subagentModel === "deepseek-chat") {
        patch.subagentModel = patch.model ?? "llama3.2";
      }
      return patch;
    case "codex":
    case "cursor":
    case "dsh":
      return patch;
    default:
      return assertNever(id, "HarnessId");
  }
}

export async function requireHarness(id: HarnessId): Promise<HarnessInfo> {
  const info = await inspectHarness(id);
  if (!info.ready) throw new HarnessSwitchError(info);
  return info;
}

export function cliPrompt(botName: string, botTitle: string, description: string, userText: string): string {
  return [
    `You are ${botName}, ${botTitle}.`,
    description.trim(),
    "You are running as this Bot's harness on the user's machine.",
    "Work in the current directory. Reply with the finished answer for the user.",
    "Do not claim you emailed, posted, or paid unless that actually happened.",
    "",
    "User:",
    userText,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export async function runHarnessCli(
  settings: Settings,
  prompt: string,
): Promise<{ ok: boolean; text: string }> {
  const id = inferHarness(settings);
  const info = await inspectHarness(id);
  if (info.kind !== "cli") {
    return { ok: false, text: harnessFailureCopy(id) };
  }
  if (!info.binary) {
    return { ok: false, text: harnessMissingCopy(id) };
  }
  const cwd = expandHome(settings.workspace);
  const timeoutMs = 180_000;
  const env: NodeJS.ProcessEnv = {};
  if (settings.apiKey) {
    env.MINIMAX_CN_API_KEY = settings.apiKey;
    env.MINIMAX_API_KEY = settings.apiKey;
    env.DEEPSEEK_API_KEY = settings.apiKey;
  }
  let args: string[] = [];
  switch (id) {
    case "codex":
      args = [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "-C",
        cwd,
        prompt,
      ];
      break;
    case "cursor":
      args = ["-p", "--trust", "--mode", "ask", "--workspace", cwd, prompt];
      break;
    case "dsh":
      args = ["--profile", settings.dshProfile || "headless", prompt];
      break;
    case "openai-compatible":
    case "ollama":
      return { ok: false, text: "HTTP harness should not call runHarnessCli." };
    default:
      return assertNever(id, "HarnessId");
  }
  const res = await runCapture(info.binary, args, { cwd, timeoutMs, env });
  if (looksLikeInternalDump(res.stdout) || looksLikeInternalDump(res.stderr)) {
    return sanitizeHarnessOutput(id, `${res.stdout}\n${res.stderr}`, { ok: false });
  }
  const raw = (res.stdout.trim() || res.stderr.trim()).slice(0, 16_000);
  return sanitizeHarnessOutput(id, raw, { ok: res.code === 0 });
}

export async function testHarness(settings: Settings): Promise<{ ok: boolean; error?: string; model?: string }> {
  const id = inferHarness(settings);
  const info = await inspectHarness(id);
  switch (id) {
    case "openai-compatible":
    case "ollama":
      return { ok: info.ready, error: info.ready ? undefined : info.install.hint, model: settings.model };
    case "codex":
    case "cursor":
    case "dsh":
      if (!info.ready) {
        return { ok: false, error: `${info.label} is missing. ${info.install.command}`.trim() };
      }
      return { ok: true, model: info.version || info.label };
    default:
      return assertNever(id, "HarnessId");
  }
}
