import { expect, test } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { AppError, type AnnotationItem, type Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildAnnotationTools } from "./annotation-tools";
import { buildThreadTools } from "./library-tools";

const bookId = "book" as Id;
const timestamp = "2026-09-09T00:00:00Z";
const note: AnnotationItem = { kind: "note", id: "note" as Id, bookId, body: "Original", createdAt: timestamp, updatedAt: timestamp };
const ask: AnnotationItem = { kind: "ask", id: "ask" as Id, bookId, text: "A real question", createdAt: timestamp };
function fixture() {
  const { deps, stores } = createInMemoryDeps({ books: [{ id: bookId, title: "Book" }], annotations: [note, ask, { ...note, id: "other-note" as Id, bookId: "other" as Id }] });
  const scope = { kind: "book" as const, bookId };
  const tools = [...buildAnnotationTools(scope, deps), ...buildThreadTools(scope, deps)];
  return { deps, stores, tool: (name: string) => tools.find(tool => tool.name === name)! };
}
const parsed = (result: AgentToolResult<unknown>) => {
  if (result.content[0]?.type !== "text") throw new Error("Expected text result");
  return JSON.parse(result.content[0].text);
};

test("Agent creates an underline through the canonical highlight command", async () => {
  const { deps, tool } = fixture();
  const result = parsed(await tool("create_annotation").execute("create", { kind: "highlight", text: "Quoted passage", style: "underline", color: "blue" }));
  expect(result).toMatchObject({ kind: "highlight", style: "underline", color: "blue", bookId });
  expect(await deps.annotations.getAnnotation(result.id)).toMatchObject({ style: "underline" });
  expect(parsed(await tool("create_annotation").execute("create", { kind: "highlight", text: "Default" }))).toMatchObject({ style: "highlight" });
});

test("exact annotation reads preserve book/type filters without scanning the list", async () => {
  const { deps, tool } = fixture();
  deps.annotations.listAnnotations = async () => { throw new Error("Unexpected full list"); };
  expect(parsed(await tool("get_annotations").execute("get", { annotationId: "note" })).items).toEqual([note]);
  expect(parsed(await tool("get_annotations").execute("get", { annotationId: "missing" })).items).toEqual([]);
  expect(parsed(await tool("get_annotations").execute("get", { annotationId: "note", kind: "ask" })).items).toEqual([]);
  expect(parsed(await tool("get_annotations").execute("get", { annotationId: "other-note" })).items).toEqual([]);
  // Existing annotation tools allow explicit cross-book retrieval; scope is a default, not a new permission.
  expect(parsed(await tool("get_annotations").execute("get", { annotationId: "other-note", bookId: "other" })).items).toHaveLength(1);
  await expect(tool("get_annotations").execute("get", { annotationId: "note", query: "Original" })).rejects.toMatchObject({ code: "annotations/invalid-input" });
});

test("type filters reach the annotations port", async () => {
  const { tool } = fixture();
  expect(parsed(await tool("get_annotations").execute("get", { kind: "ask" })).items).toEqual([ask]);
});

test("Agent annotation browsing is paginated and cursor filters cannot be changed", async () => {
  const { deps, tool } = fixture();
  deps.annotations.listAnnotations = async () => { throw new Error("Must not scan the legacy list"); };
  const first = parsed(await tool("get_annotations").execute("get", { limit: 1 }));
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).toBeString();
  const next = parsed(await tool("get_annotations").execute("get", { limit: 1, cursor: first.nextCursor }));
  expect(next.items).toHaveLength(1);
  expect(next.items[0].id).not.toBe(first.items[0].id);
  expect(next.nextCursor).toBeNull();
  await expect(tool("get_annotations").execute("get", { bookId: "other", cursor: first.nextCursor })).rejects.toMatchObject({ code: "annotations/invalid-cursor" });
});

test("edit and approved ask deletion use exact lookup, retaining the approval boundary", async () => {
  const { deps, stores, tool } = fixture();
  deps.annotations.listAnnotations = async () => { throw new Error("Unexpected full list"); };
  await tool("edit_annotation").execute("edit", { annotationId: "note", body: "Revised" });
  expect(await deps.annotations.getAnnotation(note.id)).toMatchObject({ body: "Revised" });
  const result = parsed(await tool("delete_annotation").execute("delete", { annotationId: "ask" }));
  expect(result).toMatchObject({ deleted: true, annotationKind: "ask" });
  expect(await deps.annotations.getAnnotation(ask.id)).toBeNull();
  expect(stores.interactions).toMatchObject([{ kind: "permission", action: "delete-annotation" }]);
});

test("declined ask deletion preserves the trace", async () => {
  const { deps, tool } = fixture();
  deps.interactions.request = async () => ({ cancelled: true });
  expect(parsed(await tool("delete_annotation").execute("delete", { annotationId: "ask" }))).toMatchObject({ deleted: false });
  expect(await deps.annotations.getAnnotation(ask.id)).toEqual(ask);
});

test("exact read storage errors are not reported as absent annotations", async () => {
  const { deps, tool } = fixture();
  deps.annotations.getAnnotation = async () => { throw new AppError("db/locked", "Locked"); };
  await expect(tool("get_annotations").execute("get", { annotationId: "note" })).rejects.toMatchObject({ code: "db/locked" });
});
