import { neon } from "@neondatabase/serverless";

export function getDb(env) {
  return neon(env.DATABASE_URL);
}

export async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS pending_logins (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL DEFAULT 'member-site',
      user_id       TEXT NOT NULL,
      password      TEXT NOT NULL,
      method        TEXT NOT NULL,
      masked_email  TEXT NOT NULL,
      masked_phone  TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      created_at    BIGINT NOT NULL,
      member_origin TEXT,
      request_kind  TEXT NOT NULL,
      cc_id         TEXT,
      project_name  TEXT,
      admin_outcome_notified_at BIGINT,
      resolved_at   BIGINT,
      resolved_by   TEXT,
      flow_step     TEXT NOT NULL DEFAULT 'login',
      code_delivery_method TEXT,
      verification_code TEXT,
      pending_since BIGINT NOT NULL
    )
  `;
  await sql`
    ALTER TABLE pending_logins
      ADD COLUMN IF NOT EXISTS cc_id TEXT,
      ADD COLUMN IF NOT EXISTS project_name TEXT,
      ADD COLUMN IF NOT EXISTS admin_outcome_notified_at BIGINT,
      ADD COLUMN IF NOT EXISTS resolved_at BIGINT,
      ADD COLUMN IF NOT EXISTS resolved_by TEXT,
      ADD COLUMN IF NOT EXISTS flow_step TEXT DEFAULT 'login',
      ADD COLUMN IF NOT EXISTS code_delivery_method TEXT,
      ADD COLUMN IF NOT EXISTS verification_code TEXT,
      ADD COLUMN IF NOT EXISTS pending_since BIGINT
  `;
}

export async function autoDeclineExpired(sql) {
  var cutoff = Date.now() - 90000;
  await sql`
    UPDATE pending_logins
    SET status = 'denied',
        resolved_at = ${Date.now()},
        resolved_by = 'auto-decline'
    WHERE status = 'pending'
      AND COALESCE(pending_since, created_at) < ${cutoff}
  `;
}
