import { AppError } from "./errors";
import type { DomainGrants, DomainId } from "./domains";
import { contextBundleSelector, type ContextBundle, type ContextBundleSelector } from "./context-bundle";
import type { ContextBundleHistoryPage, ContextBundleHistoryQuery, ContextBundleReadQuery } from "./context-bundle-history";
import type { ResourceRef } from "./resources";

/** Every domain a recipe reads. Selecting a recipe never widens an actor's grants. */
export function contextBundleSourceDomains(input: unknown): DomainId[] {
  const selector = contextBundleSelector(input);
  const domains = new Set<DomainId>(["memory"]);
  if (selector.kind === "book_memory_context") { domains.add("annotations"); domains.add("library"); }
  if (selector.kind === "conversation_insights_context") domains.add("conversations");
  if (selector.scope.kind === "book") domains.add("library");
  return [...domains];
}

/** Read covers history, pinned reads and export; publication additionally needs memory write. */
export function assertContextBundleGrants(grants: DomainGrants, selector: ContextBundleSelector, access: "read" | "write"): void {
  const missing = contextBundleSourceDomains({ kind: selector.kind, scope: selector.scope }).filter(domain => grants[domain] === undefined);
  if (missing.length) throw new AppError("memory/forbidden", `Context bundle requires ${missing.join(", ")} access`);
  if (access === "write" && grants.memory !== "write") throw new AppError("memory/forbidden", "Context bundle publication requires memory write access");
}

export type ContextBundleCaptureReceipt = { bundle: ContextBundle; changed: boolean; persistence: "event-log" };

/** Agent-side port. Scope and spoiler authority are resolved by the host, never by the model. */
export type ContextBundlePort = {
  capture(selector: ContextBundleSelector, signal?: AbortSignal): Promise<ContextBundleCaptureReceipt>;
  history(query: ContextBundleHistoryQuery, signal?: AbortSignal): Promise<ContextBundleHistoryPage>;
  read(query: ContextBundleReadQuery, signal?: AbortSignal): Promise<ContextBundle | null>;
  /** A sealed, thread-local reference. Bytes stay out of the model; the user saves through the native dialog. */
  export(threadKey: string, query: ContextBundleReadQuery, signal?: AbortSignal): Promise<ResourceRef>;
};
