import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { PUBLIC_DIR } from "./paths.js";
import { fulfillApproval, fulfillForm, fulfillFormCancel, runTurn, testConnection } from "./agent.js";
import {
  clearRoster,
  createBot,
  deleteSecret,
  expirePendingForms,
  getBot,
  importBotMemory,
  listRoster,
  listRoutineRuns,
  listSecretStatuses,
  loadSettings,
  loadTranscript,
  resetRosterToSeed,
  saveBot,
  saveSettings,
} from "./store.js";
import { deleteSkill, listSkills, saveSkill } from "./skills.js";
import { loadMcpConfig, mcpManager } from "./mcp.js";
import { randomBytes } from "node:crypto";
import type { McpServerConfig } from "./types.js";
import { SECRET_NAME_RE } from "./forms.js";
import {
  HarnessSwitchError,
  inferHarness,
  listHarnesses,
  parseHarnessId,
  patchForHarness,
  requireHarness,
} from "./harness.js";
import type { AgentEvent, Settings } from "./types.js";

const PORT = Number(process.env.OPENGROKBOT_PORT ?? 3088);
const HOST = process.env.OPENGROKBOT_HOST ?? "127.0.0.1";

function sseWrite(reply: { raw: { write: (chunk: string) => boolean } }, event: AgentEvent): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

export async function startServer(): Promise<void> {
  const app = Fastify({
    logger: {
      level: "info",
      // Secret form values travel through POST /api/bots/:id/forms. Request
      // bodies are not logged by default, and credentials headers are
      // redacted here as a second line of defense.
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-webhook-token']",
        "res.headers['set-cookie']",
      ],
    },
  });
  await app.register(cors, { origin: true });

  const expiredForms = await expirePendingForms().catch(() => 0);
  if (expiredForms > 0) app.log.info(`expired ${expiredForms} pending form card(s) from a previous run`);

  app.get("/api/health", async () => ({
    ok: true,
    desktop: process.env.OPENGROKBOT_DESKTOP === "1",
  }));

  app.get("/api/settings", async () => loadSettings());

  app.put<{ Body: Partial<Settings> }>("/api/settings", async (req) => {
    const body = req.body ?? {};
    const current = await loadSettings();
    return saveSettings({ ...current, ...body });
  });

  app.post("/api/settings/test", async () => {
    const settings = await loadSettings();
    return testConnection(settings);
  });

  app.get("/api/harnesses", async () => {
    const settings = await loadSettings();
    return { active: inferHarness(settings), harnesses: await listHarnesses() };
  });

  app.post<{ Body: { id?: string } }>("/api/harnesses/switch", async (req, reply) => {
    const id = parseHarnessId(req.body?.id);
    if (!id) return reply.code(400).send({ ok: false, error: "unknown harness" });
    try {
      await requireHarness(id);
    } catch (err) {
      if (err instanceof HarnessSwitchError) {
        return reply.code(409).send({
          ok: false,
          needInstall: true,
          error: err.message,
          harness: err.harness,
        });
      }
      throw err;
    }
    const current = await loadSettings();
    const settings = await saveSettings(patchForHarness(id, current));
    return { ok: true, active: id, settings };
  });

  app.get("/api/bots", async () => ({ bots: await listRoster() }));

  app.post("/api/roster/clear", async () => {
    await clearRoster();
    return { ok: true, bots: await listRoster() };
  });

  app.post("/api/roster/reset", async () => {
    await resetRosterToSeed();
    return { ok: true, bots: await listRoster() };
  });

  app.post<{
    Body: {
      name?: string;
      title?: string;
      description?: string;
      color?: string;
      face?: string;
      shape?: string;
      kind?: string;
      members?: string[];
    };
  }>("/api/bots", async (req, reply) => {
    try {
      const bot = await createBot({
        name: req.body?.name ?? "Bot",
        title: req.body?.title ?? "",
        description: req.body?.description ?? "",
        color: req.body?.color,
        face: req.body?.face,
        shape: req.body?.shape,
        kind: req.body?.kind === "group" ? "group" : "bot",
        members: Array.isArray(req.body?.members) ? req.body.members.map(String) : undefined,
      });
      return bot;
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { id: string } }>("/api/bots/:id/messages", async (req, reply) => {
    const bot = await getBot(req.params.id);
    if (!bot) return reply.code(404).send({ error: "unknown bot" });
    return { messages: await loadTranscript(req.params.id) };
  });

  app.post<{ Params: { id: string }; Body: { text?: string } }>("/api/bots/:id/messages", async (req, reply) => {
    const bot = await getBot(req.params.id);
    if (!bot) return reply.code(404).send({ error: "unknown bot" });
    const text = (req.body?.text ?? "").trim();
    if (!text) return reply.code(400).send({ error: "empty message" });

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    await runTurn({
      botId: bot.id,
      userText: text,
      onEvent: (event) => sseWrite(reply, event),
    });
    reply.raw.end();
  });

  app.post<{ Params: { id: string }; Body: { decision?: string; messageId?: string } }>(
    "/api/bots/:id/approvals",
    async (req, reply) => {
      const bot = await getBot(req.params.id);
      if (!bot) return reply.code(404).send({ error: "unknown bot" });
      const decision = req.body?.decision ?? "deny";
      if (decision === "allow" || decision === "always") {
        reply.hijack();
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        const messages = await fulfillApproval(
          bot.id,
          decision,
          req.body?.messageId,
          (event) => sseWrite(reply, event),
        );
        if (messages.length === 0) {
          reply.raw.write(`data: ${JSON.stringify({ type: "error", botId: bot.id, error: "no pending approval" })}\n\n`);
        }
        reply.raw.end();
        return;
      }
      const messages = await fulfillApproval(bot.id, decision, req.body?.messageId);
      if (messages.length === 0) return reply.code(404).send({ error: "no pending approval" });
      return { messages };
    },
  );

  // Form cards: submit resumes the paused turn over SSE (same shape as an
  // approval "allow"). The request body can contain secret values — it is
  // never logged, and fulfillForm strips secrets into the vault before
  // anything is persisted or emitted.
  app.post<{ Params: { id: string }; Body: { messageId?: string; values?: unknown } }>(
    "/api/bots/:id/forms",
    async (req, reply) => {
      const bot = await getBot(req.params.id);
      if (!bot) return reply.code(404).send({ error: "unknown bot" });
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      const result = await fulfillForm(bot.id, req.body?.messageId, req.body?.values, (event) =>
        sseWrite(reply, event),
      );
      if (!result.ok) {
        reply.raw.write(
          `data: ${JSON.stringify({ type: "error", botId: bot.id, error: result.error, errors: result.errors })}\n\n`,
        );
      }
      reply.raw.end();
    },
  );

  app.post<{ Params: { id: string }; Body: { messageId?: string } }>(
    "/api/bots/:id/forms/cancel",
    async (req, reply) => {
      const bot = await getBot(req.params.id);
      if (!bot) return reply.code(404).send({ error: "unknown bot" });
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      const result = await fulfillFormCancel(bot.id, req.body?.messageId, (event) =>
        sseWrite(reply, event),
      );
      if (!result.ok) {
        reply.raw.write(
          `data: ${JSON.stringify({ type: "error", botId: bot.id, error: result.error })}\n\n`,
        );
      }
      reply.raw.end();
    },
  );

  // Secrets vault: statuses only (name, last4, updatedAt). There is
  // deliberately no route that returns a stored value.
  app.get("/api/secrets", async () => ({ secrets: await listSecretStatuses() }));

  app.delete<{ Params: { name: string } }>("/api/secrets/:name", async (req, reply) => {
    const name = req.params.name ?? "";
    if (!SECRET_NAME_RE.test(name)) return reply.code(400).send({ error: "invalid secret name" });
    const removed = await deleteSecret(name);
    if (!removed) return reply.code(404).send({ error: "unknown secret" });
    return { ok: true };
  });

  // MCP connectors: config lives in ~/.opengrokbot/mcp.json; servers spawn
  // lazily and their tools appear in Bot turns as mcp_<server>_<tool>.
  app.get("/api/mcp", async () => ({
    servers: await mcpManager.statuses(),
    configs: await loadMcpConfig(),
  }));

  app.post<{ Body: Partial<McpServerConfig> }>("/api/mcp/servers", async (req, reply) => {
    const name = String(req.body?.name ?? "").trim();
    const command = String(req.body?.command ?? "").trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(name)) {
      return reply.code(400).send({ error: "server name must be [a-zA-Z0-9_-], max 40 chars" });
    }
    if (!command) return reply.code(400).send({ error: "command is required" });
    const config: McpServerConfig = {
      name,
      command,
      args: Array.isArray(req.body?.args) ? req.body.args.map(String) : [],
      env:
        req.body?.env && typeof req.body.env === "object"
          ? Object.fromEntries(
              Object.entries(req.body.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
            )
          : {},
      enabled: req.body?.enabled !== false,
    };
    await mcpManager.upsertServer(config);
    return { ok: true, servers: await mcpManager.statuses(), configs: await loadMcpConfig() };
  });

  app.delete<{ Params: { name: string } }>("/api/mcp/servers/:name", async (req, reply) => {
    const removed = await mcpManager.deleteServer(req.params.name);
    if (!removed) return reply.code(404).send({ error: "unknown server" });
    return { ok: true, servers: await mcpManager.statuses(), configs: await loadMcpConfig() };
  });

  app.post<{ Params: { name: string } }>("/api/mcp/servers/:name/restart", async (req, reply) => {
    const ok = await mcpManager.restartServer(req.params.name);
    if (!ok) return reply.code(404).send({ error: "unknown server" });
    return { ok: true, servers: await mcpManager.statuses() };
  });

  // Routine run history (newest first; last 20 per routine are kept).
  app.get<{ Querystring: { botId?: string } }>("/api/routine-runs", async (req) => ({
    runs: await listRoutineRuns(req.query.botId),
  }));

  // ---- Skills library (~/.opengrokbot/skills/*.md, shared by all Bots) ----
  app.get("/api/skills", async () => ({ skills: await listSkills() }));

  app.post<{ Body: { id?: string; name?: string; description?: string; body?: string } }>(
    "/api/skills",
    async (req, reply) => {
      const b = req.body ?? {};
      if (!b.name?.trim()) return reply.code(400).send({ error: "name required" });
      try {
        const skill = await saveSkill({
          id: b.id,
          name: b.name,
          description: b.description,
          body: b.body ?? "",
        });
        return { ok: true, skill };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : "invalid skill" });
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/api/skills/:id", async (req, reply) => {
    const removed = await deleteSkill(req.params.id);
    if (!removed) return reply.code(404).send({ error: "unknown skill" });
    return { ok: true };
  });

  // Import memory exported from another AI assistant into a Bot's
  // MEMORY.md. Dedupes against what's already there; returns counts.
  app.post<{ Params: { id: string }; Body: { text?: string } }>(
    "/api/bots/:id/memory/import",
    async (req, reply) => {
      const bot = await getBot(req.params.id);
      if (!bot) return reply.code(404).send({ error: "unknown bot" });
      const text = String(req.body?.text ?? "");
      if (text.length > 200_000) return reply.code(413).send({ error: "import text too large" });
      if (!text.trim()) return reply.code(400).send({ error: "nothing to import" });
      const result = await importBotMemory(bot.id, text);
      return { ok: true, ...result };
    },
  );

  // Generate or rotate a routine's webhook token. The token is stored on the
  // routine itself (roster YAML on this machine) and returned here so the UI
  // can show the full trigger URL — same local trust as the settings API key.
  app.post<{ Params: { id: string; routineId: string } }>(
    "/api/bots/:id/routines/:routineId/webhook-token",
    async (req, reply) => {
      const bot = await getBot(req.params.id);
      if (!bot) return reply.code(404).send({ error: "unknown bot" });
      const routine = bot.routines.find((r) => r.id === req.params.routineId);
      if (!routine) return reply.code(404).send({ error: "unknown routine" });
      routine.webhookToken = randomBytes(24).toString("hex");
      await saveBot(bot);
      return {
        ok: true,
        token: routine.webhookToken,
        path: `/api/hooks/routines/${bot.id}/${routine.id}`,
      };
    },
  );

  app.delete<{ Params: { id: string; routineId: string } }>(
    "/api/bots/:id/routines/:routineId/webhook-token",
    async (req, reply) => {
      const bot = await getBot(req.params.id);
      if (!bot) return reply.code(404).send({ error: "unknown bot" });
      const routine = bot.routines.find((r) => r.id === req.params.routineId);
      if (!routine) return reply.code(404).send({ error: "unknown routine" });
      routine.webhookToken = undefined;
      await saveBot(bot);
      return { ok: true };
    },
  );

  // Webhook trigger: POST with header `x-webhook-token: <token>` (or ?t=).
  // Accepts { "text": "..." } which is appended to the routine prompt.
  // Responds 202 immediately; the run lands in the run history.
  app.post<{
    Params: { botId: string; routineId: string };
    Querystring: { t?: string };
    Body: { text?: string };
  }>("/api/hooks/routines/:botId/:routineId", async (req, reply) => {
    const bot = await getBot(req.params.botId);
    if (!bot) return reply.code(404).send({ error: "unknown bot" });
    const routine = bot.routines.find((r) => r.id === req.params.routineId);
    if (!routine) return reply.code(404).send({ error: "unknown routine" });
    if (!routine.webhookToken) {
      return reply.code(401).send({ error: "webhook is not enabled for this routine" });
    }
    const provided = String(req.headers["x-webhook-token"] ?? req.query.t ?? "");
    if (provided !== routine.webhookToken) {
      return reply.code(401).send({ error: "bad webhook token" });
    }
    if (!routine.enabled) return reply.code(409).send({ error: "routine is disabled" });
    const tail = typeof req.body?.text === "string" ? req.body.text.slice(0, 2000).trim() : "";
    void runTurn({
      botId: bot.id,
      userText: `/${routine.name}${tail ? ` ${tail}` : ""}`,
      trigger: "webhook",
    }).catch(() => undefined);
    return reply.code(202).send({ ok: true, accepted: true, routine: routine.name });
  });

  await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: "/" });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.sendFile("index.html");
  });

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`OpenGrokBot http://${HOST}:${PORT}`);
}
