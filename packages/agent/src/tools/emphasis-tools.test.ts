import { expect, test } from "bun:test";
import { AppError, type Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildEmphasisTools } from "./emphasis-tools";

const range = { bookId: "book", contentVersion: "fixture", cfi: "epubcfi(/6/2!/4/2,/1:0,/1:6)", textQuote: { exact: "private needle" } };
test("emphasis uses copied references, scope guards and cancellation; results contain metadata rather than text", async () => {
  const { deps } = createInMemoryDeps(); await deps.reader.openBook("book");
  const tool = buildEmphasisTools({ kind: "book", bookId: "book" as Id }, deps)[0];
  const original = deps.reader.putEmphasis; let args: unknown;
  deps.reader.putEmphasis = async (...input) => { args = input; return original(...input); };
  const signal = new AbortController().signal;
  const before = await deps.reader.getSession();
  const result = await tool.execute("put", { action: "put", ranges: [range] }, signal);
  expect(args).toEqual([{ ranges: [range], style: "highlight" }, signal, { bookId: "book", sessionId: "fixture" }]);
  expect(JSON.stringify(result)).not.toContain("private needle");
  expect((await deps.reader.getSession()).location).toEqual(before.location);
  const mark = (await deps.reader.listEmphasis())[0];
  await tool.execute("replace", { action: "put", ranges: [range], id: mark.id, expectedRevision: mark.revision, style: "underline" });
  await expect(tool.execute("stale", { action: "remove", id: mark.id, expectedRevision: mark.revision })).rejects.toMatchObject({ code: "reader/superseded" });
  const current = (await deps.reader.listEmphasis())[0];
  await tool.execute("remove", { action: "remove", id: current.id, expectedRevision: current.revision });
  expect(await deps.reader.listEmphasis()).toEqual([]);
});

test("malformed operations and wrong-book scopes cannot dispatch while failures never turn into success", async () => {
  const { deps } = createInMemoryDeps(); await deps.reader.openBook("book");
  const tool = buildEmphasisTools({ kind: "book", bookId: "other" as Id }, deps)[0];
  await expect(tool.execute("put", { action: "put", ranges: [range] })).rejects.toMatchObject({ code: "reader/out-of-scope" });
  for (const params of [{ action: "list", id: "x" }, { action: "put", ranges: [range], owner: "other" }, { action: "remove", id: "x" }, { action: "toggle" }]) {
    await expect(tool.execute("invalid", params)).rejects.toMatchObject({ code: "reader/invalid-target" });
  }
  const global = buildEmphasisTools({ kind: "global", threadId: "probe" }, deps)[0];
  deps.reader.putEmphasis = async () => { throw new AppError("reader/stale-location", "Changed source"); };
  await expect(global.execute("put", { action: "put", ranges: [range] })).rejects.toMatchObject({ code: "reader/stale-location" });
  const abort = new AbortController(); abort.abort(Error("stopped"));
  await expect(global.execute("put", { action: "put", ranges: [range] }, abort.signal)).rejects.toThrow("stopped");
});
