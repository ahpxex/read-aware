/**
 * Relay mailbox at a million events — the DO's SQLite shape under bun:sqlite.
 * Skipped unless RELAY_STRESS is set (minutes, not milliseconds):
 *   RELAY_STRESS=1000000 bun test test/stress.test.ts
 * Prints wall-clock for append, paging the whole mailbox, and id lookups.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { MailboxCore, type SqlExec } from "../src/mailbox-core";
import { sealed } from "./harness";

const N = Number(process.env.RELAY_STRESS ?? 0);

function sqlOver(db: Database): SqlExec {
  return {
    exec: (query, ...bindings) => {
      const rows = db.query(query).all(...(bindings as never[])) as Record<string, unknown>[];
      return { toArray: () => rows };
    },
  };
}

describe.skipIf(N === 0)("mailbox stress", () => {
  test(`append, page, and look up ${N} events`, () => {
    const db = new Database(":memory:");
    const core = new MailboxCore(sqlOver(db));
    core.ensureSchema();
    const BATCH = 500;
    let t = performance.now();
    for (let i = 0; i < N; i += BATCH) {
      const events = [];
      for (let j = i; j < Math.min(N, i + BATCH); j += 1) events.push(sealed(`e-${j}`, 1_755_000_000_000 + j));
      const seqs = core.append(events, "2026-09-07T00:00:00.000Z", Number.MAX_SAFE_INTEGER);
      if (seqs === "full") throw new Error("unexpected full");
    }
    const appendS = (performance.now() - t) / 1000;
    console.log(`STRESS relay append ${N}: ${appendS.toFixed(1)}s (${Math.round(N / appendS)}/s)`);

    t = performance.now();
    let after = 0;
    let pages = 0;
    for (;;) {
      const page = core.listAfter(after, 500);
      if (page.events.length === 0) break;
      after = page.next;
      pages += 1;
    }
    const pageS = (performance.now() - t) / 1000;
    console.log(`STRESS relay page whole mailbox: ${pages} pages in ${pageS.toFixed(1)}s`);
    expect(after).toBe(N);

    t = performance.now();
    let known = 0;
    for (let i = 0; i < N; i += 2_000) {
      const ids = [];
      for (let j = i; j < Math.min(N, i + 2_000); j += 1) ids.push(`e-${j}`);
      known += Object.keys(core.lookup(ids)).length;
    }
    const lookupS = (performance.now() - t) / 1000;
    console.log(`STRESS relay lookup ${known} ids: ${lookupS.toFixed(1)}s`);
    expect(known).toBe(N);

    t = performance.now();
    const again = core.append([sealed("e-1"), sealed("e-2"), sealed("brand-new")], "2026-09-07T00:00:00.000Z", Number.MAX_SAFE_INTEGER);
    console.log(`STRESS relay redelivery append: ${(performance.now() - t).toFixed(1)}ms`);
    expect(again).toMatchObject({ "e-1": 2, "e-2": 3, "brand-new": N + 1 });
  }, 600_000);
});
