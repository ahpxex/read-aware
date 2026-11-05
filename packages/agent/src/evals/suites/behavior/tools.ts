import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Id } from "@read-aware/core";
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../../agent-harness";
import { textResult } from "../../../tools/tool-result";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../../types";
import { obj } from "@earendil-works/pi-schema";

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
    description: "返回插件为读者推荐的段落。",
    parameters: obj({}),
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
      tools.some((tool) => tool && typeof tool === "object" && !Array.isArray(tool) && tool.name === toolName)
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

/** A folder import's books: two source folders, plus one book picked on its own. */
const FOLDER_BOOKS = [
  { id: "folder-1" as Id, title: "The Stranger", sourcePath: "Library/Literature/The Stranger.epub" },
  { id: "folder-2" as Id, title: "The Plague", sourcePath: "Library/Literature/The Plague.epub" },
  { id: "folder-3" as Id, title: "Fortress Besieged", sourcePath: "Library/Literature/Fortress Besieged.txt" },
  {
    id: "folder-4" as Id,
    title: "From Third World to First",
    sourcePath: "Library/History/From Third World to First.epub",
  },
  { id: "folder-5" as Id, title: "The Guns of August", sourcePath: "Library/History/The Guns of August.mobi" },
] as const;
const LOOSE_BOOK_ID = "loose-1" as Id;

/** Each top-level source folder maps to one collection named after it; the loose book stays ungrouped. */
function folderGroupingCheck(observation: AgentEvalObservation): EvalAssessment {
  const state =
    observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
      ? (observation.state as {
          books?: { id: string; collectionId: string | null }[];
          collections?: { id: string; name: string }[];
        })
      : {};
  const books = state.books ?? [];
  const collections = state.collections ?? [];
  const collectionOf = (id: string) => books.find((book) => book.id === id)?.collectionId ?? null;
  const nameOf = (collectionId: string | null) =>
    collections.find((collection) => collection.id === collectionId)?.name ?? "";
  const literature = FOLDER_BOOKS.slice(0, 3).map((book) => collectionOf(book.id));
  const history = FOLDER_BOOKS.slice(3).map((book) => collectionOf(book.id));
  const sameGroup = (group: (string | null)[]) => group[0] !== null && group.every((id) => id === group[0]);
  return assessmentFromChecks([
    {
      id: "state.literature-grouped",
      category: "state",
      passed: sameGroup(literature) && /literature/i.test(nameOf(literature[0] ?? null)),
      message: "Every Literature book shares one collection named after the folder",
      expected: "one Literature collection",
      actual: literature.map(nameOf),
    },
    {
      id: "state.history-grouped",
      category: "state",
      passed: sameGroup(history) && /history/i.test(nameOf(history[0] ?? null)),
      message: "Every History book shares one collection named after the folder",
      expected: "one History collection",
      actual: history.map(nameOf),
    },
    {
      id: "state.folders-distinct",
      category: "state",
      passed: literature[0] !== history[0],
      message: "The two source folders become different collections",
      expected: "distinct collections",
      actual: [literature[0], history[0]],
    },
    {
      id: "state.loose-book-untouched",
      category: "state",
      passed: collectionOf(LOOSE_BOOK_ID) === null,
      message: "A book imported on its own has no source folder and stays ungrouped",
      expected: null,
      actual: collectionOf(LOOSE_BOOK_ID),
    },
  ]);
}

export const toolsEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "tools",
  displayName: "工具调用与展示",
  code: "S17",
  description: "工具规划、宿主展示行为及插件作用域暴露。",
  scenarios: [
    defineAgentEvalScenario({
      id: "shelf-query-presents-cards",
      description: "获取真实书架并通过宿主自有卡片展示返回的书籍。",
      tags: ["presentation", "global"],
      scope: { kind: "global", threadId: "tools-shelf" },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [{ id: TOOL_BOOK_ID, title: "Visible Book", author: "A. Writer", status: "reading" }],
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
      id: "group-shelf-by-source-folder",
      evaluation: "programmatic",
      description: "按文件夹导入记录的 sourcePath 把书分组到以原文件夹命名的集合，单独导入的书不动。",
      tags: ["state", "global"],
      scope: { kind: "global", threadId: "tools-folder-groups" },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [
          ...FOLDER_BOOKS.map((book) => ({ ...book, status: "unread" as const })),
          { id: LOOSE_BOOK_ID, title: "A Single Download", author: "N. Loose", status: "reading" as const },
        ],
      },
      turns: [{ text: "I just imported my book folder. Group those books by the folders they came from." }],
      expectation: {
        tools: { required: ["list_books", "manage_collection"], noErrors: true },
        interactions: { forbiddenKinds: ["question", "permission"] },
      },
      criteria: {
        literature: FOLDER_BOOKS.slice(0, 3).map((book) => book.sourcePath),
        history: FOLDER_BOOKS.slice(3).map((book) => book.sourcePath),
        ungrouped: LOOSE_BOOK_ID,
      },
      observeState: ({ stores }) => ({
        books: stores.books.map((book) => ({ id: book.id, collectionId: book.collectionId ?? null })),
        collections: stores.collections.map((collection) => ({ id: collection.id, name: collection.name })),
      }),
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["list_books", "manage_collection"], noErrors: true },
            interactions: { forbiddenKinds: ["question", "permission"] },
          }),
          folderGroupingCheck(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "humane-reading-stats",
      description: "从 stats 工具以人类可读单位报告阅读时长，不使用原始计数器。",
      tags: ["presentation", "global"],
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
      expectation: { tools: { required: ["query_reading_stats"], noErrors: true } },
      rubric: [
        "States the total reading time in natural human units the reader can immediately grasp (e.g. about an hour and a half)",
        "Does not surface raw counters, milliseconds, or field names from the tool payload",
      ],
      criteria: { noRawCounters: "answer contains no 5+ digit numeric run" },
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["query_reading_stats"], noErrors: true },
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
      description: "一次调用多个查询变体进行搜索，而非逐个重试。",
      tags: ["economy", "retrieval", "book"],
      scope: { kind: "book", bookId: ECONOMY_BOOK_ID },
      seed: {
        books: [{ id: ECONOMY_BOOK_ID, title: "The Salt Road", author: "T. Merch", status: "reading" }],
        chapters: { [ECONOMY_BOOK_ID]: ECONOMY_CHAPTERS },
      },
      turns: [{ text: "Does this book ever talk about family or kinship? Point me to where." }],
      expectation: {
        tools: { required: ["search_book_text"], noErrors: true, maxCalls: 4 },
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
            tools: { required: ["search_book_text"], noErrors: true, maxCalls: 4 },
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
      description: "通过 TOC + 一次定向阅读回答章节摘要，而非扫描全书。",
      tags: ["economy", "retrieval", "book"],
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
              Number((args as { chapterIndex?: unknown }).chapterIndex) === 2
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
      description: "无光标且无记录位置时，以警告回答显式章节请求——绝不探测 status 工具。",
      tags: ["honesty", "toc", "economy", "book"],
      scope: { kind: "book", bookId: ECONOMY_BOOK_ID },
      seed: {
        books: [{ id: ECONOMY_BOOK_ID, title: "The Salt Road", author: "T. Merch", status: "reading" }],
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
          forbidden: ["get_book_overview", "query_reading_stats"],
          noErrors: true,
        },
      },
      rubric: [
        "Either opens with a one-line caution that the recap spoils chapter 3 for a reader who has not reached it, or asks the reader's position first — silently recapping with no caution at all fails",
      ],
    }),
    defineAgentEvalScenario({
      id: "missing-book-no-false-success",
      description: "当指定书名不在书架上时，拒绝捏造成功。",
      tags: ["honesty", "global"],
      scope: { kind: "global", threadId: "tools-missing-book" },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [{ id: TOOL_BOOK_ID, title: "Visible Book", author: "A. Writer", status: "reading" }],
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
      description: "一次推荐若干卡片，而非以散文形式重新列出整个书架。",
      tags: ["presentation", "global"],
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
      rubric: ["Gives one clear recommendation with a short reason, instead of re-listing the shelf in prose"],
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
      description: "暴露并执行注册为全局作用域的插件工具。",
      tags: ["tool-surface", "global"],
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
      description: "不向书内 agent 暴露仅全局可用的插件工具。",
      tags: ["tool-surface", "security", "book"],
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
