-- Code-level rate limiting (docs/sync-engine.md §4): fixed windows, counted
-- atomically by an upsert-increment keyed on (bucket, subject_hash, window).
-- Subjects are SHA-256 hashes (email, account id, or client IP), so the table
-- does not store raw identifiers. An hourly Cron Trigger drops windows older
-- than the retention horizon independently of request traffic.
CREATE TABLE IF NOT EXISTS rate_windows (
  bucket         TEXT NOT NULL,
  subject_hash   TEXT NOT NULL,
  window_start_ms INTEGER NOT NULL,
  count          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, subject_hash, window_start_ms)
);

CREATE INDEX IF NOT EXISTS ix_rate_windows_expiry ON rate_windows (window_start_ms);
