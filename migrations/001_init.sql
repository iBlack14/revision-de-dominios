CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  api_key_hash text NOT NULL UNIQUE,
  alert_email text,
  webhook_url text,
  webhook_secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  interval_seconds integer NOT NULL DEFAULT 300 CHECK (interval_seconds BETWEEN 30 AND 86400),
  timeout_ms integer NOT NULL DEFAULT 30000 CHECK (timeout_ms BETWEEN 1000 AND 60000),
  expected_status integer NOT NULL DEFAULT 200 CHECK (expected_status BETWEEN 100 AND 599),
  expected_text text,
  fail_on_console_error boolean NOT NULL DEFAULT false,
  screenshot_mode text NOT NULL DEFAULT 'failure' CHECK (screenshot_mode IN ('always', 'failure', 'never')),
  enabled boolean NOT NULL DEFAULT true,
  current_status text NOT NULL DEFAULT 'unknown' CHECK (current_status IN ('unknown', 'up', 'down')),
  last_checked_at timestamptz,
  last_error text,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS monitors_due_idx ON monitors (next_check_at) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS monitors_client_idx ON monitors (client_id);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  success boolean NOT NULL,
  http_status integer,
  duration_ms integer NOT NULL,
  error text,
  console_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  page_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  failed_requests jsonb NOT NULL DEFAULT '[]'::jsonb,
  screenshot_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runs_monitor_created_idx ON runs (monitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS runs_client_created_idx ON runs (client_id, created_at DESC);
