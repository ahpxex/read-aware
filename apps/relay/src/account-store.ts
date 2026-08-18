/**
 * AccountStore over a D1-shaped database. `D1Like` is the structural subset of
 * D1's API this store uses — the Worker passes the real binding, the tests
 * pass a bun:sqlite adapter, and both run the identical SQL (RETURNING makes
 * token redemption and set-once key publishing single-statement atomic).
 *
 * Magic-link and session tokens are stored as SHA-256 hashes: a leaked
 * database yields nothing replayable.
 */
import type { SyncKeyMaterial, SyncTier } from "@read-aware/core";
import { isAccountTier, type Account, type AccountStore } from "./ports";

export type D1Like = {
  prepare(sql: string): {
    bind(...values: (string | number | null)[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
};

type AccountRow = {
  id: string;
  email: string;
  kdf_salt: string | null;
  kdf_params_json: string | null;
  key_check: string | null;
  blob_bytes_used: number;
  tier: string;
  tier_expires_at_ms: number | null;
  created_at: string;
};

function rowToAccount(row: AccountRow): Account {
  const keys: SyncKeyMaterial | null =
    row.kdf_salt !== null && row.kdf_params_json !== null && row.key_check !== null
      ? {
          kdfSalt: row.kdf_salt,
          kdfParams: JSON.parse(row.kdf_params_json),
          keyCheck: row.key_check,
        }
      : null;
  return {
    id: row.id,
    email: row.email,
    keys,
    blobBytesUsed: Number(row.blob_bytes_used),
    // A row can only hold an unknown tier if someone hand-edited the column;
    // read it as free rather than granting quotas the code never defined.
    tier: isAccountTier(row.tier) ? row.tier : "free",
    tierExpiresAtMs: row.tier_expires_at_ms === null ? null : Number(row.tier_expires_at_ms),
    createdAt: row.created_at,
  };
}

export class SqlAccountStore implements AccountStore {
  constructor(private db: D1Like) {}

  async findOrCreateByEmail(email: string, now: string): Promise<Account> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO accounts (id, email, blob_bytes_used, created_at)
         VALUES (?1, ?2, 0, ?3)`,
      )
      .bind(crypto.randomUUID(), email, now)
      .run();
    const row = await this.db
      .prepare(`SELECT * FROM accounts WHERE email = ?1`)
      .bind(email)
      .first<AccountRow>();
    if (!row) throw new Error("relay: account row vanished after upsert");
    return rowToAccount(row);
  }

  async get(id: string): Promise<Account | null> {
    const row = await this.db
      .prepare(`SELECT * FROM accounts WHERE id = ?1`)
      .bind(id)
      .first<AccountRow>();
    return row ? rowToAccount(row) : null;
  }

  async setKeys(id: string, keys: SyncKeyMaterial): Promise<"set" | "already-set"> {
    const updated = await this.db
      .prepare(
        `UPDATE accounts SET kdf_salt = ?2, kdf_params_json = ?3, key_check = ?4
          WHERE id = ?1 AND key_check IS NULL
          RETURNING id`,
      )
      .bind(id, keys.kdfSalt, JSON.stringify(keys.kdfParams), keys.keyCheck)
      .first();
    return updated ? "set" : "already-set";
  }

  async putMagicToken(
    tokenHash: string,
    email: string,
    expiresAtMs: number,
    now: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO magic_tokens (token_hash, email, expires_at_ms, created_at)
         VALUES (?1, ?2, ?3, ?4)`,
      )
      .bind(tokenHash, email, expiresAtMs, now)
      .run();
  }

  async consumeMagicToken(tokenHash: string, nowMs: number): Promise<string | null> {
    const row = await this.db
      .prepare(
        `DELETE FROM magic_tokens WHERE token_hash = ?1 AND expires_at_ms > ?2
         RETURNING email`,
      )
      .bind(tokenHash, nowMs)
      .first<{ email: string }>();
    return row?.email ?? null;
  }

  async putWatchTicket(tokenHash: string, accountId: string, expiresAtMs: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO watch_tickets (token_hash, account_id, expires_at_ms)
         VALUES (?1, ?2, ?3)`,
      )
      .bind(tokenHash, accountId, expiresAtMs)
      .run();
  }

  async consumeWatchTicket(tokenHash: string, nowMs: number): Promise<string | null> {
    const row = await this.db
      .prepare(
        `DELETE FROM watch_tickets WHERE token_hash = ?1 AND expires_at_ms > ?2
         RETURNING account_id`,
      )
      .bind(tokenHash, nowMs)
      .first<{ account_id: string }>();
    return row?.account_id ?? null;
  }

  async putOauthState(
    stateHash: string,
    provider: string,
    client: "app" | "web",
    lang: string,
    expiresAtMs: number,
    now: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO oauth_states
            (state_hash, provider, client, lang, expires_at_ms, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(stateHash, provider, client, lang, expiresAtMs, now)
      .run();
  }

  async consumeOauthState(
    stateHash: string,
    nowMs: number,
  ): Promise<{ provider: string; client: "app" | "web"; lang: string } | null> {
    const row = await this.db
      .prepare(
        `DELETE FROM oauth_states WHERE state_hash = ?1 AND expires_at_ms > ?2
         RETURNING provider, client, lang`,
      )
      .bind(stateHash, nowMs)
      .first<{ provider: string; client: string; lang: string }>();
    if (!row) return null;
    return {
      provider: row.provider,
      client: row.client === "web" ? "web" : "app",
      lang: row.lang,
    };
  }

  async putSession(tokenHash: string, accountId: string, now: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sessions (token_hash, account_id, created_at) VALUES (?1, ?2, ?3)`,
      )
      .bind(tokenHash, accountId, now)
      .run();
  }

  async sessionAccount(tokenHash: string): Promise<string | null> {
    const row = await this.db
      .prepare(`SELECT account_id FROM sessions WHERE token_hash = ?1`)
      .bind(tokenHash)
      .first<{ account_id: string }>();
    return row?.account_id ?? null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.prepare(`DELETE FROM sessions WHERE token_hash = ?1`).bind(tokenHash).run();
  }

  async setTierByEmail(
    email: string,
    tier: SyncTier,
    tierExpiresAtMs: number | null,
  ): Promise<Account | null> {
    const row = await this.db
      .prepare(
        `UPDATE accounts SET tier = ?2, tier_expires_at_ms = ?3
          WHERE email = ?1 RETURNING *`,
      )
      .bind(email, tier, tierExpiresAtMs)
      .first<AccountRow>();
    return row ? rowToAccount(row) : null;
  }

  async adjustBlobBytes(id: string, delta: number): Promise<number> {
    const row = await this.db
      .prepare(
        `UPDATE accounts SET blob_bytes_used = MAX(0, blob_bytes_used + ?2)
          WHERE id = ?1 RETURNING blob_bytes_used`,
      )
      .bind(id, delta)
      .first<{ blob_bytes_used: number }>();
    if (!row) throw new Error("relay: unknown account in adjustBlobBytes");
    return Number(row.blob_bytes_used);
  }

  async deleteAccount(id: string): Promise<void> {
    await this.db.prepare(`DELETE FROM sessions WHERE account_id = ?1`).bind(id).run();
    await this.db.prepare(`DELETE FROM accounts WHERE id = ?1`).bind(id).run();
  }
}
