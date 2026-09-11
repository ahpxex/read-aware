import { AppError, normalizeContextBundleHistoryPage, normalizeContextBundleHistoryQuery, normalizeContextBundleReadQuery,
  validateContextBundle, type ContextBundleHistoryQuery, type ContextBundleReadQuery } from "@read-aware/core";
import { invoke } from "../platform/ipc";

/** Internal archive adapter. No actor gets access merely by knowing a version. */
export function createContextBundleHistory(host: { invoke: typeof invoke }) {
  return {
    async list(input: ContextBundleHistoryQuery, signal?: AbortSignal) {
      const query = normalizeContextBundleHistoryQuery(input);
      signal?.throwIfAborted();
      const raw = await host.invoke<unknown>("context_bundle_history", { query });
      signal?.throwIfAborted();
      try { return normalizeContextBundleHistoryPage(raw, query); }
      catch (cause) { throw new AppError("db/error", "Invalid context history response", { cause }); }
    },
    async read(input: ContextBundleReadQuery, signal?: AbortSignal) {
      const query = normalizeContextBundleReadQuery(input);
      signal?.throwIfAborted();
      const raw = await host.invoke<unknown>("context_bundle_read", { query });
      signal?.throwIfAborted();
      if (raw === null) return null;
      let bundle;
      try { bundle = await validateContextBundle(raw); }
      catch (cause) { throw new AppError("db/error", "Invalid stored context artifact", { cause }); }
      signal?.throwIfAborted();
      if (bundle.version !== query.version || bundle.content.kind !== query.kind || JSON.stringify(bundle.content.scope) !== JSON.stringify(query.scope)) {
        throw new AppError("db/error", "Context artifact does not match its pinned selector");
      }
      return bundle;
    },
  };
}
export const contextBundleHistory = createContextBundleHistory({ invoke });
