/**
 * Worker entry: bind the Cloudflare environment to the relay's ports and hand
 * every request to the router. Bindings are typed structurally — exactly the
 * subset this code touches — so the whole package typechecks and tests in the
 * bun toolchain without Cloudflare's ambient types.
 */
import { SqlAccountStore, type D1Like } from "./account-store";
import { AccountMailbox, stubMailbox } from "./do-mailbox";
import { resendMagicLinkSender } from "./email";
import { githubProvider, googleProvider } from "./oauth";
import { DEFAULT_CONFIG, type BlobStore, type OAuthProvider, type RelayPorts } from "./ports";
import { createRelayHandler } from "./router";

export { AccountMailbox };

type R2Like = {
  put(key: string, value: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; size: number } | null>;
  head(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
  list(options: {
    prefix: string;
    cursor?: string;
  }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
};

type Env = {
  DB: D1Like;
  BLOBS: R2Like;
  MAILBOX: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
  };
  /** "1" returns magic tokens in the response — local dev ONLY. */
  MAGIC_LINK_ECHO?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  APP_ORIGIN?: string;
  /** Where `client=web` OAuth finishes land; defaults to the app origin. */
  WEB_APP_ORIGIN?: string;
  /** Free-tier quota overrides (integers); defaults in DEFAULT_CONFIG. */
  MAX_ACCOUNT_BLOB_BYTES?: string;
  MAX_ACCOUNT_EVENTS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
};

function r2BlobStore(bucket: R2Like): BlobStore {
  const path = (accountId: string, key: string) => `${accountId}/${key}`;
  return {
    async put(accountId, key, bytes) {
      await bucket.put(path(accountId, key), bytes);
    },
    async get(accountId, key) {
      const object = await bucket.get(path(accountId, key));
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    },
    async delete(accountId, key) {
      const head = await bucket.head(path(accountId, key));
      if (!head) return 0;
      await bucket.delete(path(accountId, key));
      return head.size;
    },
    async wipe(accountId) {
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix: `${accountId}/`, cursor });
        for (const object of page.objects) await bucket.delete(object.key);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    },
  };
}

function portsFromEnv(env: Env): RelayPorts {
  const oauthProviders: Record<string, OAuthProvider> = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    oauthProviders.google = googleProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  }
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    oauthProviders.github = githubProvider(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET);
  }
  return {
    accounts: new SqlAccountStore(env.DB),
    mailboxFor: (accountId) => stubMailbox(env.MAILBOX.get(env.MAILBOX.idFromName(accountId))),
    blobs: r2BlobStore(env.BLOBS),
    magicLink:
      env.RESEND_API_KEY && env.MAIL_FROM
        ? resendMagicLinkSender(
            env.RESEND_API_KEY,
            env.MAIL_FROM,
            env.APP_ORIGIN ?? "https://readaware.app",
          )
        : null,
    oauthProviders,
    config: {
      ...DEFAULT_CONFIG,
      echoMagicToken: env.MAGIC_LINK_ECHO === "1",
      webAppOrigin: env.WEB_APP_ORIGIN ?? env.APP_ORIGIN ?? DEFAULT_CONFIG.webAppOrigin,
      maxAccountBlobBytes:
        Number(env.MAX_ACCOUNT_BLOB_BYTES) || DEFAULT_CONFIG.maxAccountBlobBytes,
      maxAccountEvents: Number(env.MAX_ACCOUNT_EVENTS) || DEFAULT_CONFIG.maxAccountEvents,
    },
    now: () => Date.now(),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return createRelayHandler(portsFromEnv(env))(request);
  },
};
