import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { createInMemoryDeps } from "../testing/fixtures";
import { digestBookTick } from "./graph-upkeep";

test("a user classification during inference wins and determines the digest flavor", async () => {
  const { deps, stores } = createInMemoryDeps({ books: [{ id: "b", title: "Book", status: "finished" }],
    chapters: { b: [{ title: "One", text: "Sample text for classification.", hrefs: ["one"] }] } });
  let calls = 0;
  await digestBookTick({ deps, bookId: "b", model: { id: "fixture" } as Model<Api>, complete: async () => {
    if (calls++ === 0) {
      stores.books[0]!.narrativity = "expository";
      return fauxAssistantMessage('{"narrativity":"narrative","confidence":0.99}');
    }
    return fauxAssistantMessage('{"summary":"A concept","characters":[],"relations":[]}');
  } });
  expect(stores.books[0]!.narrativity).toBe("expository");
  const digests = await deps.bookMemory.listDigests("b");
  expect(digests).toHaveLength(1); expect(digests[0]!.flavor).toBe("expository");
  expect(calls).toBe(2);
});
