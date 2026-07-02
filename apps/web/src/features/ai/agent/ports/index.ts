/** RuntimeDeps 装配：六个端口全部接产品存储。 */
import type { RuntimeDeps } from "@read-aware/agent";
import { createAnnotationsPort } from "./annotations-port";
import { createBookTextPort } from "./book-text-port";
import { createConversationPort } from "./conversation-port";
import { createLibraryPort } from "./library-port";
import { createMemoryPort } from "./memory-port";
import { createProfilePort } from "./profile-port";

export { GLOBAL_CONVERSATION_ID } from "./conversation-port";

export function buildRuntimeDeps(): RuntimeDeps {
  return {
    library: createLibraryPort(),
    annotations: createAnnotationsPort(),
    conversations: createConversationPort(),
    profile: createProfilePort(),
    memory: createMemoryPort(),
    bookText: createBookTextPort(),
  };
}
