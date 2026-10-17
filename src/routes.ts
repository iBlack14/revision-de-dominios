import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, unlink } from "node:fs/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticate, createApiKey, hashApiKey } from "./auth.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { eventHub } from "./events.js";
import { runMonitor } from "./runner.js";
import { assertSafeUrl, isValidWebhookUrl } from "./security.js";
import { verifyScreenshotSignature } from "./screenshots.js";
import type { MonitorRecord, RunRecord } from "./types.js";

const clientSchema = z.object({
  name: z.string().trim().min(2).max(100).regex(/^[^\r\n]+$/),
  alert_email: z.email().nullable().optional(),
  webhook_url: z.url().nullable().optional()
});

const monitorSchema = z.object({
  name: z.string().trim().min(2).max(120).regex(/^[^\r\n]+$/),
  url: z.url(),
  interval_seconds: z.number().int().min(30).max(86400).default(300),
  timeout_ms: z.number().int().min(1000).max(60000).default(30000),
  expected_status: z.number().int().min(100).max(599).default(200),
  expected_text: z.string().max(500).nullable().optional(),
  fail_on_console_error: z.boolean().default(false),
  screenshot_mode: z.enum(["always", "failure", "never"]).default("failure"),
  enabled: z.boolean().default(true)
});

const monitorPatchSchema = monitorSchema.partial();

function parse<T>(schema: z.ZodType<T>, input: unknown, reply: FastifyReply): T | undefined {
  const result = schema.safeParse(input);
  if (!result.success) {
    reply.code(400).send({ error: "Datos inválidos", details: z.flattenError(result.error) });
    return undefined;
  }
  return result.data;
}

function adminAuthorized(request: FastifyRequest): boolean {
  const provided = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = Buffer.from(config.ADMIN_TOKEN);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function ownedMonitor(clientId: string, monitorId: string): Promise<MonitorRecord | undefined> {
  const result = await pool.query<MonitorRecord>(
    "SELECT * FROM monitors WHERE id = $1 AND client_id = $2",
    [monitorId, clientId]
  );
  return result.rows[0];
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok", time: new Date().toISOString() };
  });

  app.post("/v1/admin/clients", async (request, reply) => {
    if (!adminAuthorized(request)) return reply.code(401).send({ error: "Token administrativo inválido" });
    const body = parse(clientSchema, request.body, reply);
    if (!body) return;
    if (body.webhook_url && !isValidWebhookUrl(body.webhook_url)) {
      return reply.code(400).send({ error: "El webhook debe usar HTTPS en producción" });
    }
    if (body.webhook_url) await assertSafeUrl(body.webhook_url);
    const apiKey = createApiKey();
    const webhookSecret = randomBytes(32).toString("hex");
    const result = await pool.query(
      `INSERT INTO clients (name, api_key_hash, alert_email, webhook_url, webhook_secret)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, alert_email, webhook_url, created_at`,
      [body.name, hashApiKey(apiKey), body.alert_email ?? null, body.webhook_url ?? null, webhookSecret]
    );
    return reply.code(201).send({ ...result.rows[0], api_key: apiKey, webhook_secret: webhookSecret });
  });

  app.get("/public/screenshots/:runId", async (request, reply) => {
    const params = request.params as { runId: string };
    const query = request.query as { expires?: string; signature?: string };
    const expires = Number(query.expires);
    if (!query.signature || !verifyScreenshotSignature(params.runId, expires, query.signature)) {
      return reply.code(403).send({ error: "Enlace inválido o vencido" });
    }
    const result = await pool.query<RunRecord>("SELECT * FROM runs WHERE id = $1", [params.runId]);
    const run = result.rows[0];
    if (!run?.screenshot_path) return reply.code(404).send({ error: "Captura no encontrada" });
    try {
      await access(run.screenshot_path);
      return reply.type("image/png").send(createReadStream(run.screenshot_path));
    } catch {
      return reply.code(404).send({ error: "Archivo de captura no encontrado" });
    }
  });

  app.register(async (secured) => {
    secured.addHook("preHandler", authenticate);

    secured.get("/me", async (request) => request.clientAccount);

    secured.get("/events", async (request, reply) => {
      const client = request.clientAccount!;
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      reply.raw.write(`event: ready\ndata: ${JSON.stringify({ client_id: client.id })}\n\n`);
      const unsubscribe = eventHub.subscribe(client.id, reply.raw);
      const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 20_000);
      request.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    });

    secured.post("/monitors", async (request, reply) => {
      const body = parse(monitorSchema, request.body, reply);
      if (!body) return;
      await assertSafeUrl(body.url);
      const count = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM monitors WHERE client_id = $1",
        [request.clientAccount!.id]
      );
      if (Number(count.rows[0]?.count ?? 0) >= config.MAX_MONITORS_PER_CLIENT) {
        return reply.code(409).send({ error: "Se alcanzó el límite de monitores de la cuenta" });
      }
      const result = await pool.query<MonitorRecord>(
        `INSERT INTO monitors (
          client_id, name, url, interval_seconds, timeout_ms, expected_status,
          expected_text, fail_on_console_error, screenshot_mode, enabled
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *`,
        [
          request.clientAccount!.id,
          body.name,
          body.url,
          body.interval_seconds,
          body.timeout_ms,
          body.expected_status,
          body.expected_text ?? null,
          body.fail_on_console_error,
          body.screenshot_mode,
          body.enabled
        ]
      );
      return reply.code(201).send(result.rows[0]);
    });

    secured.get("/monitors", async (request) => {
      const result = await pool.query<MonitorRecord>(
        "SELECT * FROM monitors WHERE client_id = $1 ORDER BY created_at DESC",
        [request.clientAccount!.id]
      );
      return { data: result.rows };
    });

    secured.get("/monitors/:id", async (request, reply) => {
      const { id } = request.params as { id: string };
      const monitor = await ownedMonitor(request.clientAccount!.id, id);
      if (!monitor) return reply.code(404).send({ error: "Monitor no encontrado" });
      return monitor;
    });

    secured.patch("/monitors/:id", async (request, reply) => {
      const { id } = request.params as { id: string };
      const current = await ownedMonitor(request.clientAccount!.id, id);
      if (!current) return reply.code(404).send({ error: "Monitor no encontrado" });
      const body = parse(monitorPatchSchema, request.body, reply);
      if (!body) return;
      if (body.url) await assertSafeUrl(body.url);
      const updated = { ...current, ...body };
      const result = await pool.query<MonitorRecord>(
        `UPDATE monitors SET
          name=$1, url=$2, interval_seconds=$3, timeout_ms=$4, expected_status=$5,
          expected_text=$6, fail_on_console_error=$7, screenshot_mode=$8, enabled=$9,
          next_check_at=CASE WHEN $9 THEN LEAST(next_check_at, now()) ELSE next_check_at END,
          updated_at=now()
        WHERE id=$10 AND client_id=$11 RETURNING *`,
        [
          updated.name,
          updated.url,
          updated.interval_seconds,
          updated.timeout_ms,
          updated.expected_status,
          updated.expected_text,
          updated.fail_on_console_error,
          updated.screenshot_mode,
          updated.enabled,
          id,
          request.clientAccount!.id
        ]
      );
      return result.rows[0];
    });

    secured.delete("/monitors/:id", async (request, reply) => {
      const { id } = request.params as { id: string };
      const files = await pool.query<{ screenshot_path: string | null }>(
        "SELECT screenshot_path FROM runs WHERE monitor_id = $1 AND client_id = $2",
        [id, request.clientAccount!.id]
      );
      const result = await pool.query(
        "DELETE FROM monitors WHERE id = $1 AND client_id = $2 RETURNING id",
        [id, request.clientAccount!.id]
      );
      if (!result.rowCount) return reply.code(404).send({ error: "Monitor no encontrado" });
      await Promise.allSettled(
        files.rows
          .map((row) => row.screenshot_path)
          .filter((filePath): filePath is string => Boolean(filePath))
          .map((filePath) => unlink(filePath))
      );
      return reply.code(204).send();
    });

    secured.post("/monitors/:id/check", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const monitor = await ownedMonitor(request.clientAccount!.id, id);
      if (!monitor) return reply.code(404).send({ error: "Monitor no encontrado" });
      const run = await runMonitor(monitor);
      return reply.code(201).send(run);
    });

    secured.get("/monitors/:id/runs", async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as { limit?: string };
      const monitor = await ownedMonitor(request.clientAccount!.id, id);
      if (!monitor) return reply.code(404).send({ error: "Monitor no encontrado" });
      const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
      const result = await pool.query<RunRecord>(
        "SELECT * FROM runs WHERE monitor_id = $1 AND client_id = $2 ORDER BY created_at DESC LIMIT $3",
        [id, request.clientAccount!.id, limit]
      );
      return { data: result.rows };
    });

    secured.get("/runs/:id/screenshot", async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await pool.query<RunRecord>(
        "SELECT * FROM runs WHERE id = $1 AND client_id = $2",
        [id, request.clientAccount!.id]
      );
      const run = result.rows[0];
      if (!run?.screenshot_path) return reply.code(404).send({ error: "Captura no encontrada" });
      try {
        await access(run.screenshot_path);
        return reply.type("image/png").send(createReadStream(run.screenshot_path));
      } catch {
        return reply.code(404).send({ error: "Archivo de captura no encontrado" });
      }
    });
  }, { prefix: "/v1" });
}
