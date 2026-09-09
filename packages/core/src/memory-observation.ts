import type { BookGraphQuery, BookGraphResult } from "./book-memory";
import type { MemorySnapshot } from "./memory-management";
import type { BookClassificationSnapshot } from "./book-classification";
import type { MemoryQuery, MemoryRecord } from "./memory-query";

/** Query filters do not expand the actor's memory grant or spoiler boundary. */
export type MemoryObservationQuery =
  | { kind: "search"; query: MemoryQuery }
  | { kind: "inspect"; memoryId: string }
  | { kind: "classification"; bookId: string }
  | { kind: "bookGraph"; bookId: string; query?: BookGraphQuery };
export type MemoryObservationResult =
  | { kind: "search"; memories: MemoryRecord[] }
  | { kind: "inspect"; snapshot: MemorySnapshot | null }
  | { kind: "classification"; snapshot: BookClassificationSnapshot | null }
  | { kind: "bookGraph"; graph: BookGraphResult };
/** Revision orders this subscription only; it is not a mutation/CAS token. */
export type MemoryObservation = { revision: number } & (
  | { status: "ready"; result: MemoryObservationResult }
  | { status: "error"; errorCode: string }
);
