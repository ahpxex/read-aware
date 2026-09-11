import { AppError, ERR_PLUGIN_INVALID_ARGUMENT, ERR_PLUGIN_QUOTA_EXCEEDED } from "@read-aware/core";
import type { PluginDocument, PluginDocumentChange, PluginDocumentCollection, PluginDocumentPageFilter, PluginStorage } from "@read-aware/plugin-types";
import {
  pluginDocsApply, pluginDocsDelete, pluginDocsGet, pluginDocsList, pluginDocsPage, pluginDocsPut,
  type PluginDocumentMutation, type PluginDocumentRow,
} from "./plugin-backend";
import type { PluginLifecycleController } from "./plugin-lifecycle";
import { PluginDocumentObserver } from "./plugin-document-observer";

const encoder = new TextEncoder();
const DOCUMENT_BYTES = 4 * 1024 * 1024;
const BATCH_BYTES = 8 * 1024 * 1024;

function invalid(message: string): never { throw new AppError(ERR_PLUGIN_INVALID_ARGUMENT, message); }
function key(value: unknown, max: number): string {
  if (typeof value !== "string" || !value || encoder.encode(value).length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    return invalid("Invalid document identifier");
  }
  return value;
}
function collectionName(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) return invalid("Invalid collection name");
  return value;
}

function document<T = unknown>(row: PluginDocumentRow): PluginDocument<T> {
  let data: T;
  try { data = JSON.parse(row.json); }
  catch (cause) { throw new AppError("db/error", "Invalid plugin document JSON", { cause }); }
  return { id: row.id, data, bookId: row.bookId ?? undefined, anchor: row.anchor ?? undefined,
    updatedAt: row.updatedAt, revision: row.revision };
}

export function normalizeDocumentChanges(changes: PluginDocumentChange[]): PluginDocumentMutation[] {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 100) return invalid("Expected 1..100 document changes");
  let bytes = 0;
  const seen = new Set<string>();
  return changes.map(change => {
    if (!change || typeof change !== "object") return invalid("Invalid document change");
    const collection = collectionName(change.collection);
    const id = key(change.id, 1024);
    const identity = JSON.stringify([collection, id]);
    if (seen.has(identity)) return invalid("Duplicate document change");
    seen.add(identity);
    const expectedRevision = change.expectedRevision;
    if (expectedRevision !== null && (typeof expectedRevision !== "string" || !/^[a-f0-9]{32}$/.test(expectedRevision))) {
      return invalid("Expected an exact document revision or null");
    }
    const base = { collection, id, expectedRevision };
    if (change.kind === "check" || change.kind === "delete") return { ...base, kind: change.kind };
    if (change.kind !== "put") return invalid("Invalid document operation");
    let json: string | undefined;
    try { json = JSON.stringify(change.data ?? null); }
    catch { return invalid("Document data must be JSON serializable"); }
    if (json === undefined) return invalid("Document data must be JSON serializable");
    const length = encoder.encode(json).length;
    bytes += length;
    if (length > DOCUMENT_BYTES || bytes > BATCH_BYTES) throw new AppError(ERR_PLUGIN_QUOTA_EXCEEDED, "Document write exceeds byte budget");
    return { ...base, kind: "put", json,
      bookId: change.bookId === undefined ? undefined : key(change.bookId, 1024),
      anchor: change.anchor === undefined ? undefined : key(change.anchor, 16384) };
  });
}

function pageFilter(filter?: PluginDocumentPageFilter) {
  if (filter !== undefined && (!filter || typeof filter !== "object" || Array.isArray(filter)
    || Object.keys(filter).some(key => !["limit", "oldestFirst", "bookId", "cursor"].includes(key)))) return invalid("Invalid document page filter");
  const limit = filter?.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) return invalid("Document page limit must be 1..200");
  if (filter?.oldestFirst !== undefined && typeof filter.oldestFirst !== "boolean") return invalid("Invalid document page order");
  return { limit, oldestFirst: filter?.oldestFirst,
    bookId: filter?.bookId === undefined ? undefined : key(filter.bookId, 1024),
    cursor: filter?.cursor === undefined ? undefined : key(filter.cursor, 8192) };
}

export function createPluginDocuments(pluginId: string, lifecycle: PluginLifecycleController): Pick<PluginStorage, "collection" | "applyDocuments" | "observeDocuments"> {
  const observer = new PluginDocumentObserver(lifecycle);
  const storage: Pick<PluginStorage, "collection" | "applyDocuments" | "observeDocuments"> = {
    observeDocuments: <T>(input: import("@read-aware/plugin-types").PluginDocumentObservationQuery, handler: (event: import("@read-aware/plugin-types").PluginDocumentObservation<T>) => unknown) => {
      if (!input || typeof input !== "object" || Array.isArray(input)) return invalid("Invalid document observation query");
      const collection = storage.collection(collectionName(input.collection));
      if (input.kind === "get" && Object.keys(input).every(key => ["kind", "collection", "id"].includes(key))) {
        const id = key(input.id, 1024);
        return observer.observe(async () => ({ kind: "get", document: await collection.get<T>(id) }), handler);
      }
      if (input.kind === "page" && Object.keys(input).every(key => ["kind", "collection", "filter"].includes(key))) {
        const filter = pageFilter(input.filter);
        return observer.observe(async () => ({ kind: "page", page: await collection.page<T>(filter) }), handler);
      }
      return invalid("Invalid document observation query");
    },
    applyDocuments: changes => lifecycle.storageWrite("services.storage.applyDocuments", () =>
      pluginDocsApply(pluginId, normalizeDocumentChanges(changes))),
    collection: name => {
      const collection = collectionName(name);
      const api: PluginDocumentCollection = {
        put: (id, data, options) => lifecycle.storageWrite("services.storage.collection.put", () =>
          pluginDocsPut(pluginId, collection, String(id), JSON.stringify(data ?? null), { bookId: options?.bookId, anchor: options?.anchor })),
        delete: id => lifecycle.storageWrite("services.storage.collection.delete", () => pluginDocsDelete(pluginId, collection, String(id))),
        get: <T>(id: string) => lifecycle.read("services.storage.collection.get", async () => {
          const row = await pluginDocsGet(pluginId, collection, String(id));
          return row ? document<T>(row) : null;
        }),
        list: <T>(filter?: Parameters<PluginDocumentCollection["list"]>[0]) => lifecycle.read("services.storage.collection.list", async () =>
          (await pluginDocsList(pluginId, collection, { bookId: filter?.bookId, limit: filter?.limit, oldestFirst: filter?.oldestFirst })).map(document<T>)),
        page: <T>(filter?: Parameters<PluginDocumentCollection["page"]>[0]) => {
          const query = pageFilter(filter);
          return lifecycle.read("services.storage.collection.page", async () => {
            const page = await pluginDocsPage(pluginId, collection, query);
            return page.status === "stale-cursor" ? page : { ...page, items: page.items.map(document<T>) };
          });
        },
      };
      return api;
    },
  };
  return storage;
}
