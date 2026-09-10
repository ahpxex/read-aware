import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, assertReaderFocusTarget } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";

export function buildReaderFocusTool(scope: ThreadScope, deps: RuntimeDeps): AgentTool {
  return {
    name: "focus_reader", label: "Focus reader", executionMode: "sequential",
    description: "Move keyboard focus to the current reader's content surface, TOC list or chat composer for an explicit user request. Targets must already be visible; this does not open panels, reveal controls, dismiss dialogs/menus, navigate, send a message or edit a draft. A visible foreground dialog/menu blocks focus outside it. not-focused means missing/hidden/blocked/rejected, never success; do not retry in a loop or dismiss someone else's surface. Receipt confirms DOM focus at dispatch, not OS window activation, persistent focus, iframe caret, previous exact element, or screen-reader position. Book scope only controls its own current ready reader.",
    parameters: Type.Object({ target: Type.Union([Type.Literal("content"), Type.Literal("toc"), Type.Literal("chat")]) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const input = params as { target: unknown };
      if (!input || typeof input !== "object" || Object.keys(input).some(key => key !== "target")) throw new AppError("reader/invalid-target", "Expected one semantic focus target");
      assertReaderFocusTarget(input.target);
      const target = input.target;
      const current = await deps.reader.getSession();
      if (current.status !== "ready" || !current.bookId || !current.sessionId) throw new AppError("reader/unavailable", "No ready reader to focus");
      if (scope.kind === "book" && current.bookId !== scope.bookId) throw new AppError("reader/superseded", "This book is not the active reader");
      signal?.throwIfAborted();
      return textResult(await deps.reader.focus(target, signal, { sessionId: current.sessionId, bookId: current.bookId }));
    },
  };
}
