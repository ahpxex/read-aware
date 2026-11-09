/**
 * One-time move of the retired Jumper plugin's bookmarks into the library's
 * own bookmarks (`bookmark.*` events).
 *
 * Jumper kept them as private plugin documents (`jumper` / `bookmarks`): on
 * this device only, never synced. Each valid document becomes a
 * `bookmark.created` event with a stable id (`jumper-<document id>`), and the
 * native committer deletes the document in the same transaction, so the move
 * is idempotent and a crash can neither duplicate nor lose one. A document the
 * library cannot hold (malformed, or its book no longer in the library) is
 * left where it is.
 *
 * The plugin-document IPC is called directly: the plugin runtime's wrappers
 * live in a feature, which the domain layer must not import.
 */
import { isBookmarkKind, normalizeBookmarkName, normalizeBookmarkTarget, type DomainEventType } from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { isTauri } from "../platform/environment";
import { commitDomainEventBatch, type DomainEventDraft } from "../platform/domain-events";
import type { NewBookmark } from "./bookmarks";

const PLUGIN_ID = "jumper";
const COLLECTION = "bookmarks";

/** The `plugin_docs_list` row shape (Rust `PluginDocumentRow`, camelCase). */
type PluginDocumentRow = { id: string; json: string; updatedAt: string };

export type JumperBookmarkAdoption = { documentId: string; bookmark: NewBookmark; createdAt?: string };

/** A Jumper bookmark document (`version: 1`) as a library bookmark, or null. */
export function jumperBookmarkAdoption(row: PluginDocumentRow): JumperBookmarkAdoption | null {
  let data: unknown;
  try {
    data = JSON.parse(row.json);
  } catch {
    // An unparseable document is left in place; nothing can be adopted from it.
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const doc = data as Record<string, unknown>;
  if (doc.version !== 1 || !isBookmarkKind(doc.kind)) return null;
  const name = normalizeBookmarkName(doc.name);
  const raw = doc.target as Record<string, unknown> | undefined;
  if (!name || !raw || typeof raw !== "object" || typeof raw.bookId !== "string" || !raw.bookId) return null;
  const { bookId, ...location } = raw;
  const target = normalizeBookmarkTarget(location, doc.kind);
  if (!target) return null;
  const createdAt = Number.isNaN(Date.parse(row.updatedAt)) ? undefined : new Date(row.updatedAt).toISOString();
  return {
    documentId: row.id,
    bookmark: {
      bookId: bookId as string,
      name,
      kind: doc.kind,
      target,
      // A section bookmark names its chapter; a CFI or fraction one does not say.
      ...(typeof target.href === "string" ? { chapterHref: target.href } : {}),
    },
    ...(createdAt ? { createdAt } : {}),
  };
}

/** Adopt every movable Jumper bookmark; resolves with how many moved. */
export async function adoptRetiredJumperBookmarks(): Promise<number> {
  if (!isTauri()) return 0;
  const rows = await invoke<PluginDocumentRow[]>("plugin_docs_list", {
    pluginId: PLUGIN_ID,
    collection: COLLECTION,
    bookId: null,
    limit: null,
    oldestFirst: true,
  });
  const adoptions = rows.map(jumperBookmarkAdoption).filter((entry) => entry !== null);
  if (!adoptions.length) return 0;
  const type: DomainEventType = "bookmark.created";
  const drafts: DomainEventDraft[] = adoptions.map(({ documentId, bookmark, createdAt }) => ({
    type,
    origin: "system",
    ...(createdAt ? { createdAt } : {}),
    payload: { bookmarkId: `jumper-${documentId}`, ...bookmark },
  }));
  return commitDomainEventBatch(drafts, {
    dispatch: (events) =>
      invoke<number>("bookmarks_adopt_plugin_documents", {
        pluginId: PLUGIN_ID,
        collection: COLLECTION,
        adoptions: events.map((event, index) => ({ documentId: adoptions[index]!.documentId, event })),
      }),
  });
}
