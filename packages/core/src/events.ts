// Event-sourced foundation. `raw events` are the unit of sync; every higher
// memory layer (working / long-term / book-note / bundles) is a local
// projection rebuilt from this append-only log. See CLAUDE.md > Memory.

import type { BookFormat, Id } from "./entities";

/**
 * Hybrid Logical Clock stamp — gives every event a total, causally-consistent
 * order across devices so two local logs can be merged deterministically.
 */
export interface HlcStamp {
  /** Wall-clock milliseconds at emit time. */
  wallMs: number;
  /** Monotonic counter to break ties within the same wallMs on one device. */
  counter: number;
  /** Stable per-device id; the final tiebreaker. */
  deviceId: string;
}

export interface DomainEventEnvelope<T extends string = string, P = unknown> {
  /** Globally unique event id (uuid). */
  id: Id;
  /** Discriminator. */
  type: T;
  /** Ordering + sync key. */
  hlc: HlcStamp;
  /** Event-specific data. */
  payload: P;
}

// Starting event schema. Append new variants here as the product grows;
// never repurpose or mutate an existing variant's shape (it breaks replay).
export type DomainEvent =
  | DomainEventEnvelope<"book.imported", { bookId: Id; title: string; author?: string; format: BookFormat; sourceBlobKey: string }>
  | DomainEventEnvelope<"book.removed", { bookId: Id }>
  | DomainEventEnvelope<"highlight.created", { highlightId: Id; bookId: Id; anchor: string; text: string }>
  | DomainEventEnvelope<"highlight.removed", { highlightId: Id }>
  | DomainEventEnvelope<"note.created", { noteId: Id; bookId?: Id; highlightId?: Id; body: string }>
  | DomainEventEnvelope<"note.updated", { noteId: Id; body: string }>
  | DomainEventEnvelope<"reading.progressed", { bookId: Id; locator: string }>;

export type DomainEventType = DomainEvent["type"];
