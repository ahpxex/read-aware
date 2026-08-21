/**
 * 套件注册表的结构不变量：组织层的机器收口。挂了这套约束，"什么测试是
 * 什么类型"就不再靠约定——词汇表外的标签、无标签的场景、重复的场景 id
 * 都会在 bun test 里红。
 */
import { describe, expect, test } from "bun:test";
import { realBookSlugs } from "../book-fixtures";
import { evalSuites, evalSuiteGroups, suiteIdsOfGroup } from "./index";
import type { AgentEvalScenario } from "../agent-harness";
import type { EvalSuite } from "../types";
import { invalidTags } from "../tags";
import { realBook, type RealBookSlug } from "../book-fixtures";
import { buildSystemPrompt } from "../../context/system-prompt";
import { SPOILER_POLICY_RULES } from "../../context/spoiler-policy";

const BOOK_SLUGS = realBookSlugs();
const allSuites = Object.values(evalSuites) as EvalSuite<AgentEvalScenario>[];

describe("eval suite registry", () => {
  test("every suite belongs to exactly one group and the registry is their union", () => {
    const groupMembers = [
      ...suiteIdsOfGroup("behavior"),
      ...suiteIdsOfGroup("realbook"),
    ];
    expect(groupMembers.length).toBe(new Set(groupMembers).size);
    expect([...groupMembers].sort()).toEqual(
      [...Object.keys(evalSuites)].sort() as typeof groupMembers,
    );
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
      text.normalize("NFKC").toLocaleLowerCase().replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}]/gu, "");

    const realbookSuites = Object.values(
      evalSuiteGroups.realbook.suites,
    ) as EvalSuite<AgentEvalScenario>[];
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
          chapters.slice(0, Math.max(0, boundary)).map((chapter) => chapter.text).join("\n"),
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
