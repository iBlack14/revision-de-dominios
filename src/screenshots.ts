import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export function screenshotPath(clientId: string, monitorId: string, runId: string): string {
  return path.resolve(config.SCREENSHOT_DIR, clientId, monitorId, `${runId}.png`);
}

export async function ensureScreenshotDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

function signature(runId: string, expires: number): string {
  return createHmac("sha256", config.SCREENSHOT_SIGNING_SECRET)
    .update(`${runId}.${expires}`)
    .digest("hex");
}

export function createSignedScreenshotUrl(runId: string, lifetimeSeconds = 86_400): string {
  const expires = Math.floor(Date.now() / 1000) + lifetimeSeconds;
  const token = signature(runId, expires);
  return `${config.PUBLIC_BASE_URL}/public/screenshots/${runId}?expires=${expires}&signature=${token}`;
}

export function verifyScreenshotSignature(runId: string, expires: number, provided: string): boolean {
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signature(runId, expires), "hex");
  const actual = Buffer.from(provided, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
