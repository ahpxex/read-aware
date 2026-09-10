import { expect, test } from "bun:test";
import type { BookMergePreview, Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildBookMergeTools } from "./book-merge-tools";

function fixture() {
  const { deps } = createInMemoryDeps();
  const preview: BookMergePreview = { revision: `bmg1:${"a".repeat(64)}`,
    keep: { id: "a", title: "Keep", author: "Author", createdAt: "1" },
    merged: [{ id: "b", title: "Duplicate", author: "Author", createdAt: "2" }] };
  deps.library.previewMerge = async () => preview;
  const calls: unknown[] = [];
  deps.library.mergeDuplicates = async (input, signal) => {
    calls.push([input, signal]);
    return { committed: true, keepId: "a", redirects: [{ from: "b", to: "a" }] };
  };
  const tools = buildBookMergeTools({ kind: "global", threadId: "thread" }, deps);
  return { deps, preview, calls, merge: tools.find(tool => tool.name === "merge_duplicate_books")! };
}

test("merge is global-only, requires matching preview and respects declined approval", async () => {
  const f = fixture(); let approvals = 0;
  expect(buildBookMergeTools({ kind: "book", bookId: "a" as Id }, f.deps)).toEqual([]);
  f.deps.interactions.request = async () => { approvals++; return { optionId: "decline" }; };
  await expect(f.merge.execute("stale", { bookId: "a", expectedRevision: "old" })).rejects.toMatchObject({ code: "ui/superseded" });
  expect(approvals).toBe(0);
  expect((await f.merge.execute("decline", { bookId: "a", expectedRevision: f.preview.revision })).content).toEqual([{ type: "text", text: '{"committed":false}' }]);
  expect(approvals).toBe(1);
  expect(f.calls).toEqual([]);
});

test("approval names the full group and cannot mutate the approved request", async () => {
  const f = fixture(), signal = new AbortController().signal;
  const input = { bookId: "a", expectedRevision: f.preview.revision };
  f.deps.interactions.request = async request => {
    expect(request).toMatchObject({ kind: "permission", action: "merge-books" });
    expect(request.kind === "permission" && request.subject).toBe("Keep (a)\n←\nDuplicate (b)");
    input.bookId = "unapproved";
    return { optionId: "approve" };
  };
  const result = await f.merge.execute("approved", input, signal);
  expect(f.calls).toEqual([[{ bookId: "a", expectedRevision: f.preview.revision }, signal]]);
  expect(JSON.stringify(result)).toContain("totalRedirects");
});
