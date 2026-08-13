-- Relay 的 D1 侧：账号、magic-link 令牌、会话。事件密文不在这里 ——
-- 它们住在每账号的 Durable Object SQLite 里（src/mailbox-core.ts）。
-- 令牌与会话只存 SHA-256 哈希；库泄露不产生可重放的凭据。

CREATE TABLE IF NOT EXISTS accounts (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  kdf_salt        TEXT,
  kdf_params_json TEXT,
  key_check       TEXT,
  blob_bytes_used INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_tokens (
  token_hash    TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_sessions_account ON sessions (account_id);
CREATE INDEX IF NOT EXISTS ix_magic_tokens_expiry ON magic_tokens (expires_at_ms);
