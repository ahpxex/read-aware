import { expect, test } from "bun:test";
import { validateAnnotationMutations } from "./annotation-mutations";

const valid = { op: "updateNote" as const, annotationId: "note", expectedRevision: `ann1:${"a".repeat(64)}`, body: "New body" };
test("conditional batches accept distinct semantic changes, not arbitrary events", () => {
  expect(() => validateAnnotationMutations([valid])).not.toThrow();
  expect(() => validateAnnotationMutations([{ ...valid, op: "remove", kind: "ask" }])).not.toThrow();
  expect(() => validateAnnotationMutations([{ ...valid, op: "recolorHighlight", color: "blue", style: "underline" }])).not.toThrow();
});
test("conditional batches reject malformed operations, duplicate IDs, tokens and oversized requests", () => {
  const bad = [null, [], [valid, valid], [null], [{ ...valid, op: "appendEvent" }], [{ ...valid, expectedRevision: "2026-09-09" }], [{ ...valid, annotationId: "" }], [{ ...valid, body: 1 }], [{ ...valid, body: "x".repeat(100_001) }], [{ ...valid, op: "recolorHighlight", color: "invalid" }], [{ ...valid, op: "remove", kind: "book" }], Array.from({length:101},(_,i)=>({...valid,annotationId:String(i)})), Array.from({length:10},(_,i)=>({...valid,annotationId:String(i),body:"汉".repeat(100_000)}))];
  for (const changes of bad) expect(() => validateAnnotationMutations(changes as never)).toThrow();
});
