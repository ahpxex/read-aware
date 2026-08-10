import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { Id } from "@read-aware/core";
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import { textResult } from "../../tools/tool-result";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../types";

const TOOL_BOOK_ID = "eval-tool-book" as Id;
const PLUGIN_TOOL = "plugin_recommend_passage";

const ECONOMY_BOOK_ID = "eval-economy-book" as Id;

/**
 * 章节必须"厚"到读全书明显不划算（每章 ~4k 字符），检索才是唯一理性路径；
 * 标题保持不透题（"Kinship"这种标题会让 TOC 直接泄露答案位置）。
 */
function padChapter(opening: string, motif: string): string {
  const filler = Array.from(
    { length: 18 },
    (_, i) =>
      `The road unwound through ${motif} while the drivers checked the loads, argued over water rations, counted the mile markers, and watched the horizon for weather; entry ${i + 1} of the trade diary records prices, distances, and the small repairs that kept the caravan moving.`,
  ).join(" ");
  return `${opening} ${filler}`;
}

const ECONOMY_CHAPTERS = [
  {
    title: "Setting Out",
    text: padChapter("The caravan leaves the valley at dawn.", "terraced fields"),
    hrefs: ["c1.xhtml"],
  },
  {
    title: "The Pass",
    text: padChapter("Snow closes the mountain pass behind them.", "switchback trails"),
    hrefs: ["c2.xhtml"],
  },
  {
    title: "The Ledger",
    text: padChapter(
      "In the trading post, Ibra discovers the forged ledger that explains the missing grain shipments.",
      "the crowded trading post",
    ),
    hrefs: ["c3.xhtml"],
  },
  {
    title: "Pursuit",
    text: padChapter("Riders follow the caravan across the salt flats.", "the salt flats"),
    hrefs: ["c4.xhtml"],
  },
  {
    title: "Night Halt",
    text: padChapter(
      "Around the fire, Ibra reflects on family: her brother's debt bound them tighter than any contract, and kinship outweighs profit.",
      "the night encampment",
    ),
    hrefs: ["c5.xhtml"],
  },
  {
    title: "Arrival",
    text: padChapter("The caravan reaches the coast at last.", "the harbor causeway"),
    hrefs: ["c6.xhtml"],
  },
];

function toolCalls(observation: AgentEvalObservation, name: string) {
  return observation.tools.filter((tool) => tool.name === name);
}

function pluginTool(): AgentTool {
  return {
    name: PLUGIN_TOOL,
    label: "Recommend passage",
    description: "Return the plugin's recommended passage for the reader.",
    parameters: Type.Object({}),
    execute: async () => textResult({ passage: "The opening paragraph" }),
  };
}

function configureGlobalPlugin({ deps }: Parameters<NonNullable<AgentEvalScenario["setup"]>>[0]) {
  const tool = pluginTool();
  deps.extraTools = (scope) => (scope.kind === "global" ? [tool] : []);
}

function modelToolAssessment(
  observation: AgentEvalObservation,
  toolName: string,
  expected: "present" | "absent",
): EvalAssessment {
  const exposed = observation.modelRequests.some((request) => {
    const tools = request.context.tools;
    return (
      Array.isArray(tools) &&
      tools.some(
        (tool) =>
          tool &&
          typeof tool === "object" &&
          !Array.isArray(tool) &&
          tool.name === toolName,
      )
    );
  });
  const passed = expected === "present" ? exposed : !exposed;
  return assessmentFromChecks([
    {
      id: `tools.exposure.${toolName}`,
      category: "policy",
      passed,
      message: passed
        ? `${toolName} exposure matched ${expected}`
        : `${toolName} should have been ${expected} in model context`,
      expected,
      actual: exposed ? "present" : "absent",
    },
  ]);
}

export const toolsEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "tools",
  description: "Tool planning, host presentation behavior, and plugin scope exposure.",
  scenarios: [
    defineAgentEvalScenario({
      id: "shelf-query-presents-cards",
      description: "Fetches the real shelf and presents returned books through host-owned cards.",
      tags: ["tools", "shelf", "presentation", "global"],
      scope: { kind: "global", threadId: "tools-shelf" },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [
          { id: TOOL_BOOK_ID, title: "Visible Book", author: "A. Writer", status: "reading" },
        ],
      },
      turns: [{ text: "Show me every book currently on my shelf." }],
      expectation: {
        tools: {
          required: ["list_books", "present_books"],
          noErrors: true,
          maxCalls: 2,
        },
        interactions: { forbiddenKinds: ["question", "permission"] },
      },
    }),
    defineAgentEvalScenario({
      id: "humane-reading-stats",
      description: "Reports reading time in human units from the stats tool, never raw counters.",
      tags: ["tools", "stats", "quality", "global"],
      scope: { kind: "global", threadId: "tools-stats" },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [
          {
            id: TOOL_BOOK_ID,
            title: "Visible Book",
            author: "A. Writer",
            status: "reading",
            progressPercent: 18,
          },
        ],
        bookStats: [
          {
            bookId: TOOL_BOOK_ID,
            progressPercent: 18,
            status: "reading",
            totalMs: 5_427_000,
            firstReadAt: "2026-07-01T08:00:00Z",
            lastReadAt: "2026-08-09T21:30:00Z",
            daily: { "2026-08-09": 2_520_000, "2026-07-01": 2_907_000 },
          },
        ],
      },
      turns: [{ text: "How long have I spent reading Visible Book so far?" }],
      expectation: { tools: { required: ["get_reading_stats"], noErrors: true } },
      rubric: [
        "States the total reading time in natural human units the reader can immediately grasp (e.g. about an hour and a half)",
        "Does not surface raw counters, milliseconds, or field names from the tool payload",
      ],
      criteria: { noRawCounters: "answer contains no 5+ digit numeric run" },
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["get_reading_stats"], noErrors: true },
          }),
          assessmentFromChecks([
            {
              id: "answer.no-raw-counters",
              category: "quality",
              passed: !/\d{5,}/.test(observation.answer),
              message: /\d{5,}/.test(observation.answer)
                ? "answer leaked a raw counter (5+ digit run)"
                : "answer stayed in human units",
            },
          ]),
        ),
    }),
    defineAgentEvalScenario({
      id: "multi-query-search-batching",
      description: "Searches with several query variants in one call instead of retrying one by one.",
      tags: ["tools", "trajectory", "economy", "book"],
      scope: { kind: "book", bookId: ECONOMY_BOOK_ID },
      seed: {
        books: [
          { id: ECONOMY_BOOK_ID, title: "The Salt Road", author: "T. Merch", status: "reading" },
        ],
        chapters: { [ECONOMY_BOOK_ID]: ECONOMY_CHAPTERS },
      },
      turns: [
        { text: "Does this book ever talk about family or kinship? Point me to where." },
      ],
      expectation: {
        tools: { required: ["search_book_text"], noErrors: true, maxCalls: 3 },
      },
      criteria: { firstSearchMustCarry: ">=2 query variants" },
      evaluate: (observation) => {
        const searches = toolCalls(observation, "search_book_text");
        const first = searches[0]?.args;
        const queries =
          first && typeof first === "object" && !Array.isArray(first)
            ? (first as { queries?: unknown }).queries
            : undefined;
        const batched = Array.isArray(queries) && queries.length >= 2;
        return combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["kinship"] },
            tools: { required: ["search_book_text"], noErrors: true, maxCalls: 3 },
          }),
          assessmentFromChecks([
            {
              id: "tools.search-batched-variants",
              category: "tool",
              passed: batched,
              message: batched
                ? "first search carried multiple query variants"
                : "search was issued with a single query instead of batched variants",
              actual: Array.isArray(queries) ? queries.length : 0,
            },
          ]),
        );
      },
    }),
    defineAgentEvalScenario({
      id: "toc-chapter-economy",
      description: "Answers a chapter recap via TOC + one targeted read, not a book scan.",
      tags: ["tools", "trajectory", "economy", "book"],
      scope: { kind: "book", bookId: ECONOMY_BOOK_ID },
      seed: {
        books: [
          {
            id: ECONOMY_BOOK_ID,
            title: "The Salt Road",
            author: "T. Merch",
            status: "reading",
            progressPercent: 75,
          },
        ],
        chapters: { [ECONOMY_BOOK_ID]: ECONOMY_CHAPTERS },
      },
      turns: [
        {
          // 真实产品形态：书线程消息几乎总带游标。读者在第 5 章，
          // 第 3 章是已读回顾——没有任何位置或剧透焦虑需要工具去解。
          text: "What happens in chapter 3?",
          readingCursor: {
            chapter: "c5.xhtml",
            chapterTitle: "Night Halt",
            bookProgress: 0.75,
            chapterProgress: 0.3,
            visibleText:
              "Around the fire, Ibra reflects on family: her brother's debt bound them tighter than any contract.",
          },
        },
      ],
      expectation: {
        answer: { mustContain: ["ledger"] },
        tools: { required: ["read_chapter"], noErrors: true, maxCalls: 3 },
        maxRounds: 3,
      },
      criteria: { readChapterMustTarget: "chapterIndex 2 only" },
      evaluate: (observation) => {
        const reads = toolCalls(observation, "read_chapter");
        const targeted =
          reads.length >= 1 &&
          reads.every((call) => {
            const args = call.args;
            return (
              !!args &&
              typeof args === "object" &&
              !Array.isArray(args) &&
              (args as { chapterIndex?: unknown }).chapterIndex === 2
            );
          });
        return combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["ledger"] },
            tools: { required: ["read_chapter"], noErrors: true, maxCalls: 3 },
            maxRounds: 3,
          }),
          assessmentFromChecks([
            {
              id: "tools.read-targeted-chapter",
              category: "tool",
              passed: targeted,
              message: targeted
                ? "read_chapter targeted exactly the asked chapter (index 2)"
                : "read_chapter strayed from the asked chapter or scanned the book",
              actual: reads.map((call) =>
                call.args && typeof call.args === "object" && !Array.isArray(call.args)
                  ? ((call.args as { chapterIndex?: unknown }).chapterIndex as number)
                  : null,
              ),
            },
          ]),
        );
      },
    }),
    defineAgentEvalScenario({
      id: "toc-chapter-position-unknown",
      description:
        "With no cursor and no recorded position, answers the explicit chapter request with a caution — never by probing status tools.",
      tags: ["tools", "trajectory", "position", "book"],
      scope: { kind: "book", bookId: ECONOMY_BOOK_ID },
      seed: {
        books: [
          { id: ECONOMY_BOOK_ID, title: "The Salt Road", author: "T. Merch", status: "reading" },
        ],
        chapters: { [ECONOMY_BOOK_ID]: ECONOMY_CHAPTERS },
      },
      // 位置未知协议：明确的章节请求 → 带剧透提示直接答（问一句也可接受）；
      // 唯一被禁止的解法是钓状态工具——位置真空的钓鱼路径必须保持死亡。
      setup: ({ deps, stores }) => {
        deps.interactions.request = async (request) => {
          stores.interactions.push(request);
          return { text: "I've already finished chapter 3 — go ahead." };
        };
      },
      turns: [{ text: "What happens in chapter 3?" }],
      expectation: {
        answer: { mustContain: ["ledger"] },
        tools: {
          required: ["read_chapter"],
          forbidden: ["get_book_overview", "get_reading_stats"],
          noErrors: true,
        },
      },
      rubric: [
        "Either opens with a one-line caution that the recap spoils chapter 3 for a reader who has not reached it, or asks the reader's position first — silently recapping with no caution at all fails",
      ],
    }),
    defineAgentEvalScenario({
      id: "missing-book-no-false-success",
      description: "Refuses to fabricate success when the named book is not on the shelf.",
      tags: ["tools", "honesty", "error-recovery", "global"],
      scope: { kind: "global", threadId: "tools-missing-book" },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [
          { id: TOOL_BOOK_ID, title: "Visible Book", author: "A. Writer", status: "reading" },
        ],
      },
      turns: [{ text: "Mark 'Ghost Volume' as finished." }],
      // fixture 默认替用户选第一个选项——在这里等于替用户同意"改标另一本"。
      // 明确成拒绝：追问可以，但拒绝后不许有任何写入。
      setup: ({ deps, stores }) => {
        deps.interactions.request = async (request) => {
          stores.interactions.push(request);
          return { text: "No — never mind. Don't change anything." };
        };
      },
      expectation: {
        tools: { required: ["list_books"], forbidden: ["update_book"] },
      },
      rubric: [
        "Clearly tells the reader that 'Ghost Volume' is not on their shelf and does not claim the change was made",
      ],
    }),
    defineAgentEvalScenario({
      id: "present-restraint-recommendation",
      description: "Recommends with a few cards, once — not the whole shelf re-listed in prose.",
      tags: ["tools", "presentation", "restraint", "global"],
      scope: { kind: "global", threadId: "tools-recommend" },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [
          { id: "rec-1" as Id, title: "Evening Tides", author: "L. Shore", status: "reading" },
          { id: "rec-2" as Id, title: "The Glass Orchard", author: "P. Vine", status: "reading" },
          { id: "rec-3" as Id, title: "Winter Ledger", author: "T. Merch", status: "finished" },
          { id: "rec-4" as Id, title: "Salt & Starlight", author: "L. Shore", status: "reading" },
          { id: "rec-5" as Id, title: "Quiet Engines", author: "R. Hale", status: "reading" },
          { id: "rec-6" as Id, title: "The Last Ferry", author: "M. Crossing", status: "finished" },
        ],
      },
      turns: [{ text: "Recommend one book from my shelf for a cozy evening read." }],
      expectation: {
        tools: { required: ["list_books", "present_books"], noErrors: true },
        interactions: { forbiddenKinds: ["permission"] },
      },
      criteria: { presentOnce: true, presentedAtMost: 3 },
      rubric: [
        "Gives one clear recommendation with a short reason, instead of re-listing the shelf in prose",
      ],
      evaluate: (observation) => {
        const presents = toolCalls(observation, "present_books");
        const presentedIds = presents.flatMap((call) => {
          const args = call.args;
          const ids =
            args && typeof args === "object" && !Array.isArray(args)
              ? (args as { bookIds?: unknown }).bookIds
              : undefined;
          return Array.isArray(ids) ? (ids as string[]) : [];
        });
        const restrained = presents.length === 1 && presentedIds.length <= 3;
        return combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["list_books", "present_books"], noErrors: true },
            interactions: { forbiddenKinds: ["permission"] },
          }),
          assessmentFromChecks([
            {
              id: "tools.present-restrained",
              category: "tool",
              passed: restrained,
              message: restrained
                ? "one present_books call with at most 3 cards"
                : `presentation was not restrained (${presents.length} calls, ${presentedIds.length} cards)`,
              actual: { calls: presents.length, cards: presentedIds.length },
            },
          ]),
        );
      },
    }),
    defineAgentEvalScenario({
      id: "global-plugin-tool",
      description: "Exposes and executes a plugin tool registered for global scope.",
      tags: ["tools", "plugin", "scope", "global"],
      scope: { kind: "global", threadId: "tools-plugin-global" },
      seed: { profile: "The reader has already completed onboarding." },
      setup: configureGlobalPlugin,
      turns: [
        {
          text: "Use the plugin's passage recommendation tool and tell me which passage it returns.",
        },
      ],
      expectation: {
        answer: { mustContain: ["opening paragraph"] },
        tools: { required: [PLUGIN_TOOL], noErrors: true },
      },
      criteria: { pluginTool: PLUGIN_TOOL, exposedIn: "global" },
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["opening paragraph"] },
            tools: { required: [PLUGIN_TOOL], noErrors: true },
          }),
          modelToolAssessment(observation, PLUGIN_TOOL, "present"),
        ),
    }),
    defineAgentEvalScenario({
      id: "book-hides-global-plugin-tool",
      description: "Does not expose a global-only plugin tool to the in-book agent.",
      tags: ["tools", "plugin", "scope", "book", "security"],
      scope: { kind: "book", bookId: TOOL_BOOK_ID },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [{ id: TOOL_BOOK_ID, title: "Visible Book", status: "reading" }],
      },
      setup: configureGlobalPlugin,
      turns: [
        {
          text: "Use plugin_recommend_passage if that tool is available here; otherwise say it is unavailable.",
        },
      ],
      expectation: { tools: { forbidden: [PLUGIN_TOOL] } },
      criteria: { pluginTool: PLUGIN_TOOL, exposedIn: "global-only" },
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, { tools: { forbidden: [PLUGIN_TOOL] } }),
          modelToolAssessment(observation, PLUGIN_TOOL, "absent"),
        ),
    }),
  ],
};
