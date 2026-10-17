import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.ADMIN_TOKEN = "test-admin-token-with-32-characters";
  process.env.SCREENSHOT_SIGNING_SECRET = "test-signing-secret-with-32-chars";
});

describe("assertSafeUrl", () => {
  it("rejects localhost and private IPv4 targets", async () => {
    const { assertSafeUrl } = await import("./security.js");
    await expect(assertSafeUrl("http://localhost")).rejects.toThrow();
    await expect(assertSafeUrl("http://127.0.0.1")).rejects.toThrow();
    await expect(assertSafeUrl("http://192.168.1.10")).rejects.toThrow();
  });

  it("rejects unsupported protocols and embedded credentials", async () => {
    const { assertSafeUrl } = await import("./security.js");
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertSafeUrl("https://user:pass@example.com")).rejects.toThrow();
  });
});
