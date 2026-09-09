/** Read-only chapter memory contracts. These are distilled evidence, never verbatim source text. */
export type DigestFlavor = "narrative" | "expository";
/** Local optimistic condition for one chapter and its book classification, not content provenance. */
export type BookDigestSnapshot = { bookId: string; chapterIndex: number; flavor: DigestFlavor; revision: string };
/** Names/aliases use this edition's spelling; flavor determines character vs concept semantics. */
export interface DigestCharacter { name: string; aliases?: string[]; note?: string }
export interface DigestRelation { from: string; kind: string; to: string; note?: string }
export interface ChapterDigest {
  chapterIndex: number;
  /** Persisted provenance, not a content-versioned reading location. */
  chapterHref?: string;
  summary: string;
  characters: DigestCharacter[];
  relations: DigestRelation[];
  digestVersion: number;
  /** Legacy rows without flavor are narrative. */
  flavor?: DigestFlavor;
}
export interface BookGraphEdge extends DigestRelation { establishedAt: number }
export type BookGraphQuery = { names?: string[]; chapterIndex?: number };
export type BookGraphProfile = DigestCharacter & {
  appearsInChapters: number[];
  relations: BookGraphEdge[];
  relationsTruncated: boolean;
};
export type BookGraphResult = { fence?: string } & (
  | { graph: "empty" | "unavailable" | "miss"; note: string }
  | { graph: "chapter"; chapterIndex: number; chapterHref?: string; summary: string; entities: DigestCharacter[]; relations: DigestRelation[] }
  | { graph: "profiles"; profiles: BookGraphProfile[]; notFound: string[]; truncated: boolean; note: string }
  | { graph: "overview"; chaptersDigested: number; chapterRange: [number, number]; entityCount: number; edgeCount: number;
      entities: { name: string; aliases?: string[]; chapters: number }[]; truncated: boolean; note: string }
);
