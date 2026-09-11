import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, type ReadingAiAction } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";

const TOOLS: Record<ReadingAiAction, { name: string; label: string; intent: string }> = {
  explainSelection: { name: "explain_selection", label: "Explain selection", intent: "Explain the currently selected passage in context" },
  defineTerm: { name: "define_term", label: "Define term", intent: "Define the currently selected word or phrase in context" },
  translate: { name: "translate_selection", label: "Translate selection", intent: "Translate the current selection into the reader's interface language" },
  summarizeChapter: { name: "summarize_chapter", label: "Summarize chapter", intent: "Summarize the current extracted chapter, not merely the visible page" },
};

export function buildReadingAiTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  return deps.readingAiActions.enabled().map(action => ({
    name: TOOLS[action].name, label: TOOLS[action].label,
    description: `${TOOLS[action].intent}. Use only on the user's request. Targets the live reader, never invented text or a different book. In a book thread, context is returned: answer here using the supplied task and passage; for a chapter, read that chapter with the existing tools, respecting spoiler boundaries. Never call this tool recursively to carry out the returned task. In a global thread, starts the action in the active book chat; started is not a completed model answer. Feature and privacy gates are rechecked, stale selections reject.`,
    parameters: Type.Object({}, { additionalProperties: false }), executionMode: "sequential",
    execute: async (_id, input, signal) => {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new AppError("reader/invalid-target", "Reading actions accept no caller text or target override");
      signal?.throwIfAborted();
      if (!deps.readingAiActions.enabled().includes(action)) throw new AppError("ui/unavailable", "Reading AI action is disabled");
      return textResult(await deps.readingAiActions.run(action, scope.kind === "book" ? scope.bookId : undefined, signal));
    },
  }));
}
