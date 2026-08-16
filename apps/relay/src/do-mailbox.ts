/**
 * The per-account mailbox Durable Object, and the client-side port wrapper
 * around its stub. One DO instance per account (`idFromName(accountId)`):
 * single-threaded execution serializes seq assignment for free, and the DO's
 * own SQLite storage keeps each account's events in their own shard.
 *
 * Bindings are typed structurally (see index.ts) — the actual SQL lives in
 * MailboxCore, which the tests run against bun:sqlite.
 */
import type { SealedEventWire } from "@read-aware/core";
import { MailboxCore, type SqlExec } from "./mailbox-core";
import type { Mailbox } from "./ports";

type DurableState = {
  storage: { sql: SqlExec };
  blockConcurrencyWhile(fn: () => Promise<void>): void;
  /** Hibernatable-WebSocket API (Cloudflare): sockets survive DO eviction. */
  acceptWebSocket(ws: unknown): void;
  getWebSockets(): Array<{ send(data: string): void }>;
};

/** Workers global; declared structurally so tests never need workers-types. */
declare const WebSocketPair: new () => { 0: unknown; 1: unknown };

export class AccountMailbox {
  private core: MailboxCore;

  constructor(private state: DurableState) {
    this.core = new MailboxCore(state.storage.sql);
    state.blockConcurrencyWhile(async () => this.core.ensureSchema());
  }

  /**
   * The doorbell: every device holds one (hibernated) socket per account;
   * an append rings all of them with the new high-water seq, and each client
   * runs its ordinary pull. The socket carries no data — sync logic never
   * forks between "pushed" and "pulled" paths.
   */
  private ringDoorbells(): void {
    const message = JSON.stringify({ type: "changed", seq: this.core.maxSeq() });
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // A socket mid-close loses this ring; its owner reconnects and pulls.
      }
    }
  }

  /** Hibernation-API callback — inbound frames are ignored (doorbell is one-way). */
  webSocketMessage(): void {}
  webSocketClose(): void {}
  webSocketError(): void {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/watch" && req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
    }
    if (req.method === "POST" && url.pathname === "/append") {
      const { events, maxEvents } = (await req.json()) as {
        events: SealedEventWire[];
        maxEvents?: number;
      };
      const seqs = this.core.append(events, new Date().toISOString(), maxEvents);
      if (seqs === "full") return new Response("mailbox full", { status: 413 });
      this.ringDoorbells();
      return Response.json({ seqs });
    }
    if (req.method === "GET" && url.pathname === "/list") {
      const after = Number(url.searchParams.get("after") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "500");
      return Response.json(this.core.listAfter(after, limit));
    }
    if (req.method === "POST" && url.pathname === "/wipe") {
      this.core.wipe();
      return new Response(null, { status: 204 });
    }
    return new Response("no such mailbox route", { status: 404 });
  }
}

type MailboxStub = { fetch(input: string, init?: RequestInit): Promise<Response> };

/** Adapt a DO stub to the Mailbox port the router speaks. */
export function stubMailbox(stub: MailboxStub): Mailbox {
  return {
    async append(events, maxEvents) {
      const res = await stub.fetch("https://mailbox/append", {
        method: "POST",
        body: JSON.stringify({ events, maxEvents }),
        headers: { "content-type": "application/json" },
      });
      if (res.status === 413) return "full";
      const body = (await res.json()) as { seqs: Record<string, number> };
      return body.seqs;
    },
    async listAfter(after, limit) {
      const res = await stub.fetch(`https://mailbox/list?after=${after}&limit=${limit}`);
      return (await res.json()) as { events: SealedEventWire[]; next: number };
    },
    async wipe() {
      await stub.fetch("https://mailbox/wipe", { method: "POST" });
    },
    watch(req) {
      // Forward the Upgrade verbatim — the DO owns the socket, and the
      // 101 + webSocket pair pass back through the worker untouched.
      return stub.fetch("https://mailbox/watch", req);
    },
  };
}
