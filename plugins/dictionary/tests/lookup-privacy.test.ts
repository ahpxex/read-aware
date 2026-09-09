import { expect, test } from "bun:test";
import { lookUpTerm, lookupCacheId } from "../src/lookup";
import type { DictionaryContext } from "../src/types";

const entry = { headword: "SELECTION_947", senses: [{ definition: "A controlled definition" }] };
function fixture() {
  const documents = new Map<string, unknown>();
  type Request = Parameters<DictionaryContext["services"]["llm"]["ask"]>[0];
  const requests: Request[] = [];
  let selection = true, surrounding = true, failure: Error | undefined;
  const ctx = { locale: "en", domains: { settings: { queries: { read: async (path: string) =>
    ({ value: path.endsWith("sendHighlightedText") ? selection : surrounding }) } } }, services: {
    storage: { get: () => undefined, collection: () => ({ get: async (id: string) => documents.has(id) ? { data: documents.get(id) } : undefined,
      put: async (id: string, value: unknown) => { documents.set(id, value); } }) },
    llm: { ask: async (input: Request) => { requests.push(input); if (failure) throw failure; return entry; } },
  } } as unknown as DictionaryContext;
  return { ctx, documents, requests, settings(s: boolean, c: boolean) { selection = s; surrounding = c; }, fail(error: Error) { failure = error; } };
}
const input = { term: "SELECTION_947", source: "selection" as const, context: "PASSAGE_628", bookTitle: "Probe" };

test("selected text and surrounding passage travel only in structured host fields", async () => {
  const f = fixture(); await lookUpTerm(f.ctx, input);
  const request = f.requests[0]!;
  expect(request.readingContext).toEqual({ selection: input.term, surrounding: input.context, required: ["selection", "surrounding"] });
  const unstructured = JSON.stringify([request.prompt, request.system, request.schema]);
  expect(unstructured).not.toContain(input.term); expect(unstructured).not.toContain(input.context);
});

test("withheld surrounding context uses a distinct cache identity", async () => {
  const f = fixture(); f.settings(true, false);
  await lookUpTerm(f.ctx, input);
  expect(f.requests[0]!.readingContext).toEqual({ selection: input.term, surrounding: undefined, required: ["selection"] });
  expect(f.documents.has(lookupCacheId(input.term, "English", input.context, "Probe"))).toBe(false);
  expect(f.documents.has(lookupCacheId(input.term, "English", undefined, "Probe"))).toBe(true);
});

test("exact local cache hits work with both flags off without invoking inference", async () => {
  const f = fixture(); const first = await lookUpTerm(f.ctx, input);
  f.settings(false, false); f.fail(Error("Inference must not run"));
  expect(await lookUpTerm(f.ctx, input)).toEqual(first);
  expect(f.requests).toHaveLength(1);
});

test("host denial or settings races do not write a misleading cache entry", async () => {
  for (const message of ["ai/context-withheld", "ai/context-changed"]) {
    const f = fixture(); f.fail(Error(message));
    await expect(lookUpTerm(f.ctx, input)).rejects.toThrow(message);
    expect(f.documents.size).toBe(0);
  }
});

test("typed terms still work when book-text sharing is off", async () => {
  const f = fixture(); f.settings(false, false);
  await lookUpTerm(f.ctx, { ...input, source: "provided" });
  expect(f.requests[0]!.prompt).toContain(input.term);
  expect(f.requests[0]!.readingContext).toBeUndefined();
  expect(JSON.stringify(f.requests[0])).not.toContain(input.context);
});
