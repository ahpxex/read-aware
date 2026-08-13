/**
 * Typed HTTP client for the relay (protocol types from @read-aware/core).
 * A thin fetch wrapper: no retries, no state beyond the injected session
 * provider — pacing and failure policy belong to the engine and scheduler.
 */
import type {
  AccountResponse,
  AuthRequestResponse,
  AuthVerifyResponse,
  PullEventsResponse,
  PushEventsResponse,
  SealedEventWire,
  SyncKeyMaterial,
} from "@read-aware/core";

export class RelayError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(`relay ${status}: ${message}`);
    this.name = "RelayError";
  }
}

export type RelayClientOptions = {
  baseUrl: string;
  /** Current session token; null while signed out. */
  session: () => string | null;
  fetchFn?: typeof fetch;
};

export type RelayClient = ReturnType<typeof createRelayClient>;

export function createRelayClient(options: RelayClientOptions) {
  const fetchFn = options.fetchFn ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");

  async function request(
    method: string,
    path: string,
    body?: BodyInit,
    contentType?: string,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    const session = options.session();
    if (session) headers.authorization = `Bearer ${session}`;
    if (contentType) headers["content-type"] = contentType;
    const res = await fetchFn(`${base}${path}`, { method, body, headers });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const parsed = (await res.json()) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        // non-JSON error body; keep the status text
      }
      throw new RelayError(res.status, message);
    }
    return res;
  }

  const json = (method: string, path: string, body?: unknown) =>
    request(method, path, body === undefined ? undefined : JSON.stringify(body), "application/json");

  return {
    async requestMagicLink(email: string): Promise<AuthRequestResponse> {
      return (await (await json("POST", "/v1/auth/request", { email })).json()) as AuthRequestResponse;
    },
    async verifyMagicLink(token: string): Promise<AuthVerifyResponse> {
      return (await (await json("POST", "/v1/auth/verify", { token })).json()) as AuthVerifyResponse;
    },
    async account(): Promise<AccountResponse> {
      return (await (await json("GET", "/v1/account")).json()) as AccountResponse;
    },
    /**
     * Publish this account's key material. "conflict" = another device won the
     * race; the canonical material comes back so the caller re-verifies
     * against it.
     */
    async publishKeys(
      keys: SyncKeyMaterial,
    ): Promise<{ outcome: "set" } | { outcome: "conflict"; keys: SyncKeyMaterial | null }> {
      try {
        await json("POST", "/v1/account/keys", keys);
        return { outcome: "set" };
      } catch (error) {
        if (error instanceof RelayError && error.status === 409) {
          const account = await this.account();
          return { outcome: "conflict", keys: account.keys };
        }
        throw error;
      }
    },
    async logout(): Promise<void> {
      await json("POST", "/v1/auth/logout", {});
    },
    async deleteAccount(): Promise<void> {
      await request("DELETE", "/v1/account");
    },
    async pushEvents(events: SealedEventWire[]): Promise<Record<string, number>> {
      const res = await json("POST", "/v1/events", { events });
      return ((await res.json()) as PushEventsResponse).seqs;
    },
    async pullEvents(after: number, limit: number): Promise<PullEventsResponse> {
      const res = await json("GET", `/v1/events?after=${after}&limit=${limit}`);
      return (await res.json()) as PullEventsResponse;
    },
    async putBlob(key: string, bytes: Uint8Array): Promise<void> {
      await request("PUT", `/v1/blobs/${encodeURIComponent(key)}`, bytes as unknown as BodyInit);
    },
    async getBlob(key: string): Promise<Uint8Array | null> {
      try {
        const res = await request("GET", `/v1/blobs/${encodeURIComponent(key)}`);
        return new Uint8Array(await res.arrayBuffer());
      } catch (error) {
        if (error instanceof RelayError && error.status === 404) return null;
        throw error;
      }
    },
    async deleteBlob(key: string): Promise<void> {
      await request("DELETE", `/v1/blobs/${encodeURIComponent(key)}`);
    },
  };
}
