import { AppError, assertContextBundleGrants, contextBundleSelector, normalizeContextBundleHistoryQuery, normalizeContextBundleReadQuery,
  type ContextBundle, type ContextBundleCaptureReceipt, type ContextBundleHistoryPage, type ContextBundleHistoryQuery, type ContextBundleReadQuery,
  type ContextBundleSelector, type DomainGrants, type EventOrigin, type ResourceRef } from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { createLogger } from "../platform/logger";
import { initializeUserProfile } from "./user-profile";
import { contextBundles } from "./context-bundles";
import { contextBundleHistory } from "./context-bundle-history";
import { bookContextSources } from "./book-context-sources";
import { exportContextBundle } from "./context-bundle-export";
import type { ContextResourceAccess } from "../services/resource-access";
import type { ResourceOwner } from "../services/resource-owner";

type Host = {
  producer: Pick<typeof contextBundles, "captureBook" | "captureIntent" | "captureProfile" | "captureConversation">;
  archive: Pick<typeof contextBundleHistory, "list" | "read">;
  books: Pick<typeof bookContextSources, "disclose" | "observePosition">;
  invoke: typeof invoke;
  initialize(): Promise<void>;
  exportBundle: typeof exportContextBundle;
  report(error: unknown): void;
};
export type ContextBundleActor = { origin: EventOrigin; grants: DomainGrants; lifetime?: AbortSignal };

export type ContextBundleAccess = {
  capture(selector: ContextBundleSelector, signal?: AbortSignal): Promise<ContextBundleCaptureReceipt>;
  history(query: ContextBundleHistoryQuery, signal?: AbortSignal): Promise<ContextBundleHistoryPage>;
  read(query: ContextBundleReadQuery, signal?: AbortSignal): Promise<ContextBundle | null>;
  export(query: ContextBundleReadQuery, owner: ResourceOwner, signal?: AbortSignal): Promise<ResourceRef>;
};

/** The public actor gate: recipe/scope selection, domain grants, current spoiler authority and a revocable export lease. */
export function createContextBundleAccess(host: Host, actor: ContextBundleActor): ContextBundleAccess {
  const combine = (signal?: AbortSignal) => {
    const combined = actor.lifetime && signal ? AbortSignal.any([actor.lifetime, signal]) : actor.lifetime ?? signal ?? new AbortController().signal;
    combined.throwIfAborted();
    return combined;
  };
  const readable = async (query: ContextBundleReadQuery, signal: AbortSignal) => {
    const bundle = await host.archive.read(query, signal);
    if (bundle?.content.kind === "book_memory_context") await host.books.disclose(bundle, signal);
    signal.throwIfAborted();
    return bundle;
  };
  return {
    async capture(input, caller) {
      const selector = contextBundleSelector(input);
      assertContextBundleGrants(actor.grants, selector, "write");
      const signal = combine(caller), origin = actor.origin;
      const result = selector.kind === "user_profile_context" ? await host.producer.captureProfile(origin, signal)
        : selector.kind === "reading_intent_context" ? await host.producer.captureIntent(selector.scope.kind === "book" ? { kind: "book", id: selector.scope.id } : { kind: "user" }, origin, signal)
        : selector.kind === "book_memory_context" ? await host.producer.captureBook(selector.scope.kind === "book" ? selector.scope.id : "", origin, signal)
        : await host.producer.captureConversation(selector.scope.kind === "book" ? { kind: "book", id: selector.scope.id }
          : { kind: "global", id: selector.scope.kind === "conversation" ? selector.scope.id : "" }, origin, signal);
      return { bundle: result.bundle, changed: result.receipt.changed, persistence: result.receipt.persistence };
    },
    async history(input, caller) {
      const query = normalizeContextBundleHistoryQuery(input);
      assertContextBundleGrants(actor.grants, query, "read");
      return host.archive.list(query, combine(caller));
    },
    async read(input, caller) {
      const query = normalizeContextBundleReadQuery(input);
      assertContextBundleGrants(actor.grants, query, "read");
      return readable(query, combine(caller));
    },
    async export(input, owner, caller) {
      const query = normalizeContextBundleReadQuery(input);
      assertContextBundleGrants(actor.grants, query, "read");
      const signal = combine(caller);
      await host.initialize();
      signal.throwIfAborted();
      // The proof is captured before the archive read; native sealing rejects any source commit in between.
      const sourceRevision = await host.invoke<string>("context_bundle_source_revision");
      signal.throwIfAborted();
      const bundle = await readable(query, signal);
      if (bundle === null) throw new AppError("fs/not-found", "Context bundle version is not retained");
      const revoke = new AbortController(), lifetime = actor.lifetime;
      const retire = () => revoke.abort(lifetime?.reason ?? new AppError("ui/superseded", "Actor retired"));
      const stopObserving = bundle.content.scope.kind === "book" && bundle.content.kind === "book_memory_context"
        ? host.books.observePosition(bundle.content.scope.id, error => revoke.abort(error)) : () => {};
      lifetime?.addEventListener("abort", retire, { once: true });
      if (lifetime?.aborted) retire();
      const access: ContextResourceAccess = { sourceRevision, signal: revoke.signal, isAllowed: () => !revoke.signal.aborted,
        dispose: () => { lifetime?.removeEventListener("abort", retire); stopObserving(); } };
      const ref = await host.exportBundle(owner, bundle, access, signal);
      if (signal.aborted) {
        // The consumer is gone; a handle nobody holds must not wait for its expiry.
        await owner.release(ref.id).catch(host.report);
        throw signal.reason;
      }
      return ref;
    },
  };
}

const log = createLogger("context-bundle-access");
const host: Host = { producer: contextBundles, archive: contextBundleHistory, books: bookContextSources, invoke,
  initialize: initializeUserProfile, exportBundle: exportContextBundle, report: error => log.warn("Context export cleanup failed", error) };
export function contextBundleAccess(actor: ContextBundleActor): ContextBundleAccess {
  return createContextBundleAccess(host, actor);
}
