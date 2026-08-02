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
  description: "Explicit durable writes, book scoping, and grounded long-term recall.",
  scenarios: [
    defineAgentEvalScenario({
      id: "remember-user-preference",
      description: "Writes an explicit durable reader preference to user memory.",
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
      description: "Keeps an explicit insight inside the current book's memory scope.",
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
      description: "Uses memory retrieval rather than inventing a stated reader preference.",
      tags: ["memory", "retrieval", "grounding"],
      scope: { kind: "global", threadId: "memory-search" },
      seed: {
        profile: "The reader has already completed onboarding.",
        memories: [
          seedMemory({
            id: "memory-typescript",
            scope: "user",
            kind: "preference",
            content: "The reader prefers programming examples in TypeScript.",
            importance: 0.9,
          }),
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
  ],
};
