/**
 * Test harness: the relay's real storage logic over bun:sqlite. The account
 * store runs the SAME SQL as D1 (through a D1-shaped adapter), each mailbox
 * runs the SAME MailboxCore as the Durable Object, and the D1 migration file
 * is applied verbatim — so the suite exercises production SQL, not a fake.
 * Only R2 is substituted with a Map, whose contract is trivial.
 */
import { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { SqlAccountStore, type D1Like } from "../src/account-store";
import { MailboxCore, type SqlExec } from "../src/mailbox-core";
import {
  DEFAULT_CONFIG,
  type BlobStore,
  type Mailbox,
  type OAuthProvider,
  type RelayConfig,
  type RelayPorts,
} from "../src/ports";
import { createRelayHandler } from "../src/router";

const MIGRATIONS_DIR = join(import.meta.dir, "../migrations");
const MIGRATIONS = await Promise.all(
  readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => Bun.file(join(MIGRATIONS_DIR, name)).text()),
);

function d1Over(db: Database): D1Like {
  return {
    prepare: (sql) => ({
      bind: (...values) => ({
        first: async <T,>() => (db.query(sql).get(...(values as never[])) as T) ?? null,
        run: async () => {
          db.query(sql).run(...(values as never[]));
        },
        all: async <T,>() => ({ results: db.query(sql).all(...(values as never[])) as T[] }),
      }),
    }),
  };
}

function sqlOver(db: Database): SqlExec {
  return {
    // The DO's sql.exec() runs EAGERLY (toArray just reads the cursor) — the
    // adapter must match, or DDL statements whose rows nobody reads never run.
    exec: (query, ...bindings) => {
      const rows = db.query(query).all(...(bindings as never[])) as Record<string, unknown>[];
      return { toArray: () => rows };
    },
  };
}

function coreMailbox(core: MailboxCore, nowIso: () => string): Mailbox {
  return {
    append: async (events) => core.append(events, nowIso()),
    listAfter: async (after, limit) => core.listAfter(after, limit),
    wipe: async () => core.wipe(),
  };
}

function memoryBlobStore(): BlobStore {
  const objects = new Map<string, Uint8Array>();
  const path = (accountId: string, key: string) => `${accountId}/${key}`;
  return {
    async put(accountId, key, bytes) {
      objects.set(path(accountId, key), bytes);
    },
    async get(accountId, key) {
      return objects.get(path(accountId, key)) ?? null;
    },
    async delete(accountId, key) {
      const existing = objects.get(path(accountId, key));
      objects.delete(path(accountId, key));
      return existing?.length ?? 0;
    },
    async wipe(accountId) {
      for (const key of [...objects.keys()]) {
        if (key.startsWith(`${accountId}/`)) objects.delete(key);
      }
    },
  };
}

export function makeRelay(
  config: Partial<RelayConfig> = {},
  oauthProviders: Record<string, OAuthProvider> = {},
) {
  const db = new Database(":memory:");
  for (const migration of MIGRATIONS) db.exec(migration);
  let nowMs = 1_755_000_000_000;
  const nowIso = () => new Date(nowMs).toISOString();
  const mailboxes = new Map<string, Mailbox>();
  const ports: RelayPorts = {
    accounts: new SqlAccountStore(d1Over(db)),
    mailboxFor(accountId) {
      let mailbox = mailboxes.get(accountId);
      if (!mailbox) {
        const core = new MailboxCore(sqlOver(new Database(":memory:")));
        core.ensureSchema();
        mailbox = coreMailbox(core, nowIso);
        mailboxes.set(accountId, mailbox);
      }
      return mailbox;
    },
    blobs: memoryBlobStore(),
    magicLink: null,
    oauthProviders,
    config: { ...DEFAULT_CONFIG, echoMagicToken: true, ...config },
    now: () => nowMs,
  };
  return {
    handle: createRelayHandler(ports),
    advance(ms: number) {
      nowMs += ms;
    },
  };
}

type Handle = (req: Request) => Promise<Response>;

const BASE = "https://relay.test";

export function post(path: string, body: unknown, session?: string): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: session ? { authorization: `Bearer ${session}` } : {},
  });
}

export function get(path: string, session?: string): Request {
  return new Request(`${BASE}${path}`, {
    headers: session ? { authorization: `Bearer ${session}` } : {},
  });
}

export function putBytes(path: string, bytes: Uint8Array, session: string): Request {
  return new Request(`${BASE}${path}`, {
    method: "PUT",
    body: bytes,
    headers: { authorization: `Bearer ${session}` },
  });
}

export function del(path: string, session: string): Request {
  return new Request(`${BASE}${path}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${session}` },
  });
}

/** Full magic-link round trip in echo mode. */
export async function login(handle: Handle, email: string) {
  const requested = await handle(post("/v1/auth/request", { email }));
  const { devToken } = (await requested.json()) as { devToken: string };
  const verified = await handle(post("/v1/auth/verify", { token: devToken }));
  return (await verified.json()) as {
    session: string;
    accountId: string;
    keys: { kdfSalt: string; keyCheck: string } | null;
  };
}

let eventCounter = 0;

/** A fabricated sealed envelope — the relay must treat ciphertext as opaque. */
export function sealed(id?: string, wallMs = 1_755_000_000_000) {
  eventCounter += 1;
  return {
    id: id ?? `evt-${eventCounter}`,
    hlc: { wallMs, counter: eventCounter, deviceId: "device-test" },
    v: 1 as const,
    nonce: "bm9uY2Vfbm9uY2Vfbm9uY2VfMjRi",
    ciphertext: "b3BhcXVlLWJ5dGVz",
  };
}
