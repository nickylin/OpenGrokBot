import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { PUBLIC_DIR } from "./paths.js";
import { fulfillApproval, runTurn, testConnection } from "./agent.js";
import {
  createBot,
  getBot,
  listRoster,
  loadSettings,
  loadTranscript,
  saveSettings,
} from "./store.js";
import type { AgentEvent, Settings } from "./types.js";

const PORT = Number(process.env.OPENGROKBOT_PORT ?? 3088);
const HOST = process.env.OPENGROKBOT_HOST ?? "127.0.0.1";

function sseWrite(reply: { raw: { write: (chunk: string) => boolean } }, event: AgentEvent): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

export async function startServer(): Promise<void> {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/api/health", async () => ({ ok: true }));

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

  app.get("/api/bots", async () => ({ bots: await listRoster() }));

  app.post<{ Body: { name?: string; title?: string; description?: string } }>("/api/bots", async (req) => {
    const bot = await createBot({
      name: req.body?.name ?? "Bot",
      title: req.body?.title ?? "",
      description: req.body?.description ?? "",
    });
    return bot;
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
      const messages = await fulfillApproval(bot.id, req.body?.decision ?? "deny", req.body?.messageId);
      if (messages.length === 0) return reply.code(404).send({ error: "no pending approval" });
      return { messages };
    },
  );

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
