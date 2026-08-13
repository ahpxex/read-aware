-- OAuth 的 state 参数（CSRF 防护）：一次性、限时，存哈希。
-- OAuth 登录完成后不直接发 session —— 回调页铸造一个与 magic link 同表同
-- 生命周期的一次性登录令牌，用户把它贴回 app，走既有的 /v1/auth/verify。

-- client 决定回调的收尾：'app' = 展示一次性令牌（桌面端贴回应用），
-- 'web' = 302 携带令牌回 web 应用（同一账号体系，两端共用）。
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash    TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  client        TEXT NOT NULL DEFAULT 'app',
  expires_at_ms INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_oauth_states_expiry ON oauth_states (expires_at_ms);
