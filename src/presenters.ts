import { config } from "./config.js";
import type { RunRecord } from "./types.js";

export function presentRun(run: RunRecord) {
  const { screenshot_path: screenshotPath, ...publicFields } = run;
  return {
    ...publicFields,
    has_screenshot: Boolean(screenshotPath),
    screenshot_url: screenshotPath ? `${config.PUBLIC_BASE_URL}/v1/runs/${run.id}/screenshot` : null
  };
}
