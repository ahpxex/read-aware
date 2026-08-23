/** RuntimeDeps 装配：全部端口都接产品存储。 */
import type { RuntimeDeps } from "@read-aware/agent";
import { createLogger } from "../../../../platform/logger";
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

export { GLOBAL_CONVERSATION_ID } from "./conversation-port";

export function buildRuntimeDeps(): RuntimeDeps {
  return {
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
