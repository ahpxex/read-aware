import { expect, test } from "bun:test";
import { AppError, createContextBundle, validateContextBundle, type ContextBundleReadQuery } from "@read-aware/core";
import { createContextBundleHistory } from "./context-bundle-history";
import golden from "../../../../packages/core/src/context-bundle.golden.json";
import { deferred } from "../../tests/helpers/profile-host";

const selector = () => ({ kind: "book_memory_context" as const, scope: { kind: "book" as const, id: "book:one" } });
const query = (): ContextBundleReadQuery => ({ ...selector(), version: golden.version });
const page = () => ({ selector: selector(), items: [{ version: golden.version, publishedAt: "1970-01-01T00:00:01.000Z" }], offset: 0, total: 1, nextOffset: null, revision: `cbhist1:${"a".repeat(64)}` });
function host() {
  const calls: { name: string; input: unknown }[] = [];
  const control = { value: golden as unknown, before: async () => {} };
  const history = createContextBundleHistory({ invoke: async <T>(name: string, input?: unknown): Promise<T> => {
    calls.push({ name, input: structuredClone(input) }); await control.before(); return structuredClone(control.value) as T;
  } });
  return { calls, control, history };
}

test("archive adapter makes only scoped native reads, copying input before await and preserving exact artifact identity", async () => {
  const h = host(), input = query(), work = h.history.read(input); input.scope = { kind: "book", id: "other" };
  expect(await work).toEqual(await validateContextBundle(golden));
  expect(h.calls).toEqual([{ name: "context_bundle_read", input: { query: query() } }]);
  h.control.value = page();
  expect(await h.history.list(selector())).toEqual(page());
  expect(h.calls[1]).toEqual({ name: "context_bundle_history", input: { query: { ...selector(), offset: 0, limit: 20 } } });
});

test("absence is null but storage failure, scope substitution and corrupt artifacts are never empty success", async () => {
  const h = host(); h.control.value = null;
  expect(await h.history.read(query())).toBeNull();
  const wrongScope = await createContextBundle({ ...golden.content, scope: { kind: "book", id: "other" } });
  for (const value of [{}, undefined, { ...golden, version: `cb1:${"a".repeat(64)}` }, wrongScope]) {
    h.control.value = value;
    await expect(h.history.read(query())).rejects.toMatchObject({ code: "db/error" });
  }
  h.control.value = { ...page(), selector: { ...selector(), scope: { kind: "book", id: "other" } } };
  await expect(h.history.list(selector())).rejects.toMatchObject({ code: "db/error" });
  const failure = new AppError("db/locked", "PRIVATE diagnostic"); h.control.before = async () => { throw failure; };
  await expect(h.history.read(query())).rejects.toBe(failure); await expect(h.history.list(selector())).rejects.toBe(failure);
});

test("pre-abort never dispatches; cancellation during either read withholds late text and metadata", async () => {
  for (const operation of ["list", "read"] as const) {
    const h = host(), gate = deferred(), entered = deferred(), controller = new AbortController();
    const input = query();
    h.control.value = operation === "list" ? page() : golden;
    const run = (signal: AbortSignal) => operation === "list" ? h.history.list(selector(), signal) : h.history.read(input, signal);
    await expect(run(AbortSignal.abort())).rejects.toBeDefined(); expect(h.calls).toHaveLength(0);
    h.control.before = async () => { entered.resolve(); await gate.promise; };
    const work = run(controller.signal); await entered.promise; controller.abort(); gate.resolve();
    await expect(work).rejects.toBeDefined(); expect(h.calls).toHaveLength(1);
  }
});
