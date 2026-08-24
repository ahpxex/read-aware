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
import {
  costMicroUsd,
  creditsFromMicroUsd,
  meterSseStream,
  monthKey,
  MICRO_USD_PER_CREDIT,
  usageFromOpenAI,
  type AiUsage,
} from "./ai-proxy";
import {
  applyStripeEvent,
  createBillingContext,
  createCheckoutSession,
  createPortalSession,
  isBillingPlan,
  verifyStripeSignature,
  StripeError,
} from "./billing";
import { isAccountTier, quotasForTier, resolveTier, type Account, type RelayPorts } from "./ports";
import { foldClientIp, windowStartMs } from "./rate-limit-store";
import { BILLING_PAGE, PAGE, resolveLang, type RelayLang } from "./i18n";

/**
 * The `client=app` OAuth finish: a self-contained page that hands the
 * one-time sign-in token back to the app through its readaware:// deep link —
 * attempted automatically on load, with an explicit button, and a copyable
 * token as the fallback for environments where the link can't reach the app.
 * Deliberately dependency-free and bilingual; the token expires with the same
 * TTL as a magic link. (Tokens are base64url, safe verbatim in HTML and URLs;
 * the escape is defense in depth.)
 */
function signInTokenPage(token: string, lang: RelayLang): Response {
  const esc = token.replace(/[&<>"']/g, "");
  const deepLink = `readaware://sync/login/${esc}`;
  const t = PAGE[lang];
  return new Response(
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ReadAware Sync</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;background:#faf9f7;color:#292524;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  main{max-width:26rem;padding:2rem;text-align:center}
  a.open{display:inline-block;margin:1.25rem 0 .5rem;padding:.7rem 1.6rem;background:#1c1917;color:#faf9f7;border-radius:.5rem;text-decoration:none;font-weight:600}
  details{margin-top:1.5rem}
  summary{cursor:pointer;color:#57534e;font-size:.92rem}
  code{display:block;margin:1rem 0 0;padding:.9rem 1rem;background:#f5f5f4;border:1px solid #e7e5e4;border-radius:.5rem;font-size:.95rem;word-break:break-all;user-select:all}
  p{line-height:1.6;color:#57534e;font-size:.92rem}
  h1{font-size:1.15rem;font-weight:600}
</style></head><body><main>
  <h1>${t.signedIn}</h1>
  <p>${t.opening}</p>
  <a class="open" href="${deepLink}">${t.open}</a>
  <details>
    <summary>${t.fallbackSummary}</summary>
    <code>${esc}</code>
  </details>
  <p>${t.expires}</p>
  <script>location.href=${JSON.stringify(deepLink)};</script>
</main></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/**
 * Where Stripe sends an APP-initiated checkout after payment: a page in the
 * OAuth-finish mold that bounces straight back into the app through the
 * readaware:// deep link. Web-visitor checkouts never come here — they return
 * to the pricing page, whose banner explains the email-keyed sign-in.
 */
function billingReturnPage(lang: RelayLang): Response {
  const deepLink = "readaware://billing/success";
  const t = BILLING_PAGE[lang];
  return new Response(
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ReadAware</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;background:#faf9f7;color:#292524;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  main{max-width:26rem;padding:2rem;text-align:center}
  a.open{display:inline-block;margin:1.25rem 0 .5rem;padding:.7rem 1.6rem;background:#1c1917;color:#faf9f7;border-radius:.5rem;text-decoration:none;font-weight:600}
  p{line-height:1.6;color:#57534e;font-size:.92rem}
  h1{font-size:1.15rem;font-weight:600}
</style></head><body><main>
  <h1>${t.title}</h1>
  <p>${t.returning}</p>
  <a class="open" href="${deepLink}">${t.open}</a>
  <p>${t.close}</p>
  <script>location.href=${JSON.stringify(deepLink)};</script>
</main></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

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

/** The throttle subject for a request's client address: folded to its /64
 *  (IPv6 rotation otherwise mints unlimited "distinct" addresses), hashed. */
async function clientIpHash(req: Request): Promise<string> {
  return tokenHash(foldClientIp(req.headers.get("cf-connecting-ip") ?? "unknown"));
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
  const billing = ports.stripe ? createBillingContext(ports.stripe) : null;

  // ── Code-level throttles (docs/sync-engine.md §4) ─────────────────────────
  //
  // Exact business windows counted in D1. Edge WAF rules absorb coarse bursts
  // before the Worker, but cannot replace email/account identities or these
  // longer windows. Subjects are hashed; refusals still count, so a sustained
  // flood keeps its window saturated instead of slipping through on retries.
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  /** Count a hit; false when the subject is over its cap for this window. */
  const allow = (
    bucket: string,
    subjectHash: string,
    windowMs: number,
    max: number,
  ): Promise<boolean> =>
    ports.rateLimits
      .hit(bucket, subjectHash, windowStartMs(ports.now(), windowMs))
      .then((count) => count <= max);
  const ipThrottled = (req: Request, bucket: string, windowMs: number, max: number) =>
    clientIpHash(req).then((ip) => allow(bucket, ip, windowMs, max));

  /**
   * User-initiated diagnostic report (Settings → export/report diagnostics).
   * Unauthenticated by design — the user most in need of reporting is the one
   * whose app cannot sign in — so it is bounded instead: size-capped, per-IP
   * throttled, write-only (reading reports is a wrangler job, never a route).
   */
  async function handleReport(req: Request): Promise<Response> {
    const raw = await req.text();
    if (raw.length > config.maxReportBytes) {
      return failure(413, `report exceeds ${config.maxReportBytes} bytes`);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return failure(400, "report must be JSON");
    }
    if (typeof body !== "object" || body === null) return failure(400, "report must be JSON");
    const report = body as Record<string, unknown>;
    if (!isString(report.appVersion) || report.appVersion.length > 64) {
      return failure(400, "appVersion is required");
    }
    if (!isString(report.platform) || report.platform.length > 64) {
      return failure(400, "platform is required");
    }
    if (typeof report.bundle !== "object" || report.bundle === null) {
      return failure(400, "bundle is required");
    }

    // Workers put the client address in cf-connecting-ip; folding to /64 and
    // hashing keeps the row throttle-able without storing an identifier.
    const ipHash = await tokenHash(foldClientIp(req.headers.get("cf-connecting-ip") ?? "unknown"));
    const dayAgo = ports.now() - 24 * 60 * 60 * 1000;
    if ((await ports.reports.countSince(ipHash, dayAgo)) >= config.maxReportsPerIpPerDay) {
      return failure(429, "too many reports from this address; try again tomorrow");
    }

    const id = crypto.randomUUID();
    const payload = new TextEncoder().encode(raw);
    await ports.reports.submit(
      {
        id,
        createdAt: nowIso(),
        createdAtMs: ports.now(),
        ipHash,
        appVersion: report.appVersion,
        platform: report.platform,
        bytes: payload.length,
      },
      payload,
    );
    return json(200, { ok: true, reportId: id });
  }

  /** The account's quota numbers, expiry already applied. Enforcement is
   * write-time only — pulls and reads never consult this. */
  const quotasOf = (account: Account) =>
    quotasForTier(resolveTier(account, ports.now()), config);

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
    // The mail-bombing guard: a victim's inbox must not be reachable through
    // our sender, so a handful of mails per address per window is plenty for
    // any human. Skipped in echo mode only because nothing is sent — the per-IP
    // cap below still bounds even local hammering.
    if (
      !config.echoMagicToken &&
      !(await allow("auth-mail", await tokenHash(normalized), 15 * MINUTE, config.authMailPerEmailPer15Min))
    ) {
      return failure(429, "too many sign-in emails requested for this address; try again later");
    }
    if (!(await ipThrottled(req, "auth-ip", HOUR, config.authRequestPerIpPerHour))) {
      return failure(429, "too many sign-in requests from this address; try again later");
    }
    const token = randomToken();
    await accounts.putMagicToken(
      await tokenHash(token),
      normalized,
      ports.now() + config.magicTokenTtlMs,
      nowIso(),
    );
    if (config.echoMagicToken) return json(200, { ok: true, devToken: token });
    if (!ports.magicLink) return failure(501, "magic-link delivery is not configured");
    const lang = resolveLang(
      isString((body as Record<string, unknown>).lang)
        ? ((body as Record<string, unknown>).lang as string)
        : null,
    );
    await ports.magicLink.send(normalized, token, lang);
    return json(200, { ok: true });
  }

  /**
   * OAuth start/callback. OAuth here only replaces "prove you own this email":
   * the callback mints the SAME single-use sign-in token as the magic link,
   * so /v1/auth/verify — and everything after it (session, E2E passphrase) —
   * is shared verbatim between magic-link, Google, and GitHub, and between
   * the desktop app and a future web client.
   */
  async function handleOauth(req: Request, url: URL, providerId: string, action: string): Promise<Response> {
    const provider = ports.oauthProviders[providerId];
    if (!provider) return failure(404, "unknown oauth provider");
    const redirectUri = `${url.origin}/v1/auth/oauth/${providerId}/callback`;

    if (action === "start" && req.method === "GET") {
      // Every start mints a state row — an anonymous, unbounded loop would
      // grow D1 for free. The cap is generous: a human starts one or two.
      if (!(await ipThrottled(req, "oauth-ip", HOUR, config.oauthStartPerIpPerHour))) {
        return failure(429, "too many sign-in attempts from this address; try again later");
      }
      const client = url.searchParams.get("client") === "web" ? "web" : "app";
      // The finish page renders in the app's locale, but the callback only
      // carries `state` — so the language travels with the state row.
      const lang = resolveLang(url.searchParams.get("lang"));
      const state = randomToken();
      await accounts.putOauthState(
        await tokenHash(state),
        providerId,
        client,
        lang,
        ports.now() + config.magicTokenTtlMs,
        nowIso(),
      );
      return Response.redirect(provider.authorizeUrl(state, redirectUri), 302);
    }

    if (action === "callback" && req.method === "GET") {
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (!state || !code) return failure(400, "missing code or state");
      const minted = await accounts.consumeOauthState(await tokenHash(state), ports.now());
      if (!minted || minted.provider !== providerId) {
        return failure(401, "invalid or expired oauth state");
      }
      let email: string;
      try {
        email = await provider.exchangeCode(code, redirectUri);
      } catch (error) {
        console.error(`[relay] oauth exchange failed for ${providerId}`, error);
        return failure(502, "oauth exchange failed");
      }
      const signIn = randomToken();
      await accounts.putMagicToken(
        await tokenHash(signIn),
        email.trim().toLowerCase(),
        ports.now() + config.magicTokenTtlMs,
        nowIso(),
      );
      const lang = resolveLang(minted.lang);
      if (minted.client === "web") {
        // Fixed, configured origin only — the state row decides, never a
        // caller-supplied URL, so this can't become an open redirect. The
        // lang rides the query; the token stays in the fragment, which the
        // browser never sends to the landing's server.
        return Response.redirect(
          `${config.webAppOrigin}/sync/login?lang=${encodeURIComponent(lang)}#token=${encodeURIComponent(signIn)}`,
          302,
        );
      }
      return signInTokenPage(signIn, lang);
    }
    return failure(405, "method not allowed");
  }

  /**
   * The tier write seam — operator-only, its own bearer secret (never a user
   * session). Today a human runs it with curl; a payment webhook later calls
   * the same route. Comparing SHA-256 hashes instead of the raw strings keeps
   * the comparison's timing independent of how much of the secret matched.
   */
  async function handleAdminTier(req: Request): Promise<Response> {
    if (!config.adminToken) return failure(501, "admin operations are not configured");
    const header = req.headers.get("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    if ((await tokenHash(presented)) !== (await tokenHash(config.adminToken))) {
      return failure(401, "a valid admin token is required");
    }
    const body = await readJson(req);
    if (typeof body !== "object" || body === null) return failure(400, "a JSON body is required");
    const { email, tier, expiresAtMs } = body as Record<string, unknown>;
    if (!isString(email) || !EMAIL_SHAPE.test(email)) {
      return failure(400, "a valid email is required");
    }
    if (!isAccountTier(tier)) return failure(400, "unknown tier");
    if (expiresAtMs !== undefined && expiresAtMs !== null && !isFiniteNumber(expiresAtMs)) {
      return failure(400, "expiresAtMs must be a millisecond timestamp or null");
    }
    const updated = await accounts.setTierByEmail(
      email.trim().toLowerCase(),
      tier,
      expiresAtMs ?? null,
    );
    if (!updated) return failure(404, "no account with that email");
    return json(200, {
      accountId: updated.id,
      email: updated.email,
      tier: updated.tier,
      tierExpiresAtMs: updated.tierExpiresAtMs,
    });
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
    // `email` is the login-CSRF defense: the client can only ask the user for
    // an encryption passphrase AFTER showing which account the token opened
    // (docs/sync-engine.md §5). A token for an attacker's account must never
    // be connectable while looking like "just finish signing in".
    return json(200, { session, accountId: account.id, email: account.email, keys: account.keys });
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
    const quota = quotasOf(account).maxAccountEvents;
    const seqs = await ports
      .mailboxFor(account.id)
      .append(events as SealedEventWire[], quota ?? Number.MAX_SAFE_INTEGER);
    if (seqs === "full") return failure(413, "account event quota exceeded");
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

  // ── Chunked blobs ──────────────────────────────────────────────────────────
  //
  // A whole blob in one request caps a book at whatever one Worker request may
  // buffer, so large files ride as SEALED PARTS instead (client protocol in
  // apps/web sync-envelope.ts v2): each part is staged at the internal R2 key
  // `<key>#<index>` (BLOB_KEY_SHAPE forbids '#', so parts can never collide
  // with a client key), then a commit writes a 5-byte descriptor
  // [2][partCount:u32be] at the main key. GET of the main key hands the client
  // that descriptor; the leading version byte tells it whether to open a v1
  // whole blob or fetch parts. The relay understands none of the contents —
  // both formats are ciphertext, and part integrity/ordering is the client's
  // AEAD (each part's AAD binds key+index+count), not ours.
  //
  // Accounting: parts count toward the account total AS THEY ARE STAGED — an
  // abandoned upload holds quota until re-staged, committed, or deleted, which
  // keeps "cost to the operator" and "usage shown to the user" the same number
  // with no separate staging ledger. There is deliberately NO per-file cap on
  // a chunked blob: the per-part cap bounds each request, and the account
  // quota is the real bill guard. (`maxBlobBytes` still caps the legacy
  // single-request PUT.)
  const partKey = (key: string, index: number) => `${key}#${index}`;
  const MAX_BLOB_PARTS = 100_000;
  // Sealed part = 8 MiB plaintext + 41 bytes of envelope; leave headroom.
  const MAX_PART_BYTES = 12 * 1024 * 1024;

  /** Delete staged/stale parts of `key` starting at `from` until a gap;
   *  returns the bytes freed. Parts are contiguous from 0 by construction. */
  async function sweepParts(accountId: string, key: string, from: number): Promise<number> {
    let freed = 0;
    for (let index = from; index < MAX_BLOB_PARTS; index += 1) {
      const size = await blobs.delete(accountId, partKey(key, index));
      if (size === 0) break;
      freed += size;
    }
    return freed;
  }

  async function handleBlob(account: Account, req: Request, key: string, url: URL): Promise<Response> {
    if (!BLOB_KEY_SHAPE.test(key)) return failure(400, "malformed blob key");
    const partParam = url.searchParams.get("part");
    const part = partParam === null ? null : Number(partParam);
    if (part !== null && (!Number.isInteger(part) || part < 0 || part >= MAX_BLOB_PARTS)) {
      return failure(400, "malformed part index");
    }

    if (req.method === "GET") {
      const bytes = await blobs.get(account.id, part === null ? key : partKey(key, part));
      if (!bytes) return failure(404, "no such blob");
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": "application/octet-stream", ...CORS_HEADERS },
      });
    }

    if (req.method === "PUT" && part !== null) {
      // Stage one part of a chunked upload.
      const quotas = quotasOf(account);
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length === 0) return failure(400, "empty blob part");
      if (bytes.length > MAX_PART_BYTES) {
        return failure(413, `blob part exceeds ${MAX_PART_BYTES} bytes`);
      }
      const freed = await blobs.delete(account.id, partKey(key, part));
      const used = await accounts.adjustBlobBytes(account.id, bytes.length - freed);
      if (quotas.maxAccountBlobBytes !== null && used > quotas.maxAccountBlobBytes) {
        await accounts.adjustBlobBytes(account.id, -bytes.length);
        return failure(413, "account blob quota exceeded");
      }
      await blobs.put(account.id, partKey(key, part), bytes);
      return json(200, { ok: true, bytesUsed: used });
    }

    if (req.method === "PUT" && url.searchParams.get("commit") !== null) {
      // Commit a chunked upload: verify the staged run, publish the
      // descriptor, sweep whatever a previous (larger) upload left behind.
      const parts = Number(url.searchParams.get("parts"));
      if (!Number.isInteger(parts) || parts < 1 || parts > MAX_BLOB_PARTS) {
        return failure(400, "malformed parts count");
      }
      for (let index = 0; index < parts; index += 1) {
        const size = await blobs.head(account.id, partKey(key, index));
        if (size === null) return failure(400, `missing staged part ${index}`);
      }
      const descriptor = new Uint8Array(5);
      descriptor[0] = 2;
      new DataView(descriptor.buffer).setUint32(1, parts, false);
      const freedMain = await blobs.delete(account.id, key);
      const freedStale = await sweepParts(account.id, key, parts);
      const used = await accounts.adjustBlobBytes(
        account.id,
        descriptor.length - freedMain - freedStale,
      );
      await blobs.put(account.id, key, descriptor);
      return json(200, { ok: true, bytesUsed: used });
    }

    if (req.method === "PUT") {
      // Legacy/small path: the whole sealed blob in one request.
      const quotas = quotasOf(account);
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length === 0) return failure(400, "empty blob");
      if (quotas.maxBlobBytes !== null && bytes.length > quotas.maxBlobBytes) {
        return failure(413, `blob exceeds ${quotas.maxBlobBytes} bytes`);
      }
      // Replacing a key frees its old bytes first, so re-uploads don't leak
      // quota. The account row is the accountant; R2 is just the shelf.
      const freed = await blobs.delete(account.id, key);
      const freedParts = await sweepParts(account.id, key, 0);
      const used = await accounts.adjustBlobBytes(
        account.id,
        bytes.length - freed - freedParts,
      );
      if (quotas.maxAccountBlobBytes !== null && used > quotas.maxAccountBlobBytes) {
        await accounts.adjustBlobBytes(account.id, -bytes.length);
        return failure(413, "account blob quota exceeded");
      }
      await blobs.put(account.id, key, bytes);
      return json(200, { ok: true, bytesUsed: used });
    }

    if (req.method === "DELETE") {
      const freed =
        (await blobs.delete(account.id, key)) + (await sweepParts(account.id, key, 0));
      if (freed > 0) await accounts.adjustBlobBytes(account.id, -freed);
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    return failure(405, "method not allowed");
  }

  // ── Billing ───────────────────────────────────────────────────────────────

  /** The landing's locale prefixes; anything unrecognized lands on English. */
  const localePrefix = (locale: unknown): string =>
    typeof locale === "string" && ["zh", "zh-hant", "ja", "fr", "de", "ru", "es"].includes(locale)
      ? `/${locale}`
      : "";

  const stripeFailure = (error: unknown): Response => {
    if (error instanceof StripeError) {
      // 409 (already subscribed) is the caller's to handle; anything else is
      // an upstream fault this endpoint can only report.
      return failure(error.status === 409 ? 409 : 502, error.message);
    }
    throw error;
  };

  /**
   * Checkout works signed-in AND signed-out. Signed-in (bearer present) the
   * session is tied to the account and the email is locked; signed-out (the
   * landing's pricing page) Stripe collects the email and the webhook keys
   * fulfillment to it — accounts are keyed by email, so the buyer's later
   * sign-in lands on the already-upgraded row.
   */
  async function handleBillingCheckout(req: Request): Promise<Response> {
    if (!billing) return failure(501, "billing is not configured");
    const body = await readJson(req);
    if (typeof body !== "object" || body === null) return failure(400, "a JSON body is required");
    const { plan, locale, ticket } = body as Record<string, unknown>;
    if (!isBillingPlan(plan)) return failure(400, "unknown plan");
    // Every door reaches Stripe after this point. Bound the source before any
    // ticket/session lookup so bogus tickets and account rotation cannot turn
    // the optional-auth surface back into an unmetered upstream proxy.
    if (!(await ipThrottled(req, "checkout-ip", HOUR, config.checkoutPerIpPerHour))) {
      return failure(429, "too many checkout attempts from this address; try again later");
    }
    // Three doors, one handler: a billing ticket (the pricing page opened
    // FROM the app — bind that account and return the buyer to the app), a
    // bearer session (in-app callers), or neither (a web visitor — Stripe
    // collects the email and the webhook keys fulfillment to it).
    let account: Account | null = null;
    let appInitiated = false;
    if (isString(ticket) && ticket.length > 0) {
      const accountId = await accounts.ticketAccount(
        await tokenHash(`billing:${ticket}`),
        ports.now(),
      );
      if (!accountId) return failure(401, "invalid or expired upgrade ticket");
      account = await accounts.get(accountId);
      if (!account) return failure(401, "the upgrade account no longer exists");
      appInitiated = true;
    } else {
      account = await authenticate(req);
    }
    // IP limits slow account rotation; this stable account bucket closes the
    // inverse bypass (one signed-in account rotating IPs). Billing tickets are
    // reusable across cancel/retry, so they deliberately land in the same
    // account counter instead of becoming a fourth, unmetered identity.
    if (
      account &&
      !(await allow(
        "checkout-account",
        await tokenHash(account.id),
        HOUR,
        config.checkoutPerAccountPerHour,
      ))
    ) {
      return failure(429, "too many checkout attempts for this account; try again later");
    }
    const pricingUrl = `${config.webAppOrigin}${localePrefix(locale)}/pricing`;
    const lang = resolveLang(isString(locale) ? locale : null);
    try {
      const { url } = await createCheckoutSession(billing, {
        plan,
        successUrl: appInitiated
          ? // Back into the app, not to the pricing page: the deep-link page
            // returns the buyer to a session that is already signed in. The
            // origin comes from config — req.url's host is a lie under
            // wrangler dev (rewritten to the production route's domain).
            `${config.relayOrigin}/v1/billing/return?lang=${encodeURIComponent(lang)}`
          : `${pricingUrl}?purchase=success`,
        // The ticket survives a cancel (non-consuming lookup), so the retry
        // keeps its account binding instead of degrading to the web flow.
        cancelUrl: appInitiated ? `${pricingUrl}#upgrade=${ticket as string}` : pricingUrl,
        account: account
          ? { id: account.id, email: account.email, stripeCustomerId: account.stripeCustomerId }
          : undefined,
      });
      return json(200, { url });
    } catch (error) {
      return stripeFailure(error);
    }
  }

  async function handleBillingPortal(account: Account): Promise<Response> {
    if (!billing) return failure(501, "billing is not configured");
    if (!account.stripeCustomerId) return failure(404, "no billing profile for this account");
    try {
      const { url } = await createPortalSession(
        billing,
        account.stripeCustomerId,
        `${config.webAppOrigin}/pricing`,
      );
      return json(200, { url });
    } catch (error) {
      return stripeFailure(error);
    }
  }

  async function handleBillingWebhook(req: Request): Promise<Response> {
    if (!ports.stripe) return failure(501, "billing is not configured");
    const payload = await req.text();
    const valid = await verifyStripeSignature(
      payload,
      req.headers.get("stripe-signature"),
      ports.stripe.webhookSecret,
      ports.now(),
    );
    if (!valid) return failure(400, "invalid webhook signature");
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      return failure(400, "malformed event payload");
    }
    await applyStripeEvent(accounts, event as { type?: unknown; data?: { object?: unknown } }, nowIso());
    return json(200, { received: true });
  }

  /**
   * The bundled-AI proxy: OpenAI-compatible passthrough with the operator's
   * upstream key injected and the usage numbers metered (docs/sync-engine.md
   * §11). The relay never logs or stores request/response CONTENT — these
   * requests are plaintext inside TLS (not E2E like sync data), so the only
   * thing allowed to touch storage is token counts. Admission is the tier's
   * monthly credit budget, checked before forwarding and charged after the
   * upstream answers; a request in flight can overshoot by itself at most.
   */
  async function handleAiCompletions(account: Account, req: Request): Promise<Response> {
    if (ports.aiModels.length === 0) return failure(501, "bundled AI is not configured");
    const budgetCredits = quotasOf(account).aiMonthlyCredits;
    if (budgetCredits === 0) return failure(403, "bundled AI requires a paid plan");
    const month = monthKey(ports.now());
    if (budgetCredits !== null) {
      const used = await ports.aiUsage.usedMicroUsd(account.id, month);
      if (used >= budgetCredits * MICRO_USD_PER_CREDIT) {
        return failure(402, "monthly AI credits exhausted");
      }
    }

    const raw = await req.text();
    if (raw.length > config.maxAiRequestBytes) {
      return failure(413, `request exceeds ${config.maxAiRequestBytes} bytes`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return failure(400, "a JSON body is required");
    }
    if (typeof parsed !== "object" || parsed === null) return failure(400, "a JSON body is required");
    const body = parsed as Record<string, unknown>;
    const model = ports.aiModels.find((m) => m.id === body.model);
    if (!model) return failure(400, "unknown model");
    body.model = model.upstreamModel;
    // The meter depends on the final chunk carrying usage — non-negotiable.
    const stream = body.stream === true;
    if (stream) {
      const streamOptions =
        typeof body.stream_options === "object" && body.stream_options !== null
          ? (body.stream_options as Record<string, unknown>)
          : {};
      body.stream_options = { ...streamOptions, include_usage: true };
    }
    // Output ceiling: a single request must not be able to burn a whole
    // month's budget. Clients that want less may ask for less.
    if (
      typeof body.max_tokens !== "number" ||
      !Number.isFinite(body.max_tokens) ||
      body.max_tokens > config.maxAiOutputTokens
    ) {
      body.max_tokens = config.maxAiOutputTokens;
    }

    const fetchFn = ports.aiFetch ?? fetch;
    const upstream = await fetchFn(`${model.upstreamBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!upstream.ok) {
      // Status + body pass through (they may explain a content filter); the
      // status alone is logged — never the content.
      console.error(`[relay] ai upstream ${model.id} answered ${upstream.status}`);
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") ?? "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    const record = (usage: AiUsage): Promise<void> => {
      const write = ports.aiUsage.add(account.id, month, costMicroUsd(model, usage));
      // The streamed response outlives the handler — waitUntil keeps the
      // accounting write alive past it.
      ports.waitUntil?.(write);
      return write;
    };

    if (stream && upstream.body) {
      return new Response(upstream.body.pipeThrough(meterSseStream((usage) => void record(usage))), {
        status: 200,
        headers: {
          "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
          "cache-control": "no-store",
          ...CORS_HEADERS,
        },
      });
    }
    const text = await upstream.text();
    try {
      const usage = usageFromOpenAI((JSON.parse(text) as { usage?: unknown }).usage);
      if (usage) await record(usage);
    } catch {
      // Unparseable success body: pass it through unmetered rather than eat it.
    }
    return new Response(text, {
      status: 200,
      headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (req.method === "POST" && path === "/v1/report") return handleReport(req);
    if (req.method === "POST" && path === "/v1/auth/request") return handleAuthRequest(req);
    if (req.method === "POST" && path === "/v1/auth/verify") return handleAuthVerify(req);
    if (req.method === "POST" && path === "/v1/admin/tier") return handleAdminTier(req);
    if (req.method === "POST" && path === "/v1/billing/webhook") return handleBillingWebhook(req);
    // Optional auth: signed-in checkout binds the account, signed-out is the
    // landing page's flow. Placed before the session gate on purpose.
    if (req.method === "POST" && path === "/v1/billing/checkout") return handleBillingCheckout(req);
    // Stripe's success redirect for app-initiated checkouts — a public page,
    // like the OAuth finish; it carries nothing but a language.
    if (req.method === "GET" && path === "/v1/billing/return") {
      return billingReturnPage(resolveLang(url.searchParams.get("lang")));
    }
    if (path.startsWith("/v1/auth/oauth/")) {
      const [providerId, action] = path.slice("/v1/auth/oauth/".length).split("/");
      return handleOauth(req, url, providerId ?? "", action ?? "");
    }

    // The doorbell socket: a browser WebSocket cannot send an Authorization
    // header, and the long-lived session must never ride in a URL (access
    // logs). The client trades its session for a one-shot short-TTL ticket
    // (POST below, ordinary bearer auth), and the socket URL carries only
    // that ticket — consumed atomically on connect, worthless afterwards.
    if (req.method === "GET" && path === "/v1/events/watch") {
      const ticket = url.searchParams.get("ticket") ?? "";
      const accountId = ticket
        ? await accounts.consumeWatchTicket(await tokenHash(ticket), ports.now())
        : null;
      if (!accountId) return failure(401, "a valid watch ticket is required");
      const mailbox = ports.mailboxFor(accountId);
      if (!mailbox.watch) return failure(501, "watch is not supported by this deployment");
      return mailbox.watch(req);
    }

    // Everything below requires a session.
    const account = await authenticate(req);
    if (!account) return failure(401, "authentication required");

    if (req.method === "POST" && path === "/v1/auth/logout") {
      const header = req.headers.get("authorization") ?? "";
      await accounts.deleteSession(await tokenHash(header.slice(7)));
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (req.method === "GET" && path === "/v1/account") {
      const tier = resolveTier(account, ports.now());
      return json(200, {
        accountId: account.id,
        email: account.email,
        keys: account.keys,
        blobBytesUsed: account.blobBytesUsed,
        tier,
        tierExpiresAtMs: account.tierExpiresAtMs,
        eventsUsed: await ports.mailboxFor(account.id).count(),
        aiCreditsUsed: creditsFromMicroUsd(
          await ports.aiUsage.usedMicroUsd(account.id, monthKey(ports.now())),
        ),
        hasBilling: account.stripeCustomerId !== null,
        limits: quotasForTier(tier, config),
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
    if (req.method === "POST" && path === "/v1/events/watch-ticket") {
      const ticket = randomToken();
      // 60 seconds: long enough to open the socket, useless to an archived log.
      await accounts.putWatchTicket(await tokenHash(ticket), account.id, ports.now() + 60_000);
      return json(200, { ticket });
    }
    if (req.method === "POST" && path === "/v1/billing/portal") {
      return handleBillingPortal(account);
    }
    if (req.method === "POST" && path === "/v1/billing/ticket") {
      // The upgrade hand-off to the pricing page: a short-lived ticket rides
      // in the URL fragment instead of the session (fragments never reach
      // servers or logs). Domain-separated hash — a watch ticket can never
      // redeem as a billing ticket or vice versa. 15 minutes: the buyer may
      // read the plans before clicking Subscribe.
      const ticket = randomToken();
      await accounts.putWatchTicket(
        await tokenHash(`billing:${ticket}`),
        account.id,
        ports.now() + 15 * 60_000,
      );
      return json(200, { ticket });
    }
    if (req.method === "GET" && path === "/v1/ai/models") {
      return json(200, { models: ports.aiModels.map(({ id, name }) => ({ id, name })) });
    }
    if (req.method === "POST" && path === "/v1/ai/chat/completions") {
      return handleAiCompletions(account, req);
    }
    if (path === "/v1/events") {
      if (req.method === "POST") return handlePushEvents(account, req);
      if (req.method === "GET") return handlePullEvents(account, url);
      return failure(405, "method not allowed");
    }
    if (path.startsWith("/v1/blobs/")) {
      return handleBlob(account, req, decodeURIComponent(path.slice("/v1/blobs/".length)), url);
    }
    return failure(404, "no such route");
  };
}
