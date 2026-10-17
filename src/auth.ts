import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "./db.js";
import type { ClientRecord } from "./types.js";

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function createApiKey(): string {
  return `ww_live_${randomBytes(24).toString("base64url")}`;
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const value = request.headers["x-api-key"];
  if (typeof value !== "string" || !value) {
    return reply.code(401).send({ error: "Falta el encabezado X-API-Key" });
  }

  const result = await pool.query<ClientRecord>(
    "SELECT id, name, alert_email, webhook_url, webhook_secret FROM clients WHERE api_key_hash = $1",
    [hashApiKey(value)]
  );
  const client = result.rows[0];
  if (!client) {
    return reply.code(401).send({ error: "API key inválida" });
  }
  request.clientAccount = client;
}
