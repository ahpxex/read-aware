import type { Id } from "@read-aware/core";
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import { seedMemory } from "../../testing/fixtures";
import type { AgentEvalObservation, EvalAssessment, EvalSuite, JsonObject } from "../types";

const MEMORY_BOOK_ID = "eval-memory-book" as Id;

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
      tags: ["memory", "write", "user-scope"],
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
      tags: ["memory", "write", "book-scope"],
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
      tags: ["memory", "retrieval", "grounding"],
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
      tags: ["memory", "restraint"],
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
  ],
};
