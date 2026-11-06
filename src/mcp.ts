import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { homeDir, ensureHome } from "./paths.js";
import { substituteSecretsInEnv } from "./secrets.js";
import type { McpServerConfig, McpServerStatus } from "./types.js";

/**
 * Minimal MCP client (stdio transport) — v0.4.
 *
 * Servers are declared in ~/.opengrokbot/mcp.json:
 *   { "servers": [{ "name": "fs", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"], "env": { "API_KEY": "${secret:my.key}" } }] }
 *
 * Each server is spawned lazily on first use, speaks newline-delimited
 * JSON-RPC, and its tools are exposed to the model as mcp_<server>_<tool>.
 * Env values may use ${secret:name}; substitution happens at spawn time on
 * this machine, and tool results are masked by the caller (agent.ts) before
 * the model sees them.
 */

const PROTOCOL_VERSION = "2024-11-05";
const CALL_TIMEOUT_MS = 60_000;
const START_BUDGET_MS = 10_000;

function configPath(): string {
  return join(homeDir(), "mcp.json");
}

export async function loadMcpConfig(): Promise<McpServerConfig[]> {
  await ensureHome();
  if (!existsSync(configPath())) return [];
  try {
    const raw = JSON.parse(await readFile(configPath(), "utf8")) as { servers?: unknown };
    const servers = Array.isArray(raw.servers) ? raw.servers : [];
    return servers
      .map((s) => {
        const rec = (s ?? {}) as Record<string, unknown>;
        return {
          name: String(rec.name ?? "").trim(),
          command: String(rec.command ?? "").trim(),
          args: Array.isArray(rec.args) ? rec.args.map(String) : [],
          env:
            rec.env && typeof rec.env === "object"
              ? Object.fromEntries(
                  Object.entries(rec.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
                )
              : {},
          enabled: rec.enabled !== false,
        } satisfies McpServerConfig;
      })
      .filter((s) => s.name && s.command);
  } catch {
    return [];
  }
}

export async function saveMcpConfig(servers: McpServerConfig[]): Promise<void> {
  await ensureHome();
  await writeFile(configPath(), JSON.stringify({ servers }, null, 2));
}

type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
};

class McpConnection {
  state: "stopped" | "starting" | "ready" | "error" = "stopped";
  error?: string;
  tools: McpTool[] = [];
  private proc?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private bufferReady?: Promise<void>;

  constructor(private config: McpServerConfig) {}

  async start(): Promise<void> {
    if (this.state === "ready" || this.state === "starting") return this.bufferReady;
    this.state = "starting";
    this.error = undefined;
    this.bufferReady = this.doStart();
    return this.bufferReady;
  }

  private async doStart(): Promise<void> {
    const { env, missing } = await substituteSecretsInEnv(this.config.env ?? {});
    if (missing.length > 0) {
      console.warn(`[mcp:${this.config.name}] env entries dropped, missing secrets: ${missing.join(", ")}`);
    }
    const proc = spawn(this.config.command, this.config.args ?? [], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc = proc;
    proc.on("error", (err) => this.failAll(err));
    proc.on("exit", (code) => {
      if (this.state !== "stopped") {
        this.state = "error";
        this.error = `server exited (code ${code ?? "?"})`;
      }
      this.failAll(new Error(`mcp server ${this.config.name} exited`));
    });
    proc.stderr.on("data", () => undefined); // drain; never log env-bearing output

    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message ?? "mcp error"));
        else p.resolve(msg.result);
      }
      // Server-initiated requests/notifications are ignored in v0.4.
    });

    try {
      await this.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "opengrokbot", version: "0.4.0" },
      });
      this.notify("notifications/initialized", {});
      const listed = (await this.request("tools/list", {})) as { tools?: McpTool[] };
      this.tools = Array.isArray(listed.tools) ? listed.tools : [];
      this.state = "ready";
    } catch (err) {
      this.state = "error";
      this.error = err instanceof Error ? err.message : String(err);
      this.stop();
      throw err;
    }
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const proc = this.proc;
    if (!proc) return Promise.reject(new Error("mcp server not started"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mcp ${method} timed out`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  private notify(method: string, params: unknown): void {
    this.proc?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    const parts = (result.content ?? []).map((c) => {
      if (c.type === "text") return c.text ?? "";
      return `[${c.type ?? "content"} omitted]`;
    });
    const text = parts.join("\n").slice(0, 8000);
    if (result.isError) return JSON.stringify({ error: text || "mcp tool error" });
    return text || "(empty result)";
  }

  stop(): void {
    this.state = "stopped";
    this.failAll(new Error("mcp server stopped"));
    try {
      this.proc?.kill();
    } catch {
      /* already gone */
    }
    this.proc = undefined;
    this.tools = [];
  }
}

function sanitize(part: string): string {
  return part.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function mcpToolName(server: string, tool: string): string {
  return `mcp_${sanitize(server)}_${sanitize(tool)}`.slice(0, 64);
}

type ManagedServer = {
  config: McpServerConfig;
  conn: McpConnection;
};

class McpManager {
  private servers = new Map<string, ManagedServer>();
  private toolRoutes = new Map<string, { server: string; tool: string }>();
  private loaded = false;

  async sync(): Promise<void> {
    const configs = await loadMcpConfig();
    const wanted = new Map(configs.map((c) => [c.name, c]));
    for (const [name, managed] of this.servers) {
      const next = wanted.get(name);
      if (!next || JSON.stringify(next) !== JSON.stringify(managed.config)) {
        managed.conn.stop();
        this.servers.delete(name);
      }
    }
    for (const [name, config] of wanted) {
      if (!this.servers.has(name)) {
        this.servers.set(name, { config, conn: new McpConnection(config) });
      }
    }
    this.loaded = true;
    this.rebuildRoutes();
  }

  private rebuildRoutes(): void {
    this.toolRoutes.clear();
    for (const [name, managed] of this.servers) {
      for (const tool of managed.conn.tools) {
        this.toolRoutes.set(mcpToolName(name, tool.name), { server: name, tool: tool.name });
      }
    }
  }

  /** Start every enabled server (bounded), then return OpenAI tool defs for all ready servers. */
  async getToolDefs(): Promise<ChatCompletionTool[]> {
    if (!this.loaded) await this.sync();
    const starts = [...this.servers.values()]
      .filter((m) => m.config.enabled !== false && m.conn.state !== "ready")
      .map((m) =>
        Promise.race([
          m.conn.start().catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, START_BUDGET_MS)),
        ]),
      );
    if (starts.length) await Promise.all(starts);
    this.rebuildRoutes();
    const defs: ChatCompletionTool[] = [];
    for (const [name, managed] of this.servers) {
      if (managed.config.enabled === false || managed.conn.state !== "ready") continue;
      for (const tool of managed.conn.tools) {
        defs.push({
          type: "function",
          function: {
            name: mcpToolName(name, tool.name),
            description: `[MCP:${name}] ${tool.description ?? tool.name}`.slice(0, 500),
            parameters: (tool.inputSchema as Record<string, unknown>) ?? {
              type: "object",
              properties: {},
            },
          },
        });
      }
    }
    return defs;
  }

  hasTool(name: string): boolean {
    return this.toolRoutes.has(name);
  }

  async callTool(publicName: string, args: Record<string, unknown>): Promise<string> {
    const route = this.toolRoutes.get(publicName);
    if (!route) return JSON.stringify({ error: `unknown MCP tool ${publicName}` });
    const managed = this.servers.get(route.server);
    if (!managed) return JSON.stringify({ error: `MCP server ${route.server} is gone` });
    if (managed.conn.state !== "ready") {
      await managed.conn.start().catch(() => undefined);
    }
    if (managed.conn.state !== "ready") {
      return JSON.stringify({
        error: `MCP server ${route.server} is not ready${managed.conn.error ? `: ${managed.conn.error}` : ""}`,
      });
    }
    return managed.conn.callTool(route.tool, args);
  }

  async statuses(): Promise<McpServerStatus[]> {
    if (!this.loaded) await this.sync();
    this.rebuildRoutes();
    return [...this.servers.values()].map((m) => ({
      name: m.config.name,
      command: [m.config.command, ...(m.config.args ?? [])].join(" "),
      enabled: m.config.enabled !== false,
      state: m.conn.state,
      toolCount: m.conn.tools.length,
      tools: m.conn.tools.map((t) => t.name),
      error: m.conn.error,
    }));
  }

  async upsertServer(config: McpServerConfig): Promise<void> {
    const servers = await loadMcpConfig();
    const idx = servers.findIndex((s) => s.name === config.name);
    if (idx >= 0) servers[idx] = config;
    else servers.push(config);
    await saveMcpConfig(servers);
    await this.sync();
  }

  async deleteServer(name: string): Promise<boolean> {
    const servers = await loadMcpConfig();
    const next = servers.filter((s) => s.name !== name);
    if (next.length === servers.length) return false;
    await saveMcpConfig(next);
    await this.sync();
    return true;
  }

  async restartServer(name: string): Promise<boolean> {
    const managed = this.servers.get(name);
    if (!managed) return false;
    managed.conn.stop();
    this.servers.set(name, { config: managed.config, conn: new McpConnection(managed.config) });
    await this.servers.get(name)!.conn.start().catch(() => undefined);
    this.rebuildRoutes();
    return true;
  }
}

export const mcpManager = new McpManager();
