import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { HOST_COMMAND_IDS, normalizeHostCommandRequest } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";

export function buildHostCommandTools(deps: RuntimeDeps): AgentTool[] {
  return [{
    name: "list_host_commands", label: "Host commands",
    description: "Discover the finite native navigation and shelf command catalog, current availability and permitted checked values. Not arbitrary menu IDs, plugin commands, book/collection lookup or file import. Re-read availability before using a previously listed command. Commands are parameterless; workspaceRevision can guard execution.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async (_id, _input, signal) => {
      signal?.throwIfAborted(); const snapshot = await deps.hostCommands.list(signal);
      signal?.throwIfAborted(); return textResult(snapshot);
    },
  }, {
    name: "execute_host_command", label: "Run host command",
    description: "Execute a discovered native navigation or shelf command in response to the user's intent. Shelf layout/sort/group commands save that setting then show the shelf while preserving the current collection and selection (up to 1000 IDs). A partial receipt means the setting persisted but navigation failed: do not claim full success or rollback. Completion means the existing settings and workspace contracts completed, not animation or data loading. No import, arbitrary callback, book/collection or plugin-command dispatch.",
    parameters: Type.Object({ id: Type.Union(HOST_COMMAND_IDS.map(id => Type.Literal(id))),
      expectedWorkspaceRevision: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false }),
    execute: async (_id, input, signal) => {
      signal?.throwIfAborted(); const request = normalizeHostCommandRequest(input);
      const result = await deps.hostCommands.execute(request, signal);
      // Preserve a settled/partial receipt even when cancellation followed a write.
      return textResult(result);
    },
  }];
}
