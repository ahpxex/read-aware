import { AppError, normalizeConversationTarget, type ConversationInsightsSnapshot, type ConversationTarget } from "@read-aware/core";
import { afterLocalKVWrites, flushLocalKV, localKV } from "../../../platform/local-store";
import { invoke } from "../../../platform/ipc";
import { emitAppEvent } from "../../../platform/app-events";
import { GLOBAL_CONVERSATION_ID } from "./conversation-store";

const INSIGHTS_KEY = "read-aware-agent-insights";

/** Settle owner operations before capturing a source clock, not after reading it. */
export async function prepareConversationInsightsSnapshot(): Promise<void> {
  await afterLocalKVWrites(() => flushLocalKV(INSIGHTS_KEY));
}

/** Host-only durable source; no optimistic mirror or arbitrary KV key over IPC. */
export async function loadConversationInsightsSnapshot(input: ConversationTarget): Promise<ConversationInsightsSnapshot> {
  return invoke("conversation_insights_snapshot", { target: normalizeConversationTarget(input) });
}

function readInsights(): Record<string, string> {
  const raw = localKV.getItem(INSIGHTS_KEY);
  if (raw === null) return {};
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (cause) { throw new AppError("db/error", "Invalid stored conversation insights JSON", { cause }); }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.values(value).some(summary => typeof summary !== "string")) {
    throw new AppError("db/error", "Invalid stored conversation insights");
  }
  return value as Record<string, string>;
}

/** Agent and plugin queries read the same stored summary, never synthesize one. */
export function getStoredConversationInsights(threadKey: string): string | undefined {
  const insights = readInsights();
  if (Object.hasOwn(insights, threadKey)) return insights[threadKey];
  // The pre-multithread global summary belongs only to the original global thread.
  if (threadKey === `global:${GLOBAL_CONVERSATION_ID}` && Object.hasOwn(insights, "global")) return insights.global;
  return undefined;
}

export function putStoredConversationInsights(threadKey: string, summary: string): Promise<void> {
  return afterLocalKVWrites(async () => {
    const insights = readInsights();
    insights[threadKey] = summary;
    await localKV.setItemAsync(INSIGHTS_KEY, JSON.stringify(insights));
    emitAppEvent("conversations-changed", {});
  });
}

export function clearStoredConversationInsights(threadKey: string): Promise<void> {
  return afterLocalKVWrites(async () => {
    const insights = readInsights();
    const keys = threadKey === `global:${GLOBAL_CONVERSATION_ID}` ? [threadKey, "global"] : [threadKey];
    if (!keys.some(key => Object.hasOwn(insights, key))) return;
    for (const key of keys) delete insights[key];
    await localKV.setItemAsync(INSIGHTS_KEY, JSON.stringify(insights));
    emitAppEvent("conversations-changed", {});
  });
}
