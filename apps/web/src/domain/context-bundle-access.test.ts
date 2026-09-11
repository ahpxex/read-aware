import { expect, test } from "bun:test";
import { AppError, createContextBundle, FULL_DOMAIN_GRANTS, type ContextBundle, type DomainGrants, type ResourceRef } from "@read-aware/core";
import { createContextBundleAccess } from "./context-bundle-access";
import type { ResourceOwner } from "../services/resource-owner";
import type { ContextResourceAccess } from "../services/resource-access";

async function artifact(kind: "user_profile_context" | "book_memory_context" = "user_profile_context"): Promise<ContextBundle> {
  return createContextBundle(kind === "user_profile_context"
    ? { format: "readaware.context", schemaVersion: 1, recipeVersion: 1, kind, scope: { kind: "user" }, sourceRevision: "pctx1:test",
      items: [{ kind: "curated_profile", id: "profile", revision: "pctx1:test", label: "Profile", text: "Reader" }], omissions: [] }
    : { format: "readaware.context", schemaVersion: 1, recipeVersion: 1, kind, scope: { kind: "book", id: "book-one" }, sourceRevision: "bctx1:test",
      items: [], omissions: [{ kind: "memory", reason: "spoiler", count: 1 }] });
}

function fixture(grants: DomainGrants = FULL_DOMAIN_GRANTS, lifetime?: AbortSignal) {
  const calls: string[] = [], released: string[] = [], reported: unknown[] = [];
  let archived: ContextBundle | null = null, disclosure: Error | null = null, positionListener: ((error: AppError) => void) | null = null, observing = 0;
  let lease: ContextResourceAccess | undefined, exportGate: Promise<void> = Promise.resolve();
  const controls = { before: async (_step: string) => {} };
  const step = async (name: string) => { calls.push(name); await controls.before(name); };
  const receipt = { version: "cb1:x", changed: true, persistence: "event-log" as const };
  const producer = {
    captureProfile: async (origin: string, signal?: AbortSignal) => { await step(`profile:${origin}:${signal?.aborted}`); return { bundle: await artifact(), receipt }; },
    captureIntent: async (scope: unknown, origin: string) => { await step(`intent:${JSON.stringify(scope)}:${origin}`); return { bundle: await artifact(), receipt }; },
    captureBook: async (bookId: string, origin: string) => { await step(`book:${bookId}:${origin}`); return { bundle: await artifact("book_memory_context"), receipt }; },
    captureConversation: async (target: unknown, origin: string) => { await step(`conversation:${JSON.stringify(target)}:${origin}`); return { bundle: await artifact(), receipt }; },
  };
  const owner = { release: async (id: string) => { released.push(id); } } as unknown as ResourceOwner;
  const access = createContextBundleAccess({
    producer, archive: {
      list: async (query, signal) => { await step(`list:${query.kind}:${signal?.aborted}`); return { selector: { kind: query.kind, scope: query.scope }, items: [], offset: 0, nextOffset: null, total: 0, revision: `cbhist1:${"a".repeat(64)}` }; },
      read: async (query, signal) => { await step(`read:${query.kind}:${query.version.slice(0, 8)}:${signal?.aborted}`); return archived; },
    },
    books: { disclose: async (bundle: ContextBundle) => { await step(`disclose:${bundle.content.kind}`); if (disclosure) throw disclosure; },
      observePosition: (bookId, onChange) => { observing++; calls.push(`observe:${bookId}`); positionListener = onChange; return () => { observing--; positionListener = null; }; } },
    invoke: async <T>(command: string) => { await step(command); return "cbsource1:proof:7" as T; },
    initialize: () => step("initialize"),
    exportBundle: async (_owner, bundle: unknown, granted, signal) => {
      await step(`export:${(bundle as ContextBundle).version.slice(0, 8)}:${granted.sourceRevision}`); lease = granted; await exportGate; void signal;
      return { id: "ref-1", name: "x.json", mimeType: "application/json", size: 1, state: "ready", source: "context", expiresAt: 1 } as ResourceRef;
    },
    report: error => { reported.push(error); },
  }, { origin: "plugin:p", grants, lifetime });
  return { access, calls, controls, released, reported, owner, archive: (value: ContextBundle | null) => { archived = value; },
    deny: (error: Error) => { disclosure = error; }, changePosition: () => positionListener?.(new AppError("memory/conflict", "moved")),
    observing: () => observing, lease: () => lease, gateExport: (gate: Promise<void>) => { exportGate = gate; } };
}

test("capture routes each recipe to its producer with the actor origin after a memory write grant check", async () => {
  const f = fixture();
  expect((await f.access.capture({ kind: "user_profile_context", scope: { kind: "user" } })).changed).toBe(true);
  await f.access.capture({ kind: "reading_intent_context", scope: { kind: "user" } });
  await f.access.capture({ kind: "reading_intent_context", scope: { kind: "book", id: "b1" } });
  await f.access.capture({ kind: "book_memory_context", scope: { kind: "book", id: "b1" } });
  await f.access.capture({ kind: "conversation_insights_context", scope: { kind: "book", id: "b1" } });
  await f.access.capture({ kind: "conversation_insights_context", scope: { kind: "conversation", id: "t1" } });
  expect(f.calls).toEqual(["profile:plugin:p:false", 'intent:{"kind":"user"}:plugin:p', 'intent:{"kind":"book","id":"b1"}:plugin:p', "book:b1:plugin:p",
    'conversation:{"kind":"book","id":"b1"}:plugin:p', 'conversation:{"kind":"global","id":"t1"}:plugin:p']);
  const reader = fixture({ memory: "read", annotations: "read", library: "read", conversations: "read" });
  await expect(reader.access.capture({ kind: "user_profile_context", scope: { kind: "user" } })).rejects.toMatchObject({ code: "memory/forbidden" });
  const writer = fixture({ memory: "write" });
  await expect(writer.access.capture({ kind: "book_memory_context", scope: { kind: "book", id: "b1" } })).rejects.toMatchObject({ code: "memory/forbidden" });
  await expect(writer.access.capture({ kind: "conversation_insights_context", scope: { kind: "conversation", id: "t" } })).rejects.toMatchObject({ code: "memory/forbidden" });
  await expect(writer.access.capture({ kind: "user_profile_context", scope: { kind: "book", id: "b" } } as never)).rejects.toMatchObject({ code: "memory/invalid-input" });
  expect(reader.calls).toEqual([]); expect(writer.calls).toEqual([]);
});

test("history and pinned reads recheck grants, and book text is delivered only after host disclosure", async () => {
  const f = fixture({ memory: "read", library: "read", annotations: "read" });
  const version = `cb1:${"a".repeat(64)}`;
  expect((await f.access.history({ kind: "user_profile_context", scope: { kind: "user" } })).total).toBe(0);
  await expect(f.access.history({ kind: "conversation_insights_context", scope: { kind: "conversation", id: "t" } })).rejects.toMatchObject({ code: "memory/forbidden" });
  expect(await f.access.read({ kind: "user_profile_context", scope: { kind: "user" }, version })).toBeNull();
  const book = await artifact("book_memory_context"); f.archive(book);
  expect(await f.access.read({ kind: "book_memory_context", scope: { kind: "book", id: "book-one" }, version })).toEqual(book);
  f.deny(new AppError("memory/forbidden", "beyond fence"));
  await expect(f.access.read({ kind: "book_memory_context", scope: { kind: "book", id: "book-one" }, version })).rejects.toMatchObject({ code: "memory/forbidden", message: "beyond fence" });
  f.archive(await artifact());
  expect((await f.access.read({ kind: "user_profile_context", scope: { kind: "user" }, version }))?.content.kind).toBe("user_profile_context");
  expect(f.calls).toEqual(["list:user_profile_context:false", `read:user_profile_context:${version.slice(0, 8)}:false`,
    `read:book_memory_context:${version.slice(0, 8)}:false`, "disclose:book_memory_context",
    `read:book_memory_context:${version.slice(0, 8)}:false`, "disclose:book_memory_context", `read:user_profile_context:${version.slice(0, 8)}:false`]);
  await expect(f.access.read({ kind: "user_profile_context", scope: { kind: "user" }, version: "latest" } as never)).rejects.toMatchObject({ code: "memory/invalid-query" });
});

test("export captures the source proof before the archive read, binds a revocable lease and drops handles nobody holds", async () => {
  const lifetime = new AbortController(), f = fixture(FULL_DOMAIN_GRANTS, lifetime.signal), version = `cb1:${"b".repeat(64)}`;
  await expect(f.access.export({ kind: "user_profile_context", scope: { kind: "user" }, version }, f.owner)).rejects.toMatchObject({ code: "fs/not-found" });
  const book = await artifact("book_memory_context"); f.archive(book);
  const ref = await f.access.export({ kind: "book_memory_context", scope: { kind: "book", id: "book-one" }, version }, f.owner);
  expect(ref.id).toBe("ref-1");
  expect(f.calls).toEqual(["initialize", "context_bundle_source_revision", `read:user_profile_context:${version.slice(0, 8)}:false`,
    "initialize", "context_bundle_source_revision", `read:book_memory_context:${version.slice(0, 8)}:false`, "disclose:book_memory_context", "observe:book-one",
    `export:${book.version.slice(0, 8)}:cbsource1:proof:7`]);
  const lease = f.lease()!;
  expect(lease.isAllowed()).toBe(true); expect(f.observing()).toBe(1);
  f.changePosition();
  expect(lease.signal.aborted).toBe(true); expect(lease.isAllowed()).toBe(false);
  expect((lease.signal.reason as AppError).code).toBe("memory/conflict");
  lease.dispose(); expect(f.observing()).toBe(0);
  f.archive(await artifact());
  await f.access.export({ kind: "user_profile_context", scope: { kind: "user" }, version }, f.owner);
  const profileLease = f.lease()!;
  expect(f.observing()).toBe(0); expect(profileLease.isAllowed()).toBe(true);
  lifetime.abort(new AppError("ui/superseded", "retired"));
  expect(profileLease.isAllowed()).toBe(false); expect((profileLease.signal.reason as AppError).code).toBe("ui/superseded");
  await expect(f.access.export({ kind: "user_profile_context", scope: { kind: "user" }, version }, f.owner)).rejects.toMatchObject({ code: "ui/superseded" });
  expect(f.released).toEqual([]);
});

test("a caller cancelled after the seal releases the sealed handle instead of leaking it until expiry", async () => {
  const version = `cb1:${"c".repeat(64)}`, selector = { kind: "user_profile_context" as const, scope: { kind: "user" as const }, version };
  // The native seal completed while the consumer was already gone: the access layer owns the orphaned handle.
  const orphan = fixture(), orphanCaller = new AbortController();
  orphan.archive(await artifact());
  orphan.gateExport(new Promise<void>(resolve => { setTimeout(() => { orphanCaller.abort(new Error("after-seal")); resolve(); }, 0); }));
  await expect(orphan.access.export(selector, orphan.owner, orphanCaller.signal)).rejects.toMatchObject({ message: "after-seal" });
  expect(orphan.released).toEqual(["ref-1"]);
  // A cancellation that arrives after delivery belongs to the caller, who holds the handle.
  const held = fixture(), heldCaller = new AbortController();
  held.archive(await artifact());
  const ref = await held.access.export(selector, held.owner, heldCaller.signal);
  heldCaller.abort(new Error("late"));
  expect(ref.id).toBe("ref-1"); expect(held.released).toEqual([]);
  // A cancellation before the seal never produces a handle at all.
  const early = fixture(), earlyCaller = new AbortController();
  early.archive(await artifact()); early.controls.before = async step => { if (step === "context_bundle_source_revision") earlyCaller.abort(new Error("early")); };
  await expect(early.access.export(selector, early.owner, earlyCaller.signal)).rejects.toMatchObject({ message: "early" });
  expect(early.calls).toEqual(["initialize", "context_bundle_source_revision"]); expect(early.released).toEqual([]);
});
