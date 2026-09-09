import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildBookClassificationTool } from "./book-classification-tool";
import type { ThreadScope } from "../thread-scope";

function fixture(scope: ThreadScope = { kind: "book", bookId: "b" }) {
  const f = createInMemoryDeps({ books: [{ id: "b", title: "Book", narrativity: "narrative" }, { id: "other", title: "Other" }] });
  return { ...f, tool: buildBookClassificationTool(scope, f.deps) };
}
test("both scopes inspect and approve an exact classification without requiring automatic memory building", async () => {
  for (const scope of [{ kind: "book", bookId: "b" }, { kind: "global", threadId: "g" }] as ThreadScope[]) {
    const f = fixture(scope); f.deps.memoryPolicy = { enabled: () => false, subscribe: () => () => {} };
    const inspected = await f.tool.execute("inspect", { action: "inspect", bookId: "b" });
    expect(inspected.content[0]).toMatchObject({ type: "text" });
    const snapshot = (await f.deps.bookClassification.inspect("b"))!;
    await f.tool.execute("change", { action: "classify", bookId: "b", narrativity: "expository", expectedRevision: snapshot.revision });
    expect(f.stores.books[0]!.narrativity).toBe("expository");
    expect(f.stores.interactions).toHaveLength(1);
    expect(f.stores.interactions[0]).toMatchObject({ kind: "permission", action: "classify-book", subject: "Book\nb\nnarrative -> expository" });
  }
});
test("decline, extra fields, missing books and wrong scope never mutate", async () => {
  const f = fixture(), snapshot = (await f.deps.bookClassification.inspect("b"))!;
  f.deps.interactions.request = async () => ({ optionId: "decline" });
  await expect(f.tool.execute("malformed", null as never)).rejects.toMatchObject({ code: "memory/invalid-input" });
  await f.tool.execute("decline", { action: "classify", narrativity: "expository", expectedRevision: snapshot.revision });
  expect(f.stores.books[0]!.narrativity).toBe("narrative");
  await expect(f.tool.execute("other", { action: "inspect", bookId: "other" })).rejects.toMatchObject({ code: "memory/forbidden" });
  await expect(f.tool.execute("extra", { action: "classify", narrativity: "expository", expectedRevision: snapshot.revision, onlyIfUnclassified: true })).rejects.toMatchObject({ code: "memory/invalid-input" });
  await expect(f.tool.execute("mixed", { action: "inspect", narrativity: "expository" })).rejects.toMatchObject({ code: "memory/invalid-input" });
  const global = fixture({ kind: "global", threadId: "g" });
  await expect(global.tool.execute("missing", { action: "inspect", bookId: "missing" })).rejects.toMatchObject({ code: "reader/book-not-found" });
  await expect(global.tool.execute("no-id", { action: "inspect" })).rejects.toMatchObject({ code: "memory/invalid-input" });
});
test("approval freezes input and concurrent classification is not rebased", async () => {
  const f = fixture(), snapshot = (await f.deps.bookClassification.inspect("b"))!;
  const params = { action: "classify", narrativity: "expository", expectedRevision: snapshot.revision };
  f.deps.interactions.request = async () => { params.narrativity = "narrative"; return { optionId: "approve" }; };
  await f.tool.execute("frozen", params); expect(f.stores.books[0]!.narrativity).toBe("expository");
  const next = (await f.deps.bookClassification.inspect("b"))!;
  f.deps.interactions.request = async () => {
    await f.deps.bookClassification.change({ bookId: "b", narrativity: "expository", expectedRevision: next.revision });
    return { optionId: "approve" };
  };
  await expect(f.tool.execute("race", { action: "classify", narrativity: "narrative", expectedRevision: next.revision })).rejects.toMatchObject({ code: "memory/conflict" });
  expect(f.stores.books[0]!.narrativity).toBe("expository");
});
test("pre-cancellation and cancellation while approving never write", async () => {
  const f = fixture(), snapshot = (await f.deps.bookClassification.inspect("b"))!;
  const aborted = new AbortController(); aborted.abort();
  await expect(f.tool.execute("cancelled", { action: "inspect" }, aborted.signal)).rejects.toMatchObject({ code: "memory/cancelled" });
  expect(f.stores.interactions).toHaveLength(0);
  const pending = new AbortController();
  f.deps.interactions.request = async () => { pending.abort(); return { optionId: "approve" }; };
  await expect(f.tool.execute("cancelled-write", { action: "classify", narrativity: "expository", expectedRevision: snapshot.revision }, pending.signal)).rejects.toMatchObject({ code: "memory/cancelled" });
  expect(f.stores.books[0]!.narrativity).toBe("narrative");
});
