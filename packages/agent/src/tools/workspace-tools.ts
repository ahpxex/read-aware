import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { normalizeWorkspaceQuery, type WorkspaceQuery, type WorkspaceSnapshot, type WorkspaceTarget } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";

/** Preserve a usable continuation even when adversarial identifiers expand in JSON. */
export function workspaceToolSnapshot(snapshot: WorkspaceSnapshot) {
  const result = { ...structuredClone(snapshot), search: { ...snapshot.search,
    query: snapshot.search.query.slice(0, 256), queryTruncated: snapshot.search.query.length > 256 } };
  while (JSON.stringify(result).length > 14_000 && result.selection.bookIds.length > 1) {
    result.selection.bookIds.pop();
    result.selection.nextCursor = result.selection.bookIds[result.selection.bookIds.length - 1];
  }
  return result;
}

export function buildWorkspaceTools(deps: RuntimeDeps): AgentTool[] {
  return [{
    name: "get_workspace", label: "Workspace",
    description: "Read the actual app surface, open settings section, command-palette search, and paged shelf selection. No reading text, settings values or credentials. Query text is a 256-character preview; selection may be shortened to fit the response budget. Continue with nextCursor and compare revisions; restart pagination if revision changed.",
    parameters: Type.Object({ selectionAfter: Type.Optional(Type.String({ maxLength: 256 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 25 })) }, { additionalProperties: false }),
    execute: async (_id, input, signal) => {
      signal?.throwIfAborted();
      const query = normalizeWorkspaceQuery(input as WorkspaceQuery);
      const state = await deps.workspace.snapshot({ ...query, limit: Math.min(query.limit, 25) });
      signal?.throwIfAborted(); return textResult(workspaceToolSnapshot(state));
    },
  }, {
    name: "navigate_app", label: "Navigate app",
    description: "Open the shelf root or a collection, Context (agent), statistics, a settings section, or command search. Shelf navigation replaces selection (omission clears it); selected IDs must all exist in that collection, not hidden books. Settings/search keep the reader open; other targets close it through the normal handoff. Requires the user's navigation intent. Completion means the destination committed, not background data/time persistence or executing a search result. Optional expectedRevision rejects a stale workspace. Search is the command palette, not full-book text search. Core settings sections: general, appearance, reading, ai, plugins, menus, shortcuts, dataSync, about; enabled plugin sections: plugin:<id>.",
    parameters: Type.Object({
      target: Type.Union([
        Type.Object({ surface: Type.Literal("shelf"), collectionId: Type.Optional(Type.Union([Type.String({ maxLength: 256 }), Type.Null()])),
          selection: Type.Optional(Type.Object({ active: Type.Boolean(), bookIds: Type.Array(Type.String({ maxLength: 256 }), { maxItems: 1000 }) })) }, { additionalProperties: false }),
        Type.Object({ surface: Type.Union([Type.Literal("agent"), Type.Literal("stats")]) }, { additionalProperties: false }),
        Type.Object({ surface: Type.Literal("settings"), section: Type.Optional(Type.String({ maxLength: 263 })) }, { additionalProperties: false }),
        Type.Object({ surface: Type.Literal("search"), query: Type.Optional(Type.String({ maxLength: 4096 })) }, { additionalProperties: false }),
      ]), expectedRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    }, { additionalProperties: false }),
    execute: async (_id, input, signal) => {
      signal?.throwIfAborted();
      const params = input as { target: WorkspaceTarget; expectedRevision?: number };
      const receipt = await deps.workspace.navigate(params.target, params.expectedRevision, signal);
      signal?.throwIfAborted(); return textResult({ ...receipt, snapshot: workspaceToolSnapshot(receipt.snapshot) });
    },
  }];
}
