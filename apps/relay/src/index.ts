/**
 * Worker entry: bind the Cloudflare environment to the relay's ports and hand
 * every request to the router. Bindings are typed structurally — exactly the
 * subset this code touches — so the whole package typechecks and tests in the
 * bun toolchain without Cloudflare's ambient types.
 */
import { SqlAccountStore, type D1Like } from "./account-store";
import { AccountMailbox, stubMailbox } from "./do-mailbox";
import { resendMagicLinkSender } from "./email";
import { DEFAULT_CONFIG, type BlobStore, type RelayPorts } from "./ports";
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
    config: { ...DEFAULT_CONFIG, echoMagicToken: env.MAGIC_LINK_ECHO === "1" },
    now: () => Date.now(),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return createRelayHandler(portsFromEnv(env))(request);
  },
};
