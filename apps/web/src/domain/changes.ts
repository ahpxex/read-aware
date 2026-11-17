import {
  AppError,
  normalizeChangesQuery,
  type ChangeArea,
  type ChangeNotice,
  type ChangesPort,
  type ChangesQuery,
  type DomainEventType,
} from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { isTauri } from "../platform/environment";
import { runDomainWrite } from "../platform/domain-write-gate";
import { withPluginDataWrites } from "../platform/plugin-data-access";

const LIBRARY_READING: readonly ChangeArea[] = ["library", "reading"];
const EVERYTHING_OF_A_BOOK: readonly ChangeArea[] = ["library", "reading", "annotations", "memory", "conversations"];
const LIBRARY: readonly ChangeArea[] = ["library"];
const ANNOTATIONS: readonly ChangeArea[] = ["annotations"];
const CONVERSATIONS: readonly ChangeArea[] = ["conversations"];
const MEMORY: readonly ChangeArea[] = ["memory"];
const SETTINGS: readonly ChangeArea[] = ["settings"];
/** Not a plugin-readable area, so no change notice is produced. */
const NONE: readonly ChangeArea[] = [];

/**
 * Which change areas each domain event invalidates. Complete by type: a new
 * event does not compile until it is placed, so no plugin cursor silently
 * misses it.
 */
const eventAreas: Record<DomainEventType, readonly ChangeArea[]> = {
  "book.imported": LIBRARY_READING,
  "book.metadataEdited": LIBRARY_READING,
  "book.metadataSettled": LIBRARY_READING,
  "book.coverExtracted": LIBRARY_READING,
  "book.starred": LIBRARY_READING,
  "book.opened": LIBRARY_READING,
  "book.finished": LIBRARY_READING,
  "book.progressed": LIBRARY_READING,
  "book.timeRecorded": LIBRARY_READING,
  "book.sessionRecorded": LIBRARY_READING,
  "book.merged": EVERYTHING_OF_A_BOOK,
  "book.removed": EVERYTHING_OF_A_BOOK,
  "collection.created": LIBRARY,
  "collection.renamed": LIBRARY,
  "collection.opened": LIBRARY,
  "collection.removed": LIBRARY,
  "book.addedToCollection": LIBRARY,
  "book.removedFromCollection": LIBRARY,
  "userFont.imported": SETTINGS,
  "userFont.removed": SETTINGS,
  "highlight.created": ANNOTATIONS,
  "highlight.recolored": ANNOTATIONS,
  "highlight.removed": ANNOTATIONS,
  "note.created": ANNOTATIONS,
  "note.updated": ANNOTATIONS,
  "note.removed": ANNOTATIONS,
  "ask.recorded": ANNOTATIONS,
  "ask.removed": ANNOTATIONS,
  "aiConversation.started": CONVERSATIONS,
  "aiConversation.cleared": CONVERSATIONS,
  "aiConversation.titled": CONVERSATIONS,
  "aiMessage.appended": CONVERSATIONS,
  "aiMessage.removed": CONVERSATIONS,
  "book.chapterDigested": MEMORY,
  "book.narrativityClassified": MEMORY,
  "context.bundlePublished": MEMORY,
  "profile.onboarded": MEMORY,
  "profile.updated": MEMORY,
  "entity.resolved": MEMORY,
  "entity.merged": MEMORY,
  "memory.promoted": MEMORY,
  "memory.revised": MEMORY,
  "memory.superseded": MEMORY,
  "memory.feedback": MEMORY,
  "memory.forgotten": MEMORY,
  // Bookmarks are a host surface, not a plugin capability domain.
  "bookmark.created": NONE,
  "bookmark.renamed": NONE,
  "bookmark.removed": NONE,
  // Settings notices come from the authorized settings keys, not from this event.
  "preference.changed": NONE,
  // A restore announces itself as a projection invalidation.
  "backup.restoreChunk": NONE,
  "backup.restored": NONE,
};

type RawChange = {
  kind: string;
  operation: string;
  entityId: string;
  bookId: string | null;
  pluginId: string | null;
  detail: string | null;
};
export type ChangesAuthority = {
  owner: string;
  pluginId?: string;
  /** Must authorize every selected area, book/global scope, and settings path.
   * Catalog-derived KV bindings stay private; callers cannot supply raw keys. */
  acquire(
    query: ChangesQuery,
    signal?: AbortSignal,
  ): Promise<{
    settingsKeys: string[];
    assert(): void | Promise<void>;
    dispose(): void;
  }>;
};
export function createChangesPort(authority: ChangesAuthority): ChangesPort {
  const prepare = async (input: ChangesQuery, signal?: AbortSignal) => {
    if (!isTauri()) throw new AppError("changes/unavailable", "Change cursors require desktop");
    const query = normalizeChangesQuery(input);
    const lease = await authority.acquire(query, signal);
    try {
      await lease.assert();
      signal?.throwIfAborted();
      if (query.areas.includes("documents") && !authority.pluginId)
        throw new AppError("plugin/permission-denied", "Private changes require a plugin owner");
      const selector = {
        projectionKey: JSON.stringify(query),
        eventTypes: Object.entries(eventAreas)
          .filter(([, areas]) => areas.some((area) => query.areas.includes(area)))
          .map(([type]) => type),
        settingsKeys: query.areas.includes("settings") ? [...lease.settingsKeys] : [],
        bookId: query.bookId ?? null,
        pluginId: query.areas.includes("documents") ? authority.pluginId : null,
      };
      return { query, lease, selector };
    } catch (error) {
      lease.dispose();
      throw error;
    }
  };
  const write = <T>(
    lease: Awaited<ReturnType<ChangesAuthority["acquire"]>>,
    signal: AbortSignal | undefined,
    work: () => Promise<T>,
  ) =>
    withPluginDataWrites(authority.pluginId ? [authority.pluginId] : [], () =>
      runDomainWrite(async () => {
        signal?.throwIfAborted();
        await lease.assert();
        return work();
      }),
    );
  return {
    async open(input, signal) {
      const { lease, selector } = await prepare(input, signal);
      try {
        const cursor = await write(lease, signal, () =>
          invoke<string>("capability_changes_open", { owner: authority.owner, selector }),
        );
        await lease.assert();
        signal?.throwIfAborted();
        return { cursor };
      } finally {
        lease.dispose();
      }
    },
    async read(input, cursor, limit = 50, signal) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !/^[a-f0-9]{48}$/.test(cursor))
        throw new AppError("changes/invalid-query", "Invalid change page");
      const { query, lease, selector } = await prepare(input, signal);
      try {
        const page = await write(lease, signal, () =>
          invoke<{ changes: RawChange[]; cursor: string; hasMore: boolean }>("capability_changes_read", {
            owner: authority.owner,
            selector,
            cursor,
            limit,
          }),
        );
        await lease.assert();
        signal?.throwIfAborted();
        const changes: ChangeNotice[] = [];
        for (const row of page.changes) {
          if (
            query.bookId &&
            row.bookId !== query.bookId &&
            !(row.kind === "setting" && row.entityId === "read-aware-reader-settings")
          )
            continue;
          const book = row.bookId ? { bookId: row.bookId } : {};
          if (row.kind === "event") {
            const areas = (eventAreas[row.operation as DomainEventType] ?? []).filter((area) =>
              query.areas.includes(area),
            );
            if (areas.length) changes.push({ areas, ...book });
          } else if (
            row.kind === "document" &&
            query.areas.includes("documents") &&
            row.pluginId === authority.pluginId &&
            row.detail &&
            (!query.collection || query.collection === row.detail)
          )
            changes.push({ areas: ["documents"], ...book, collection: row.detail, id: row.entityId });
          else if (
            row.kind === "setting" &&
            query.areas.includes("settings") &&
            selector.settingsKeys.includes(row.entityId)
          )
            changes.push({ areas: ["settings"] });
        }
        return { changes, cursor: page.cursor, hasMore: page.hasMore };
      } finally {
        lease.dispose();
      }
    },
  };
}
