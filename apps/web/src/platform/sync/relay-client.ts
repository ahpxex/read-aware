/**
 * Typed HTTP client for the relay (protocol types from @read-aware/core).
 * A thin fetch wrapper: no retries, no state beyond the injected session
 * provider — pacing and failure policy belong to the engine and scheduler.
 */
import type {
  AccountResponse,
  AuthRequestResponse,
  AuthVerifyResponse,
  BillingPlanId,
  BillingSessionResponse,
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

/**
 * The URL answered 200 but with the wrong kind of content — an HTML page where
 * ciphertext or JSON was expected. That is never the relay talking: it is a
 * misconfigured relay URL (e.g. a host whose interceptor answers every path),
 * a captive portal, or a proxy. Distinct from RelayError so callers can say
 * "wrong server" instead of surfacing a misleading decode failure.
 */
export class RelayMisdirectedError extends Error {
  constructor(contentType: string) {
    super(
      `relay answered "${contentType || "unknown content"}" where ${""}sync data was expected — the relay URL likely points at the wrong server`,
    );
    this.name = "RelayMisdirectedError";
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
    expect: "json" | "binary" | "none" = "json",
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
    // A 200 with the wrong content kind is not the relay: it is some other
    // server answering on the relay's URL (misconfigured base URL, captive
    // portal, an intercepting proxy). Catching it here turns "envelope failed
    // to decode" mysteries into a diagnosable "wrong server" upfront.
    const kind = (res.headers.get("content-type") ?? "").toLowerCase();
    if (expect === "json" && res.status !== 204 && !kind.includes("application/json")) {
      throw new RelayMisdirectedError(kind);
    }
    if (expect === "binary" && !kind.includes("application/octet-stream")) {
      throw new RelayMisdirectedError(kind);
    }
    return res;
  }

  const json = (method: string, path: string, body?: unknown) =>
    request(method, path, body === undefined ? undefined : JSON.stringify(body), "application/json");

  return {
    async requestMagicLink(email: string, lang?: string): Promise<AuthRequestResponse> {
      return (await (
        await json("POST", "/v1/auth/request", { email, lang })
      ).json()) as AuthRequestResponse;
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
    /** One-shot ticket for the doorbell socket — the session never rides in a URL. */
    async watchTicket(): Promise<string> {
      const res = await json("POST", "/v1/events/watch-ticket", {});
      return ((await res.json()) as { ticket: string }).ticket;
    },
    async deleteAccount(): Promise<void> {
      await request("DELETE", "/v1/account");
    },
    /** Hosted Stripe checkout for a plan — the URL opens in the system browser. */
    async createCheckout(plan: BillingPlanId, locale?: string): Promise<string> {
      const res = await json("POST", "/v1/billing/checkout", { plan, locale });
      return ((await res.json()) as BillingSessionResponse).url;
    },
    /**
     * Short-lived ticket that lets the pricing page start a checkout BOUND to
     * this account (and return the buyer to the app) — the session itself
     * never rides in a URL.
     */
    async billingTicket(): Promise<string> {
      const res = await json("POST", "/v1/billing/ticket", {});
      return ((await res.json()) as { ticket: string }).ticket;
    },
    /** Hosted subscription management; 404 until a purchase linked a customer. */
    async createPortal(): Promise<string> {
      const res = await json("POST", "/v1/billing/portal", {});
      return ((await res.json()) as BillingSessionResponse).url;
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
    /** Stage one sealed part of a chunked blob (see sync-envelope.ts v2). */
    async putBlobPart(key: string, index: number, parts: number, bytes: Uint8Array): Promise<void> {
      await request(
        "PUT",
        `/v1/blobs/${encodeURIComponent(key)}?part=${index}&parts=${parts}`,
        bytes as unknown as BodyInit,
      );
    },
    /** Commit a chunked upload: all `parts` staged parts become the blob. */
    async commitBlob(key: string, parts: number): Promise<void> {
      await request("PUT", `/v1/blobs/${encodeURIComponent(key)}?commit=1&parts=${parts}`);
    },
    async getBlob(key: string): Promise<Uint8Array | null> {
      try {
        const res = await request(
          "GET",
          `/v1/blobs/${encodeURIComponent(key)}`,
          undefined,
          undefined,
          "binary",
        );
        return new Uint8Array(await res.arrayBuffer());
      } catch (error) {
        if (error instanceof RelayError && error.status === 404) return null;
        throw error;
      }
    },
    /** Fetch one sealed part of a chunked blob. */
    async getBlobPart(key: string, index: number): Promise<Uint8Array> {
      const res = await request(
        "GET",
        `/v1/blobs/${encodeURIComponent(key)}?part=${index}`,
        undefined,
        undefined,
        "binary",
      );
      return new Uint8Array(await res.arrayBuffer());
    },
    async deleteBlob(key: string): Promise<void> {
      await request("DELETE", `/v1/blobs/${encodeURIComponent(key)}`);
    },
  };
}
