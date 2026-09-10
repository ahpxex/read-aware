import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { useToast } from "@read-aware/ui";
import type { ConversationTarget } from "@read-aware/core";
import { conversationRuntime, conversationTurnRequests } from "../../../domain/conversation-control";
import { describeError, useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import type { ChatComposerHandle } from "../components/ChatComposer";
import type { BookConversation } from "./useBookConversation";

const subscribe = (listener: () => void) => conversationRuntime.observe(listener);
const revision = () => conversationRuntime.revision;
const log = createLogger("conversation-turn-requests");

export function useConversationTurnRequests(target: ConversationTarget, conversation: BookConversation,
  composerRef: RefObject<ChatComposerHandle | null>) {
  const { toast } = useToast(), { t } = useTranslation("ai");
  const current = useRef({ conversation, targetId: target.id });
  current.current = { conversation, targetId: target.id };
  useSyncExternalStore(subscribe, revision, revision);
  useEffect(() => conversationTurnRequests.bind(target, {
    state: () => ({ loading: current.current.targetId !== target.id || current.current.conversation.isLoading || conversationRuntime.isControlling(target.id),
      ready: !current.current.conversation.isLoading && !current.current.conversation.isStreaming && conversationRuntime.canStart(target.id),
      generation: current.current.conversation.messages, canRetry: current.current.conversation.messages.some(message => message.role === "user") }),
    draft: text => composerRef.current?.adoptDraft(text) ?? false,
    send: text => current.current.conversation.send(text),
    retry: () => current.current.conversation.retry(),
  }), [target.kind, target.id, composerRef]);

  return {
    request: conversationTurnRequests.pending(target.id),
    accept: (id: string) => {
      try { conversationTurnRequests.accept(id); }
      catch (error) {
        log.warn("Could not accept conversation request", error);
        toast({ variant: "destructive", title: t("chat.turnRequest.failed"), description: describeError(error).body });
      }
    },
    dismiss: (id: string) => conversationTurnRequests.dismiss(id),
  };
}
