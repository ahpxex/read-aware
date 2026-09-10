import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildImageViewerTools } from "./image-viewer-tools";

test("Agent controls are scoped to the active book and exact viewer and never reveal image content", async () => {
  const { deps } = createInMemoryDeps();
  const snapshot = { id: "image", sessionId: "session", bookId: "book", revision: 1, scale: 1, rotation: 0, panX: 0, panY: 0 };
  deps.reader.getImage = async () => snapshot;
  let calls = 0;
  deps.reader.controlImage = async () => { calls++; return { status: "closed", id: "image" }; };
  for (const scope of [{ kind: "global", threadId: "global" }, { kind: "book", bookId: "book" }, { kind: "book", bookId: "other" }] as const) {
    const [read, control] = buildImageViewerTools(scope, deps);
    const result = JSON.stringify(await read!.execute("q", {}));
    if (scope.kind === "book" && scope.bookId === "other") {
      expect(result).not.toContain("panX");
      await expect(control!.execute("c", { request: { id: "image", action: "close" } })).rejects.toMatchObject({ code: "reader/superseded" });
    } else {
      expect(result).toContain("panX");
      await control!.execute("c", { request: { id: "image", action: "close" } });
    }
    await expect(control!.execute("c", { request: { id: "old", action: "close" } })).rejects.toMatchObject({ code: "reader/superseded" });
  }
  expect(calls).toBe(2);
});
