/**
 * Collections domain — the shelf's user-defined groups (single-membership
 * today; the event vocabulary already carries set semantics).
 */
import type { CollectionSummary, EventOrigin } from "@read-aware/core";
import { emitAppEvent } from "../platform/app-events";
import {
  createCollection,
  deleteCollection,
  listCollections,
  listLibraryBooks,
  renameCollection,
  setBooksCollection,
} from "../features/library/lib/library-db";
import { COLLECTION_EVENTS, domainSubscribe, type DomainEventSubscribe } from "./events";

const notifyLibraryChanged = (): void => emitAppEvent("library-changed", {});

export type CollectionsDomain = {
  list(): Promise<CollectionSummary[]>;
  /** Ids of the books currently in a collection. */
  booksIn(collectionId: string): Promise<string[]>;
  on: DomainEventSubscribe<(typeof COLLECTION_EVENTS)[number]>;
  create(name: string): Promise<CollectionSummary>;
  rename(collectionId: string, name: string): Promise<void>;
  /** Delete the collection; its books stay, ungrouped. */
  remove(collectionId: string): Promise<void>;
  /** Assign books to a collection, or `null` to ungroup them. */
  assignBooks(bookIds: string[], collectionId: string | null): Promise<void>;
};

export function createCollectionsDomain(origin: EventOrigin): CollectionsDomain {
  return {
    list: async () =>
      (await listCollections()).map((collection) => ({
        id: collection.id,
        name: collection.name,
        createdAt: collection.createdAt,
      })),
    booksIn: async (collectionId) =>
      (await listLibraryBooks())
        .filter((book) => book.collectionId === String(collectionId))
        .map((book) => book.id),
    on: domainSubscribe(COLLECTION_EVENTS, origin),
    create: async (name) => {
      const collection = await createCollection(String(name), origin);
      notifyLibraryChanged();
      return { id: collection.id, name: collection.name, createdAt: collection.createdAt };
    },
    rename: async (collectionId, name) => {
      await renameCollection(String(collectionId), String(name), origin);
      notifyLibraryChanged();
    },
    remove: async (collectionId) => {
      await deleteCollection(String(collectionId), origin);
      notifyLibraryChanged();
    },
    assignBooks: async (bookIds, collectionId) => {
      await setBooksCollection(
        bookIds.map(String),
        collectionId == null ? null : String(collectionId),
        origin,
      );
      notifyLibraryChanged();
    },
  };
}
