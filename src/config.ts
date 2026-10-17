import { z } from "zod";

const booleanString = z
  .string()
  .optional()
  .transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  ADMIN_TOKEN: z.string().min(16),
  SCREENSHOT_SIGNING_SECRET: z.string().min(16),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8080"),
  SCREENSHOT_DIR: z.string().default("./data/screenshots"),
  CHECK_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  MAX_MONITORS_PER_CLIENT: z.coerce.number().int().min(1).max(1000).default(50),
  RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  ALLOW_PRIVATE_TARGETS: booleanString,
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanString,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("WebWatch <alerts@example.com>")
});

export const config = schema.parse(process.env);
