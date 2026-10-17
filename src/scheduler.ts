import { config } from "./config.js";
import { pool } from "./db.js";
import { runMonitor } from "./runner.js";
import type { MonitorRecord } from "./types.js";
import { unlink } from "node:fs/promises";

let timer: NodeJS.Timeout | undefined;
let running = false;
let lastCleanupDate = "";

async function cleanupExpiredRuns(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (lastCleanupDate === today) return;
  lastCleanupDate = today;
  const expired = await pool.query<{ screenshot_path: string | null }>(
    `DELETE FROM runs
     WHERE created_at < now() - make_interval(days => $1)
     RETURNING screenshot_path`,
    [config.RETENTION_DAYS]
  );
  await Promise.allSettled(
    expired.rows
      .map((row) => row.screenshot_path)
      .filter((filePath): filePath is string => Boolean(filePath))
      .map((filePath) => unlink(filePath))
  );
}

async function claimDueMonitors(): Promise<MonitorRecord[]> {
  const result = await pool.query<MonitorRecord>(
    `WITH due AS (
      SELECT id
      FROM monitors
      WHERE enabled = true AND next_check_at <= now()
      ORDER BY next_check_at
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    )
    UPDATE monitors AS monitor
    SET next_check_at = now() + make_interval(secs => monitor.interval_seconds),
        updated_at = now()
    FROM due
    WHERE monitor.id = due.id
    RETURNING monitor.*`,
    [config.CHECK_CONCURRENCY]
  );
  return result.rows;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await cleanupExpiredRuns();
    const monitors = await claimDueMonitors();
    await Promise.all(
      monitors.map((monitor) =>
        runMonitor(monitor).catch((error) => console.error(`Monitor ${monitor.id} failed`, error))
      )
    );
  } catch (error) {
    console.error("Scheduler tick failed", error);
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  void tick();
  timer = setInterval(() => void tick(), 5_000);
  timer.unref();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
