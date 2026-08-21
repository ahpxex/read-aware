import type { Id } from "@read-aware/core";
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../../agent-harness";
import { seedMemory } from "../../../testing/fixtures";
import type { AgentEvalObservation, EvalAssessment, EvalSuite, JsonObject } from "../../types";

const MEMORY_BOOK_ID = "eval-memory-book" as Id;
const OTHER_BOOK_ID = "eval-memory-other-book" as Id;

function savedMemoryAssessment(
  observation: AgentEvalObservation,
  expectedScope: string,
  contentFragment: string,
): EvalAssessment {
  const state =
    observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
      ? (observation.state as JsonObject)
      : {};
  const memories = Array.isArray(state.saved) ? state.saved : [];
  const matched = memories.some(
    (memory) =>
      memory &&
      typeof memory === "object" &&
      !Array.isArray(memory) &&
      memory.scope === expectedScope &&
      typeof memory.content === "string" &&
      memory.content.toLocaleLowerCase().includes(contentFragment.toLocaleLowerCase()),
  );
  return assessmentFromChecks([
    {
      id: "state.memory-saved",
      category: "state",
      passed: matched,
      message: matched
        ? `durable memory was saved in ${expectedScope}`
        : `no matching durable memory was saved in ${expectedScope}`,
      expected: { scope: expectedScope, contentContains: contentFragment },
      actual: memories,
    },
  ]);
}

const observeSaved = ({ stores }: Parameters<NonNullable<AgentEvalScenario["observeState"]>>[0]) => ({
  saved: stores.savedMemoryInputs,
});

export const memoryEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "memory",
  code: "S10",
  description: "显式持久写入、书籍作用域限定及基于文本的长期记忆。",
  scenarios: [
    defineAgentEvalScenario({
      id: "remember-user-preference",
      description: "将显式的持久读者偏好写入用户记忆。",
      tags: ["memory", "global"],
      scope: { kind: "global", threadId: "memory-user" },
      seed: { profile: "The reader has already completed onboarding." },
      turns: [{ text: "Please remember that I prefer explanations with diagrams." }],
      expectation: { tools: { required: ["remember"], noErrors: true, maxCalls: 1 } },
      criteria: { savedScope: "user", contentContains: "diagram" },
      observeState: observeSaved,
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["remember"], noErrors: true, maxCalls: 1 },
          }),
          savedMemoryAssessment(observation, "user", "diagram"),
        ),
    }),
    defineAgentEvalScenario({
      id: "remember-book-insight",
      description: "将显式洞察保留在当前书籍的记忆范围。",
      tags: ["memory", "book"],
      scope: { kind: "book", bookId: MEMORY_BOOK_ID },
      seed: {
        books: [{ id: MEMORY_BOOK_ID, title: "Memory and Reading", status: "reading" }],
        profile: "The reader has already completed onboarding.",
      },
      turns: [
        {
          text: "Remember for this book: the recurring window image represents constrained choice.",
        },
      ],
      expectation: { tools: { required: ["remember"], noErrors: true, maxCalls: 1 } },
      criteria: { savedScope: `book:${MEMORY_BOOK_ID}`, contentContains: "window" },
      observeState: observeSaved,
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["remember"], noErrors: true, maxCalls: 1 },
          }),
          savedMemoryAssessment(observation, `book:${MEMORY_BOOK_ID}`, "window"),
        ),
    }),
    defineAgentEvalScenario({
      id: "search-long-term-memory",
      description: "通过记忆检索而非捏造来回答读者已有偏好。",
      tags: ["memory", "retrieval", "global"],
      scope: { kind: "global", threadId: "memory-search" },
      seed: {
        profile: "The reader has already completed onboarding.",
        // 目标记忆压到低重要性、再垫 8 条高重要性噪音：system prompt 只注入
        // 前 8 条,目标必然落在注入窗外——search_memory 因此是唯一取回路径,
        // 场景测的才是检索而不是"照抄开场白"。
        memories: [
          seedMemory({
            id: "memory-typescript",
            scope: "user",
            kind: "preference",
            content: "The reader prefers programming examples in TypeScript.",
            importance: 0.2,
          }),
          ...Array.from({ length: 8 }, (_, index) =>
            seedMemory({
              id: `memory-decoy-${index}`,
              scope: "user",
              kind: "fact",
              content: `The reader mentioned enjoying long walks on day ${index + 1} of their reading streak.`,
              importance: 0.9,
            }),
          ),
        ],
      },
      turns: [
        {
          text: "Search your long-term memory for my programming example-language preference, then tell me what it is.",
        },
      ],
      expectation: {
        answer: { mustContain: ["TypeScript"] },
        tools: { required: ["search_memory"], noErrors: true },
      },
    }),
    defineAgentEvalScenario({
      id: "remember-restraint",
      description: "不将闲聊内容写入长期记忆。",
      tags: ["memory", "control", "book"],
      scope: { kind: "book", bookId: MEMORY_BOOK_ID },
      seed: {
        books: [
          {
            id: MEMORY_BOOK_ID,
            title: "Memory and Reading",
            status: "reading",
            progressPercent: 34,
          },
        ],
        profile: "The reader has already completed onboarding.",
      },
      turns: [
        {
          // 纯闲聊（不含任何隐含问题——"where were we"是个真问题，不属于这个场景）
          text: "Nice weather today — reading on the balcony feels great.",
          readingCursor: {
            chapter: "m-ch2.xhtml",
            chapterTitle: "Working Memory",
            bookProgress: 0.34,
            chapterProgress: 0.6,
            visibleText: "Rehearsal keeps an item alive in the phonological loop.",
          },
        },
      ],
      expectation: {
        tools: { forbidden: ["remember"] },
        interactions: { forbiddenKinds: ["question", "permission"] },
        maxRounds: 2,
      },
      criteria: { memoryMustStayEmpty: true },
      observeState: observeSaved,
      evaluate: (observation) => {
        const saved =
          observation.state &&
          typeof observation.state === "object" &&
          !Array.isArray(observation.state)
            ? ((observation.state as { saved?: unknown[] }).saved ?? [])
            : [];
        return combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { forbidden: ["remember"] },
            interactions: { forbiddenKinds: ["question", "permission"] },
            maxRounds: 2,
          }),
          assessmentFromChecks([
            {
              id: "state.no-memory-pollution",
              category: "state",
              passed: saved.length === 0,
              message:
                saved.length === 0
                  ? "small talk left no memory writes"
                  : "small talk was written into long-term memory",
              actual: saved.length,
            },
          ]),
        );
      },
    }),
    defineAgentEvalScenario({
      id: "note-request-routes-to-annotation",
      description:
        "读者要求“记个笔记”时走 create_annotation（读者可见的笔记），而非 remember（不可见记忆）。",
      tags: ["state", "book"],
      scope: { kind: "book", bookId: MEMORY_BOOK_ID },
      seed: {
        books: [{ id: MEMORY_BOOK_ID, title: "Memory and Reading", status: "reading" }],
        profile: "The reader has already completed onboarding.",
      },
      turns: [
        {
          text: "帮我记条笔记：本章的灯塔意象代表被限制的选择。",
          readingCursor: {
            chapter: "m-ch3.xhtml",
            chapterTitle: "Symbols",
            bookProgress: 0.4,
            chapterProgress: 0.5,
            visibleText: "The lighthouse turns its beam only within the harbor's walls.",
          },
        },
      ],
      expectation: {
        tools: { required: ["create_annotation"], forbidden: ["remember"], noErrors: true },
      },
      criteria: {
        routing:
          "a requested note must land in the book's annotation list (reader-visible); memory is invisible",
      },
      observeState: ({ stores }) => ({ notes: stores.annotations.filter((a) => a.kind === "note") }),
      evaluate: (observation) => {
        const state =
          observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
            ? (observation.state as { notes?: Array<{ body?: string }> })
            : {};
        const notes = Array.isArray(state.notes) ? state.notes : [];
        const captured = notes.some(
          (note) =>
            typeof note.body === "string" &&
            /灯塔|lighthouse/i.test(note.body) &&
            /选择|choice/i.test(note.body),
        );
        return combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["create_annotation"], forbidden: ["remember"], noErrors: true },
          }),
          assessmentFromChecks([
            {
              id: "state.note-in-annotation-list",
              category: "state",
              passed: captured,
              message: captured
                ? "the requested note landed in the book's annotation list"
                : "no note with the requested content was recorded",
              actual: notes.map((note) => note.body ?? ""),
            },
          ]),
        );
      },
    }),
    defineAgentEvalScenario({
      id: "book-scope-memory-isolation",
      description:
        "对照：A 书的记忆不串味到 B 书线程——回答不得复述 A 书的洞察，也不得凭空宣称记得。",
      tags: ["memory", "control", "book"],
      scope: { kind: "book", bookId: OTHER_BOOK_ID },
      seed: {
        books: [
          { id: MEMORY_BOOK_ID, title: "Memory and Reading", status: "finished" },
          { id: OTHER_BOOK_ID, title: "The Second Book", status: "reading" },
        ],
        profile: "The reader has already completed onboarding.",
        memories: [
          seedMemory({
            id: "memory-lighthouse-insight",
            scope: `book:${MEMORY_BOOK_ID}`,
            kind: "insight",
            content: "读者读出：灯塔意象代表被限制的选择（lighthouse = constrained choice）。",
            importance: 0.9,
          }),
        ],
      },
      turns: [
        {
          text: "这本书里也提到灯塔了吗？你之前对我读到的灯塔意象记过什么？",
          readingCursor: {
            chapter: "s-ch1.xhtml",
            chapterTitle: "Arrival",
            bookProgress: 0.1,
            chapterProgress: 0.3,
            visibleText: "The town wakes to fog and the smell of salt.",
          },
        },
      ],
      expectation: {
        // book:B 的可见 scope 不含 book:A——串味只能来自幻觉，不来自检索
        answer: { mustNotContain: ["constrained choice", "受限的选择", "被限制的选择"] },
      },
      criteria: {
        isolation:
          "book-scoped memory is invisible from another book's thread; a leak here is fabrication, not retrieval",
      },
      rubric: [
        "Answers about THIS book's text, and if acknowledging prior lighthouse notes, says they belong to another book — never recites the stored insight as if it were about this one",
      ],
    }),
    defineAgentEvalScenario({
      id: "global-thread-book-memory-search",
      description:
        "全局线程用 search_memory 的 bookId 参数取回指定书的低重要性记忆，而非靠开场白注入。",
      tags: ["memory", "retrieval", "global"],
      scope: { kind: "global", threadId: "memory-global-book-search" },
      seed: {
        books: [{ id: MEMORY_BOOK_ID, title: "Memory and Reading", status: "reading" }],
        profile: "The reader has already completed onboarding.",
        memories: [
          seedMemory({
            id: "memory-book-lighthouse",
            scope: `book:${MEMORY_BOOK_ID}`,
            kind: "insight",
            content: "The reader found the lighthouse keeper's routine a metaphor for attention.",
            importance: 0.2,
          }),
          ...Array.from({ length: 8 }, (_, index) =>
            seedMemory({
              id: `memory-global-decoy-${index}`,
              scope: "user",
              kind: "fact",
              content: `The reader enjoys reading in the evening, day ${index + 1} of their streak.`,
              importance: 0.9,
            }),
          ),
        ],
      },
      turns: [
        {
          text: "关于《Memory and Reading》这本书，你记得我读出过什么洞见吗？先搜一下再回答。",
        },
      ],
      expectation: {
        answer: { mustContain: ["lighthouse"] },
        tools: { required: ["search_memory"], noErrors: true },
      },
    }),
    defineAgentEvalScenario({
      id: "first-session-onboarding-questions",
      description:
        "全局线程首次会话且画像为空：先问 2-4 个短问题了解读者，而不是长篇独白。",
      tags: ["interaction", "memory", "global"],
      scope: { kind: "global", threadId: "memory-onboarding" },
      // 刻意不 seed profile：空画像 + 首条消息 = 系统提示的访谈模式
      seed: {
        books: [{ id: MEMORY_BOOK_ID, title: "Memory and Reading", status: "reading" }],
      },
      turns: [{ text: "我今晚想找点东西读，你帮我参谋参谋。" }],
      expectation: {
        interactions: { requiredKinds: ["question"] },
      },
      criteria: {
        onboarding: "empty profile + first turn → the interview block in the system prompt kicks in",
      },
      rubric: [
        "Asks one short, warm question (reading goals, background, or preferred depth) instead of lecturing",
      ],
    }),
  ],
};
