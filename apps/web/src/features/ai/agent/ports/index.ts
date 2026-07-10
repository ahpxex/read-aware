/** RuntimeDeps 装配：全部端口都接产品存储。 */
import type { RuntimeDeps } from "@read-aware/agent";
import { createAnnotationsPort } from "./annotations-port";
import { createBookTextPort } from "./book-text-port";
import { createConversationPort } from "./conversation-port";
import { createDictionaryPort } from "./dictionary-port";
import { createLibraryPort } from "./library-port";
import { createMemoryPort } from "./memory-port";
import { createProfilePort } from "./profile-port";
import { createVocabularyPort } from "./vocabulary-port";

export { GLOBAL_CONVERSATION_ID } from "./conversation-port";

export function buildRuntimeDeps(): RuntimeDeps {
  return {
    library: createLibraryPort(),
    annotations: createAnnotationsPort(),
    conversations: createConversationPort(),
    profile: createProfilePort(),
    memory: createMemoryPort(),
    bookText: createBookTextPort(),
    vocabulary: createVocabularyPort(),
    dictionary: createDictionaryPort(),
  };
}
