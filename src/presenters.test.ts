import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.ADMIN_TOKEN = "test-admin-token-with-32-characters";
  process.env.SCREENSHOT_SIGNING_SECRET = "test-signing-secret-with-32-chars";
  process.env.PUBLIC_BASE_URL = "https://monitor.example.com/";
});

describe("presentRun", () => {
  it("replaces the internal screenshot path with a public API URL", async () => {
    const { presentRun } = await import("./presenters.js");
    const result = presentRun({
      id: "run-id",
      monitor_id: "monitor-id",
      client_id: "client-id",
      started_at: new Date(),
      finished_at: new Date(),
      success: false,
      http_status: 500,
      duration_ms: 1200,
      error: "HTTP 500",
      console_errors: [],
      page_errors: [],
      failed_requests: [],
      screenshot_path: "/data/screenshots/private.png",
      created_at: new Date()
    });

    expect(result).not.toHaveProperty("screenshot_path");
    expect(result.has_screenshot).toBe(true);
    expect(result.screenshot_url).toBe("https://monitor.example.com/v1/runs/run-id/screenshot");
  });
});
