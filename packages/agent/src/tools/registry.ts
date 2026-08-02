import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { buildAnnotationTools } from "./annotation-tools";
import { buildBookTextTools } from "./book-text-tools";
import { buildConversationTools } from "./conversation-tools";
import { buildInteractionTools } from "./interaction-tools";
import { buildThreadTools } from "./library-tools";
import { buildMemoryTools } from "./memory-tools";
import { buildPresentTools } from "./present-tools";
import { buildReaderTools } from "./reader-tools";
import { buildSettingsTools } from "./settings-tools";
import { buildShelfTools } from "./shelf-tools";

/** One authoritative scope policy for the tools sent to the model. */
export function buildAgentTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  return [
    ...buildThreadTools(scope, deps),
    ...buildShelfTools(scope, deps),
    ...buildAnnotationTools(scope, deps),
    ...buildMemoryTools(scope, deps),
    ...buildConversationTools(scope, deps),
    ...buildBookTextTools(scope, deps),
    ...(scope.kind === "global" ? buildPresentTools(deps) : []),
    ...buildReaderTools(scope, deps),
    ...buildInteractionTools(scope, deps),
    ...buildSettingsTools(deps),
    ...(deps.extraTools?.(scope) ?? []),
  ];
}
