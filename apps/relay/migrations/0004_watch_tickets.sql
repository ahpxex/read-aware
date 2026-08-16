-- One-shot tickets for the change-doorbell WebSocket (GET /v1/events/watch).
-- A browser WebSocket cannot send an Authorization header, and the long-lived
-- session must never ride in a URL (access logs). The client trades its
-- session for a ticket over an authenticated POST, and the ticket — hashed
-- here, single-use, short-TTL — is the only thing the socket URL carries.
CREATE TABLE IF NOT EXISTS watch_tickets (
  token_hash    TEXT NOT NULL PRIMARY KEY,
  account_id    TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
