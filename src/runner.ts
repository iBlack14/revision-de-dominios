import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Page } from "playwright";
import { getBrowser } from "./browser.js";
import { pool } from "./db.js";
import { eventHub } from "./events.js";
import { sendStateAlert } from "./notifications.js";
import { assertSafeUrl } from "./security.js";
import { ensureScreenshotDirectory, screenshotPath } from "./screenshots.js";
import type { ClientRecord, MonitorRecord, RunRecord } from "./types.js";

const MAX_CAPTURED_ERRORS = 50;

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function protectPage(page: Page): Promise<void> {
  const checkedHosts = new Map<string, boolean>();
  await page.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.startsWith("data:") || requestUrl.startsWith("blob:")) {
      await route.continue();
      return;
    }
    try {
      const hostname = new URL(requestUrl).hostname;
      if (!checkedHosts.has(hostname)) {
        await assertSafeUrl(requestUrl);
        checkedHosts.set(hostname, true);
      }
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
}

export async function runMonitor(monitor: MonitorRecord): Promise<RunRecord> {
  await assertSafeUrl(monitor.url);
  const runId = randomUUID();
  const startedAt = new Date();
  const started = performance.now();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: Array<{ url: string; error: string }> = [];
  let httpStatus: number | null = null;
  let errorMessage: string | null = null;
  let imagePath: string | null = null;
  let success = false;
  let page: Page | undefined;
  const browser = await getBrowser();
  const context = await browser.newContext({
    ignoreHTTPSErrors: false,
    serviceWorkers: "block",
    viewport: { width: 1440, height: 900 }
  });
  await context.routeWebSocket("**/*", (webSocket) => webSocket.close());

  try {
    page = await context.newPage();
    page.setDefaultTimeout(monitor.timeout_ms);
    page.on("console", (message) => {
      if (message.type() === "error" && consoleErrors.length < MAX_CAPTURED_ERRORS) {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      if (pageErrors.length < MAX_CAPTURED_ERRORS) pageErrors.push(error.message);
    });
    page.on("requestfailed", (request) => {
      if (failedRequests.length < MAX_CAPTURED_ERRORS) {
        failedRequests.push({
          url: request.url(),
          error: request.failure()?.errorText ?? "request failed"
        });
      }
    });
    await protectPage(page);
    const response = await page.goto(monitor.url, {
      waitUntil: "domcontentloaded",
      timeout: monitor.timeout_ms
    });
    httpStatus = response?.status() ?? null;
    await page.waitForTimeout(750);

    if (httpStatus !== monitor.expected_status) {
      throw new Error(`Se esperaba HTTP ${monitor.expected_status}, se recibió ${httpStatus ?? "sin respuesta"}`);
    }
    if (monitor.expected_text) {
      const bodyText = await page.locator("body").innerText({ timeout: monitor.timeout_ms });
      if (!bodyText.includes(monitor.expected_text)) {
        throw new Error(`No se encontró el texto esperado: ${monitor.expected_text}`);
      }
    }
    if (monitor.fail_on_console_error && (consoleErrors.length || pageErrors.length)) {
      throw new Error(`La página produjo ${consoleErrors.length + pageErrors.length} errores JavaScript`);
    }
    success = true;
  } catch (error) {
    errorMessage = messageFrom(error).slice(0, 2000);
  }

  if (page && (monitor.screenshot_mode === "always" || (monitor.screenshot_mode === "failure" && !success))) {
    imagePath = screenshotPath(monitor.client_id, monitor.id, runId);
    try {
      await ensureScreenshotDirectory(imagePath);
      await page.screenshot({ path: imagePath, fullPage: false, timeout: monitor.timeout_ms });
    } catch (error) {
      imagePath = null;
      errorMessage ??= `No se pudo capturar la página: ${messageFrom(error)}`;
    }
  }
  await context.close();

  const finishedAt = new Date();
  const durationMs = Math.round(performance.now() - started);
  const inserted = await pool.query<RunRecord>(
    `INSERT INTO runs (
      id, monitor_id, client_id, started_at, finished_at, success, http_status,
      duration_ms, error, console_errors, page_errors, failed_requests, screenshot_path
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13)
    RETURNING *`,
    [
      runId,
      monitor.id,
      monitor.client_id,
      startedAt,
      finishedAt,
      success,
      httpStatus,
      durationMs,
      errorMessage,
      JSON.stringify(consoleErrors),
      JSON.stringify(pageErrors),
      JSON.stringify(failedRequests),
      imagePath
    ]
  );
  const run = inserted.rows[0];
  if (!run) throw new Error("No se pudo guardar el resultado");

  const nextStatus = success ? "up" : "down";
  await pool.query(
    `UPDATE monitors
     SET current_status = $1, last_checked_at = $2, last_error = $3, updated_at = now()
     WHERE id = $4`,
    [nextStatus, finishedAt, errorMessage, monitor.id]
  );

  eventHub.publish(monitor.client_id, "monitor.checked", {
    monitor_id: monitor.id,
    status: nextStatus,
    run
  });

  const clientResult = await pool.query<ClientRecord>(
    "SELECT id, name, alert_email, webhook_url, webhook_secret FROM clients WHERE id = $1",
    [monitor.client_id]
  );
  const client = clientResult.rows[0];
  if (client && !success && monitor.current_status !== "down") {
    await sendStateAlert("monitor.down", client, monitor, run);
  } else if (client && success && monitor.current_status === "down") {
    await sendStateAlert("monitor.recovered", client, monitor, run);
  }
  return run;
}
