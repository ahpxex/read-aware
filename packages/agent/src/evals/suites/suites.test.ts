/**
 * 套件注册表的结构不变量：组织层的机器收口。挂了这套约束，"什么测试是
 * 什么类型"就不再靠约定——词汇表外的标签、无标签的场景、重复的场景 id
 * 都会在 bun test 里红。
 */
import { describe, expect, test } from "bun:test";
import { realBookSlugs } from "../book-fixtures";
import { evalSuites, evalSuiteGroups, suiteIdsOfGroup } from "./index";
import type { AgentEvalScenario } from "../agent-harness";
import type { AgentEvalObservation, EvalSuite } from "../types";
import { invalidTags } from "../tags";
import { createInMemoryEnvironment } from "../host";
import { toJsonValue } from "../json";
import { realBook, type RealBookSlug } from "../book-fixtures";
import { buildSystemPrompt } from "../../context/system-prompt";
import { SPOILER_POLICY_RULES } from "../../context/spoiler-policy";

const BOOK_SLUGS = realBookSlugs();
const allSuites = Object.values(evalSuites) as EvalSuite<AgentEvalScenario>[];

function behaviorObservation(overrides: Partial<AgentEvalObservation>): AgentEvalObservation {
  return {
    turns: [],
    answer: "已完成。",
    thinking: "",
    tools: [],
    interactions: [],
    modelRequests: [],
    telemetry: { wallTimeMs: 1 },
    ...overrides,
  };
}

describe("behavior acceptance boundaries", () => {
  test("a highlight claim without a create receipt remains a failed annotation task", async () => {
    const scenario = evalSuites.annotations.scenarios.find((s) => s.id === "highlight-verbatim-text")!;
    const assessment = await scenario.evaluate(
      behaviorObservation({
        answer: "Done — I highlighted the stopped-clock sentence.",
        state: [
          {
            kind: "highlight",
            text: "Mara notices the brass clock stopped at nine minutes past two, wet footprints leading nowhere, and an unopened letter on the desk.",
          },
        ],
        tools: [],
      }),
    );
    expect(assessment.passed).toBe(false);
    expect(assessment.checks.find((check) => check.id === "tool.required.create_annotation")?.passed).toBe(false);
  });

  test("an explicit note request requires the complete dictated body", async () => {
    const scenario = evalSuites.annotations.scenarios.find((s) => s.id === "note-on-request")!;
    const exactBody = "the bolted doors make the housekeeper the only person who could stage this.";
    const receipt = { turn: 1, id: "note", name: "create_annotation", isError: false };
    const exact = await scenario.evaluate(
      behaviorObservation({
        tools: [receipt],
        state: [{ kind: "note", body: exactBody }],
      }),
    );
    expect(exact.passed).toBe(true);
    const truncated = await scenario.evaluate(
      behaviorObservation({
        tools: [receipt],
        state: [{ kind: "note", body: exactBody.slice(0, -1) }],
      }),
    );
    expect(truncated.passed).toBe(false);
    expect(truncated.checks.find((check) => check.id === "state.note-body-preserved")?.passed).toBe(false);
  });

  test("the journey fixture exposes its selected passage through the reader session", async () => {
    const scenario = evalSuites.journeys.scenarios.find((s) => s.id === "karamazov-reading-session")!;
    const context = createInMemoryEnvironment(scenario);
    await scenario.setup?.(context);
    const session = await context.deps.reader.getSession();
    const selected = scenario.turns[0]!.attachments![0]!.text;
    expect(session.selection?.text).toBe(selected);
    expect(session.selection?.range).toBeDefined();
    const range = session.selection!.range!;
    const source = await context.deps.bookText.readRange({ range, limit: 12000, contextChars: 0 });
    expect(scenario.scope.kind).toBe("book");
    if (scenario.scope.kind !== "book") throw new Error("journey fixture must use a book scope");
    expect(range.bookId).toBe(scenario.scope.bookId);
    expect(range.contentVersion).toBe(session.location!.contentVersion);
    expect(source.text).toBe(selected);
    expect(source.nextOffset).toBeNull();
    expect(source.sectionIndex).toBe(9);
  });

  test("selected highlight must preserve the selection even when adjacent text is verbatim", async () => {
    const scenario = evalSuites.refactoring.scenarios.find((s) => s.id === "refactoring-annotate-verbatim")!;
    const selected = scenario.turns[0]!.attachments![0]!.text;
    const visible = scenario.turns[0]!.readingCursor!.visibleText!;
    expect(visible).not.toBe(selected);
    const observation = async (text: string) => {
      const context = createInMemoryEnvironment(scenario);
      await scenario.setup?.(context);
      const bookId = realBook("refactoring").bookId;
      const chapterIndex = scenario.turns[0]!.readingCursor!.chapterIndex!;
      const chapter = context.stores.chapters.get(bookId)![chapterIndex]!;
      const start = chapter.text.indexOf(text);
      expect(start).toBeGreaterThanOrEqual(0);
      const { contentVersion } = await context.deps.bookText.getNavigationToc(bookId);
      const range = { bookId, contentVersion, cfi: `epubcfi(fixture:${chapterIndex}:${start}:${start + text.length})` };
      await context.deps.annotations.createHighlight({ bookId, text, range });
      await context.deps.annotations.createNote({ bookId, quotedText: text, body: "这里值得回头再读。", range });
      return behaviorObservation({
        tools: [
          { turn: 1, id: "highlight", name: "create_annotation", args: { kind: "highlight", text }, isError: false },
        ],
        state: toJsonValue(await scenario.observeState!(context)),
      });
    };
    expect((await scenario.evaluate(await observation(selected))).passed).toBe(true);
    const wider = await scenario.evaluate(await observation(visible));
    expect(wider.checks.find((check) => check.id === "state.highlight-selection-boundary")?.passed).toBe(false);
  });

  test("active annotation selections expose the complete source range matching each attachment", async () => {
    for (const suite of allSuites) {
      for (const scenario of suite.scenarios.filter((entry) => entry.id.endsWith("-annotate-verbatim"))) {
        const context = createInMemoryEnvironment(scenario);
        await scenario.setup?.(context);
        const session = await context.deps.reader.getSession();
        const selected = scenario.turns[0]!.attachments![0]!.text;
        expect(session.selection?.text, scenario.id).toBe(selected);
        expect(session.selection?.range, scenario.id).toBeDefined();
        const range = session.selection!.range!;
        const source = await context.deps.bookText.readRange({ range, limit: 12000, contextChars: 0 });
        expect(range.bookId).toBe(session.bookId!);
        expect(range.contentVersion).toBe(session.location!.contentVersion);
        expect(source.text).toBe(selected);
        expect(source.nextOffset).toBeNull();
        expect(source.sectionIndex).toBe(scenario.turns[0]!.readingCursor!.chapterIndex!);
      }
    }
  });

  test("memory correction accepts conditional edits only when the active user state contains the correction", async () => {
    const scenario = evalSuites.personalization.scenarios.find((s) => s.id === "memory-update-correction")!;
    const output = behaviorObservation({
      tools: [{ turn: 1, id: "correct", name: "manage_memory", args: { action: "correct" }, isError: false }],
      state: { memories: [{ scope: "user", content: "现在玩 Factorio", status: "active" }] },
    });
    expect((await scenario.evaluate(output)).passed).toBe(true);
    for (const memory of [
      { scope: "user", content: "仍玩 Minecraft", status: "active" },
      { scope: "book:other", content: "Factorio", status: "active" },
      { scope: "user", content: "Factorio", status: "forgotten" },
    ])
      expect((await scenario.evaluate({ ...output, state: { memories: [memory] } })).passed).toBe(false);
    expect((await scenario.evaluate({ ...output, state: { saved: [{ content: "Factorio" }] } })).passed).toBe(false);
  });

  test("a translated memory answer still requires evidence from the requested book", async () => {
    const scenario = evalSuites.memory.scenarios.find((s) => s.id === "global-thread-book-memory-search")!;
    const tool = {
      turn: 1,
      id: "search",
      name: "search_memory",
      args: { bookId: "eval-memory-book" },
      output: JSON.stringify({ items: [{ id: "memory-book-lighthouse", scope: "book:eval-memory-book" }] }),
      isError: false,
    };
    const output = behaviorObservation({ answer: "你把灯塔看守人的作息看作注意力的隐喻。", tools: [tool] });
    expect((await scenario.evaluate(output)).passed).toBe(true);
    expect(
      (await scenario.evaluate({ ...output, tools: [{ ...tool, args: { bookId: "another-book" } }] })).passed,
    ).toBe(false);
    expect((await scenario.evaluate({ ...output, tools: [{ ...tool, output: '{"items":[]}' }] })).passed).toBe(false);
    expect((await scenario.evaluate({ ...output, answer: "你喜欢晚上读书。" })).passed).toBe(false);
  });
});

describe("eval suite registry", () => {
  test("every suite belongs to exactly one group and the registry is their union", () => {
    const groupMembers = [...suiteIdsOfGroup("behavior"), ...suiteIdsOfGroup("realbook")];
    expect(groupMembers.length).toBe(new Set(groupMembers).size);
    expect([...groupMembers].sort()).toEqual([...Object.keys(evalSuites)].sort() as typeof groupMembers);
  });

  test("group suite ids all resolve to registered suites", () => {
    for (const group of ["behavior", "realbook"] as const) {
      for (const suiteId of suiteIdsOfGroup(group)) {
        expect((evalSuites as Record<string, unknown>)[suiteId], `${group}/${suiteId}`).toBeDefined();
        expect(
          (evalSuiteGroups[group].suites as Record<string, unknown>)[suiteId],
          `${group}/${suiteId}`,
        ).toBeDefined();
      }
    }
  });

  test("suite codes are unique and stable-format (S01…)", () => {
    const codes = allSuites.map((suite) => suite.code);
    expect(codes.length).toBe(new Set(codes).size);
    for (const code of codes) expect(code).toMatch(/^S\d{2,}$/);
  });

  test("every suite has a readable display name", () => {
    for (const suite of allSuites) {
      expect(suite.displayName.trim().length, suite.id).toBeGreaterThan(0);
      expect(suite.displayName, suite.id).not.toBe(suite.id);
    }
  });

  test("real-book suites are organized one-to-one by registered book slug", () => {
    expect([...suiteIdsOfGroup("realbook")].sort()).toEqual([...BOOK_SLUGS].sort());
  });

  test("scenario ids are unique within each suite and non-empty everywhere", () => {
    for (const suite of allSuites) {
      expect(suite.scenarios.length).toBeGreaterThan(0);
      const ids = suite.scenarios.map((scenario) => scenario.id);
      expect(ids.length, suite.id).toBe(new Set(ids).size);
    }
  });

  test("every scenario carries tags from the closed vocabulary or a real-book slug", () => {
    const violations: string[] = [];
    for (const suite of allSuites) {
      for (const scenario of suite.scenarios) {
        const tags = scenario.tags ?? [];
        if (tags.length === 0) violations.push(`${suite.id}/${scenario.id}: no tags`);
        for (const problem of invalidTags(tags, BOOK_SLUGS)) {
          violations.push(`${suite.id}/${scenario.id}: ${problem}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("the product prompt contains every shared spoiler-policy rule", () => {
    const prompt = buildSystemPrompt({ kind: "book", bookId: "policy-book" as never }, {});
    for (const rule of SPOILER_POLICY_RULES) expect(prompt).toContain(rule);
  });

  test("declared leak markers are absent from TOC titles and boundary-safe text", () => {
    const violations: string[] = [];
    const normalize = (text: string) =>
      text
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}]/gu, "");

    const realbookSuites = Object.values(evalSuiteGroups.realbook.suites) as EvalSuite<AgentEvalScenario>[];
    for (const suite of realbookSuites) {
      for (const scenario of suite.scenarios) {
        const input = scenario.input as Record<string, unknown>;
        const criteria = input.criteria as Record<string, unknown> | undefined;
        const policy = criteria?.fixturePolicy as
          | { bookSlug?: string; boundaryChapter?: number; leakWords?: string[] }
          | undefined;
        if (!policy?.bookSlug || !policy.leakWords?.length) continue;
        const book = realBook(policy.bookSlug as RealBookSlug);
        const chapters = book.epub().chapters;
        const toc = normalize(chapters.map((chapter) => chapter.title ?? "").join("\n"));
        const boundary = policy.boundaryChapter ?? -1;
        const safeChapterText = normalize(
          chapters
            .slice(0, Math.max(0, boundary))
            .map((chapter) => chapter.text)
            .join("\n"),
        );
        const turns = (input.turns ?? []) as Array<{
          readingCursor?: { chapterIndex?: number; visibleText?: string };
        }>;
        const visibleText = normalize(
          turns
            .filter((turn) => turn.readingCursor?.chapterIndex === boundary)
            .map((turn) => turn.readingCursor?.visibleText ?? "")
            .join("\n"),
        );
        for (const marker of policy.leakWords) {
          const normalized = normalize(marker);
          if (toc.includes(normalized)) {
            violations.push(`${suite.id}/${scenario.id}: ${marker} is TOC-visible`);
          }
          if (safeChapterText.includes(normalized) || visibleText.includes(normalized)) {
            violations.push(`${suite.id}/${scenario.id}: ${marker} is boundary-safe`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
