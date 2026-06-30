// Event-sourced foundation. `raw events` are the unit of sync; every higher
// layer (core projections, working / long-term memory, context bundles, the
// vector index) is a local projection rebuilt from this append-only log.
// See CLAUDE.md > Memory and docs/data-model.md.
//
// This file is the CANONICAL event registry: docs/sqlite-schema.sql and
// docs/data-model.md must agree with the variants declared here. Every column
// a projection table marks NOT NULL has to be derivable from some event payload
// (or from the envelope's HLC wall time), or the projection cannot be rebuilt.
//
// Naming: `aggregate.verbInPast`, dot + camelCase (e.g. `book.metadataEdited`).

import type {
  BookFormat,
  CoverStatus,
  HighlightColor,
  HighlightStyle,
  Id,
  MemoryFeedbackSignal,
  ReadingStatus,
} from "./entities";

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
  /**
   * Payload version. Bump (and add a new payload variant) instead of mutating
   * an existing shape — replay of historical events must never break. Mirrors
   * domain_events.schema_version.
   */
  schemaVersion?: number;
  /** Operator identity; `"local"` on the single-user desktop app today. */
  actorId?: Id;
  /** Event-specific data. */
  payload: P;
}

// Append new variants below; never repurpose or mutate an existing variant's
// shape (it breaks replay). Projection timestamps (created_at / updated_at /
// last_opened_at …) are derived from the envelope HLC wall time unless a
// payload field is called out explicitly.
export type DomainEvent =
  // --- Books -------------------------------------------------------------
  | DomainEventEnvelope<
      "book.imported",
      {
        bookId: Id;
        title: string;
        author?: string;
        format: BookFormat;
        /** Original import file name (reader rebuilds the File from it). */
        fileName: string;
        mimeType?: string;
        /** Original file size in bytes. */
        fileSize: number;
        /** Blob key of the original source file (no format conversion). */
        sourceBlobKey: string;
        /** Content hash for reliable duplicate-import detection. */
        sourceSha256?: string;
      }
    >
  | DomainEventEnvelope<
      "book.metadataEdited",
      { bookId: Id; title?: string; author?: string }
    >
  | DomainEventEnvelope<
      "book.coverExtracted",
      { bookId: Id; status: CoverStatus; coverBlobKey?: string }
    >
  /** Drives books.last_opened_at; emitted when a book is opened in the reader. */
  | DomainEventEnvelope<"book.opened", { bookId: Id }>
  | DomainEventEnvelope<"book.starred", { bookId: Id; starred: boolean }>
  | DomainEventEnvelope<"book.removed", { bookId: Id }>
  // --- Collections (set semantics → reconstructable as many-to-many later) -
  | DomainEventEnvelope<"collection.created", { collectionId: Id; name: string }>
  | DomainEventEnvelope<"collection.renamed", { collectionId: Id; name: string }>
  | DomainEventEnvelope<"collection.removed", { collectionId: Id }>
  | DomainEventEnvelope<
      "book.addedToCollection",
      { bookId: Id; collectionId: Id }
    >
  | DomainEventEnvelope<
      "book.removedFromCollection",
      { bookId: Id; collectionId: Id }
    >
  // --- Reading -----------------------------------------------------------
  | DomainEventEnvelope<
      "reading.progressed",
      {
        bookId: Id;
        /** Format-neutral position (EPUB CFI or PDF locator). */
        locator: string;
        chapterHref?: string;
        currentLocation?: number;
        totalLocations?: number;
        progressPercent?: number;
        status?: ReadingStatus;
      }
    >
  /** Active reading time; `ms` is a duration, `atEpochMs` the local instant. */
  | DomainEventEnvelope<
      "reading.timeRecorded",
      { bookId: Id; ms: number; atEpochMs: number }
    >
  // --- Annotations -------------------------------------------------------
  | DomainEventEnvelope<
      "highlight.created",
      {
        highlightId: Id;
        bookId: Id;
        /** Range anchor; may be absent for unanchorable formats (some PDFs). */
        anchor?: string;
        chapterHref?: string;
        text: string;
        color?: HighlightColor;
        style?: HighlightStyle;
      }
    >
  | DomainEventEnvelope<
      "highlight.recolored",
      { highlightId: Id; color: HighlightColor; style?: HighlightStyle }
    >
  | DomainEventEnvelope<"highlight.removed", { highlightId: Id }>
  | DomainEventEnvelope<
      "note.created",
      {
        noteId: Id;
        bookId: Id;
        highlightId?: Id;
        anchor?: string;
        chapterHref?: string;
        quotedText?: string;
        body: string;
      }
    >
  | DomainEventEnvelope<"note.updated", { noteId: Id; body: string }>
  | DomainEventEnvelope<"note.removed", { noteId: Id }>
  // --- AI conversation (one persistent thread per book) ------------------
  | DomainEventEnvelope<
      "aiConversation.started",
      { conversationId: Id; bookId: Id; title?: string }
    >
  | DomainEventEnvelope<
      "aiMessage.appended",
      {
        messageId: Id;
        conversationId: Id;
        role: "user" | "assistant";
        seq: number;
        content: string;
        model?: string;
        attachments?: Array<{
          attachmentId: Id;
          kind?: "selection";
          text: string;
          anchor?: string;
          chapterHref?: string;
        }>;
      }
    >
  | DomainEventEnvelope<"aiConversation.cleared", { conversationId: Id }>
  // --- Profile + memory (forward-looking; pipeline not yet built) --------
  | DomainEventEnvelope<
      "profile.updated",
      { displayName?: string; traits?: Record<string, unknown> }
    >
  | DomainEventEnvelope<
      "entity.resolved",
      { entityId: Id; kind: string; canonicalName: string; aliases?: string[] }
    >
  | DomainEventEnvelope<"entity.merged", { keepId: Id; mergedId: Id }>
  | DomainEventEnvelope<
      "memory.promoted",
      {
        memoryId: Id;
        kind: string;
        scope?: "user" | "book" | "entity" | "conversation";
        bookId?: Id;
        entityId?: Id;
        subject?: string;
        content: string;
        importance?: number;
        confidence?: number;
        evidence?: Array<{
          sourceKind: string;
          sourceId: Id;
          quote?: string;
          weight?: number;
        }>;
      }
    >
  | DomainEventEnvelope<
      "memory.revised",
      { memoryId: Id; content?: string; importance?: number; confidence?: number }
    >
  | DomainEventEnvelope<
      "memory.superseded",
      { memoryId: Id; bySupersedingId: Id }
    >
  | DomainEventEnvelope<
      "memory.feedback",
      { memoryId: Id; signal: MemoryFeedbackSignal; note?: string }
    >
  | DomainEventEnvelope<
      "memory.forgotten",
      { memoryId: Id; reason: "decay" | "user" }
    >;

export type DomainEventType = DomainEvent["type"];
