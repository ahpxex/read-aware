import { expect, test } from "bun:test";
import { normalizeContextBundleSelector, normalizeContextBundleHistoryQuery, normalizeContextBundleReadQuery, normalizeContextBundleHistoryPage } from "./context-bundle-history";
import golden from "./context-bundle.golden.json";
import historyGolden from "./context-bundle-history.golden.json";

const selector = () => ({ kind: golden.content.kind, scope: structuredClone(golden.content.scope) });
const revision = `cbhist1:${"a".repeat(64)}`;
const page = () => ({ selector: selector(), items: [{ version: golden.version, publishedAt: "1970-01-01T00:00:01.000Z" }], offset: 0, nextOffset: null, total: 1, revision });

test("history and pinned reads normalize all recipe scopes without allowing bare IDs or implicit global queries", () => {
  for (const [kind, scope] of [
    ["user_profile_context", { kind: "user" }], ["reading_intent_context", { kind: "user" }],
    ["reading_intent_context", { kind: "book", id: "b" }], ["book_memory_context", { kind: "book", id: "b" }],
    ["conversation_insights_context", { kind: "book", id: "b" }], ["conversation_insights_context", { kind: "conversation", id: "thread-b" }],
  ] as const) {
    expect(normalizeContextBundleSelector({ kind, scope })).toEqual({ kind, scope });
    expect(normalizeContextBundleHistoryQuery({ kind, scope })).toEqual({ kind, scope, offset: 0, limit: 20 });
    expect(normalizeContextBundleReadQuery({ kind, scope, version: golden.version })).toEqual({ kind, scope, version: golden.version });
  }
  for (const bad of [{}, { version: golden.version }, { kind: "book_memory_context", scope: { kind: "user" } },
    { ...selector(), scope: { ...selector().scope, ignored: true } }, { ...selector(), sql: "SELECT *" }]) {
    expect(() => normalizeContextBundleHistoryQuery(bad)).toThrow();
  }
});

test("pagination requires a filter-bound revision for continuation and rejects null, unbounded or malformed inputs", () => {
  expect(normalizeContextBundleHistoryQuery({ ...selector(), offset: 10, limit: 100, expectedRevision: revision })).toMatchObject({ offset: 10, limit: 100, expectedRevision: revision });
  for (const extra of [{ offset: 1 }, { offset: -1 }, { offset: Number.MAX_SAFE_INTEGER + 1 }, { offset: 0.5 }, { limit: 0 }, { limit: 101 },
    { offset: null }, { limit: null }, { expectedRevision: null }, { expectedRevision: "latest" }, { expectedRevision: `cbhist1:${"A".repeat(64)}` }]) {
    expect(() => normalizeContextBundleHistoryQuery({ ...selector(), ...extra })).toThrow();
  }
  for (const version of ["latest", "", null, `cb1:${"A".repeat(64)}`, `${golden.version}:extra`]) {
    expect(() => normalizeContextBundleReadQuery({ ...selector(), version })).toThrow();
  }
});

test("query and response normalization copy nested scopes and page entries", () => {
  const raw = selector(), query = normalizeContextBundleHistoryQuery(raw);
  raw.scope.id = "elsewhere";
  const expectedScope = normalizeContextBundleSelector(selector()).scope;
  expect(query.scope).toEqual(expectedScope);
  const result = page(), normalized = normalizeContextBundleHistoryPage(result, query);
  result.items[0]!.version = `cb1:${"0".repeat(64)}`; result.selector.scope.id = "elsewhere";
  expect(normalized.items[0]!.version).toBe(golden.version); expect(normalized.selector.scope).toEqual(expectedScope);
  expect(normalizeContextBundleHistoryPage(historyGolden, query)).toEqual({ ...historyGolden, selector: normalizeContextBundleSelector(historyGolden.selector) });
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(JSON.stringify(["context-bundle-history", 1, query.kind, query.scope.kind, query.scope.kind === "user" ? null : query.scope.id]) + "\n");
  for (const item of historyGolden.items) hash.update(JSON.stringify([item.version, item.publishedAt]) + "\n");
  expect(`cbhist1:${hash.digest("hex")}`).toBe(historyGolden.revision);
});

test("history response validation enforces scope, order, counts, revision and exact continuation", () => {
  const query = normalizeContextBundleHistoryQuery(selector());
  for (const change of [
    { selector: { ...selector(), scope: { kind: "book", id: "other" } } }, { total: 2 }, { offset: 1 }, { nextOffset: 1 },
    { revision: "wrong" }, { body: "PRIVATE" }, { items: [] },
    { items: [{ version: golden.version, publishedAt: "bad\0time" }] },
    { items: [{ version: golden.version, publishedAt: "time", text: "PRIVATE" }] },
  ]) expect(() => normalizeContextBundleHistoryPage({ ...page(), ...change }, query)).toThrow();
  expect(() => normalizeContextBundleHistoryPage(page(), { ...query, expectedRevision: `cbhist1:${"b".repeat(64)}` })).toThrow();
  const entries = [{ version: `cb1:${"b".repeat(64)}`, publishedAt: "time" }, { version: `cb1:${"a".repeat(64)}`, publishedAt: "time" }];
  expect(normalizeContextBundleHistoryPage({ ...page(), items: entries, total: 2 }, query).items).toEqual(entries);
  expect(() => normalizeContextBundleHistoryPage({ ...page(), items: [...entries].reverse(), total: 2 }, query)).toThrow();
  expect(normalizeContextBundleHistoryPage({ ...page(), items: [], total: 0 }, query).nextOffset).toBeNull();
});
