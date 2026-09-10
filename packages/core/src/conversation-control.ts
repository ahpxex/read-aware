import { AppError } from "./errors";

export type ConversationTarget = { kind: "book" | "global"; id: string };
export type ConversationSessionState = ConversationTarget & { sessionId: string; loading: boolean; streaming: boolean; messageCount: number };
export type ConversationRuntimeSnapshot = { revision: number; selectedGlobalThreadId: string; sessions: ConversationSessionState[] };
export type ConversationControlReceipt = { status: "completed"; target: ConversationTarget };
export type ConversationTurnRequest = { target: ConversationTarget } & (
  { action: "draft" | "send"; text: string } | { action: "retry" }
);
export type ConversationTurnRequestStatus = "pending" | "adopted" | "started" | "dismissed" | "cancelled" | "stale" | "failed" | "expired";
export type ConversationTurnRequestSnapshot = {
  id: string; target: ConversationTarget; action: ConversationTurnRequest["action"];
  status: ConversationTurnRequestStatus; createdAt: number;
};
export function normalizeConversationTurnRequest(value: ConversationTurnRequest): ConversationTurnRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !["target", "action", "text"].includes(key))
    || !["draft", "send", "retry"].includes(value.action)) throw new AppError("ui/invalid-target", "Invalid conversation turn request");
  const target = normalizeConversationTarget(value.target);
  if (value.action === "retry") {
    if ("text" in value) throw new AppError("ui/invalid-target", "Retry preserves the existing user message");
    return { target, action: "retry" };
  }
  if (typeof value.text !== "string" || !value.text.trim() || value.text.length > 65_536) throw new AppError("ui/invalid-target", "Conversation text must contain 1-65536 characters");
  return { target, action: value.action, text: value.text };
}
export function normalizeConversationTarget(value: ConversationTarget): ConversationTarget {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => key !== "kind" && key !== "id")
    || !["book", "global"].includes(value.kind) || typeof value.id !== "string" || !value.id.trim() || value.id.length > 256) {
    throw new AppError("ui/invalid-target", "Invalid conversation target");
  }
  const global = value.id === "__global__" || value.id.startsWith("thread-");
  if ((value.kind === "global") !== global) throw new AppError("ui/invalid-target", "Conversation kind and identity do not match");
  return { kind: value.kind, id: value.id };
}
