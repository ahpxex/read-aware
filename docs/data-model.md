# ReadAware — Local Data Model & Schema (Design)

> **Status:** Decided direction, **not yet implemented**. This document defines
> the *target* on-device schema. The current app persists to IndexedDB +
> localStorage (see [§8 Mapping](#8-mapping-from-the-current-storage)); the
> actual database port (StorageAdapter implementations, projection rebuild,
> migration) is **deliberately deferred**. This file is the contract we build
> toward, the source of truth for *shape*, not a description of what ships today.
>
> Aligns with `CLAUDE.md` › *AI Architecture Decisions* and the existing
> contracts in `packages/core` (`events.ts`, `entities.ts`, `storage.ts`).

## Table of contents

1. [Principles](#1-principles)
2. [Layered model](#2-layered-model)
3. [The event log — the source of truth](#3-the-event-log--the-source-of-truth)
4. [Event catalog](#4-event-catalog)
5. [Projection tables (SQLite)](#5-projection-tables-sqlite)
6. [Vector index (LanceDB)](#6-vector-index-lancedb)
7. [Device-local config (never in the log)](#7-device-local-config-never-in-the-log)
8. [Mapping from the current storage](#8-mapping-from-the-current-storage)
9. [Sync model](#9-sync-model)
10. [Open decisions](#10-open-decisions)

---

## 1. Principles

- **Local-first.** Data and retrieval live on-device. The network is for sync
  and (optional) remote inference, never for core reads/writes.
- **Two independent axes.** *Data + retrieval = local* (SQLite + LanceDB);
  *LLM inference = remote* (BYO key / proxy). Keep them separate.
- **Event-sourced.** The append-only **event log is the true source of truth**
  and the **unit of sync**. Every structured table and the vector index is a
  **deterministic projection rebuilt from the log** — projections are recomputed
  on-device and never synced directly.
- **The backend is sync + relay only.** It stores the (preferably E2E-encrypted)
  event log + large blobs and exposes a change feed. It holds no business logic.
- **Reach storage through a `StorageAdapter`** (native FS + SQLite + LanceDB on
  desktop; OPFS + wa-sqlite + WASM vector index in the browser).

### Conventions

- IDs are UUIDv4 strings (`TEXT`). Timestamps are ISO-8601 strings (`TEXT`)
  unless a column is explicitly an epoch-millis `INTEGER` (HLC `wall_ms`).
- SQLite types used: `TEXT`, `INTEGER`, `REAL`, `BLOB`. Booleans are `INTEGER`
  (0/1). Structured payloads are JSON in `TEXT` columns.
- "Projection" tables carry **no authoritative state of their own**: dropping
  and replaying the log must rebuild them byte-for-byte.

---

## 2. Layered model

```
                          remote backend (sync + relay only)
                 ┌─────────────────────────────────────────────┐
                 │  encrypted event log replica · blobs · feed  │
                 └───────────────▲─────────────────────┬────────┘
                          push/pull events             │ blobs
ON DEVICE                       │                      │
┌───────────────────────────────┴──────────────────────┴───────────────────┐
│  EVENT LOG  (append-only, immutable, HLC-ordered)   ← source of truth      │
│             the ONLY thing that is synced                                  │
└───────────────┬───────────────────────────────────────────────────────────┘
                │ deterministic, on-device replay
   ┌────────────┼───────────────────────────────┬──────────────────────────┐
   ▼            ▼                                ▼                          ▼
 SQLite      SQLite                          SQLite                    LanceDB
 core        memory                          context bundles           vector index
 tables      (long-term, working)            (versioned)               (derived embeds)
 (books,     ──────────────────              ──────────────            ───────────────
 highlights, promotion / decay /             user_profile_context,     semantic search
 notes,      conflict-res / dedup            book_memory_context, …    over memories +
 progress)                                                             reading artifacts
```

- **Raw events** — append-only, immutable. The unit of sync.
- **Working memory** — short-horizon projection for the active reading session.
- **Long-term user memory** — consolidated, decayed, deduped projection.
- **Book / highlight / note memory** — per-artifact projection.
- **Context bundles** — exportable, versioned projections assembled for a moment.

Everything below the event log is rebuildable; only the log is canonical.

---

## 3. The event log — the source of truth

One append-only table. Order is a Hybrid Logical Clock so two device logs merge
deterministically. Matches `DomainEventEnvelope` + `HlcStamp` in
`packages/core/src/events.ts`.

```sql
CREATE TABLE event_log (
  id          TEXT    NOT NULL PRIMARY KEY,   -- event uuid (envelope.id)
  type        TEXT    NOT NULL,               -- discriminator, e.g. 'highlight.created'
  -- Hybrid Logical Clock (envelope.hlc) — total causal order across devices
  hlc_wall_ms INTEGER NOT NULL,               -- wall-clock ms at emit
  hlc_counter INTEGER NOT NULL,               -- tiebreaker within the same ms
  hlc_device  TEXT    NOT NULL,               -- stable per-device id (final tiebreaker)
  payload     TEXT    NOT NULL,               -- event-specific JSON
  -- denormalized for cheap projection / pruning (all derivable from payload):
  entity_id   TEXT,                           -- primary subject (bookId / highlightId / …)
  ingested_at TEXT    NOT NULL                -- when this device first stored it
);

-- Replay + incremental projection read events in HLC order:
CREATE UNIQUE INDEX ix_event_log_hlc
  ON event_log (hlc_wall_ms, hlc_counter, hlc_device);
CREATE INDEX ix_event_log_entity ON event_log (entity_id);
CREATE INDEX ix_event_log_type   ON event_log (type);
```

Rules:

- **Immutable & append-only.** Never `UPDATE`/`DELETE` a row. Corrections are new
  events (`*.updated`, `*.removed`).
- **Never repurpose a `type`'s payload shape.** Add a new variant instead;
  replay of historical events must never break.
- **`readEventsSince(after?: HlcStamp)`** = `WHERE (hlc_wall_ms,hlc_counter,hlc_device) > after ORDER BY ix_event_log_hlc`.
- **Projection checkpoint** records how far each projection has consumed the log,
  so projections update incrementally and can be rebuilt from zero:

```sql
CREATE TABLE projection_checkpoint (
  projection   TEXT NOT NULL PRIMARY KEY,  -- e.g. 'books', 'long_term_memory'
  hlc_wall_ms  INTEGER NOT NULL,
  hlc_counter  INTEGER NOT NULL,
  hlc_device   TEXT NOT NULL
);
```

---

## 4. Event catalog

`✓` = already declared in `packages/core/src/events.ts`. `+` = planned (add as a
new `DomainEventEnvelope` variant; do not mutate existing ones).

| Type | Status | Payload (JSON) |
|------|:--:|----------------|
| `book.imported` | ✓ | `{ bookId, title, author?, format, sourceBlobKey }` |
| `book.removed` | ✓ | `{ bookId }` |
| `highlight.created` | ✓ | `{ highlightId, bookId, anchor, text }` |
| `highlight.removed` | ✓ | `{ highlightId }` |
| `note.created` | ✓ | `{ noteId, bookId?, highlightId?, body }` |
| `note.updated` | ✓ | `{ noteId, body }` |
| `reading.progressed` | ✓ | `{ bookId, locator }` |
| `book.metadataEdited` | + | `{ bookId, title?, author?, coverBlobKey? }` |
| `note.removed` | + | `{ noteId }` |
| `highlight.recolored` | + | `{ highlightId, color }` |
| `aichat.started` | + | `{ chatId, bookId, anchor?, seedText }` |
| `aichat.messageAppended` | + | `{ chatId, role, content }` |
| `profile.updated` | + | `{ displayName?, traits? }` |
| `memory.promoted` | + | `{ memoryId, kind, subject, content, importance, evidence[] }` |
| `memory.revised` | + | `{ memoryId, content?, importance? }` |
| `memory.superseded` | + | `{ memoryId, bySupersedingId }` |
| `memory.feedback` | + | `{ memoryId, signal: 'pin'|'correct'|'reject', note? }` |
| `memory.forgotten` | + | `{ memoryId, reason: 'decay'|'user' }` |
| `entity.merged` | + | `{ keepId, mergedId }` |

`locator` is a format-neutral position string (EPUB CFI, or a PDF page locator);
`anchor` is the same idea for annotation ranges. See current `ReaderProgress` and
`cfiRange` in [§8](#8-mapping-from-the-current-storage).

> **Consolidation as events.** Memory promotion/decay/conflict-resolution
> decisions are themselves events (`memory.*`), so the memory projection is
> reproducible and syncable. The *derivation logic* runs on-device; the
> *outcomes* are logged.

---

## 5. Projection tables (SQLite)

All rebuildable from the log. Foreign keys express intent; because rows are
written by replay (in HLC order), enforcement can be deferred or `DEFERRABLE`.

### 5.1 Core reading model

Mirrors `packages/core/src/entities.ts`.

```sql
CREATE TABLE user_profile (
  id           TEXT NOT NULL PRIMARY KEY,
  display_name TEXT,
  traits       TEXT,                 -- JSON: derived, stable preferences
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE book (
  id              TEXT NOT NULL PRIMARY KEY,
  title           TEXT NOT NULL,
  author          TEXT,
  format          TEXT NOT NULL,     -- 'epub'|'mobi'|'azw3'|'fb2'|'pdf'
  source_blob_key TEXT NOT NULL,     -- → blob.key (original file)
  cover_blob_key  TEXT,              -- → blob.key (extracted cover; null = none)
  added_at        TEXT NOT NULL,
  removed_at      TEXT               -- soft tombstone (book.removed); null = active
);
CREATE INDEX ix_book_added ON book (added_at);

CREATE TABLE highlight (
  id           TEXT NOT NULL PRIMARY KEY,
  book_id      TEXT NOT NULL REFERENCES book(id),
  anchor       TEXT NOT NULL,        -- EPUB CFI / PDF locator (range)
  chapter_href TEXT,
  text         TEXT NOT NULL,
  color        TEXT NOT NULL DEFAULT 'yellow',  -- 'yellow'|'green'|'blue'|'pink'
  created_at   TEXT NOT NULL,
  removed_at   TEXT
);
CREATE INDEX ix_highlight_book ON highlight (book_id);

CREATE TABLE note (
  id           TEXT NOT NULL PRIMARY KEY,
  book_id      TEXT REFERENCES book(id),
  highlight_id TEXT REFERENCES highlight(id),
  anchor       TEXT,
  chapter_href TEXT,
  quoted_text  TEXT,                 -- the anchored excerpt, if any
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  removed_at   TEXT
);
CREATE INDEX ix_note_book ON note (book_id);

-- One current position per (user, book). Updated by reading.progressed.
CREATE TABLE reading_position (
  book_id          TEXT NOT NULL PRIMARY KEY REFERENCES book(id),
  locator          TEXT,             -- CFI / PDF locator (cfi/href)
  current_location INTEGER,
  total_locations  INTEGER,
  progress_percent REAL NOT NULL DEFAULT 0,   -- 0–100
  status           TEXT NOT NULL DEFAULT 'unread', -- 'unread'|'reading'|'finished'
  last_read_at     TEXT
);

-- AI chats threaded over a selection (annotation kind = ai-chat today).
CREATE TABLE ai_chat (
  id           TEXT NOT NULL PRIMARY KEY,
  book_id      TEXT NOT NULL REFERENCES book(id),
  anchor       TEXT,
  chapter_href TEXT,
  seed_text    TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE TABLE ai_chat_message (
  id        TEXT NOT NULL PRIMARY KEY,
  chat_id   TEXT NOT NULL REFERENCES ai_chat(id),
  role      TEXT NOT NULL,           -- 'user'|'assistant'
  content   TEXT NOT NULL,
  seq       INTEGER NOT NULL,        -- order within the chat
  created_at TEXT NOT NULL
);
CREATE INDEX ix_chat_msg_chat ON ai_chat_message (chat_id, seq);
```

### 5.2 Memory (long-term + working)

The hard half (per CLAUDE.md): the write/consolidation pipeline is modeled as
explicitly as retrieval — promotion, conflict resolution, decay, dedup/entity
resolution.

```sql
-- Resolved entities behind "repeated appearance across books/conversations".
CREATE TABLE entity (
  id          TEXT NOT NULL PRIMARY KEY,
  kind        TEXT NOT NULL,         -- 'person'|'concept'|'work'|'place'|…
  canonical   TEXT NOT NULL,         -- canonical display name
  aliases     TEXT,                  -- JSON string[]
  created_at  TEXT NOT NULL
);

CREATE TABLE long_term_memory (
  id           TEXT NOT NULL PRIMARY KEY,
  kind         TEXT NOT NULL,        -- 'profile_fact'|'preference'|'insight'|'entity_fact'
  entity_id    TEXT REFERENCES entity(id),
  subject      TEXT,                 -- short subject/key for the memory
  content      TEXT NOT NULL,        -- the consolidated statement
  -- retrieval signals (CLAUDE.md › Memory and Context):
  importance   REAL NOT NULL DEFAULT 0,  -- consolidated salience
  confidence   REAL NOT NULL DEFAULT 0,
  recency_at   TEXT NOT NULL,        -- last reinforced
  hit_count    INTEGER NOT NULL DEFAULT 0,  -- repeated appearance counter
  pinned       INTEGER NOT NULL DEFAULT 0,  -- explicit user feedback
  status       TEXT NOT NULL DEFAULT 'active', -- 'active'|'superseded'|'forgotten'
  superseded_by TEXT REFERENCES long_term_memory(id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX ix_ltm_status   ON long_term_memory (status);
CREATE INDEX ix_ltm_entity   ON long_term_memory (entity_id);
CREATE INDEX ix_ltm_importance ON long_term_memory (importance);

-- Provenance: which raw events / artifacts support a memory (dedup + audit).
CREATE TABLE memory_evidence (
  memory_id  TEXT NOT NULL REFERENCES long_term_memory(id),
  source_kind TEXT NOT NULL,         -- 'event'|'highlight'|'note'|'ai_chat'|'book'
  source_id  TEXT NOT NULL,
  weight     REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (memory_id, source_kind, source_id)
);

-- Short-horizon projection for the active session (cheap to rebuild/discard).
CREATE TABLE working_memory (
  id          TEXT NOT NULL PRIMARY KEY,
  book_id     TEXT REFERENCES book(id),
  content     TEXT NOT NULL,
  salience    REAL NOT NULL DEFAULT 0,
  expires_at  TEXT,                  -- decays out of the window
  created_at  TEXT NOT NULL
);
```

### 5.3 Context bundles (versioned, exportable)

Structured, exportable context — preferred over ad-hoc prompt strings. Each
bundle key keeps a version history so exports are reproducible.

```sql
CREATE TABLE context_bundle (
  id          TEXT NOT NULL PRIMARY KEY,
  bundle_key  TEXT NOT NULL,         -- stable per (type, scope), e.g. 'book_memory:<bookId>'
  type        TEXT NOT NULL,         -- 'user_profile_context'|'reading_intent_context'
                                     -- |'book_memory_context'|'conversation_insights_context'
  book_id     TEXT REFERENCES book(id),  -- null for user-level bundles
  version     INTEGER NOT NULL,      -- monotonic per bundle_key
  content     TEXT NOT NULL,         -- the assembled bundle (JSON), external-agent ready
  checksum    TEXT NOT NULL,         -- content hash for dedup / change detection
  assembled_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ix_bundle_key_version ON context_bundle (bundle_key, version);
```

### 5.4 Blob registry

Large bytes (book files, normalized derivatives, covers) live in the blob store
(`StorageAdapter.putBlob/getBlob`), not in a SQLite column. This table is the
on-device index of them.

```sql
CREATE TABLE blob (
  key         TEXT NOT NULL PRIMARY KEY,  -- referenced by book.source_blob_key, cover_blob_key
  kind        TEXT NOT NULL,         -- 'source'|'derivative'|'cover'
  mime_type   TEXT,
  byte_size   INTEGER,
  created_at  TEXT NOT NULL
);
```

---

## 6. Vector index (LanceDB)

A **derived** index, rebuilt on-device from the log / SQLite — never the primary
store. Mirrors `VectorItem` / `VectorMatch` in `storage.ts`.

- **Indexed:** long-term memories, working memories, highlights, notes, AI-chat
  turns — anything retrievable.
- **Per item:** `id`, `embedding: number[]`, `metadata` (e.g.
  `{ source_kind, book_id, importance, recency_at }`) so retrieval can blend
  similarity with the [§5.2](#52-memory-long-term--working) signals (relevance to
  the current reading goal, recency, importance, explicit feedback, repeated
  appearance) rather than similarity alone.
- **Rebuild:** drop + re-embed from SQLite; `embedding` is never the source of
  truth and is never synced.

---

## 7. Device-local config (never in the log)

Settings and secrets are **not** domain events and are **not** synced by default
— they stay device-local, outside the event log.

| Data | Today | Target | Synced? |
|------|-------|--------|:--:|
| Reader settings (`theme`, `fontSize`, `lineSpacing`, `readingMode`) | `localStorage['read-aware-reader-settings']` | `app_settings` row (or keep in a local KV) | No (device-local). Optional later: a `settings.changed` event stream if cross-device sync is wanted. |
| AI provider config (`provider`, `apiKey`, `model`, `customBaseUrl`) | `localStorage['read-aware-ai-config']` (**plaintext key**) | OS keychain / secure store for the key; non-secret fields in `app_settings` | **Never.** Secret. Move off plaintext localStorage. |

```sql
-- Optional local KV for non-secret device config (not synced, not in the log).
CREATE TABLE app_settings (
  key   TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL              -- JSON
);
```

---

## 8. Mapping from the current storage

What ships today → where it lands in the target. (Today's stores live in each
feature's `lib/`; see `library-db.ts`, `annotation-db.ts`, `reader-settings.ts`,
`ai-config.ts`.)

| Today (IndexedDB / localStorage) | Target |
|----------------------------------|--------|
| `read-aware-library` › `books` (`LibraryBook`) | derived from `book.imported` / `book.metadataEdited` / `book.removed` → `book`; reading position → `reading_position`; cover data URL → `blob` (kind `cover`) + `book.cover_blob_key` |
| `read-aware-library` › `files` (`StoredBookFile.blob`) | blob store + `blob` registry (kind `source`); `book.source_blob_key` |
| `LibraryBook.coverUrl` / `coverChecked` | `book.cover_blob_key` (null = none); the "checked" flag becomes "a `cover` blob exists or import recorded none" |
| `LibraryBook.progress` (`ReaderProgress`) | `reading_position` (locator = `cfi`/`href`, plus current/total/percent/status) |
| `read-aware-annotations` › `annotations` (`Highlight`) | `highlight.created`/`removed` → `highlight` (`cfiRange`→`anchor`) |
| …`annotations` (`Note`) | `note.created`/`updated`/`removed` → `note` (`content`→`body`) |
| …`annotations` (`AIChat` + `messages[]`) | `aichat.started`/`messageAppended` → `ai_chat` + `ai_chat_message` |
| `read-aware-reader-settings` | `app_settings` (device-local) — see [§7](#7-device-local-config-never-in-the-log) |
| `read-aware-ai-config` | secure store (key) + `app_settings` (non-secret) — see [§7](#7-device-local-config-never-in-the-log) |

Naming reconciliation: today's annotation `cfiRange` → core `anchor`; `Note.content`
→ core `body`; the annotations table's `type` discriminator splits into the typed
tables `highlight` / `note` / `ai_chat`.

---

## 9. Sync model

- **Unit of sync = events.** Only `event_log` rows cross the wire. Projections,
  the vector index, and device-local config are never synced — each device
  rebuilds projections from the merged log.
- **Merge = HLC order.** Pulled events are appended and projections re-applied in
  `(hlc_wall_ms, hlc_counter, hlc_device)` order. Same log everywhere ⇒ identical
  projections.
- **Blobs sync separately.** Book files / derivatives move as large (E2E-encrypted)
  blobs keyed by `blob.key`, referenced from synced events; a new device
  bootstraps by pulling the log, then lazily fetching blobs on demand.
- **E2E by default.** The server stores ciphertext only and cannot run
  server-side search or feed a thin web client — a conscious tradeoff
  (`CLAUDE.md` › *Context Portability*). Revisit only if a richer server-backed
  web client becomes a priority.
- **Change feed.** The backend exposes "events after HLC X" so devices catch up
  incrementally; `projection_checkpoint` tracks local apply progress.

---

## 10. Open decisions

- **Reader settings: synced or device-local?** Defaulting to device-local
  ([§7](#7-device-local-config-never-in-the-log)). Promote to a `settings.changed`
  event stream only if users expect settings to follow them across devices.
- **Progress: event vs. high-frequency projection.** `reading.progressed` can be
  chatty. Options: debounce emission (already debounced in the UI), or keep a
  fast-moving local `reading_position` and only emit a coarse event on
  session-end / chapter change. Needs a rule so the log doesn't bloat.
- **Memory schema depth.** [§5.2](#52-memory-long-term--working) is a starting
  point; decay function, conflict-resolution policy, and entity-resolution
  thresholds are pipeline decisions to spec separately.
- **Context bundle retention.** How many versions to keep per `bundle_key` before
  pruning (vs. full reproducibility from the log).
- **`per-user` scoping.** Single-user on-device today; if multi-profile is ever
  needed, add `user_id` to the scoped tables and to event payloads.

---

*Implementation (StorageAdapter for desktop/web, projection builders, IndexedDB→
SQLite migration) is deferred — see the status note at the top.*
