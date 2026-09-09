/** RuntimeDeps 装配：全部端口都接产品存储。 */
import type { RuntimeDeps } from "@read-aware/agent";
import { createLogger } from "../../../../platform/logger";
import { hostEnvironment } from "../../../../platform/host-environment";
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
import { createReaderPort } from "./reader-port";
import { createSettingsPort } from "./settings-port";
import { createUserInteractionPort } from "./user-interaction-port";
import { memoryPolicy } from "../memory-policy";
import { readingContextPolicy } from "../reading-context-policy";
import { inspectMemory, mutateMemory } from "../../../../domain/memory-management";

export { GLOBAL_CONVERSATION_ID } from "./conversation-port";

export function buildRuntimeDeps(): RuntimeDeps {
  return {
    memoryManagement: { inspect: inspectMemory, mutate: (input, signal) => mutateMemory(input, "agent", signal) },
    hostCommands: trustedHostCommands("agent"),
    environment: { snapshot: async () => hostEnvironment.snapshot() },
    workspace: { snapshot: async query => workspace.snapshot(query), navigate: (target, revision, signal) => workspace.navigate(target, revision, signal, true) },
    memoryPolicy,
    readingContextPolicy,
    library: createLibraryPort(),
    annotations: createAnnotationsPort(),
    reader: createReaderPort(),
    interactions: createUserInteractionPort(),
    conversations: createConversationPort(),
    profile: createProfilePort(),
    memory: createMemoryPort(),
    bookText: createBookTextPort(),
    bookMemory: createBookMemoryPort(),
    settings: createSettingsPort(),
    log: createLogger("agent"),
    extraTools: getPluginAgentTools,
    extraContext: getPluginAgentContext,
    extraMemoryCandidates: getPluginMemoryCandidates,
  };
}
