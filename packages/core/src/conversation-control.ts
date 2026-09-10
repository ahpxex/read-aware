import { AppError } from "./errors";

export type ConversationTarget = { kind: "book" | "global"; id: string };
export type ConversationSessionState = ConversationTarget & { sessionId: string; loading: boolean; streaming: boolean; messageCount: number };
export type ConversationRuntimeSnapshot = { revision: number; selectedGlobalThreadId: string; sessions: ConversationSessionState[] };
export type ConversationControlReceipt = { status: "completed"; target: ConversationTarget };
export function normalizeConversationTarget(value: ConversationTarget): ConversationTarget {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => key !== "kind" && key !== "id")
    || !["book", "global"].includes(value.kind) || typeof value.id !== "string" || !value.id.trim() || value.id.length > 256) {
    throw new AppError("ui/invalid-target", "Invalid conversation target");
  }
  const global = value.id === "__global__" || value.id.startsWith("thread-");
  if ((value.kind === "global") !== global) throw new AppError("ui/invalid-target", "Conversation kind and identity do not match");
  return { kind: value.kind, id: value.id };
}
