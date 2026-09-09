import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { HOST_COMMAND_IDS, normalizeHostCommandRequest } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";

export function buildHostCommandTools(deps: RuntimeDeps): AgentTool[] {
  return [{
    name: "list_host_commands", label: "Host commands",
    description: "Discover native navigation and shelf commands, parameter schemas, current availability and permitted checked values. open-book requires args.bookId, open-collection requires args.collectionId; obtain real IDs from library queries, not menu labels. Other commands are parameterless. Not arbitrary menu IDs, plugin commands or file import. workspaceRevision can guard execution.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async (_id, _input, signal) => {
      signal?.throwIfAborted(); const snapshot = await deps.hostCommands.list(signal);
      signal?.throwIfAborted(); return textResult(snapshot);
    },
  }, {
    name: "execute_host_command", label: "Run host command",
    description: "Execute a discovered native command in response to the user's intent. open-book requires args:{bookId}; open-collection requires args:{collectionId}; omit args for every other ID. Shelf layout/sort/group save the setting then show the shelf while preserving collection/selection (up to 1000 IDs). A partial receipt means settings persisted but navigation failed, not rollback. open-book waits for real reader completion but does not dismiss unrelated overlays; collections wait for workspace component commit. No import, arbitrary callbacks or plugin-command dispatch.",
    parameters: Type.Object({ id: Type.Union(HOST_COMMAND_IDS.map(id => Type.Literal(id))),
      args: Type.Optional(Type.Object({ bookId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
        collectionId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })) }, { additionalProperties: false })),
      expectedWorkspaceRevision: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_id, input, signal) => {
      signal?.throwIfAborted(); const request = normalizeHostCommandRequest(input);
      const result = await deps.hostCommands.execute(request, signal);
      // Preserve a settled/partial receipt even when cancellation followed a write.
      return textResult(result);
    },
  }];
}
