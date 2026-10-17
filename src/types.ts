export interface ClientRecord {
  id: string;
  name: string;
  alert_email: string | null;
  webhook_url: string | null;
  webhook_secret: string;
}

export interface MonitorRecord {
  id: string;
  client_id: string;
  name: string;
  url: string;
  interval_seconds: number;
  timeout_ms: number;
  expected_status: number;
  expected_text: string | null;
  fail_on_console_error: boolean;
  screenshot_mode: "always" | "failure" | "never";
  enabled: boolean;
  current_status: "unknown" | "up" | "down";
  last_checked_at: Date | null;
  last_error: string | null;
  next_check_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface RunRecord {
  id: string;
  monitor_id: string;
  client_id: string;
  started_at: Date;
  finished_at: Date;
  success: boolean;
  http_status: number | null;
  duration_ms: number;
  error: string | null;
  console_errors: string[];
  page_errors: string[];
  failed_requests: Array<{ url: string; error: string }>;
  screenshot_path: string | null;
  created_at: Date;
}

declare module "fastify" {
  interface FastifyRequest {
    clientAccount?: ClientRecord;
  }
}
