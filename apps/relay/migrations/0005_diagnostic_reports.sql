-- User-initiated diagnostic reports: one metadata row per upload, for listing
-- (wrangler d1 execute — see docs/diagnostics.md) and per-IP throttling. The
-- payload itself lives in R2 under _reports/<id>.json. The app only ever
-- sends a report when the user explicitly asks it to.
CREATE TABLE diagnostic_reports (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  app_version TEXT NOT NULL,
  platform TEXT NOT NULL,
  bytes INTEGER NOT NULL
);

CREATE INDEX diagnostic_reports_ip_recent
  ON diagnostic_reports (ip_hash, created_at_ms);
