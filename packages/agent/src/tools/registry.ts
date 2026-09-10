import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { buildAnnotationTools } from "./annotation-tools";
import { buildBookTextTools } from "./book-text-tools";
import { buildGraphTools } from "./graph-tools";
import { buildBookGraphTaskTool } from "./book-graph-task-tool";
import { buildConversationTools } from "./conversation-tools";
import { buildConversationControlTools } from "./conversation-control-tools";
import { buildInteractionTools } from "./interaction-tools";
import { buildThreadTools } from "./library-tools";
import { buildMemoryTools } from "./memory-tools";
import { buildPresentTools } from "./present-tools";
import { buildReaderTools } from "./reader-tools";
import { buildNavigationTools } from "./navigation-tools";
import { buildReferenceTools } from "./reference-tools";
import { buildSettingsTools } from "./settings-tools";
import { buildEnvironmentTools } from "./environment-tools";
import { buildWorkspaceTools } from "./workspace-tools";
import { buildHostCommandTools } from "./host-command-tools";
import { buildHostIOTools } from "./host-io-tools";
import { buildSyncTools } from "./sync-tools";
import { buildMaintenanceTools } from "./maintenance-tools";
import { buildResourceTools } from "./resource-tools";
import { buildEnrichmentTools } from "./enrichment-tools";
import { buildBookMergeTools } from "./book-merge-tools";
import { buildScheduleTools } from "./schedule-tools";
import { buildShelfTools } from "./shelf-tools";
import type { AgentTurnState } from "./turn-state";

export type { AgentTurnState, SpoilerFence } from "./turn-state";
export { createAgentTurnState } from "./turn-state";

/** One authoritative scope policy for the tools sent to the model. */
export function buildAgentTools(
  scope: ThreadScope,
  deps: RuntimeDeps,
  turnState?: AgentTurnState,
): AgentTool[] {
  return [
    ...buildEnvironmentTools(deps),
    ...buildWorkspaceTools(deps),
    ...buildHostCommandTools(deps),
    ...buildHostIOTools(deps),
    ...buildSyncTools(scope, deps),
    ...buildMaintenanceTools(deps),
    ...buildResourceTools(scope, deps),
    ...buildEnrichmentTools(scope, deps),
    ...buildBookMergeTools(scope, deps),
    ...buildScheduleTools(scope, deps),
    ...buildThreadTools(scope, deps),
    ...buildShelfTools(scope, deps),
    ...buildAnnotationTools(scope, deps),
    ...buildMemoryTools(scope, deps),
    ...buildConversationTools(scope, deps, turnState),
    ...buildConversationControlTools(scope, deps),
    ...buildBookTextTools(scope, deps, turnState),
    ...buildGraphTools(scope, deps, turnState),
    buildBookGraphTaskTool(scope, deps),
    ...(scope.kind === "global" ? buildPresentTools(deps, turnState) : []),
    ...buildReaderTools(scope, deps, turnState),
    ...buildNavigationTools(scope, deps, turnState),
    ...buildReferenceTools(scope, deps, turnState),
    ...buildInteractionTools(scope, deps, turnState),
    ...buildSettingsTools(scope, deps),
    ...(deps.extraTools?.(scope) ?? []),
  ];
}
