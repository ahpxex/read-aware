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
};

export class AccountMailbox {
  private core: MailboxCore;

  constructor(state: DurableState) {
    this.core = new MailboxCore(state.storage.sql);
    state.blockConcurrencyWhile(async () => this.core.ensureSchema());
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/append") {
      const { events } = (await req.json()) as { events: SealedEventWire[] };
      return Response.json({ seqs: this.core.append(events, new Date().toISOString()) });
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
    async append(events) {
      const res = await stub.fetch("https://mailbox/append", {
        method: "POST",
        body: JSON.stringify({ events }),
        headers: { "content-type": "application/json" },
      });
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
  };
}
