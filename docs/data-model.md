# ReadAware — Local Data Model & Schema (Design)

> **Status:** Decided direction; the sync foundation is **now live on desktop**
> (2026-07). The Tauri app persists to SQLite; schema migration v3 brings the
> live database to this document's sync shape: `domain_events` (full envelope) +
> `event_sync_state` / `blob_sync_state` outboxes + the `blob_objects` registry,
> with blob **bytes on the filesystem** (`<app_data>/blobs/`), WAL journaling,
> and a stable `local_device` identity. Events are **dual-written** from every
> UX persistence seam (library, annotations, reading time), and a boot-time
> **genesis reconciliation** synthesizes creation events for any projection row
> the log has never seen (pre-event-era data, old backup restores). Still not
> built: the relay itself, projection replay/rebuild from the log, and the
> normalized projection tables (the interim denormalized `books`/`annotations`
> tables from migration v2 remain the read models; [§8](#8-mapping-from-the-current-storage)
> documents the remaining mapping).
>
> **Single source of truth for the schema is
> [`docs/sqlite-schema.sql`](./sqlite-schema.sql)** — the exact, field-level DDL
> with per-column comments. The **event catalog's source of truth is
> [`packages/core/src/events.ts`](../packages/core/src/events.ts)**, and the
> domain types are [`packages/core/src/entities.ts`](../packages/core/src/entities.ts).
> **This document is conceptual prose only** — it deliberately contains no
> `CREATE TABLE` DDL, so it can never drift from the `.sql`. When the two
> disagree, the `.sql` (for tables) and `events.ts` (for events) win.
>
> Aligns with `CLAUDE.md` › *AI Architecture Decisions*.

## Table of contents

1. [Principles](#1-principles)
2. [Layered model](#2-layered-model)
3. [The event log — the source of truth](#3-the-event-log--the-source-of-truth)
4. [Event catalog](#4-event-catalog)
5. [Projection tables (SQLite)](#5-projection-tables-sqlite)
6. [Vector index (LanceDB)](#6-vector-index-lancedb)
7. [Device-local config (never in the log)](#7-device-local-config-never-in-the-log)
8. [Mapping from the current storage](#8-mapping-from-the-current-storage)
9. [Sync model & the rebuild contract](#9-sync-model--the-rebuild-contract)
10. [Open decisions](#10-open-decisions)

---

## 1. Principles

- **Local-first.** Data and retrieval live on-device. The network is for sync
  and (optional) remote inference, never for core reads/writes.
- **Two independent axes.** *Data + retrieval = local* (SQLite incl. FTS —
  **no vector store in the default architecture**, see [§6](#6-vector-index-lancedb));
  *LLM inference = remote* (BYO key / proxy). Keep them separate.
- **Event-sourced.** The append-only **event log (`domain_events`) is the true
  source of truth** and the **unit of sync**. Every structured table (and any
  derived index) is a **deterministic projection rebuilt from the log** —
  projections are recomputed on-device and never synced directly.
- **The backend is sync + relay only.** It stores the (preferably E2E-encrypted)
  event log + large blobs and exposes a change feed. It holds no business logic.
  *The cloud relay is not built yet; the schema provisions for it but the app is
  fully usable with sync disabled.*
- **Reach storage through a `StorageAdapter`** (native FS/blob store + SQLite
  in the Tauri desktop app).

### Conventions

- IDs are UUID strings (`TEXT`). Timestamps are **ISO-8601 UTC strings**
  (`TEXT`) everywhere, with the **one documented exception** that *durations*
  are epoch-millisecond `INTEGER`s (e.g. `reading_time_*.total_ms`, HLC
  `wall_ms`). There are no mixed-affinity timestamp columns.
- SQLite types used: `TEXT`, `INTEGER`, `REAL`. Booleans are `INTEGER` (0/1).
  Structured payloads are JSON in `*_json TEXT` columns.
- Every table in the `.sql` is tagged with one of four **classes** (see
  [§9](#9-sync-model--the-rebuild-contract)): `[synced log]`, `[projection]`,
  `[device-local]`, `[local index]`. The class governs whether it syncs and
  whether a projection rebuild may touch it.

---

## 2. Layered model

```
                          remote backend (sync + relay only — NOT BUILT YET)
                 ┌─────────────────────────────────────────────┐
                 │  encrypted event log replica · blobs · feed  │
                 └───────────────▲─────────────────────┬────────┘
                          push/pull events             │ blobs
ON DEVICE                       │                      │
┌───────────────────────────────┴──────────────────────┴───────────────────┐
│  EVENT LOG  (append-only, immutable, HLC-ordered)   ← source of truth      │
│             domain_events — the ONLY thing that is synced                   │
└───────────────┬───────────────────────────────────────────────────────────┘
                │ deterministic, on-device replay (UPSERT/merge by stable id)
   ┌────────────┼───────────────────────────────┬──────────────────────────┐
   ▼            ▼                                ▼                          ▼
 SQLite      SQLite                          SQLite                    (optional
 core        memory                          context bundles           fallback only:
 projections (long-term, working)            (versioned)               vector index —
 (books,     ──────────────────              ──────────────            NOT in default
 highlights, promotion / decay /             user_profile_context,     build, see §6)
 notes,      conflict-res / dedup            book_memory_context, …
 progress)
```

- **Raw events** — append-only, immutable. The unit of sync.
- **Working memory** — short-horizon projection for the active reading session.
- **Long-term user memory** — consolidated, decayed, deduped projection.
- **Book / highlight / note memory** — per-artifact projection.
- **Context bundles** — exportable, versioned projections assembled for a moment.

Everything below the event log is rebuildable; only the log is canonical.
*Device-local config (settings, per-book overrides, sync state) is **not** in
this picture — it lives beside the projections but is never derived from the log
(see [§7](#7-device-local-config-never-in-the-log)).*

---

## 3. The event log — the source of truth

One append-only table, `domain_events` (see the `.sql` for exact columns).
Order is a **Hybrid Logical Clock** `(hlc_wall_ms, hlc_counter, hlc_device)` so
two device logs merge deterministically; a `UNIQUE` index on that triple gives a
total causal order. Matches `DomainEventEnvelope` + `HlcStamp` in
`packages/core/src/events.ts`.

Rules:

- **Immutable & append-only.** Never `UPDATE`/`DELETE` a row. Corrections are new
  events (`*.metadataEdited`, `*.removed`, `*.recolored`, …).
- **Never repurpose a `type`'s payload shape.** Bump `schema_version` and add a
  new payload variant instead; replay of historical events must never break.
- **Per-event sync state is a side table** (`event_sync_state`), so tracking
  push/retry never mutates the immutable log.
- **`readEventsSince(after?: HlcStamp)`** reads `WHERE (hlc_wall_ms, hlc_counter,
  hlc_device) > after` in HLC order.
- **`projection_checkpoints`** records how far each projection has consumed the
  log, so projections update incrementally and can be rebuilt from zero.

Every column a projection marks `NOT NULL` must be derivable from some event
payload (or the envelope's HLC wall time). The event payloads in `events.ts`
were sized to satisfy exactly that — e.g. `book.imported` carries
`fileName`/`fileSize` because `books.file_name`/`file_size` are `NOT NULL`.

---

## 4. Event catalog

Canonical definitions live in `packages/core/src/events.ts` (the `DomainEvent`
union). Naming is `aggregate.verbInPast` (dot + camelCase). Timestamps for
projections come from the envelope `createdAt` — which defaults to the HLC wall
time, and diverges from it only on genesis-synthesized events, which carry the
row's historical timestamp while their HLC is stamped at synthesis time.

| Type | Payload (JSON, summarized) |
|------|----------------------------|
| `book.imported` | `{ bookId, title, author?, format, fileName, mimeType?, fileSize, sourceBlobKey, sourceSha256? }` |
| `book.metadataEdited` | `{ bookId, title?, author? }` |
| `book.coverExtracted` | `{ bookId, status, coverBlobKey? }` |
| `book.opened` | `{ bookId }` → drives `books.last_opened_at` |
| `book.starred` | `{ bookId, starred }` |
| `book.removed` | `{ bookId }` (tombstone) |
| `collection.created` / `collection.renamed` / `collection.removed` | `{ collectionId, name? }` |
| `book.addedToCollection` / `book.removedFromCollection` | `{ bookId, collectionId }` (set semantics → reconstructable as many-to-many later) |
| `reading.progressed` | `{ bookId, locator, chapterHref?, currentLocation?, totalLocations?, progressPercent?, status? }` |
| `reading.timeRecorded` | `{ bookId, ms, atEpochMs, localDay, localHour }` — day/hour buckets are stamped at **record** time in the recording device's timezone; deriving them at replay time would shift history across timezones |
| `highlight.created` | `{ highlightId, bookId, anchor?, chapterHref?, text, color?, style? }` |
| `highlight.recolored` | `{ highlightId, color, style? }` |
| `highlight.removed` | `{ highlightId }` |
| `note.created` | `{ noteId, bookId, highlightId?, anchor?, chapterHref?, quotedText?, body }` |
| `note.updated` / `note.removed` | `{ noteId, body? }` |
| `ask.recorded` / `ask.removed` | `{ askId, bookId, anchor?, chapterHref?, text }` / `{ askId }` — passive traces of the book thread (agent-architecture §7) |
| `aiConversation.started` | `{ conversationId, bookId, title? }` |
| `aiMessage.appended` | `{ messageId, conversationId, role, seq, content, model?, attachments? }` |
| `aiConversation.cleared` | `{ conversationId }` |
| `profile.updated` | `{ displayName?, traits? }` |
| `entity.resolved` / `entity.merged` | `{ entityId, … }` / `{ keepId, mergedId }` |
| `memory.promoted` | `{ memoryId, kind, scope?, bookId?, entityId?, subject?, content, importance?, confidence?, evidence[] }` |
| `memory.revised` / `memory.superseded` / `memory.feedback` / `memory.forgotten` | see `events.ts` |

> **Consolidation as events.** Memory promotion/decay/conflict-resolution
> decisions are themselves events (`memory.*`), so the memory projection is
> reproducible and syncable. The *derivation logic* runs on-device; the
> *outcomes* are logged.
>
> **Producer status.** Book / collection / annotation / ask / reading events are
> **live**: the UX persistence seams dual-write them (event first, projection
> second), and boot-time genesis reconciliation backfills creation events for
> rows that predate the write path. AI-conversation events await the chat
> layer's move off localStorage. `profile.*`, `entity.*`, and `memory.*` are
> declared so the projection tables are well-defined, but **have no producer
> yet** — the consolidation pipeline is future work ([§10](#10-open-decisions)).

---

## 5. Projection tables (SQLite)

All `[projection]` tables are rebuildable from the log; see the `.sql` for exact
columns. This section describes intent only.

### 5.1 Core reading model

Mirrors `packages/core/src/entities.ts`.

- **`books`** — the shelf read-model. `cover_status` (`unchecked`/`ready`/`none`/
  `failed`) + `cover_blob_key` replace the old `coverChecked` + `coverUrl` pair;
  `starred`, `last_opened_at`, and a `removed_at` tombstone drive shelf sorting
  and soft-delete. Original bytes live in the blob store, referenced by
  `source_blob_key`.
- **`collections`** + **`book_collection_memberships`** — a book belongs to at
  most one collection today (`memberships` is keyed by `book_id`). The underlying
  events are additive set operations, so widening to many-to-many later is a
  projection change, not a data migration.
- **`reading_positions`** — one current position per book (`cfi`/`href` +
  `current/total_locations` + `progress_percent` + `reading_status`), updated by
  `reading.progressed` / `book.opened`.
- **`reading_time_totals` / `_daily` / `_hourly`** — active-reading-time
  aggregates rebuilt from `reading.timeRecorded`. Durations are `INTEGER` ms;
  the timestamp columns are ISO-8601 `TEXT` like everywhere else.
- **`highlights`** / **`notes`** — annotations. `cfiRange` → `anchor`,
  `Note.content` → `body`. A highlight's `anchor` may be null for unanchorable
  formats; a note always belongs to a book (`book_id NOT NULL`), matching
  `events.ts`.
- **`asks`** — passive traces of the book thread (one row per question asked;
  agent-architecture §7), rebuilt from `ask.recorded` / `ask.removed`. Written
  by the agent runtime, not the user.

### AI conversation (one persistent thread per book)

The product model is **one persistent conversation per book** — not a thread per
selection. `ai_conversations` is keyed `UNIQUE(book_id)`; `ai_messages` holds the
turns (`seq`-ordered), and `ai_message_attachments` holds the selection chips
that "Ask AI about this" attaches to a user message. *Clearing* a conversation
sets `cleared_at` and wipes its messages **in place** (the row and its id are
kept), so the `started` projection must upsert/lookup by book and never blind-
insert a fresh id.

### 5.2 Memory (long-term + working)

The hard half (per CLAUDE.md): the write/consolidation pipeline is modeled as
explicitly as retrieval. Tables (all forward-looking, no producer yet):

- **`entities`** + **`entity_aliases`** — resolved entities behind "repeated
  appearance across books/conversations"; `entities.merged_into_id` records an
  `entity.merged`.
- **`memories`** — the consolidated statement plus retrieval signals
  (`importance`, `confidence`, `recency_at`, `hit_count`, `pinned`, `status`,
  `superseded_by`) so retrieval can blend similarity with relevance, recency,
  importance, and explicit feedback — not similarity alone.
- **`memory_evidence`** — provenance: which events/artifacts support a memory
  (dedup + audit).
- **`working_memory`** — short-horizon, decaying projection for the active
  session (`salience`, `expires_at`); cheap to rebuild/discard.

### 5.3 Context bundles (versioned, exportable)

**`context_bundles`** keeps a version history per `bundle_key` (`type` +
`scope_id`), so exports are reproducible; **`context_bundle_items`** records the
ranked sources behind each version. External agents read the structured
`content_json`, never the raw transcript. (Forward-looking.)

### 5.4 Blob registry

Large bytes (book files, covers, font faces) live in the blob store on the
filesystem via `StorageAdapter.putBlob/getBlob` — **never in a SQLite column**.
**`blob_objects`** is the on-device index of them (`kind`, `mime_type`,
`byte_size`, `sha256`, `storage_uri`, `sync_required`, soft-delete `deleted_at`).
It is a `[device-local]` authoritative registry of local storage facts, *not* a
projection — a projection rebuild must not touch it.

### 5.5 Full-text index (FTS5) — the default retrieval

**Live since desktop migration v4.** Default retrieval is **FTS + structured
signals** (no vector store); `annotations_fts` is the first index —
highlights/notes/asks text, `[local index]` class (droppable, rebuildable,
never synced), maintained by triggers, ranked by BM25.

**CJK contract** (the part that is easy to get wrong):

- fts5's `unicode61` tokenizer does not segment CJK — a han run becomes one
  giant token, so "习惯" would never match "养成好习惯". The `trigram`
  tokenizer handles substrings but needs **≥ 3 chars per query**, while the
  most common Chinese query is a **2-char word**.
- So text is **pre-segmented into overlapping CJK bigrams** by
  `ra_fts_segment`, a SQL function the storage layer registers on every
  connection ("养成好习惯" → `养成 成好 好习 习惯`); non-CJK words pass through
  whole. Queries run through the same segmentation (`fts_match_expr`): a CJK
  run becomes a quoted **phrase** of its bigrams (they are consecutive tokens),
  a lone CJK char or an English word becomes a quoted **prefix** token
  (`"习"*` hits the bigram 习惯, `"hab"*` hits "habits"). Quoting everything
  also neutralizes fts5 operators in user input.
- Consequence: writes to the indexed tables from a bare `sqlite3` shell fail
  (no `ra_fts_segment`); use the app connection, or drop + repopulate.

**Rebuild recipe** (also the repair path): `DELETE FROM annotations_fts;
INSERT INTO annotations_fts SELECT … ra_fts_segment(text) … FROM annotations;`

`memories_fts` and `ai_messages_fts` follow the same contract when those
tables gain producers.

---

## 6. Vector index (LanceDB)

> **Not in the default architecture** (decided 2026-07-02, see
> `docs/agent-architecture.md` §4). Default retrieval is SQLite FTS +
> scope/recency/importance signals + agentic iterative search. This section is
> retained as the spec for the **optional upgrade path** — if FTS ever proves
> insufficient, embed memories + annotations first, full text last. The
> `vector_documents` / `embedding_jobs` tables stay in the schema as dormant
> provisions.

A **derived** index, rebuilt on-device — never the primary store.
**`vector_documents`** is the SQLite-side manifest (source, `content_hash`,
`embedding_model`/`dimension`, `lance_table`, `indexed_at`/`stale_at`); the
vectors themselves live in LanceDB. **`embedding_jobs`** is the local work queue.

- **Indexed:** long-term memories, working memories, highlights, notes, AI
  messages, book sections — anything retrievable.
- **Metadata-rich** so retrieval can blend similarity with the
  [§5.2](#52-memory-long-term--working) signals.
- **Rebuild:** drop + re-embed from SQLite; the embedding is never the source of
  truth and is never synced. Mirrors `VectorItem` / `VectorMatch` in
  `storage.ts`. (Forward-looking — no producer yet.)

---

## 7. Device-local config (never in the log)

Settings and secrets are **not** domain events and are **not** synced by default
— they stay device-local, outside the event log, and are **never recreated by a
projection rebuild**.

- **`settings`** — a single-row (`CHECK(id=1)`) table of **stable, validated**
  preferences as typed columns (General / Appearance / Reading / AI features &
  privacy / shelf view / panel widths). Adding a stable setting is an additive
  `ADD COLUMN DEFAULT` (non-destructive).
- **`app_kv`** — a key/value escape hatch for **high-churn or experimental**
  flags that aren't worth a typed column yet, so they don't each require a
  schema migration. Promote to a typed `settings` column once stable.
- **`shortcut_bindings`** — per-action keybinding overrides; absent ids use the
  code defaults.
- **`ai_provider_configs`** — BYOK model connection config. Non-secret fields
  (`provider`, `model`, `custom_base_url`) live here; the **API key lives in the
  OS Keychain**, and SQLite stores only `api_key_ref`. Keyed by a `TEXT` id with
  `role` (`chat`/`embedding`) + `is_default`, so a separate embedding provider
  (only relevant if the optional vector fallback in [§6](#6-vector-index-lancedb)
  is ever adopted) costs nothing — even if v1 configures one row.
- **`reader_book_overrides`** / **`reader_panel_layouts`** — per-book appearance
  and panel state. These reference `books` only *logically* (no enforced FK) so a
  projection rebuild of `books` can never cascade-delete this non-derivable local
  state (see [§9](#9-sync-model--the-rebuild-contract)).

**AI provider key:** today's `read-aware-ai-config` stores the API key in
**plaintext localStorage** — that must move to the Keychain on migration and
**never** enter SQLite.

---

## 8. Mapping from the current storage

What ships today → where it lands in the target. (Today's stores live in each
feature's `lib/`; see `library-db.ts`, `annotation-db.ts`, `reader-settings.ts`,
`ai-config.ts`, the reading-stats / conversations / fonts modules.)

| Today (IndexedDB / localStorage) | Target |
|----------------------------------|--------|
| `read-aware-library` › `books` (`LibraryBook`) | `book.imported` / `metadataEdited` / `coverExtracted` / `starred` / `removed` → `books`; position → `reading_positions`; cover bytes → `blob_objects` (kind `cover_image`) + `books.cover_blob_key` |
| `read-aware-library` › `files` (`StoredBookFile.blob`) | blob store + `blob_objects` (kind `book_source`); `books.source_blob_key` |
| `LibraryBook.coverUrl` / `coverChecked` | `books.cover_blob_key` (null = none) + `cover_status` |
| `LibraryBook.progress` (`ReaderProgress`) | `reading_positions` (cfi/href + current/total/percent/status) |
| `read-aware-library` › `collections` (`Collection`) | `collection.*` / `book.addedToCollection` → `collections` + `book_collection_memberships` |
| `read-aware-reading-stats` (`totalMs`/`byHour`/`daily`/…) | `reading.timeRecorded` → `reading_time_totals` / `_daily` / `_hourly` |
| `read-aware-annotations` › highlights (`Highlight`, `cfiRange`) | `highlight.created`/`recolored`/`removed` → `highlights` (`cfiRange`→`anchor`) |
| …notes (`Note`, `content`) | `note.created`/`updated`/`removed` → `notes` (`content`→`body`) |
| `read-aware-conversations` (`bookId → messages[]`) | `aiConversation.started` / `aiMessage.appended` → `ai_conversations` (one per book) + `ai_messages` + `ai_message_attachments` |
| `read-aware-fonts` (font `ArrayBuffer`) | `cached_font_faces` + `blob_objects` (kind `font_face`); `sync_required = 0` |
| `read-aware-reader-settings` / `-app-settings` / `-general-settings` / `-ai-preferences` / `-shelf-view` | `settings` typed columns (high-churn flags → `app_kv`) — see [§7](#7-device-local-config-never-in-the-log) |
| `read-aware-shortcuts` | `shortcut_bindings` |
| `read-aware-reader-panels` + dragged panel widths | `reader_panel_layouts` + `settings.toc_panel_width_px` / `chat_panel_width_px` |
| per-book appearance scope | `reader_book_overrides` |
| `read-aware-ai-config` | Keychain (key) + `ai_provider_configs` (non-secret) — see [§7](#7-device-local-config-never-in-the-log) |

Naming reconciliation: today's annotation `cfiRange` → `anchor`; `Note.content`
→ `body`; the annotations table's `type` discriminator splits into the typed
tables `highlights` / `notes` / `ai_conversations`.

---

## 9. Sync model & the rebuild contract

### Table classes

| Class | Synced? | Rebuilt from log? | Examples |
|-------|:--:|:--:|----------|
| `[synced log]` | **yes** | n/a (it *is* the source) | `domain_events` |
| `[projection]` | no | **yes** | `books`, `highlights`, `notes`, `memories`, `context_bundles` |
| `[device-local]` | no | **no** (authoritative local) | `settings`, `ai_provider_configs`, `reader_book_overrides`, `blob_objects`, `sync_*`, `event_sync_state` |
| `[local index]` | no | rebuilt from SQLite, not the log | `vector_documents`, `cached_font_faces` |

### Sync

- **Unit of sync = events.** Only `domain_events` rows cross the wire.
  Projections, the vector index, and device-local config are never synced.
- **Merge = HLC order.** Pulled events are appended and projections re-applied in
  `(hlc_wall_ms, hlc_counter, hlc_device)` order. Same log everywhere ⇒ identical
  projections.
- **Blobs sync separately**, keyed by `blob_objects.key`, tracked by
  `blob_sync_state`; a new device bootstraps from the log, then lazily fetches
  blobs.
- **Blob bootstrap contract.** `books.source_blob_key` (and every other
  blob-key FK) points at `blob_objects`, which is `[device-local]` — so on a
  fresh device, replay must **materialize the blob manifest row first**:
  when an event referencing a blob key is applied (e.g. `book.imported`'s
  `sourceBlobKey`), upsert a `blob_objects` row with `storage_uri = NULL`
  ("known remotely, not fetched") before or with the projection row, then let
  the blob fetcher fill in the bytes and the `storage_uri` lazily. A `NULL`
  `storage_uri` therefore means *not present on this device* — readers treat
  it as a cache miss, never an error.
- **E2E envelope (decided 2026-07).** The relay stores ciphertext only, and the
  **encrypted envelope covers everything that describes behavior**: `type`,
  `schema_version`, `aggregate_type`/`aggregate_id`, `payload_json`,
  `created_at`. If only the payload were encrypted, the plaintext event types
  alone would hand the relay a complete timeline of reading activity. The
  relay sees just what routing needs: event `id`, `hlc_device`, its own server
  sequence, ciphertext size. (Relay itself not built yet; this contract is
  fixed now so `event_sync_state`/the feed aren't designed against a leakier
  shape.)
- **Change feed.** "events after HLC X"; `projection_checkpoints` tracks local
  apply progress.
- **Deterministic replay caveats.** Anything a projection derives must not
  depend on replay-time environment: `reading_time_daily/hourly` bucket by the
  `localDay`/`localHour` **carried in the event payload** (never recomputed
  from `atEpochMs` in the current timezone), and `ai_messages.seq` is assigned
  from HLC order on conflict (two offline devices can mint the same seq; the
  event-carried seq is a hint, the HLC is the truth).

### The rebuild contract

A projection rebuild applies events by **`UPSERT`/merge keyed by the stable
entity id — never `DROP`/`DELETE`-then-reinsert**, and touches **only
`[projection]` tables**. Two consequences make this safe:

1. `[device-local]` and `[local index]` tables are excluded from rebuild, so
   non-derivable local state (per-book overrides, panel layouts, blob registry,
   sync outbox) survives untouched.
2. The two device-local satellites that key on a book id
   (`reader_book_overrides`, `reader_panel_layouts`) deliberately carry **no
   enforced FK** to `books`, so even a hypothetical `DELETE FROM books` can't
   cascade into them. Orphan rows (book removed) are harmless and cleaned
   opportunistically.

### FK enforcement (integration requirement)

`PRAGMA foreign_keys` is **per-connection** and not persisted in the file. The
StorageAdapter **must** re-issue `PRAGMA foreign_keys = ON` on every connection
(and assert it in a startup self-check), or all the `ON DELETE` actions become
silent no-ops. Cross-aggregate FKs (everything referencing `blob_objects`,
`memberships → collections`, the memory cross-refs) are
`DEFERRABLE INITIALLY DEFERRED` so bulk migration / replay can insert in any
order within a transaction.

---

## 10. Open decisions

- **Progress: event vs. high-frequency projection.** `reading.progressed` can be
  chatty. Today the UI debounces; the long-term rule (coarse event on
  session-end / chapter change vs. fast local `reading_positions` + periodic
  event) still needs to be fixed so the log doesn't bloat.
- **Memory pipeline depth.** [§5.2](#52-memory-long-term--working) tables are
  defined but unproduced; the decay function, conflict-resolution policy, and
  entity-resolution thresholds are pipeline decisions to spec separately before
  the `memory.*` / `entity.*` producers are built.
- **Context bundle retention.** How many versions to keep per `bundle_key`
  before pruning (vs. full reproducibility from the log).
- **`per-user` scoping.** Single-user on-device today; multi-profile would add a
  `user_id` to scoped tables and event payloads (cheap, because projections
  rebuild). `domain_events.actor_id` already defaults to `'local'` so historical
  events stay attributable.

### Resolved (previously open)

- **Reader settings are device-local**, in the typed `settings` table (+ `app_kv`
  for experimental flags), not the event log — promote to a `settings.changed`
  event stream only if cross-device settings sync is ever wanted.
- **AI provider config supports multiple roles** (`chat` / `embedding`) via
  `ai_provider_configs.role` + `is_default`, instead of a single hard-coded row.

---

*Implementation (StorageAdapter for desktop, projection builders, IndexedDB→
SQLite migration) is deferred — see the status note at the top.*
