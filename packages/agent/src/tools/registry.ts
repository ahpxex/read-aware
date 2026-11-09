import { buildDurableJobTools } from "./durable-job-tools";
import { buildChangeTools } from "./change-tools";
import { buildTransactionTools } from "./transaction-tools";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { buildAnnotationTools } from "./annotation-tools";
import { buildBookmarkTools } from "./bookmark-tools";
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
import { buildOperationAvailabilityTools } from "./operation-availability-tools";
import { buildCapabilityTool } from "./capability-tools";
import { buildWindowTools } from "./window-tools";
import { buildImageViewerTools } from "./image-viewer-tools";
import { buildBookImageTools } from "./book-image-tools";
import { buildWorkspaceTools } from "./workspace-tools";
import { buildHostCommandTools } from "./host-command-tools";
import { buildHostIOTools } from "./host-io-tools";
import { buildPluginServiceTools } from "./plugin-service-tools";
import { buildSyncTools } from "./sync-tools";
import { buildMaintenanceTools } from "./maintenance-tools";
import { buildResourceTools } from "./resource-tools";
import { buildDownloadTools } from "./download-tools";
import { buildWebTools } from "./web-tools";
import { buildEnrichmentTools } from "./enrichment-tools";
import { buildBookContentTools } from "./book-content-tools";
import { buildBookMergeTools } from "./book-merge-tools";
import { buildScheduleTools } from "./schedule-tools";
import { buildShelfTools } from "./shelf-tools";
import { buildReadingAiTools } from "./reading-ai-tools";
import { buildContextBundleTools } from "./context-bundle-tools";
import { buildOnboardingTool } from "./onboarding-tool";
import type { AgentTurnState } from "./turn-state";
import { prepareHostTools } from "./tool-availability";
import { consolidateHostTools } from "./consolidate-tools";

export type { AgentTurnState, SpoilerFence } from "./turn-state";
export { createAgentTurnState } from "./turn-state";

// New host/plugin capabilities remain discoverable without taxing every reading
// request. Changes here require the model-surface budget test, not a count of the
// entire host catalog. Domain permissions still belong to the original tools.
const CORE_TOOLS = new Set([
  "get_host_capabilities",
  "ask_user",
  "list_books",
  "get_book_overview",
  "query_conversation",
  "get_annotations",
  "get_toc",
  "read_chapter",
  "search_book_text",
  "query_book_graph",
  "search_memory",
  "remember",
  "get_user_profile",
  "get_settings",
  "get_setting_options",
  "update_settings",
  "web_search",
  "web_fetch",
  "present_web_images",
  "present_books",
  "open_book",
]);
const MAX_LOADED_TOOLS = 12;

/** One authoritative scope/availability policy; full catalog for host callers,
 * compact projection for the model. Both execute the same guarded tools. */
export function buildAgentTools(
  scope: ThreadScope,
  deps: RuntimeDeps,
  turnState?: AgentTurnState,
  modelFacing = false,
): AgentTool[] {
  const hostTools: AgentTool[] = [
    ...(scope.kind === "global" ? [buildOnboardingTool(scope, deps)] : []),
    ...(scope.kind === "global" ? buildReadingAiTools(scope, deps) : []),
    ...buildEnvironmentTools(deps),
    ...buildOperationAvailabilityTools(deps, scope),
    ...buildWindowTools(deps),
    ...buildImageViewerTools(scope, deps),
    ...buildBookImageTools(scope, deps, turnState),
    ...buildWorkspaceTools(deps),
    ...buildHostCommandTools(deps),
    ...buildHostIOTools(deps),
    ...buildPluginServiceTools(scope, deps, turnState),
    ...buildTransactionTools(scope, deps),
    ...buildDurableJobTools(scope, deps),
    ...buildChangeTools(scope, deps),
    ...buildSyncTools(scope, deps),
    ...buildMaintenanceTools(deps),
    ...buildResourceTools(scope, deps),
    ...buildDownloadTools(scope, deps),
    ...buildWebTools(deps, turnState),
    ...buildEnrichmentTools(scope, deps),
    ...buildBookContentTools(scope, deps),
    ...buildBookMergeTools(scope, deps),
    ...buildScheduleTools(scope, deps),
    ...buildThreadTools(scope, deps),
    ...buildShelfTools(scope, deps),
    ...buildAnnotationTools(scope, deps, turnState),
    ...buildBookmarkTools(scope, deps),
    ...buildMemoryTools(scope, deps),
    ...buildContextBundleTools(scope, deps),
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
  ];
  const extensions = deps.extraTools?.(scope) ?? [];
  const prepared = consolidateHostTools(prepareHostTools(hostTools, scope, deps, turnState).all);
  const loaded = turnState ? (turnState.loadedTools ??= new Set<string>()) : new Set<string>();
  const discover = modelFacing
    ? (names: string[]) => {
        for (const name of names) {
          if (CORE_TOOLS.has(name)) continue;
          loaded.delete(name);
          loaded.add(name);
          while (loaded.size > MAX_LOADED_TOOLS) loaded.delete(loaded.values().next().value!);
        }
        return [...loaded];
      }
    : undefined;
  const catalog = buildCapabilityTool(scope, prepared.enabled, extensions, prepared.all, discover);
  return [...prepared.enabled, catalog, ...extensions].filter(
    (tool) => !modelFacing || CORE_TOOLS.has(tool.name) || loaded.has(tool.name),
  );
}

export function buildModelTools(scope: ThreadScope, deps: RuntimeDeps, state: AgentTurnState): AgentTool[] {
  return buildAgentTools(scope, deps, state, true);
}
