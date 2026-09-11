/** RuntimeDeps 装配：全部端口都接产品存储。 */
import type { RuntimeDeps } from "@read-aware/agent";
import { createLogger } from "../../../../platform/logger";
import { hostEnvironment } from "../../../../platform/host-environment";
import { hostWindow } from "../../../../services/window";
import { hostIO } from "../../../../services/host-io";
import { hostSync } from "../../../../services/sync";
import { hostMaintenance } from "../../../../services/maintenance";
import { hostDiagnostics } from "../../../../services/diagnostics";
import { agentResources } from "../../../../services/resources";
import { pluginSchedules } from "../../../plugins/runtime/plugin-scheduler";
import { createConversationsDomain } from "../../../../domain/conversations";
import { workspace } from "../../../../services/workspace";
import { trustedHostCommands } from "../../../../services/host-command-runtime";
import {
  getPluginAgentContext,
  getPluginAgentTools,
  getPluginMemoryCandidates,
} from "../../../plugins/runtime/plugin-tools";
import { createAnnotationsPort } from "./annotations-port";
import { createBookMemoryPort } from "./book-memory-port";
import { createBookTextPort } from "./book-text-port";
import { createConversationPort } from "./conversation-port";
import { createLibraryPort } from "./library-port";
import { createMemoryPort } from "./memory-port";
import { createProfilePort } from "./profile-port";
import { createEntityRegistryPort } from "./entity-registry-port";
import { createContextBundlePort } from "./context-bundle-port";
import { createReaderPort } from "./reader-port";
import { createSettingsPort } from "./settings-port";
import { createUserInteractionPort } from "./user-interaction-port";
import { downloadResource } from "./download-port";
import { memoryPolicy } from "../memory-policy";
import { readingContextPolicy } from "../reading-context-policy";
import { inspectMemory, mutateMemory } from "../../../../domain/memory-management";
import { inspectBookClassification, changeBookClassification } from "../../../../domain/book-classification";
import { agentBookGraphTasks } from "../../../../domain/book-graph-tasks";
import { identityConsolidationPort } from "../../../../domain/identity-consolidation";
import { readingAiActions } from "../../../../services/reading-ai-runtime";

export { GLOBAL_CONVERSATION_ID } from "./conversation-port";

export function buildRuntimeDeps(): RuntimeDeps {
  const conversations = createConversationsDomain("agent");
  const interactions = createUserInteractionPort();
  return {
    readingAiActions,
    schedules: { list: async query => pluginSchedules.list(query), control: (input, signal) => pluginSchedules.control(input, signal) },
    sync: hostSync,
    maintenance: hostMaintenance,
    diagnostics: hostDiagnostics,
    resources: agentResources,
    downloadResource,
    conversationControl: { snapshot: conversations.queries.runtime, listThreads: conversations.queries.listThreads,
      turnRequests: conversations.queries.turnRequests, ...conversations.commands },
    hostIO,
    bookGraphTasks: agentBookGraphTasks,
    bookClassification: { inspect: inspectBookClassification, change: (input, signal) => changeBookClassification(input, "agent", signal) },
    memoryManagement: { inspect: inspectMemory, mutate: (input, signal) => mutateMemory(input, "agent", signal) },
    hostCommands: trustedHostCommands("agent"),
    environment: { snapshot: async () => hostEnvironment.snapshot() },
    window: hostWindow,
    workspace: { snapshot: async query => workspace.snapshot(query), navigate: (target, revision, signal) => workspace.navigate(target, revision, signal, true) },
    memoryPolicy,
    readingContextPolicy,
    library: createLibraryPort(),
    annotations: createAnnotationsPort(),
    reader: createReaderPort(),
    interactions,
    conversations: createConversationPort(),
    profile: createProfilePort(),
    entityRegistry: createEntityRegistryPort(),
    contextBundles: createContextBundlePort(),
    identityConsolidation: identityConsolidationPort,
    memory: createMemoryPort(),
    bookText: createBookTextPort(),
    bookMemory: createBookMemoryPort(),
    settings: createSettingsPort(),
    log: createLogger("agent"),
    extraTools: scope => getPluginAgentTools(scope, interactions),
    extraContext: getPluginAgentContext,
    extraMemoryCandidates: getPluginMemoryCandidates,
  };
}
