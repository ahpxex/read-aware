import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildDeleteBooksTool } from "./delete-books";

const scope = { kind: "global" as const, threadId: "batch-test" };
const seed = () => createInMemoryDeps({ books: [{ id: "a", title: "Alpha" }, { id: "b", title: "Beta" }] });

test("batch uses one approval listing all titles, snapshots IDs, and calls one batch command", async () => {
  const { deps, stores } = seed(), input = ["a", "b", "a"];
  let calls = 0;
  const remove = deps.library.removeBooks;
  deps.library.removeBooks = async ids => { calls++; expect(ids).toEqual(["a", "b"]); return remove(ids); };
  deps.interactions.request = async request => { stores.interactions.push(request); input.splice(0, input.length, "unapproved"); return { optionId: "approve" }; };
  const result = await buildDeleteBooksTool(scope, deps).execute("batch", { bookIds: input });
  expect(calls).toBe(1); expect(stores.books).toHaveLength(0);
  expect(stores.interactions).toHaveLength(1);
  expect(stores.interactions[0]).toMatchObject({ action: "delete-books", subject: "1. Alpha\n2. Beta" });
  expect(result.content[0]).toMatchObject({ type: "text", text: JSON.stringify({ bookIds: ["a", "b"], committed: true, files: { status: "released" } }) });
});

test("decline, cancellation and unknown IDs never mutate a batch", async () => {
  for (const option of ["decline", "cancel", "abort"]) {
    const { deps, stores } = seed(), abort = new AbortController();
    deps.interactions.request = async () => {
      if (option === "abort") abort.abort();
      return option === "cancel" ? { cancelled: true } : { optionId: option === "decline" ? "decline" : "approve" };
    };
    const pending = buildDeleteBooksTool(scope, deps).execute("batch", { bookIds: ["a", "b"] }, abort.signal);
    if (option === "abort") await expect(pending).rejects.toThrow(); else await pending;
    expect(stores.books).toHaveLength(2);
  }
  const { deps, stores } = seed();
  await expect(buildDeleteBooksTool(scope, deps).execute("missing", { bookIds: ["a", "missing"] })).rejects.toMatchObject({ code: "library/book-not-found" });
  expect(stores.interactions).toHaveLength(0); expect(stores.books).toHaveLength(2);
});

test("pending cleanup remains explicit and retry never invokes record deletion", async () => {
  const { deps } = seed();
  deps.library.removeBooks = async bookIds => ({ bookIds, committed: true, files: { status: "pending", errorCode: "fs/permission" } });
  const result = await buildDeleteBooksTool(scope, deps).execute("batch", { bookIds: ["a", "b"] });
  expect(result.content[0]).toMatchObject({ text: JSON.stringify({ bookIds: ["a", "b"], committed: true, files: { status: "pending", errorCode: "fs/permission" } }) });
  deps.library.removeBooks = async () => { throw Error("Must not delete records on cleanup"); };
  deps.library.listBooks = async () => [];
  const retry = await buildDeleteBooksTool(scope, deps).execute("cleanup", { bookIds: ["a", "b"], cleanupOnly: true });
  expect(retry.content[0]).toMatchObject({ text: JSON.stringify({ bookIds: ["a", "b"], files: { status: "pending", errorCode: "library/book-reappeared" } }) });
});
