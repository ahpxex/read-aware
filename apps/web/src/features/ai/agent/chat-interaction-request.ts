import type { UserInteractionRequest } from "@read-aware/agent";
import type { ChatInteractionPart } from "../lib/chat-types";

/** Explicit boundary between runtime requests and persisted chat presentation. */
export function toChatInteractionRequest(request: UserInteractionRequest): ChatInteractionPart["request"] {
  const identity = { id: request.id, threadKey: request.threadKey };
  return request.kind === "question"
    ? { ...identity, kind: "question", question: request.question, allowCustom: request.allowCustom,
      options: request.options.map(option => ({ id: option.id, label: option.label, description: option.description })) }
    : { ...identity, kind: "permission", action: request.action, subject: request.subject,
      ...(request.maxChapters === undefined ? {} : { maxChapters: request.maxChapters }) };
}
