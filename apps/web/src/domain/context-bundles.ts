import { AppError, conversationContextBundle, normalizeConversationTarget, profileContextBundle,
  type ContextBundle, type ConversationTarget, type EventOrigin, type ProfileContextSnapshot } from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { broadcastDomainEventDrafts, mintEventRows, type DomainEventDraft } from "../platform/domain-events";
import { createLogger } from "../platform/logger";
import { initializeUserProfile } from "./user-profile";
import { loadConversationInsightsSnapshot, prepareConversationInsightsSnapshot } from "../features/ai/lib/conversation-insights-store";

type Receipt = { version: string; changed: boolean; persistence: "event-log" };
type Host = { invoke: typeof invoke; mint: typeof mintEventRows; broadcast: typeof broadcastDomainEventDrafts;
  insights: { prepare: typeof prepareConversationInsightsSnapshot; read: typeof loadConversationInsightsSnapshot };
  initialize(): Promise<void>; warn(message: string): void };

/** Internal producer. Actor authorization and file export are separate consumers. */
export function createContextBundleService(host: Host) {
  const capture = async (origin: EventOrigin, assemble: () => Promise<ContextBundle>, signal?: AbortSignal, prepare?: () => Promise<void>) => {
    signal?.throwIfAborted();
    await host.initialize();
    signal?.throwIfAborted();
    if (prepare) { await prepare(); signal?.throwIfAborted(); }
    const expectedReadRevision = await host.invoke<string>("context_bundle_source_revision");
    signal?.throwIfAborted();
    const bundle = await assemble();
    signal?.throwIfAborted();
    const draft: DomainEventDraft = { type: "context.bundlePublished", payload: bundle, origin };
    const [event] = await host.mint([draft]);
    signal?.throwIfAborted();
    const receipt = await host.invoke<Receipt>("context_bundle_publish", { event, expectedReadRevision });
    // Native dispatch owns the real result, including cancellation after dispatch.
    if (!receipt || receipt.version !== bundle.version || typeof receipt.changed !== "boolean" || receipt.persistence !== "event-log") {
      throw new AppError("db/error", "Invalid context publication receipt");
    }
    if (receipt.changed) host.broadcast([draft]);
    return { bundle, receipt };
  };
  return {
    async captureProfile(origin: EventOrigin, signal?: AbortSignal): Promise<{ bundle: ContextBundle; receipt: Receipt }> {
      return capture(origin, async () => {
        const snapshot = await host.invoke<ProfileContextSnapshot>("profile_context");
        signal?.throwIfAborted();
        const { bundle, derivedStatus } = await profileContextBundle(snapshot);
        if (derivedStatus === "invalid") host.warn("Invalid consolidated profile omitted from context bundle");
        return bundle;
      }, signal);
    },
    async captureConversation(input: ConversationTarget, origin: EventOrigin, signal?: AbortSignal) {
      const target = normalizeConversationTarget(input);
      return capture(origin, async () => {
        const snapshot = await host.insights.read(target);
        signal?.throwIfAborted();
        return conversationContextBundle(snapshot, target);
      }, signal, host.insights.prepare);
    },
  };
}

export const contextBundles = createContextBundleService({ invoke, mint: mintEventRows, broadcast: broadcastDomainEventDrafts,
  insights: { prepare: prepareConversationInsightsSnapshot, read: loadConversationInsightsSnapshot },
  initialize: initializeUserProfile, warn: message => createLogger("context-bundle").warn(message) });
