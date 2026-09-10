import { expect, test } from "bun:test";
import type { Annotation } from "./annotation-types";
import { observedAnnotationMutation } from "./native-annotation-mutations";

const note: Annotation & { revision: string } = { id: "n", bookId: "b", type: "note", text: "quote", content: "body",
  cfiRange: null, chapterHref: null, createdAt: "then", updatedAt: "then", revision: `ann1:${"a".repeat(64)}` };

test("native update/delete use exactly the revision displayed, never synthesize a fresh token", () => {
  expect(observedAnnotationMutation(note, { op: "updateNote", body: "draft" })).toEqual({
    op: "updateNote", body: "draft", annotationId: "n", expectedRevision: note.revision });
  expect(observedAnnotationMutation(note, { op: "remove" })).toMatchObject({ kind: "note", expectedRevision: note.revision });
  expect(() => observedAnnotationMutation({ ...note, revision: undefined }, { op: "remove" })).toThrow();
  expect(() => observedAnnotationMutation(note, { op: "recolorHighlight", color: "blue" })).toThrow();
});

test("native recolor changes color only and cannot restore a stale style", () => {
  const highlight: Annotation = { ...note, type: "highlight", color: "yellow", style: "underline" };
  expect(observedAnnotationMutation(highlight, { op: "recolorHighlight", color: "blue" })).toEqual({
    op: "recolorHighlight", color: "blue", annotationId: "n", expectedRevision: note.revision });
  expect(observedAnnotationMutation({ ...note, type: "ask" }, { op: "remove" })).toMatchObject({ kind: "ask" });
});
