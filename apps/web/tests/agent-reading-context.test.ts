/**
 * What a model can learn about the reader's place in a real book, checked
 * without a model.
 *
 * The book is one of the eval books, read by the app over the headless shell.
 * A scripted model stands where a real one would: these tests look at what the
 * runtime puts in front of it and what the reading tool hands back. They are
 * the contract a reading question depends on — the enclosing paragraph, its
 * place in the chapter, the reading boundary — and they fail when the app's
 * pipeline stops delivering it, whatever a model would have made of it.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Context } from "@earendil-works/pi-ai";
import { evalSuites, type AgentEvalScenario } from "@read-aware/agent/evals";
import { createScriptedThread } from "@read-aware/agent/testing/scripted-thread";
import { blocksIn } from "@read-aware/core";
import { getExtractedChapters } from "../src/domain/library";
import { addEvalBooks, createAppEvalHost, extractEvalBook, readEvalBookSnapshot } from "./headless/eval-host";
import { installHeadlessShell, type HeadlessShell } from "./headless/shell";

const BOOK = "eval-karamazov";
let shell: HeadlessShell;
beforeAll(async () => {
  shell = await installHeadlessShell();
  addEvalBooks(shell, ["karamazov"]);
});
afterAll(() => shell.dispose());

const text = (message: Context["messages"][number]) =>
  typeof message.content === "string"
    ? message.content
    : message.content.map((part) => ("text" in part ? part.text : "")).join("");

/** Run one turn of a scenario with a model that only calls the given tools, and collect what it was shown. */
async function scripted(
  scenario: AgentEvalScenario,
  turnIndex: number,
  calls: Parameters<typeof createScriptedThread>[2],
) {
  const environment = await createAppEvalHost().createEnvironment(scenario);
  const turn = await environment.locateTurn(scenario.turns[turnIndex]!);
  const requests: Context[] = [];
  const { thread, dispose } = createScriptedThread(scenario.scope, environment.deps, calls, (context) =>
    requests.push(structuredClone(context)),
  );
  try {
    for await (const _chunk of thread.sendTurn(turn)) {
      // Drain: the requests are what is examined.
    }
  } finally {
    dispose();
  }
  const prompt = text(requests[0]!.messages[requests[0]!.messages.length - 1]!);
  const results = requests
    .slice(1)
    .map((request) => request.messages[request.messages.length - 1]!)
    .filter((message) => message.role === "toolResult")
    .map(text);
  return { environment, turn, prompt, results };
}

const scenarioOf = (suite: keyof typeof evalSuites, id: string) =>
  evalSuites[suite].scenarios.find((scenario) => scenario.id === id)! as AgentEvalScenario;

test("the eval book's snapshot is what the app extracts from it", async () => {
  const stored = readEvalBookSnapshot("karamazov");
  expect(stored).not.toBeNull();
  // Scenarios are written against the snapshot: a difference means they describe a book the app no longer produces.
  expect(JSON.stringify(await extractEvalBook("karamazov")) === JSON.stringify(stored)).toBe(true);
});

test("a selection in the middle of a chapter: coordinates in the prompt, the passage and its place from the tool", async () => {
  const scenario = scenarioOf("karamazov", "karamazov-passage-role-in-chapter");
  const selection = scenario.turns[0]!.attachments![0]!.text;
  const chapterIndex = scenario.turns[0]!.readingCursor!.chapterIndex!;
  const chapter = (await getExtractedChapters(BOOK, "system"))[chapterIndex]!;
  const at = chapter.text.indexOf(selection);
  const { environment, turn, prompt, results } = await scripted(scenario, 0, [
    { name: "read_chapter", arguments: { around: "selection", context: 1 } },
  ]);

  expect(environment.environment).toBe("app-headless");
  // The reader reports where the page is, not a chapter index or text offsets: the runtime resolves them.
  expect(turn.readingCursor).toMatchObject({ anchor: expect.stringMatching(/^epubcfi\(/), chapter: chapter.hrefs![0] });
  expect(turn.readingCursor!.chapterIndex).toBeUndefined();
  expect(turn.attachments![0]!.anchor).toMatch(/^epubcfi\(/);

  // The model is given coordinates: the chapter the app resolved, the page, the selection. No page text.
  const [block] = blocksIn(chapter.layout, at, at + selection.length);
  expect(prompt).toContain(`chapter_index: ${chapterIndex}`);
  expect(prompt).toContain(`chapter_title: ${JSON.stringify(chapter.title)}`);
  expect(prompt).toMatch(
    /\nposition: paragraph \d+ sentence \d+ through paragraph \d+ sentence \d+, of \d+ paragraphs/,
  );
  expect(prompt).toMatch(new RegExp(`\\nselection: paragraph ${block!.paragraph} sentence \\d+`));
  expect(prompt).not.toContain("visible_text");
  const before = chapter.text.slice(Math.max(0, at - 80), at - 20);
  expect(before.length).toBeGreaterThan(20);
  expect(prompt).not.toContain(before);

  // The tool returns the passage in place: its block, the blocks around it, where it sits in the chapter.
  const read = JSON.parse(JSON.parse(results[results.length - 1]!).content?.[0]?.text ?? results[results.length - 1]!);
  expect(read.focus.start.paragraph).toBe(block!.paragraph);
  expect(read.blocks.total).toBe(chapter.layout.paragraphs.length);
  expect(read.placeInChapter).toContain(`paragraph ${block!.paragraph} of ${chapter.layout.paragraphs.length}`);
  expect(read.text).toContain(selection);
  expect(read.text).toContain(`[${block!.paragraph}`);
  // A narrative reader's chapter ends at their page: the sentence after the selection is not handed over.
  const unread = chapter.text
    .slice(at + selection.length)
    .trim()
    .slice(0, 24);
  expect(read.readerPosition).toBeDefined();
  expect(read.text).not.toContain(unread);
});

test("a selection the reader holds is a real range of the book, in the chapter it was made in", async () => {
  const scenario = scenarioOf("karamazov", "karamazov-annotate-verbatim");
  const selection = scenario.turns[0]!.attachments![0]!.text;
  const chapterIndex = scenario.turns[0]!.readingCursor!.chapterIndex!;
  const environment = await createAppEvalHost().createEnvironment(scenario);
  await scenario.setup?.(environment);
  // The reader session exposes the selection as the app would: a versioned range that reads back as the passage.
  const session = await environment.deps.reader.getSession();
  expect(session.selection?.text).toBe(selection);
  const range = session.selection!.range!;
  expect(range.cfi).toMatch(/^epubcfi\(\/6\//);
  expect(range.contentVersion).toMatch(/^sha256:/);
  expect((await environment.deps.bookText.readRange({ range, limit: 12000, contextChars: 0 })).text).toBe(selection);
  expect((await environment.deps.bookText.locate!(BOOK as never, range))?.start.chapterIndex).toBe(chapterIndex);
});
