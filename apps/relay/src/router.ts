/**
 * The relay's HTTP surface (docs/sync-engine.md §3-§5): magic-link auth, the
 * numbered ciphertext mailbox, and encrypted blob storage. Pure request →
 * response over RelayPorts — no Cloudflare types in here, which is what lets
 * the whole surface run under bun:test against sqlite-backed ports.
 *
 * The relay never decrypts, never validates event schemas, never understands
 * `type` — it checks shapes and sizes, assigns numbers, and hands ciphertext
 * back. Client schema evolution must never require touching this file.
 */
import type { HlcStamp, SealedEventWire, SyncKeyMaterial } from "@read-aware/core";
import type { Account, RelayPorts } from "./ports";

// ── Small helpers ────────────────────────────────────────────────────────────

/**
 * The client is a Tauri webview (origin `tauri://localhost` or a dev
 * localhost), so every response needs CORS. `*` is safe here: auth is a
 * bearer token the page attaches explicitly, never an ambient cookie.
 */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

const failure = (status: number, error: string) => json(status, { error });

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Tokens are stored hashed; a leaked database yields nothing replayable. */
export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readJson(req: Request): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

const isString = (v: unknown): v is string => typeof v === "string";
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isHlcStamp(v: unknown): v is HlcStamp {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return isFiniteNumber(s.wallMs) && isFiniteNumber(s.counter) && isString(s.deviceId);
}

function isSealedEvent(v: unknown): v is SealedEventWire {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    isString(e.id) &&
    e.id.length > 0 &&
    e.id.length <= 128 &&
    isHlcStamp(e.hlc) &&
    e.v === 1 &&
    isString(e.nonce) &&
    isString(e.ciphertext) &&
    e.ciphertext.length > 0
  );
}

function isKeyMaterial(v: unknown): v is SyncKeyMaterial {
  if (typeof v !== "object" || v === null) return false;
  const k = v as Record<string, unknown>;
  if (!isString(k.kdfSalt) || !isString(k.keyCheck)) return false;
  if (typeof k.kdfParams !== "object" || k.kdfParams === null) return false;
  const p = k.kdfParams as Record<string, unknown>;
  return (
    p.algo === "argon2id" && isFiniteNumber(p.t) && isFiniteNumber(p.m) && isFiniteNumber(p.p)
  );
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Blob keys mirror the client registry: `<prefix>:<id>`, filesystem-ish. */
const BLOB_KEY_SHAPE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/;

// ── The handler ──────────────────────────────────────────────────────────────

export function createRelayHandler(ports: RelayPorts): (req: Request) => Promise<Response> {
  const { accounts, blobs, config } = ports;
  const nowIso = () => new Date(ports.now()).toISOString();

  async function authenticate(req: Request): Promise<Account | null> {
    const header = req.headers.get("authorization") ?? "";
    if (!header.startsWith("Bearer ")) return null;
    const accountId = await accounts.sessionAccount(await tokenHash(header.slice(7)));
    if (!accountId) return null;
    return accounts.get(accountId);
  }

  async function handleAuthRequest(req: Request): Promise<Response> {
    const body = await readJson(req);
    const email =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).email
        : undefined;
    if (!isString(email) || !EMAIL_SHAPE.test(email)) {
      return failure(400, "a valid email is required");
    }
    const normalized = email.trim().toLowerCase();
    const token = randomToken();
    await accounts.putMagicToken(
      await tokenHash(token),
      normalized,
      ports.now() + config.magicTokenTtlMs,
      nowIso(),
    );
    if (config.echoMagicToken) return json(200, { ok: true, devToken: token });
    if (!ports.magicLink) return failure(501, "magic-link delivery is not configured");
    await ports.magicLink.send(normalized, token);
    return json(200, { ok: true });
  }

  async function handleAuthVerify(req: Request): Promise<Response> {
    const body = await readJson(req);
    const token =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).token
        : undefined;
    if (!isString(token) || token.length === 0) return failure(400, "token is required");
    const email = await accounts.consumeMagicToken(await tokenHash(token), ports.now());
    if (!email) return failure(401, "invalid or expired token");
    const account = await accounts.findOrCreateByEmail(email, nowIso());
    const session = randomToken();
    await accounts.putSession(await tokenHash(session), account.id, nowIso());
    return json(200, { session, accountId: account.id, keys: account.keys });
  }

  async function handlePushEvents(account: Account, req: Request): Promise<Response> {
    const body = await readJson(req);
    const events =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).events
        : undefined;
    if (!Array.isArray(events)) return failure(400, "events array is required");
    if (events.length > config.maxBatch) {
      return failure(413, `batch exceeds ${config.maxBatch} events`);
    }
    for (const ev of events) {
      if (!isSealedEvent(ev)) return failure(400, "malformed sealed event");
      if (JSON.stringify(ev).length > config.maxEventBytes) {
        return failure(413, `event exceeds ${config.maxEventBytes} bytes`);
      }
    }
    const seqs = await ports.mailboxFor(account.id).append(events as SealedEventWire[]);
    return json(200, { seqs });
  }

  async function handlePullEvents(account: Account, url: URL): Promise<Response> {
    const after = Number(url.searchParams.get("after") ?? "0");
    if (!Number.isInteger(after) || after < 0) return failure(400, "after must be a non-negative integer");
    const requested = Number(url.searchParams.get("limit") ?? config.maxPullLimit);
    const limit = Number.isInteger(requested)
      ? Math.max(1, Math.min(requested, config.maxPullLimit))
      : config.maxPullLimit;
    const page = await ports.mailboxFor(account.id).listAfter(after, limit);
    return json(200, page);
  }

  async function handleBlob(account: Account, req: Request, key: string): Promise<Response> {
    if (!BLOB_KEY_SHAPE.test(key)) return failure(400, "malformed blob key");
    if (req.method === "GET") {
      const bytes = await blobs.get(account.id, key);
      if (!bytes) return failure(404, "no such blob");
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": "application/octet-stream", ...CORS_HEADERS },
      });
    }
    if (req.method === "PUT") {
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length === 0) return failure(400, "empty blob");
      if (bytes.length > config.maxBlobBytes) {
        return failure(413, `blob exceeds ${config.maxBlobBytes} bytes`);
      }
      // Replacing a key frees its old bytes first, so re-uploads don't leak
      // quota. The account row is the accountant; R2 is just the shelf.
      const freed = await blobs.delete(account.id, key);
      const used = await accounts.adjustBlobBytes(account.id, bytes.length - freed);
      if (used > config.maxAccountBlobBytes) {
        await accounts.adjustBlobBytes(account.id, -bytes.length);
        return failure(413, "account blob quota exceeded");
      }
      await blobs.put(account.id, key, bytes);
      return json(200, { ok: true, bytesUsed: used });
    }
    if (req.method === "DELETE") {
      const freed = await blobs.delete(account.id, key);
      if (freed > 0) await accounts.adjustBlobBytes(account.id, -freed);
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    return failure(405, "method not allowed");
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (req.method === "POST" && path === "/v1/auth/request") return handleAuthRequest(req);
    if (req.method === "POST" && path === "/v1/auth/verify") return handleAuthVerify(req);

    // Everything below requires a session.
    const account = await authenticate(req);
    if (!account) return failure(401, "authentication required");

    if (req.method === "POST" && path === "/v1/auth/logout") {
      const header = req.headers.get("authorization") ?? "";
      await accounts.deleteSession(await tokenHash(header.slice(7)));
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (req.method === "GET" && path === "/v1/account") {
      return json(200, {
        accountId: account.id,
        email: account.email,
        keys: account.keys,
        blobBytesUsed: account.blobBytesUsed,
      });
    }
    if (req.method === "POST" && path === "/v1/account/keys") {
      const body = await readJson(req);
      if (!isKeyMaterial(body)) return failure(400, "malformed key material");
      const outcome = await accounts.setKeys(account.id, body);
      if (outcome === "already-set") {
        // Not an error state the client can fix by retrying — hand back the
        // canonical material so it can re-verify the passphrase against it.
        const current = await accounts.get(account.id);
        return json(409, { error: "key material is already published", keys: current?.keys });
      }
      return json(200, { ok: true });
    }
    if (req.method === "DELETE" && path === "/v1/account") {
      await ports.mailboxFor(account.id).wipe();
      await blobs.wipe(account.id);
      await accounts.deleteAccount(account.id);
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (path === "/v1/events") {
      if (req.method === "POST") return handlePushEvents(account, req);
      if (req.method === "GET") return handlePullEvents(account, url);
      return failure(405, "method not allowed");
    }
    if (path.startsWith("/v1/blobs/")) {
      return handleBlob(account, req, decodeURIComponent(path.slice("/v1/blobs/".length)));
    }
    return failure(404, "no such route");
  };
}
