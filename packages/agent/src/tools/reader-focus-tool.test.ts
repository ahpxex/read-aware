import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildReaderFocusTool } from "./reader-focus-tool";
import type { ThreadScope } from "../thread-scope";

test("both scopes focus only their current ready reader and retain a non-success receipt", async () => {
  for (const scope of [{ kind: "global", threadId: "t" }, { kind: "book", bookId: "book" }] as ThreadScope[]) {
    const { deps } = createInMemoryDeps();
    await deps.reader.openBook("book");
    let received: unknown;
    deps.reader.focus = async (...args) => { received = args; return { status: "not-focused", reason: "hidden", target: args[0], bookId: "book", sessionId: "fixture" }; };
    const tool = buildReaderFocusTool(scope, deps), controller = new AbortController();
    const result = await tool.execute("focus", { target: "chat" }, controller.signal);
    expect(received).toEqual(["chat", controller.signal, { bookId: "book", sessionId: "fixture" }]);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(result.content)).toContain("not-focused");
    await expect(tool.execute("invalid", { target: "#input" })).rejects.toMatchObject({ code: "reader/invalid-target" });
    await expect(tool.execute("extra", { target: "chat", force: true })).rejects.toMatchObject({ code: "reader/invalid-target" });
    await expect(tool.execute("cancelled", { target: "chat" }, AbortSignal.abort())).rejects.toBeDefined();
    if (scope.kind === "book") {
      await deps.reader.openBook("other");
      await expect(tool.execute("other", { target: "content" })).rejects.toMatchObject({ code: "reader/superseded" });
    }
  }
});
