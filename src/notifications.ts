import { createHmac } from "node:crypto";
import { access } from "node:fs/promises";
import nodemailer from "nodemailer";
import { config } from "./config.js";
import { createSignedScreenshotUrl } from "./screenshots.js";
import type { ClientRecord, MonitorRecord, RunRecord } from "./types.js";

interface AlertPayload {
  event: "monitor.down" | "monitor.recovered";
  monitor: Pick<MonitorRecord, "id" | "name" | "url">;
  run: Omit<RunRecord, "screenshot_path"> & { screenshot_url: string | null };
}

function buildPayload(event: AlertPayload["event"], monitor: MonitorRecord, run: RunRecord): AlertPayload {
  const { screenshot_path: _screenshotPath, ...safeRun } = run;
  return {
    event,
    monitor: { id: monitor.id, name: monitor.name, url: monitor.url },
    run: {
      ...safeRun,
      screenshot_url: run.screenshot_path ? createSignedScreenshotUrl(run.id) : null
    }
  };
}

async function sendWebhook(client: ClientRecord, payload: AlertPayload): Promise<void> {
  if (!client.webhook_url) return;
  const body = JSON.stringify(payload);
  const digest = createHmac("sha256", client.webhook_secret).update(body).digest("hex");
  const response = await fetch(client.webhook_url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webwatch-signature": `sha256=${digest}`
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Webhook respondió HTTP ${response.status}`);
}

async function sendEmail(client: ClientRecord, payload: AlertPayload, screenshotPath: string | null): Promise<void> {
  if (!client.alert_email || !config.SMTP_HOST) return;
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined
  });
  const isDown = payload.event === "monitor.down";
  const attachments = [];
  if (screenshotPath) {
    try {
      await access(screenshotPath);
      attachments.push({ filename: `${payload.monitor.name}.png`, path: screenshotPath });
    } catch {}
  }
  await transport.sendMail({
    from: config.SMTP_FROM,
    to: client.alert_email,
    subject: `${isDown ? "CAÍDA" : "RECUPERADA"}: ${payload.monitor.name}`,
    text: [
      `Estado: ${isDown ? "caída" : "recuperada"}`,
      `Monitor: ${payload.monitor.name}`,
      `URL: ${payload.monitor.url}`,
      `HTTP: ${payload.run.http_status ?? "sin respuesta"}`,
      `Duración: ${payload.run.duration_ms} ms`,
      payload.run.error ? `Error: ${payload.run.error}` : ""
    ].filter(Boolean).join("\n"),
    attachments
  });
}

export async function sendStateAlert(
  event: AlertPayload["event"],
  client: ClientRecord,
  monitor: MonitorRecord,
  run: RunRecord
): Promise<void> {
  const payload = buildPayload(event, monitor, run);
  const results = await Promise.allSettled([
    sendWebhook(client, payload),
    sendEmail(client, payload, run.screenshot_path)
  ]);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    console.error("One or more alert deliveries failed", failures);
  }
}
