import type { Collection, LibraryBook } from "../../library/lib/library-types";

/** A member shown on the collection's stack: its cover, or the placeholder a coverless book gets. */
export type CollectionCover = Pick<LibraryBook, "id" | "title" | "author" | "format" | "coverUrl">;

export type CollectionTileData = {
  id: string;
  name: string;
  count: number;
  /** The first members, front to back; the stack shows up to three. */
  covers: CollectionCover[];
};

/** How many members a collection's stack draws. */
export const COLLECTION_STACK_DEPTH = 3;

/** What a collection tile shows: its true member count and the members its stack draws. */
export function collectionTileData(collection: Collection, members: LibraryBook[]): CollectionTileData {
  return {
    id: collection.id,
    name: collection.name,
    count: members.length,
    covers: members
      .slice(0, COLLECTION_STACK_DEPTH)
      .map(({ id, title, author, format, coverUrl }) => ({ id, title, author, format, coverUrl })),
  };
}
