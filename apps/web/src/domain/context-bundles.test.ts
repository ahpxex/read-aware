import { expect, test } from "bun:test";
import { AppError, type ContextBundle, type ProfileContextSnapshot } from "@read-aware/core";
import { createContextBundleService } from "./context-bundles";
import { deferred } from "../../tests/helpers/profile-host";
import type { DomainEventDraft } from "../platform/domain-events";
import insightsGolden from "../../../../packages/core/src/context-bundle-insights.golden.json";
import type { ConversationInsightsSnapshot, ConversationTarget } from "@read-aware/core";
import { createReadingIntentSources } from "../features/plugins/runtime/plugin-reading-intents";
import { createBookContextSources } from "./book-context-sources";
import { ReadingSessionController } from "./reading-session-controller";
import bookFixture from "../../../../packages/core/src/context-bundle-book.fixture.json";

function fixture() {
  const calls: string[] = [], broadcasts: DomainEventDraft[] = [], warnings: string[] = [];
  const snapshot: ProfileContextSnapshot = { profile: { summary: "Reader", revision: `profile2:${"a".repeat(64)}` }, derived: null, sourceConditions: [] };
  const controls = { before: async (_step: string) => {}, changed: true, badReceipt: false };
  const insights = structuredClone(insightsGolden) as ConversationInsightsSnapshot;
  let readTarget: ConversationTarget | undefined;
  const intentLifetime = new AbortController(); let intentObservers = 0;
  const reader = new ReadingSessionController(); let bookObservers = 0;
  let publication: { event: { payload: ContextBundle; origin: string }; expectedReadRevision: string } | undefined;
  async function step(name: string) { calls.push(name); await controls.before(name); }
  const intentProvider = { id: "goal", key: "owner:goal", pluginId: "owner", pluginName: "Owner", provide: () => [],
    readingIntentLifetime: intentLifetime.signal, readingIntent: { scopes: ["book", "user"] as Array<"book" | "user">,
      prepare: () => step("prepare-intents"), read: async () => { await step("read-intents"); return { text: "Read carefully", revision: "doc:1" }; } } };
  const service = createContextBundleService({
    books: createBookContextSources({ read: async () => { await step("read-book"); return structuredClone(bookFixture); },
      blob: async () => { throw Error("No registered metadata expected"); }, reader: { snapshot: () => reader.snapshot(), observe: listener => {
        bookObservers++; const off = reader.observe(listener); return () => { bookObservers--; off(); };
      } } }),
    intents: createReadingIntentSources({ list: () => [intentProvider],
      observe: () => { intentObservers++; return () => { intentObservers--; }; }, requireBook: () => step("intent-book") }),
    initialize: () => step("initialize"), warn: message => { warnings.push(message); },
    insights: { prepare: () => step("prepare-insights"), read: async target => {
      readTarget = structuredClone(target); await step("read-insights"); return structuredClone(insights);
    } },
    mint: async drafts => { await step("mint"); return drafts.map(draft => ({ ...draft, id: "minted", hlc: { wallMs: 1, counter: 0, deviceId: "local" } })); },
    broadcast: drafts => { calls.push("broadcast"); broadcasts.push(...structuredClone(drafts)); },
    invoke: async <T>(command: string, args?: unknown): Promise<T> => {
      await step(command);
      if (command === "context_bundle_source_revision") return "cbsource1:observed:1" as T;
      if (command === "profile_context") return structuredClone(snapshot) as T;
      if (command !== "context_bundle_publish") throw Error(`Unexpected ${command}`);
      publication = structuredClone(args) as typeof publication;
      return { version: controls.badReceipt ? "wrong" : publication!.event.payload.version, changed: controls.changed, persistence: "event-log" } as T;
    },
  });
  return { service, calls, broadcasts, warnings, snapshot, insights, controls, reader, bookObservers: () => bookObservers, intentLifetime, intentObservers: () => intentObservers,
    publication: () => publication, readTarget: () => readTarget };
}

test("capture initializes durable sources, fences before reads, publishes origin and broadcasts only actual changes", async () => {
  const host = fixture(), result = await host.service.captureProfile("plugin:profile");
  expect(host.calls).toEqual(["initialize", "context_bundle_source_revision", "profile_context", "mint", "context_bundle_publish", "broadcast"]);
  expect(host.publication()).toMatchObject({ expectedReadRevision: "cbsource1:observed:1", event: { origin: "plugin:profile", payload: result.bundle } });
  expect(host.broadcasts).toEqual([{ type: "context.bundlePublished", payload: result.bundle, origin: "plugin:profile" }]);
  host.controls.changed = false;
  expect((await host.service.captureProfile("agent")).receipt.changed).toBe(false);
  expect(host.broadcasts).toHaveLength(1);
});

test("book capture fences durable reads and disposes its reader observation on every outcome", async () => {
  const host = fixture(), result = await host.service.captureBook("book-one", "plugin:context");
  expect(host.calls).toEqual(["initialize", "context_bundle_source_revision", "read-book", "mint", "context_bundle_publish", "broadcast"]);
  expect(result.bundle.content).toMatchObject({ kind: "book_memory_context", scope: { kind: "book", id: "book-one" }, items: [] });
  expect(host.publication()).toMatchObject({ event: { origin: "plugin:context" } }); expect(host.bookObservers()).toBe(0);
  for (const step of ["initialize", "context_bundle_source_revision", "read-book", "mint", "context_bundle_publish"]) {
    const h = fixture(); h.controls.before = async current => { if (current === step) h.reader.begin("book-one"); };
    const work = h.service.captureBook("book-one", "user");
    if (step === "context_bundle_publish") expect((await work).receipt.changed).toBe(true);
    else { await expect(work).rejects.toMatchObject({ code: "memory/conflict" }); expect(h.calls).not.toContain("context_bundle_publish"); }
    expect(h.bookObservers()).toBe(0);
  }
  const failure = fixture(); failure.controls.before = async step => { if (step === "read-book") throw Error("read failed"); };
  await expect(failure.service.captureBook("book-one", "user")).rejects.toThrow("read failed"); expect(failure.bookObservers()).toBe(0);
});

test("each read, initialization, mint or publication failure propagates without retry or success broadcast", async () => {
  for (const fail of ["initialize", "context_bundle_source_revision", "profile_context", "mint", "context_bundle_publish"]) {
    const host = fixture();
    const error = new AppError(fail === "context_bundle_publish" ? "memory/conflict" : "db/locked", "injected");
    host.controls.before = async step => { if (step === fail) throw error; };
    await expect(host.service.captureProfile("user")).rejects.toBe(error);
    expect(host.calls.filter(step => step === fail)).toHaveLength(1); expect(host.broadcasts).toHaveLength(0);
    expect(host.calls.at(-1)).toBe(fail);
  }
});

test("cancellation before native publication prevents the write at every async boundary", async () => {
  const aborted = fixture();
  await expect(aborted.service.captureProfile("user", AbortSignal.abort())).rejects.toBeDefined();
  expect(aborted.calls).toHaveLength(0);
  for (const pause of ["initialize", "context_bundle_source_revision", "profile_context", "mint"]) {
    const host = fixture(), entered = deferred(), gate = deferred(), controller = new AbortController();
    host.controls.before = async step => { if (step === pause) { entered.resolve(); await gate.promise; } };
    const pending = host.service.captureProfile("user", controller.signal);
    await entered.promise; controller.abort(); gate.resolve();
    await expect(pending).rejects.toBeDefined();
    expect(host.calls).not.toContain("context_bundle_publish"); expect(host.broadcasts).toHaveLength(0);
  }
});

test("cancellation after dispatch drains the actual success or failure rather than inventing cancellation", async () => {
  for (const fail of [false, true]) {
    const host = fixture(), entered = deferred(), gate = deferred(), controller = new AbortController();
    const error = new AppError("db/locked", "native failure");
    host.controls.before = async step => { if (step === "context_bundle_publish") { entered.resolve(); await gate.promise; if (fail) throw error; } };
    const pending = host.service.captureProfile("user", controller.signal);
    await entered.promise; controller.abort(); gate.resolve();
    if (fail) { await expect(pending).rejects.toBe(error); expect(host.broadcasts).toHaveLength(0); }
    else { expect((await pending).receipt.changed).toBe(true); expect(host.broadcasts).toHaveLength(1); }
  }
});

test("degraded derived content logs without private bytes; invalid receipts never broadcast", async () => {
  const host = fixture(); host.snapshot.derived = { secret: "private broken block" };
  const result = await host.service.captureProfile("user");
  expect(host.warnings).toHaveLength(1);
  expect(JSON.stringify([result.bundle, host.warnings])).not.toContain("private broken block");
  host.controls.badReceipt = true;
  await expect(host.service.captureProfile("user")).rejects.toMatchObject({ code: "db/error" });
  expect(host.broadcasts).toHaveLength(1);
});

test("conversation recipe settles the real source owner before the clock and cannot be retargeted while awaiting", async () => {
  const host = fixture(), target: ConversationTarget = { kind: "book", id: "book:one" };
  const pending = host.service.captureConversation(target, "plugin:context"); target.id = "different";
  const result = await pending;
  expect(host.calls).toEqual(["initialize", "prepare-insights", "context_bundle_source_revision", "read-insights", "mint", "context_bundle_publish", "broadcast"]);
  expect(host.readTarget()).toEqual({ kind: "book", id: "book:one" });
  expect(result.bundle.content).toMatchObject({ kind: "conversation_insights_context", scope: insightsGolden.target,
    sourceRevision: insightsGolden.revision, items: [{ text: insightsGolden.summary }] });
  expect(host.publication()).toMatchObject({ event: { origin: "plugin:context" }, expectedReadRevision: "cbsource1:observed:1" });
  host.insights.target.id = "different";
  await expect(host.service.captureConversation({ kind: "book", id: "book:one" }, "user")).rejects.toMatchObject({ code: "memory/invalid-input" });
  expect(host.broadcasts).toHaveLength(1);
});

test("conversation owner failures and cancellation at every boundary never publish a partial recipe", async () => {
  for (const pause of ["initialize", "prepare-insights", "context_bundle_source_revision", "read-insights", "mint"]) {
    const host = fixture(), controller = new AbortController();
    host.controls.before = async step => { if (step === pause) controller.abort(); };
    await expect(host.service.captureConversation({ kind: "book", id: "book:one" }, "user", controller.signal)).rejects.toBeDefined();
    expect(host.calls).not.toContain("context_bundle_publish"); expect(host.broadcasts).toHaveLength(0);
  }
  for (const fail of ["prepare-insights", "read-insights", "context_bundle_publish"]) {
    const host = fixture(), error = new AppError("db/locked", "source failure");
    host.controls.before = async step => { if (step === fail) throw error; };
    await expect(host.service.captureConversation({ kind: "book", id: "book:one" }, "user")).rejects.toBe(error);
    expect(host.calls.filter(step => step === fail)).toHaveLength(1); expect(host.broadcasts).toHaveLength(0);
  }
});

test("intention capture prepares before the native clock, reads within it and cleans up its lease", async () => {
  const host = fixture(), scope = { kind: "book" as const, id: "one" };
  const pending = host.service.captureIntent(scope, "user"); scope.id = "other";
  const result = await pending;
  expect(host.calls).toEqual(["initialize", "intent-book", "prepare-intents", "context_bundle_source_revision", "intent-book", "read-intents", "mint", "context_bundle_publish", "broadcast"]);
  expect(result.bundle.content).toMatchObject({ kind: "reading_intent_context", scope: { kind: "book", id: "one" }, items: [{ text: "Read carefully", revision: "doc:1" }] });
  expect(host.intentObservers()).toBe(0);
});

test("source retirement prevents undispatched publication but preserves actual dispatched receipt", async () => {
  for (const pause of ["prepare-intents", "read-intents", "mint", "context_bundle_publish"]) {
    const host = fixture(); host.controls.before = async step => { if (step === pause) host.intentLifetime.abort(); };
    const pending = host.service.captureIntent({ kind: "user" }, "user");
    if (pause === "context_bundle_publish") { expect((await pending).receipt.changed).toBe(true); expect(host.broadcasts).toHaveLength(1); }
    else { await expect(pending).rejects.toBeDefined(); expect(host.calls).not.toContain("context_bundle_publish"); }
    expect(host.intentObservers()).toBe(0);
  }
});
