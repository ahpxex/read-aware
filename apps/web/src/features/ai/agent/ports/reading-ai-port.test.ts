import { expect, spyOn, test } from "bun:test";
import { createInMemoryDeps } from "@read-aware/agent/testing";
import { createScriptedThread } from "@read-aware/agent/testing/scripted-thread";
import { ReadingSessionController } from "../../../../domain/reading-session-controller";
import { readingRuntime } from "../../../../domain/reading-runtime";
import { readerPanels } from "../../../../services/reader-panels";
import { readingAiActions } from "../../../../services/reading-ai-runtime";
import { buildRuntimeDeps } from "./index";
import { initI18n } from "../../../../i18n";

test("actual Agent ports execute a captured selection in the existing book turn, not a recursive chat request", async () => {
  await initI18n("en");
  const session = new ReadingSessionController(() => {}).snapshot();
  Object.assign(session, { status: "ready", sessionId: "session", bookId: "book", location: { bookId: "book", contentVersion: "v1", href: "chapter.xhtml" },
    selection: { id: "selection", text: "Selected meaning", textLength: 16, range: null } });
  const spies = [spyOn(readingRuntime, "snapshot").mockReturnValue(session),
    spyOn(readerPanels, "setPanel").mockResolvedValue({ status: "completed", sessionId: "session", panel: "chat", open: true } as never)];
  const { deps } = createInMemoryDeps({ books: [{ id: "book", title: "Test", author: "Test", progressPercent: 10, status: "reading" }] });
  deps.readingAiActions = buildRuntimeDeps().readingAiActions;
  let sends = 0;
  const unbind = readingAiActions.bind("book", { send: () => { sends++; return "started"; } });
  const scripted = createScriptedThread({ kind: "book", bookId: "book" }, deps, [{ name: "define_term", arguments: {} }]);
  try {
    const chunks = [];
    for await (const chunk of scripted.thread.sendTurn({ text: "Define the selected term." })) chunks.push(chunk);
    const end = chunks.find(chunk => chunk.type === "tool-step" && chunk.phase === "end");
    expect(end).toMatchObject({ tool: "define_term", isError: false });
    expect(JSON.parse((end as { output: string }).output)).toMatchObject({ status: "context", context: { action: "defineTerm", bookId: "book", selection: { text: "Selected meaning" } } });
    expect(readerPanels.setPanel).toHaveBeenCalledWith("chat", true, expect.any(AbortSignal), { bookId: "book", sessionId: "session" });
    expect(sends).toBe(0);
  } finally { scripted.dispose(); unbind(); for (const spy of spies) spy.mockRestore(); }
});
