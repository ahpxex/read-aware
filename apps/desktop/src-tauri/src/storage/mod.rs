// Local-first storage backend (desktop) — SQLite + filesystem blob store.
//
// This is the desktop implementation of @read-aware/core's storage contracts.
// `domain_events` is the append-only source of truth and the unit of sync;
// the typed tables (books/collections/annotations) are projections kept in
// step by the frontend's dual writes. Blob BYTES live on the filesystem under
// `<app_data>/blobs/`; SQLite holds only the `blob_objects` registry (key,
// kind, sha256, size, storage_uri) — see docs/sqlite-schema.sql.
//
// Retrieval is FTS + structured signals per docs/agent-architecture.md §4 —
// there is no vector store in the default architecture.

use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

/// Hybrid logical clock stamp. Mirrors `HlcStamp` in @read-aware/core.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hlc {
    pub wall_ms: i64,
    pub counter: i64,
    pub device_id: String,
}

/// One row of the append-only event log. Mirrors `DomainEventEnvelope`.
/// The optional fields default at insert time (`schema_version` 1, `actor_id`
/// 'local', `created_at` derived from the HLC wall time).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRow {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub hlc: Hlc,
    #[serde(default)]
    pub schema_version: Option<i64>,
    #[serde(default)]
    pub aggregate_type: Option<String>,
    #[serde(default)]
    pub aggregate_id: Option<String>,
    #[serde(default)]
    pub actor_id: Option<String>,
    #[serde(default)]
    pub origin: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    pub payload: Value,
}

/// Managed Tauri state: the single SQLite connection behind a mutex.
pub struct Db(pub Mutex<Connection>);

/// Managed Tauri state: the app-data directory. Blob bytes live in
/// `<data_dir>/blobs/`; `blob_objects.storage_uri` is relative to this root.
pub struct DataDir(pub PathBuf);

/// Ordered schema migrations. Each `(version, name, sql)` is applied once, in
/// version order, inside a transaction, and recorded in `schema_migrations`.
///
/// Rules: never edit an already-shipped migration's SQL (users have applied it);
/// evolve the schema by appending a new `(version, ...)` entry. Statements are
/// `IF NOT EXISTS` so first-run on a database created by the old ad-hoc
/// `init_db` (bare `events`/`blobs`) is idempotent and never wipes data.
const MIGRATIONS: &[(i64, &str, &str)] = &[
    (
        1,
        "core_local_first_tables",
        "CREATE TABLE IF NOT EXISTS events (
            id          TEXT PRIMARY KEY,
            type        TEXT NOT NULL,
            hlc_wall    INTEGER NOT NULL,
            hlc_counter INTEGER NOT NULL,
            hlc_device  TEXT NOT NULL,
            payload     TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_events_hlc
            ON events (hlc_wall, hlc_counter, hlc_device);
         CREATE TABLE IF NOT EXISTS blobs (
            key  TEXT PRIMARY KEY,
            data BLOB NOT NULL
         );
         -- [device-local] this install's identity (single-row).
         CREATE TABLE IF NOT EXISTS local_device (
            id             INTEGER PRIMARY KEY CHECK (id = 1),
            device_id      TEXT NOT NULL,
            display_name   TEXT,
            created_at     TEXT NOT NULL,
            last_opened_at TEXT NOT NULL
         );
         -- [device-local] key/value config store. Backs the synchronous settings
         -- seam (localKV): every `read-aware-*` preference is one row of JSON.
         CREATE TABLE IF NOT EXISTS app_kv (
            key        TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );",
    ),
    (
        2,
        "library_annotation_projections",
        // v1-runtime tables. Typed columns for everything the app queries/sorts.
        // Pragmatic deviations from the normalized event-sourced target
        // (docs/sqlite-schema.sql), documented so the drift is intentional:
        //   - `books` is denormalized: progress (as JSON) and collection_id live
        //     inline instead of in reading_positions / book_collection_memberships,
        //     mirroring the interim LibraryBook shape for a zero-risk swap.
        //   - covers stay inline data URLs (`cover_url`); only the large book file
        //     goes to the blob store (key `bookfile:<id>`).
        //   - highlights + notes share one typed `annotations` table (the current
        //     unified store), not separate highlights/notes tables.
        //   - no cross-table FKs yet (matches the current FK-less IndexedDB).
        "CREATE TABLE IF NOT EXISTS books (
            id               TEXT PRIMARY KEY,
            title            TEXT NOT NULL,
            author           TEXT NOT NULL,
            format           TEXT NOT NULL,
            file_name        TEXT NOT NULL,
            mime_type        TEXT,
            file_size        INTEGER NOT NULL,
            cover_url        TEXT,
            cover_checked    INTEGER NOT NULL DEFAULT 0,
            created_at       TEXT NOT NULL,
            updated_at       TEXT NOT NULL,
            last_opened_at   TEXT,
            progress_percent REAL NOT NULL DEFAULT 0,
            reading_status   TEXT NOT NULL DEFAULT 'unread',
            progress_json    TEXT,
            starred          INTEGER NOT NULL DEFAULT 0,
            collection_id    TEXT
         );
         CREATE INDEX IF NOT EXISTS ix_books_collection ON books (collection_id);
         CREATE TABLE IF NOT EXISTS collections (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            created_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS annotations (
            id           TEXT PRIMARY KEY,
            book_id      TEXT NOT NULL,
            type         TEXT NOT NULL,
            cfi_range    TEXT,
            chapter_href TEXT,
            text         TEXT NOT NULL,
            color        TEXT,
            style        TEXT,
            content      TEXT,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS ix_annotations_book_type ON annotations (book_id, type);",
    ),
    (
        3,
        "domain_events_blob_registry_outbox",
        // Cloud-readiness pass. Brings the live database up to the target
        // sync-infrastructure shape (docs/sqlite-schema.sql):
        //   - `domain_events` replaces the bare `events` table (full envelope:
        //     schema_version, aggregate, actor, created_at vs ingested_at).
        //     Existing rows (none in practice — the old log had no producers)
        //     are carried over, then the old table is dropped.
        //   - `event_sync_state` / `blob_sync_state` are the push outboxes; the
        //     sync engine (not yet built) consumes them. Rows accumulate as
        //     'pending' until then — that is the point of an outbox.
        //   - `blob_objects` is the blob registry; BYTES move out of SQLite to
        //     `<app_data>/blobs/` (see `externalize_inline_blobs`, which runs
        //     right after this migration and drops the inline `blobs` table).
        //   - On a fresh install v1 creates `events`/`blobs` and this migration
        //     immediately retires them — a harmless one-time quirk, cheaper than
        //     editing the already-shipped v1 SQL.
        "CREATE TABLE IF NOT EXISTS domain_events (
            id             TEXT PRIMARY KEY,
            type           TEXT NOT NULL,
            schema_version INTEGER NOT NULL DEFAULT 1,
            hlc_wall_ms    INTEGER NOT NULL,
            hlc_counter    INTEGER NOT NULL,
            hlc_device     TEXT NOT NULL,
            aggregate_type TEXT,
            aggregate_id   TEXT,
            payload_json   TEXT NOT NULL,
            actor_id       TEXT NOT NULL DEFAULT 'local',
            created_at     TEXT NOT NULL,
            ingested_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         );
         CREATE UNIQUE INDEX IF NOT EXISTS ix_domain_events_hlc
            ON domain_events (hlc_wall_ms, hlc_counter, hlc_device);
         CREATE INDEX IF NOT EXISTS ix_domain_events_type ON domain_events (type);
         CREATE INDEX IF NOT EXISTS ix_domain_events_aggregate
            ON domain_events (aggregate_type, aggregate_id);
         INSERT OR IGNORE INTO domain_events
            (id, type, schema_version, hlc_wall_ms, hlc_counter, hlc_device,
             payload_json, actor_id, created_at)
            SELECT id, type, 1, hlc_wall, hlc_counter, hlc_device, payload, 'local',
                   strftime('%Y-%m-%dT%H:%M:%fZ', hlc_wall / 1000.0, 'unixepoch')
            FROM events;
         DROP TABLE IF EXISTS events;
         CREATE TABLE IF NOT EXISTS event_sync_state (
            event_id   TEXT PRIMARY KEY REFERENCES domain_events(id) ON DELETE CASCADE,
            push_state TEXT NOT NULL DEFAULT 'pending',
            pushed_at  TEXT,
            remote_id  TEXT,
            last_error TEXT,
            updated_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS ix_event_sync_state_push
            ON event_sync_state (push_state, updated_at)
            WHERE push_state IN ('pending','failed');
         CREATE TABLE IF NOT EXISTS blob_objects (
            key              TEXT PRIMARY KEY,
            kind             TEXT NOT NULL,
            mime_type        TEXT,
            byte_size        INTEGER,
            sha256           TEXT,
            storage_uri      TEXT,
            sync_required    INTEGER NOT NULL DEFAULT 1,
            created_at       TEXT NOT NULL,
            last_accessed_at TEXT,
            deleted_at       TEXT
         );
         CREATE INDEX IF NOT EXISTS ix_blob_objects_kind ON blob_objects (kind);
         CREATE INDEX IF NOT EXISTS ix_blob_objects_sha256 ON blob_objects (sha256);
         CREATE TABLE IF NOT EXISTS blob_sync_state (
            blob_key   TEXT PRIMARY KEY REFERENCES blob_objects(key) ON DELETE CASCADE,
            push_state TEXT NOT NULL DEFAULT 'pending',
            pushed_at  TEXT,
            remote_uri TEXT,
            last_error TEXT,
            updated_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS ix_blob_sync_state_push
            ON blob_sync_state (push_state, updated_at)
            WHERE push_state IN ('pending','failed');",
    ),
    (
        4,
        "annotations_fts_index",
        // [local index] Full-text search over annotations (highlights, notes,
        // asks) — the retrieval half of "FTS + structured signals" (no vector
        // store; docs/agent-architecture.md §4).
        //
        // CJK handling: fts5's unicode61 tokenizer does not segment CJK (a han
        // run becomes ONE token) and trigram needs >= 3 chars per query — but
        // the most common Chinese query is a 2-char word. So text is
        // pre-segmented by `ra_fts_segment` (a registered SQL function) into
        // overlapping CJK bigrams plus plain alphanumeric words
        // ("养成好习惯" -> "养成 成好 好习 习惯"); queries run through the same
        // segmentation (see `fts_match_expr`), giving exact 2-char matches,
        // prefix matches for single CJK chars, and word/prefix for English.
        //
        // A plain fts5 table (id UNINDEXED) rather than external-content: the
        // content option couples to rowids, which VACUUM may renumber for
        // TEXT-pk tables. Deletes scan by id — fine at annotation scale.
        // Droppable/rebuildable: the DELETE+INSERT pair below is also the
        // repair recipe. Kept in sync by triggers; writes from a bare sqlite3
        // shell (no ra_fts_segment) will fail — use the app's connection.
        "CREATE VIRTUAL TABLE IF NOT EXISTS annotations_fts USING fts5(
            id UNINDEXED,
            book_id UNINDEXED,
            type UNINDEXED,
            text,
            content,
            tokenize = 'unicode61'
         );
         CREATE TRIGGER IF NOT EXISTS trg_annotations_fts_insert
         AFTER INSERT ON annotations BEGIN
            INSERT INTO annotations_fts (id, book_id, type, text, content)
            VALUES (new.id, new.book_id, new.type,
                    ra_fts_segment(new.text), ra_fts_segment(COALESCE(new.content, '')));
         END;
         CREATE TRIGGER IF NOT EXISTS trg_annotations_fts_update
         AFTER UPDATE ON annotations BEGIN
            DELETE FROM annotations_fts WHERE id = old.id;
            INSERT INTO annotations_fts (id, book_id, type, text, content)
            VALUES (new.id, new.book_id, new.type,
                    ra_fts_segment(new.text), ra_fts_segment(COALESCE(new.content, '')));
         END;
         CREATE TRIGGER IF NOT EXISTS trg_annotations_fts_delete
         AFTER DELETE ON annotations BEGIN
            DELETE FROM annotations_fts WHERE id = old.id;
         END;
         DELETE FROM annotations_fts;
         INSERT INTO annotations_fts (id, book_id, type, text, content)
            SELECT id, book_id, type, ra_fts_segment(text), ra_fts_segment(COALESCE(content, ''))
            FROM annotations;",
    ),
    (
        5,
        "memories_projection",
        // Agent long-term memory (docs/data-model.md §5.2), replacing the
        // webview-IndexedDB interim store. Pragmatic v1 of the documented
        // shape: today's runtime signals only (importance/evidence/pinned/
        // status); confidence, recency_at, superseded_by and memory_evidence
        // arrive with the consolidation pipeline that produces them.
        // Rows are soft-state: superseded/forgotten stay for auditability.
        "CREATE TABLE IF NOT EXISTS memories (
            id             TEXT PRIMARY KEY,
            scope          TEXT NOT NULL,
            kind           TEXT NOT NULL,
            content        TEXT NOT NULL,
            importance     REAL NOT NULL,
            evidence_count INTEGER NOT NULL,
            pinned         INTEGER NOT NULL DEFAULT 0,
            status         TEXT NOT NULL DEFAULT 'active',
            created_at     TEXT NOT NULL,
            updated_at     TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS ix_memories_scope_status
            ON memories (scope, status);",
    ),
    (
        6,
        "ai_chat_projections",
        // AI 对话转录（docs/sqlite-schema.sql 的 ai_conversations/ai_messages），
        // 替代 app_kv 里一个 key 装整个 conversations map 的 JSON。务实 v1，
        // 偏差有意为之：
        //   - id 即今天的存储 id（bookId 或 "__global__"），不设 book_id 列/FK
        //     （全局线程无书；与现有 FK-less 投影表一致）。
        //   - attachments/parts 内联 JSON 列，不建 ai_message_attachments 表 ——
        //     事件溯源落地时随重放一起规范化。
        //   - 无 status/model 列（流式恢复/审计特性到来时追加）。
        //   - 清空对话 = 删 messages + 在会话行留 cleared_at 墓碑（同步语义照文档）。
        "CREATE TABLE IF NOT EXISTS ai_conversations (
            id         TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            cleared_at TEXT
         );
         CREATE TABLE IF NOT EXISTS ai_messages (
            id               TEXT PRIMARY KEY,
            conversation_id  TEXT NOT NULL,
            role             TEXT NOT NULL,
            seq              INTEGER NOT NULL,
            content          TEXT NOT NULL,
            created_at       TEXT NOT NULL,
            attachments_json TEXT,
            parts_json       TEXT
         );
         CREATE UNIQUE INDEX IF NOT EXISTS ix_ai_messages_conversation_seq
            ON ai_messages (conversation_id, seq);",
    ),
    (
        7,
        "ai_message_error",
        // 消息级失败标记（失败的轮次直接显形在消息上，带内联重试）；
        // NULL = 正常消息。
        "ALTER TABLE ai_messages ADD COLUMN error TEXT;",
    ),
    (
        8,
        "domain_events_origin",
        // 事件的软件行为体来源：'user'（用户直接操作）、'agent'（阅读 agent）、
        // 'system'（后台机制）、'plugin:<id>'（插件数据 API 写入）。与 actor_id
        // （操作者身份）正交；插件写入的审计与卸载补偿都建立在这一列上。
        "ALTER TABLE domain_events ADD COLUMN origin TEXT NOT NULL DEFAULT 'user';",
    ),
    (
        9,
        "vocabulary_reading_time_projections",
        // 生词本与阅读时长的 SQLite 投影（docs/sqlite-schema.sql）：
        // 替代 app_kv 里的 read-aware-vocabulary / read-aware-reading-stats
        // JSON blob。两者的事件（vocabulary.*、reading.timeRecorded）已在
        // 日志双写；这些表是可重放的读模型。
        "CREATE TABLE IF NOT EXISTS vocabulary_entries (
            id         TEXT NOT NULL PRIMARY KEY,
            term       TEXT NOT NULL,
            language   TEXT NOT NULL,
            entry_json TEXT NOT NULL,
            context    TEXT,
            book_id    TEXT,
            book_title TEXT,
            added_at   TEXT NOT NULL,
            removed_at TEXT
         );
         CREATE INDEX IF NOT EXISTS ix_vocabulary_added
            ON vocabulary_entries (added_at);
         CREATE TABLE IF NOT EXISTS reading_time_totals (
            book_id          TEXT NOT NULL PRIMARY KEY,
            total_ms         INTEGER NOT NULL DEFAULT 0,
            first_started_at INTEGER,
            last_read_at     INTEGER
         );
         CREATE TABLE IF NOT EXISTS reading_time_daily (
            book_id   TEXT NOT NULL,
            local_day TEXT NOT NULL,
            ms        INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (book_id, local_day)
         );
         CREATE TABLE IF NOT EXISTS reading_time_hourly (
            book_id    TEXT NOT NULL,
            local_hour INTEGER NOT NULL,
            ms         INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (book_id, local_hour)
         );",
    ),
    (
        10,
        "plugin_documents",
        // 插件文档集合：插件的结构化私有数据（KV 之上、核心域之下的一层）。
        // 生命周期归插件（卸载即清）；book_id/anchor 是可选出处索引（无书籍
        // 级联——删书后文档存活，出处只是引用不是归属）。
        "CREATE TABLE IF NOT EXISTS plugin_documents (
            plugin_id  TEXT NOT NULL,
            collection TEXT NOT NULL,
            id         TEXT NOT NULL,
            json       TEXT NOT NULL,
            book_id    TEXT,
            anchor     TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (plugin_id, collection, id)
         );
         CREATE INDEX IF NOT EXISTS ix_plugin_documents_book
            ON plugin_documents (plugin_id, collection, book_id);
         CREATE INDEX IF NOT EXISTS ix_plugin_documents_updated
            ON plugin_documents (plugin_id, collection, updated_at);",
    ),
];

/// Apply migrations newer than the highest recorded version, up to `max_version`
/// (`i64::MAX` in production; tests use lower caps to stage old databases).
fn run_migrations_up_to(conn: &mut Connection, max_version: i64) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         );",
    )
    .map_err(|e| e.to_string())?;
    let current: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    for (version, name, sql) in MIGRATIONS {
        if *version > current && *version <= max_version {
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            tx.execute_batch(sql).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
                params![version, name],
            )
            .map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn run_migrations(conn: &mut Connection) -> Result<(), String> {
    run_migrations_up_to(conn, i64::MAX)
}

/// Connection baseline, applied to EVERY connection at open (none of these
/// persist in the database file):
///   - WAL: readers don't block the writer; a multi-MB blob-era import no
///     longer wrote double through a rollback journal.
///   - synchronous=NORMAL: the safe pairing with WAL (durable at checkpoint).
///   - busy_timeout: a second process (or a checkpoint) briefly holding the
///     lock waits instead of failing with SQLITE_BUSY.
///   - foreign_keys: per-connection flag; the schema's FKs are inert without it.
fn apply_connection_pragmas(conn: &Connection) -> Result<(), String> {
    // journal_mode returns the resulting mode as a row, so query it.
    conn.query_row("PRAGMA journal_mode = WAL", [], |row| {
        row.get::<_, String>(0)
    })
    .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;
         PRAGMA foreign_keys = ON;",
    )
    .map_err(|e| e.to_string())
}

// --- FTS segmentation (CJK bigrams + word tokens) -----------------------------

/// CJK scripts that unicode61 cannot segment into words: Han (+ extensions),
/// kana, hangul. Everything else goes through the plain word path.
fn is_cjk(c: char) -> bool {
    matches!(u32::from(c),
        0x3400..=0x4DBF   // CJK ext A
        | 0x4E00..=0x9FFF // CJK unified
        | 0xF900..=0xFAFF // CJK compat
        | 0x20000..=0x2FA1F // CJK ext B..F + compat supplement
        | 0x3040..=0x30FF // hiragana + katakana
        | 0x31F0..=0x31FF // katakana phonetic extensions
        | 0xAC00..=0xD7AF // hangul syllables
        | 0x1100..=0x11FF // hangul jamo
    )
}

/// Emit a CJK run as overlapping bigrams ("养成好习惯" → 养成/成好/好习/习惯);
/// a lone char stays a single token so 1-char runs remain searchable.
fn flush_cjk_run(tokens: &mut Vec<String>, run: &mut Vec<char>) {
    match run.len() {
        0 => {}
        1 => tokens.push(run[0].to_string()),
        n => {
            for i in 0..n - 1 {
                tokens.push(run[i..i + 2].iter().collect());
            }
        }
    }
    run.clear();
}

/// Split text into FTS tokens: CJK runs become overlapping bigrams, other
/// alphanumeric runs stay whole words, everything else separates. unicode61
/// then tokenizes the emitted stream verbatim (plus its own case/diacritic
/// folding), so bigrams land as consecutive tokens — which is what lets the
/// query side use phrase matches for longer CJK spans.
fn fts_tokens(text: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut cjk_run: Vec<char> = Vec::new();
    let mut word = String::new();
    for c in text.chars() {
        if is_cjk(c) {
            if !word.is_empty() {
                tokens.push(std::mem::take(&mut word));
            }
            cjk_run.push(c);
        } else if c.is_alphanumeric() {
            flush_cjk_run(&mut tokens, &mut cjk_run);
            word.push(c);
        } else {
            if !word.is_empty() {
                tokens.push(std::mem::take(&mut word));
            }
            flush_cjk_run(&mut tokens, &mut cjk_run);
        }
    }
    if !word.is_empty() {
        tokens.push(word);
    }
    flush_cjk_run(&mut tokens, &mut cjk_run);
    tokens
}

/// The `ra_fts_segment` SQL function body: index-side segmentation.
fn fts_segment(text: &str) -> String {
    fts_tokens(text).join(" ")
}

/// Build an fts5 MATCH expression from a user query, mirroring the index-side
/// segmentation. Each CJK run becomes a quoted PHRASE of its bigrams (they are
/// consecutive tokens in the index); each word / lone CJK char becomes a quoted
/// prefix token (`"hab"*` matches "habits", `"习"*` matches the bigram 习惯).
/// Quoting every token also neutralizes fts5 operators (AND/OR/NEAR/parens) in
/// user input. Returns None when the query has no indexable tokens.
fn fts_match_expr(query: &str) -> Option<String> {
    fn quote(token: &str) -> String {
        format!("\"{}\"", token.replace('"', "\"\""))
    }
    fn flush_word(parts: &mut Vec<String>, word: &mut String) {
        if !word.is_empty() {
            parts.push(format!("{}*", quote(word)));
            word.clear();
        }
    }
    fn flush_cjk(parts: &mut Vec<String>, run: &mut Vec<char>) {
        let mut bigrams: Vec<String> = Vec::new();
        flush_cjk_run(&mut bigrams, run);
        match bigrams.as_slice() {
            [] => {}
            // Lone CJK char: prefix-match so it still hits bigram tokens.
            [only] if only.chars().count() == 1 => parts.push(format!("{}*", quote(only))),
            _ => parts.push(quote(&bigrams.join(" "))),
        }
    }

    let mut parts: Vec<String> = Vec::new();
    let mut cjk_run: Vec<char> = Vec::new();
    let mut word = String::new();
    for c in query.chars() {
        if is_cjk(c) {
            flush_word(&mut parts, &mut word);
            cjk_run.push(c);
        } else if c.is_alphanumeric() {
            flush_cjk(&mut parts, &mut cjk_run);
            word.push(c);
        } else {
            flush_word(&mut parts, &mut word);
            flush_cjk(&mut parts, &mut cjk_run);
        }
    }
    flush_word(&mut parts, &mut word);
    flush_cjk(&mut parts, &mut cjk_run);
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" ")) // implicit AND
    }
}

/// Register app SQL functions on a connection. Must run BEFORE migrations
/// (v4's initial populate and the FTS triggers call `ra_fts_segment`).
pub fn register_sql_functions(conn: &Connection) -> Result<(), String> {
    use rusqlite::functions::FunctionFlags;
    conn.create_scalar_function(
        "ra_fts_segment",
        1,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let text: String = ctx.get(0)?;
            Ok(fts_segment(&text))
        },
    )
    .map_err(|e| e.to_string())
}

// --- Device identity (HLC + sync attribution) --------------------------------

/// Ensure the single `local_device` row exists and return its stable device id,
/// generating one on first run. Bumps `last_opened_at` on every boot.
pub fn ensure_local_device(conn: &Connection) -> Result<String, String> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT device_id FROM local_device WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other.to_string()),
        })?;
    if let Some(device_id) = existing {
        conn.execute(
            "UPDATE local_device SET last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = 1",
            [],
        )
        .map_err(|e| e.to_string())?;
        return Ok(device_id);
    }
    let device_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO local_device (id, device_id, created_at, last_opened_at)
         VALUES (1, ?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        params![device_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(device_id)
}

/// Boot info for the frontend HLC: the stable device id plus the highest HLC
/// this device ever persisted, so the clock can reseed monotonically across
/// restarts even if the wall clock stepped backwards.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDeviceInfo {
    pub device_id: String,
    pub last_hlc_wall_ms: Option<i64>,
    pub last_hlc_counter: Option<i64>,
}

#[tauri::command]
pub fn local_device_get(db: State<'_, Db>) -> Result<LocalDeviceInfo, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let device_id = ensure_local_device(&conn)?;
    let last = conn
        .query_row(
            "SELECT hlc_wall_ms, hlc_counter FROM domain_events WHERE hlc_device = ?1
             ORDER BY hlc_wall_ms DESC, hlc_counter DESC LIMIT 1",
            params![device_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other.to_string()),
        })?;
    Ok(LocalDeviceInfo {
        device_id,
        last_hlc_wall_ms: last.map(|(wall, _)| wall),
        last_hlc_counter: last.map(|(_, counter)| counter),
    })
}

// --- Filesystem blob store ----------------------------------------------------
//
// Bytes live as ordinary files under `<data_dir>/blobs/`; SQLite keeps only the
// `blob_objects` registry row (kind, mime, size, sha256, storage_uri) plus the
// `blob_sync_state` outbox. Payloads still cross the IPC bridge RAW
// (`tauri::ipc::Request` / `Response`), never as JSON — a serde `Vec<u8>` would
// serialize a book file into a JSON array of numbers, which froze the webview
// main thread on large books.

/// Header carrying the blob key on raw-body `put_blob` requests (the body is
/// the payload itself, so the key can't ride in JSON args).
const BLOB_KEY_HEADER: &str = "x-blob-key";
/// Optional header carrying the payload MIME type on `put_blob` requests.
const BLOB_MIME_HEADER: &str = "x-blob-mime";

/// Map a blob key's prefix to its registry `kind` and whether it should sync
/// to the relay (font caches are re-downloadable; everything else is user data).
fn blob_kind(key: &str) -> (&'static str, bool) {
    match key.split(':').next() {
        Some("bookfile") => ("book_source", true),
        Some("cover") => ("cover_image", true),
        Some("font") => ("font_face", false),
        _ => ("unknown", true),
    }
}

/// Filesystem-safe file name for a blob key: percent-encode every byte outside
/// `[A-Za-z0-9._-]`. Injective (no two keys share a file) and reversible, so a
/// stray file in `blobs/` can always be traced back to its key.
fn blob_file_name(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    for byte in key.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'_' | b'-' => out.push(byte as char),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobPutResult {
    pub sha256: String,
    pub byte_size: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobInfo {
    pub byte_size: u64,
    pub mime_type: Option<String>,
}

fn put_blob_inner(
    conn: &Connection,
    data_dir: &Path,
    key: &str,
    mime_type: Option<&str>,
    data: &[u8],
) -> Result<BlobPutResult, String> {
    let blobs_dir = data_dir.join("blobs");
    std::fs::create_dir_all(&blobs_dir).map_err(|e| e.to_string())?;
    let file_name = blob_file_name(key);
    // Write-then-rename so a crash mid-write never leaves a torn blob behind
    // a committed registry row.
    let tmp_path = blobs_dir.join(format!("{file_name}.tmp"));
    let final_path = blobs_dir.join(&file_name);
    std::fs::write(&tmp_path, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &final_path).map_err(|e| e.to_string())?;

    let sha256 = format!("{:x}", Sha256::digest(data));
    let byte_size = data.len() as i64;
    register_blob_inner(conn, key, mime_type, byte_size, sha256, file_name)
}

fn register_blob_inner(
    conn: &Connection,
    key: &str,
    mime_type: Option<&str>,
    byte_size: i64,
    sha256: String,
    file_name: String,
) -> Result<BlobPutResult, String> {
    let (kind, sync_required) = blob_kind(key);
    let storage_uri = format!("blobs/{file_name}");
    conn.execute(
        "INSERT INTO blob_objects
            (key, kind, mime_type, byte_size, sha256, storage_uri, sync_required, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(key) DO UPDATE SET
            kind = excluded.kind,
            mime_type = COALESCE(excluded.mime_type, blob_objects.mime_type),
            byte_size = excluded.byte_size,
            sha256 = excluded.sha256,
            storage_uri = excluded.storage_uri,
            sync_required = excluded.sync_required,
            deleted_at = NULL",
        params![
            key,
            kind,
            mime_type,
            byte_size,
            sha256,
            storage_uri,
            sync_required as i64
        ],
    )
    .map_err(|e| e.to_string())?;
    if sync_required {
        // (Re)writes reset the outbox: changed content must push again.
        conn.execute(
            "INSERT INTO blob_sync_state (blob_key, updated_at)
             VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(blob_key) DO UPDATE SET
                push_state = 'pending',
                pushed_at = NULL,
                updated_at = excluded.updated_at",
            params![key],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(BlobPutResult { sha256, byte_size })
}

/// Copy a user-selected desktop file straight into the managed blob directory,
/// then hash the staged copy. `std::fs::copy` deliberately stays intact here:
/// it uses fclonefileat/fcopyfile on macOS, copy_file_range on Linux, and
/// CopyFileEx on Windows instead of forcing every platform through a userspace
/// read/write loop.
fn copy_blob_from_file(
    data_dir: &Path,
    key: &str,
    source_path: &Path,
) -> Result<(String, i64, String), String> {
    let blobs_dir = data_dir.join("blobs");
    std::fs::create_dir_all(&blobs_dir).map_err(|e| e.to_string())?;
    let file_name = blob_file_name(key);
    let tmp_path = blobs_dir.join(format!("{file_name}.tmp"));
    let final_path = blobs_dir.join(&file_name);

    let copy_result = (|| -> Result<(String, i64), String> {
        let byte_size = std::fs::copy(source_path, &tmp_path).map_err(|e| {
            format!("Failed to copy selected book {}: {e}", source_path.display())
        })?;
        let staged = std::fs::File::open(&tmp_path).map_err(|e| e.to_string())?;
        let mut reader = BufReader::new(staged);
        let mut hasher = Sha256::new();
        let mut buffer = vec![0_u8; 1024 * 1024];

        loop {
            let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        std::fs::rename(&tmp_path, &final_path).map_err(|e| e.to_string())?;
        Ok((format!("{:x}", hasher.finalize()), byte_size as i64))
    })();

    let (sha256, byte_size) = match copy_result {
        Ok(result) => result,
        Err(error) => {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(error);
        }
    };
    Ok((sha256, byte_size, file_name))
}

#[cfg(test)]
fn put_blob_from_file_inner(
    conn: &Connection,
    data_dir: &Path,
    key: &str,
    mime_type: Option<&str>,
    source_path: &Path,
) -> Result<BlobPutResult, String> {
    let (sha256, byte_size, file_name) = copy_blob_from_file(data_dir, key, source_path)?;
    register_blob_inner(conn, key, mime_type, byte_size, sha256, file_name)
}

fn get_blob_record_inner(
    conn: &Connection,
    data_dir: &Path,
    key: &str,
) -> Result<Option<(PathBuf, BlobInfo)>, String> {
    let record: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT storage_uri, mime_type FROM blob_objects
             WHERE key = ?1 AND deleted_at IS NULL AND storage_uri IS NOT NULL",
            params![key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other.to_string()),
        })?;
    let Some((storage_uri, mime_type)) = record else {
        return Ok(None);
    };

    let relative = Path::new(&storage_uri);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(format!("Invalid managed blob path for {key}"));
    }

    let path = data_dir.join(relative);
    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    Ok(Some((
        path,
        BlobInfo {
            byte_size: metadata.len(),
            mime_type,
        },
    )))
}

/// Empty vec means "no such blob" (the raw-response contract; no real payload
/// is zero-length). A registry row whose file went missing is treated the same.
fn get_blob_inner(conn: &Connection, data_dir: &Path, key: &str) -> Result<Vec<u8>, String> {
    let Some((path, _)) = get_blob_record_inner(conn, data_dir, key)? else {
        return Ok(Vec::new());
    };
    std::fs::read(path).map_err(|e| e.to_string())
}

fn get_blob_range_inner(
    conn: &Connection,
    data_dir: &Path,
    key: &str,
    offset: u64,
    length: u64,
) -> Result<Vec<u8>, String> {
    let Some((path, info)) = get_blob_record_inner(conn, data_dir, key)? else {
        return Ok(Vec::new());
    };
    if offset >= info.byte_size || length == 0 {
        return Ok(Vec::new());
    }

    let read_len = length.min(info.byte_size - offset);
    let capacity = usize::try_from(read_len)
        .map_err(|_| format!("Requested blob range is too large: {read_len} bytes"))?;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity(capacity);
    file.take(read_len)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(bytes)
}

/// Remove the bytes and tombstone the registry row (`deleted_at` set,
/// `storage_uri` cleared, outbox row dropped). The tombstone keeps sync and
/// backup-restore from resurrecting a deliberately deleted file.
fn delete_blob_inner(conn: &Connection, data_dir: &Path, key: &str) -> Result<(), String> {
    let storage_uri: Option<String> = conn
        .query_row(
            "SELECT storage_uri FROM blob_objects WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other.to_string()),
        })?;
    if let Some(uri) = storage_uri {
        match std::fs::remove_file(data_dir.join(&uri)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    conn.execute(
        "UPDATE blob_objects SET
            deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            storage_uri = NULL
         WHERE key = ?1",
        params![key],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM blob_sync_state WHERE blob_key = ?1",
        params![key],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// One-time data migration: move any bytes still inline in the pre-v3 `blobs`
/// table out to `<data_dir>/blobs/` files + `blob_objects` rows, then drop the
/// table. Runs on every boot but is a no-op once the table is gone. Idempotent
/// under crashes: file writes are keyed deterministically and registry rows are
/// upserts, so a re-run after a partial pass simply overwrites its own work
/// before dropping the table.
fn externalize_inline_blobs(conn: &Connection, data_dir: &Path) -> Result<(), String> {
    let has_inline_table: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'blobs')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !has_inline_table {
        return Ok(());
    }
    {
        let mut stmt = conn
            .prepare("SELECT key, data FROM blobs")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (key, data) = row.map_err(|e| e.to_string())?;
            put_blob_inner(conn, data_dir, &key, None, &data)?;
        }
    }
    conn.execute_batch("DROP TABLE blobs;")
        .map_err(|e| e.to_string())?;
    // The inline pages are gone but the file doesn't shrink by itself; with the
    // library's book bytes leaving the database this is the one reclaim that is
    // actually worth a VACUUM.
    conn.execute_batch("VACUUM;").map_err(|e| e.to_string())?;
    Ok(())
}

/// Open (creating if needed) the app database, apply the connection PRAGMA
/// baseline (WAL et al — see `apply_connection_pragmas`), run migrations,
/// externalize any pre-v3 inline blobs, and ensure the device identity row.
/// Returns the connection plus the app-data dir the blob store roots at.
pub fn init_db(app: &AppHandle) -> Result<(Connection, PathBuf), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut conn = Connection::open(dir.join("read-aware.db")).map_err(|e| e.to_string())?;
    apply_connection_pragmas(&conn)?;
    register_sql_functions(&conn)?;
    run_migrations(&mut conn)?;
    externalize_inline_blobs(&conn, &dir)?;
    ensure_local_device(&conn)?;
    Ok((conn, dir))
}

fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<EventRow> {
    let payload_str: String = row.get("payload_json")?;
    let payload: Value = serde_json::from_str(&payload_str).unwrap_or(Value::Null);
    Ok(EventRow {
        id: row.get("id")?,
        event_type: row.get("type")?,
        hlc: Hlc {
            wall_ms: row.get("hlc_wall_ms")?,
            counter: row.get("hlc_counter")?,
            device_id: row.get("hlc_device")?,
        },
        schema_version: row.get("schema_version")?,
        aggregate_type: row.get("aggregate_type")?,
        aggregate_id: row.get("aggregate_id")?,
        actor_id: row.get("actor_id")?,
        origin: row.get("origin")?,
        created_at: row.get("created_at")?,
        payload,
    })
}

// --- Event log (the sync unit) ---

fn append_events_inner(conn: &mut Connection, events: &[EventRow]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for ev in events {
        let payload = serde_json::to_string(&ev.payload).map_err(|e| e.to_string())?;
        // `?4` (HLC wall ms) is reused to derive created_at when the caller
        // didn't stamp one. INSERT OR IGNORE keeps replays/dup deliveries
        // idempotent by event id (and by the unique HLC index).
        let inserted = tx
            .execute(
                "INSERT OR IGNORE INTO domain_events
                    (id, type, schema_version, hlc_wall_ms, hlc_counter, hlc_device,
                     aggregate_type, aggregate_id, payload_json, actor_id, origin, created_at)
                 VALUES (?1, ?2, COALESCE(?3, 1), ?4, ?5, ?6, ?7, ?8, ?9,
                         COALESCE(?10, 'local'),
                         COALESCE(?11, 'user'),
                         COALESCE(?12, strftime('%Y-%m-%dT%H:%M:%fZ', ?4 / 1000.0, 'unixepoch')))",
                params![
                    ev.id,
                    ev.event_type,
                    ev.schema_version,
                    ev.hlc.wall_ms,
                    ev.hlc.counter,
                    ev.hlc.device_id,
                    ev.aggregate_type,
                    ev.aggregate_id,
                    payload,
                    ev.actor_id,
                    ev.origin,
                    ev.created_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        // Locally-appended events enter the push outbox; ignored duplicates
        // (already logged, possibly already pushed) must not re-enter it.
        if inserted > 0 {
            tx.execute(
                "INSERT OR IGNORE INTO event_sync_state (event_id, updated_at)
                 VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![ev.id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn append_events(events: Vec<EventRow>, db: State<'_, Db>) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    append_events_inner(&mut conn, &events)
}

#[tauri::command]
pub fn read_events_since(after: Option<Hlc>, db: State<'_, Db>) -> Result<Vec<EventRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    match after {
        Some(a) => {
            let mut stmt = conn
                .prepare(
                    "SELECT * FROM domain_events
                     WHERE (hlc_wall_ms, hlc_counter, hlc_device) > (?1, ?2, ?3)
                     ORDER BY hlc_wall_ms, hlc_counter, hlc_device",
                )
                .map_err(|e| e.to_string())?;
            let iter = stmt
                .query_map(params![a.wall_ms, a.counter, a.device_id], row_to_event)
                .map_err(|e| e.to_string())?;
            for r in iter {
                out.push(r.map_err(|e| e.to_string())?);
            }
        }
        None => {
            let mut stmt = conn
                .prepare(
                    "SELECT * FROM domain_events
                     ORDER BY hlc_wall_ms, hlc_counter, hlc_device",
                )
                .map_err(|e| e.to_string())?;
            let iter = stmt
                .query_map([], row_to_event)
                .map_err(|e| e.to_string())?;
            for r in iter {
                out.push(r.map_err(|e| e.to_string())?);
            }
        }
    }
    Ok(out)
}

/// Distinct aggregate ids that already have an event of one of the given types.
/// Backs the boot-time genesis reconciliation: the frontend synthesizes
/// creation events for projection rows whose aggregate never entered the log.
#[tauri::command]
pub fn list_event_aggregate_ids(
    types: Vec<String>,
    db: State<'_, Db>,
) -> Result<Vec<String>, String> {
    if types.is_empty() {
        return Ok(Vec::new());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let placeholders = vec!["?"; types.len()].join(", ");
    let sql = format!(
        "SELECT DISTINCT aggregate_id FROM domain_events
         WHERE aggregate_id IS NOT NULL AND type IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map(rusqlite::params_from_iter(types.iter()), |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in iter {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// --- Blob commands (book files + derivatives) ---

#[tauri::command]
pub fn put_blob(
    request: tauri::ipc::Request<'_>,
    db: State<'_, Db>,
    data_dir: State<'_, DataDir>,
) -> Result<BlobPutResult, String> {
    let key = request
        .headers()
        .get(BLOB_KEY_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| format!("put_blob: missing {BLOB_KEY_HEADER} header"))?
        .to_string();
    let mime_type = request
        .headers()
        .get(BLOB_MIME_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    // Desktop delivers the payload as a true raw body. Android cannot: the
    // WebView's request interception never exposes POST bodies, so Tauri falls
    // back to JSON there and the bytes arrive as a JSON number array (the
    // official fs plugin's write_file accepts both for the same reason).
    let data: Vec<u8> = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data.clone(),
        tauri::ipc::InvokeBody::Json(value) => serde_json::from_value(value.clone())
            .map_err(|e| format!("put_blob: unsupported JSON body: {e}"))?,
    };
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    put_blob_inner(&conn, &data_dir.0, &key, mime_type.as_deref(), &data)
}

/// Native desktop import path. File copying and hashing run on Tauri's blocking
/// pool, not the window thread, and no source bytes cross IPC.
#[tauri::command]
pub async fn put_blob_from_file(
    app: AppHandle,
    path: String,
    key: String,
    mime_type: Option<String>,
) -> Result<BlobPutResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = app.state::<DataDir>().0.clone();
        let (sha256, byte_size, file_name) =
            copy_blob_from_file(&data_dir, &key, Path::new(&path))?;
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        register_blob_inner(
            &conn,
            &key,
            mime_type.as_deref(),
            byte_size,
            sha256,
            file_name,
        )
    })
    .await
    .map_err(|e| format!("put_blob_from_file task failed: {e}"))?
}

/// Returns the blob's bytes as a raw (non-JSON) IPC response. A missing key
/// yields an EMPTY body — the JS wrapper maps zero length back to `null`.
/// (A raw `Response` cannot express `Option`, and no real payload here is
/// zero-length: book files and derivatives are never empty.)
#[tauri::command]
pub fn get_blob(
    key: String,
    db: State<'_, Db>,
    data_dir: State<'_, DataDir>,
) -> Result<tauri::ipc::Response, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    get_blob_inner(&conn, &data_dir.0, &key).map(tauri::ipc::Response::new)
}

/// Metadata-only lookup used to create a random-access book source in the
/// webview without first transferring the whole file.
#[tauri::command]
pub fn get_blob_info(
    key: String,
    db: State<'_, Db>,
    data_dir: State<'_, DataDir>,
) -> Result<Option<BlobInfo>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(get_blob_record_inner(&conn, &data_dir.0, &key)?.map(|(_, info)| info))
}

/// Read only one byte range from a managed blob. PDF.js drives this through
/// its range transport, so opening a large PDF no longer copies the entire
/// source file into WKWebView before the first page can render.
#[tauri::command]
pub async fn get_blob_range(
    app: AppHandle,
    key: String,
    offset: u64,
    length: u64,
) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let data_dir = app.state::<DataDir>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        get_blob_range_inner(&conn, &data_dir.0, &key, offset, length)
    })
    .await
    .map_err(|e| format!("get_blob_range task failed: {e}"))??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn delete_blob(
    key: String,
    db: State<'_, Db>,
    data_dir: State<'_, DataDir>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    delete_blob_inner(&conn, &data_dir.0, &key)
}

// --- Staged blob transfers (mobile) ---
//
// The raw-body/raw-response fast paths above don't exist on Android: the
// WebView never exposes POST bodies (uploads fall back to a JSON number
// array — parsing tens of millions of array elements stalls for minutes on a
// whole book), and IPC responses are injected via `evaluateJavascript`, which
// chokes on multi-megabyte payloads. Mirroring the `book_read_*` commands in
// lib.rs, mobile moves blobs through small staged chunks instead: downloads
// pull raw-response slices; uploads push base64 strings (one JSON string
// parses orders of magnitude faster than the number-array fallback).

/// Blobs staged for chunked download, keyed by blob key.
#[derive(Default)]
pub struct BlobReadSessions(Mutex<std::collections::HashMap<String, Vec<u8>>>);

/// Upload buffers accumulating base64 chunks until commit, keyed by blob key.
#[derive(Default)]
pub struct BlobWriteSessions(Mutex<std::collections::HashMap<String, Vec<u8>>>);

/// Stage a blob for chunked download and return its byte length.
/// 0 = no such key (same convention as `get_blob`'s empty body).
#[tauri::command]
pub fn blob_read_open(
    key: String,
    sessions: State<'_, BlobReadSessions>,
    db: State<'_, Db>,
    data_dir: State<'_, DataDir>,
) -> Result<usize, String> {
    let bytes = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        get_blob_inner(&conn, &data_dir.0, &key)?
    };
    let len = bytes.len();
    if len > 0 {
        sessions
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(key, bytes);
    }
    Ok(len)
}

/// Return one chunk of a staged blob as a raw binary response.
#[tauri::command]
pub fn blob_read_chunk(
    key: String,
    offset: usize,
    length: usize,
    sessions: State<'_, BlobReadSessions>,
) -> Result<tauri::ipc::Response, String> {
    let map = sessions.0.lock().map_err(|e| e.to_string())?;
    let bytes = map
        .get(&key)
        .ok_or_else(|| format!("blob_read_chunk: no open session for {key}"))?;
    let start = offset.min(bytes.len());
    let end = offset.saturating_add(length).min(bytes.len());
    Ok(tauri::ipc::Response::new(bytes[start..end].to_vec()))
}

/// Drop a staged download once the webview has pulled every chunk.
#[tauri::command]
pub fn blob_read_close(
    key: String,
    sessions: State<'_, BlobReadSessions>,
) -> Result<(), String> {
    sessions.0.lock().map_err(|e| e.to_string())?.remove(&key);
    Ok(())
}

/// Open (or reset) an upload buffer for `key`.
#[tauri::command]
pub fn blob_write_open(
    key: String,
    sessions: State<'_, BlobWriteSessions>,
) -> Result<(), String> {
    sessions
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(key, Vec::new());
    Ok(())
}

/// Append one base64-encoded chunk to an open upload buffer.
#[tauri::command]
pub fn blob_write_chunk(
    key: String,
    chunk_base64: String,
    sessions: State<'_, BlobWriteSessions>,
) -> Result<(), String> {
    use base64::Engine;
    let chunk = base64::engine::general_purpose::STANDARD
        .decode(chunk_base64.as_bytes())
        .map_err(|e| format!("blob_write_chunk: invalid base64: {e}"))?;
    let mut map = sessions.0.lock().map_err(|e| e.to_string())?;
    let buffer = map
        .get_mut(&key)
        .ok_or_else(|| format!("blob_write_chunk: no open session for {key}"))?;
    buffer.extend_from_slice(&chunk);
    Ok(())
}

/// Append one raw-body chunk to an open upload buffer. The desktop twin of
/// `blob_write_chunk`: one 80MB `put_blob` body saturates the WKWebView main
/// thread for seconds, so large desktop uploads stream through this in slices
/// (the key rides the same header as `put_blob`).
#[tauri::command]
pub fn blob_write_chunk_raw(
    request: tauri::ipc::Request<'_>,
    sessions: State<'_, BlobWriteSessions>,
) -> Result<(), String> {
    let key = request
        .headers()
        .get(BLOB_KEY_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| format!("blob_write_chunk_raw: missing {BLOB_KEY_HEADER} header"))?
        .to_string();
    let chunk: Vec<u8> = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data.clone(),
        tauri::ipc::InvokeBody::Json(value) => serde_json::from_value(value.clone())
            .map_err(|e| format!("blob_write_chunk_raw: unsupported JSON body: {e}"))?,
    };
    let mut map = sessions.0.lock().map_err(|e| e.to_string())?;
    let buffer = map
        .get_mut(&key)
        .ok_or_else(|| format!("blob_write_chunk_raw: no open session for {key}"))?;
    buffer.extend_from_slice(&chunk);
    Ok(())
}

/// Persist an upload buffer through the regular blob store path.
#[tauri::command]
pub fn blob_write_commit(
    key: String,
    mime_type: Option<String>,
    sessions: State<'_, BlobWriteSessions>,
    db: State<'_, Db>,
    data_dir: State<'_, DataDir>,
) -> Result<BlobPutResult, String> {
    let data = sessions
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&key)
        .ok_or_else(|| format!("blob_write_commit: no open session for {key}"))?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    put_blob_inner(&conn, &data_dir.0, &key, mime_type.as_deref(), &data)
}

/// Discard an upload buffer after a failed transfer.
#[tauri::command]
pub fn blob_write_abort(
    key: String,
    sessions: State<'_, BlobWriteSessions>,
) -> Result<(), String> {
    sessions.0.lock().map_err(|e| e.to_string())?.remove(&key);
    Ok(())
}

// --- Device-local key/value config (backs the settings seam) ---

/// The persisted app theme preference, read straight off the connection during
/// setup — BEFORE the main window (and its boot splash) exists. Returns
/// `"light"` / `"dark"` for an explicit choice, `None` for "system", an unset
/// key, or an unreadable value — the caller then follows the OS scheme.
/// Key/shape mirror `features/settings/lib/app-settings.ts`.
pub fn read_boot_theme(conn: &Connection) -> Option<&'static str> {
    let value: String = conn
        .query_row(
            "SELECT value_json FROM app_kv WHERE key = 'read-aware-app-settings'",
            [],
            |row| row.get(0),
        )
        .ok()?;
    let parsed: Value = serde_json::from_str(&value).ok()?;
    match parsed.get("theme").and_then(|theme| theme.as_str()) {
        Some("light") => Some("light"),
        Some("dark") => Some("dark"),
        _ => None,
    }
}

/// Load the entire `app_kv` store as a `{ key: value_json }` map. Called once at
/// boot to hydrate the synchronous in-memory snapshot the settings modules read.
#[tauri::command]
pub fn load_kv_all(db: State<'_, Db>) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT key, value_json FROM app_kv")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut map = std::collections::HashMap::new();
    for row in rows {
        let (key, value) = row.map_err(|e| e.to_string())?;
        map.insert(key, value);
    }
    Ok(map)
}

/// Upsert one config key (write-through from `localKV.setItem`).
#[tauri::command]
pub fn set_kv(key: String, value: String, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO app_kv (key, value_json, updated_at)
         VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete one config key (write-through from `localKV.removeItem`).
#[tauri::command]
pub fn delete_kv(key: String, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM app_kv WHERE key = ?1", params![key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Library projection (books + collections; book-file bytes via blob store) ---

/// Mirrors `LibraryBook` in apps/web (…/library/lib/library-types.ts). The nested
/// `progress` (ReaderProgress | null) is carried verbatim as JSON.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBook {
    pub id: String,
    pub title: String,
    pub author: String,
    pub format: String,
    pub file_name: String,
    #[serde(default)]
    pub mime_type: String,
    pub file_size: i64,
    #[serde(default)]
    pub cover_url: Option<String>,
    #[serde(default)]
    pub cover_checked: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub last_opened_at: Option<String>,
    pub progress_percent: f64,
    pub reading_status: String,
    #[serde(default)]
    pub progress: Value,
    #[serde(default)]
    pub starred: Option<bool>,
    #[serde(default)]
    pub collection_id: Option<String>,
}

/// Mirrors `Collection` in library-types.ts.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub created_at: String,
}

fn row_to_library_book(row: &rusqlite::Row) -> rusqlite::Result<LibraryBook> {
    let progress_str: Option<String> = row.get("progress_json")?;
    let progress = progress_str
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    Ok(LibraryBook {
        id: row.get("id")?,
        title: row.get("title")?,
        author: row.get("author")?,
        format: row.get("format")?,
        file_name: row.get("file_name")?,
        mime_type: row
            .get::<_, Option<String>>("mime_type")?
            .unwrap_or_default(),
        file_size: row.get("file_size")?,
        cover_url: row.get("cover_url")?,
        cover_checked: Some(row.get::<_, i64>("cover_checked")? != 0),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        last_opened_at: row.get("last_opened_at")?,
        progress_percent: row.get("progress_percent")?,
        reading_status: row.get("reading_status")?,
        progress,
        starred: Some(row.get::<_, i64>("starred")? != 0),
        collection_id: row.get("collection_id")?,
    })
}

#[tauri::command]
pub fn library_load(db: State<'_, Db>) -> Result<Vec<LibraryBook>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM books")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_library_book)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn library_get_book(id: String, db: State<'_, Db>) -> Result<Option<LibraryBook>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match conn.query_row(
        "SELECT * FROM books WHERE id = ?1",
        params![id],
        row_to_library_book,
    ) {
        Ok(book) => Ok(Some(book)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn library_put_book(book: LibraryBook, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let progress_json = if book.progress.is_null() {
        None
    } else {
        Some(book.progress.to_string())
    };
    conn.execute(
        "INSERT INTO books
            (id, title, author, format, file_name, mime_type, file_size, cover_url,
             cover_checked, created_at, updated_at, last_opened_at, progress_percent,
             reading_status, progress_json, starred, collection_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
         ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, author=excluded.author, format=excluded.format,
            file_name=excluded.file_name, mime_type=excluded.mime_type,
            file_size=excluded.file_size, cover_url=excluded.cover_url,
            cover_checked=excluded.cover_checked, created_at=excluded.created_at,
            updated_at=excluded.updated_at, last_opened_at=excluded.last_opened_at,
            progress_percent=excluded.progress_percent, reading_status=excluded.reading_status,
            progress_json=excluded.progress_json, starred=excluded.starred,
            collection_id=excluded.collection_id",
        params![
            book.id,
            book.title,
            book.author,
            book.format,
            book.file_name,
            book.mime_type,
            book.file_size,
            book.cover_url,
            book.cover_checked.unwrap_or(false) as i64,
            book.created_at,
            book.updated_at,
            book.last_opened_at,
            book.progress_percent,
            book.reading_status,
            progress_json,
            book.starred.unwrap_or(false) as i64,
            book.collection_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn library_delete_books(
    ids: Vec<String>,
    db: State<'_, Db>,
    data_dir: State<'_, DataDir>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for id in &ids {
        conn.execute("DELETE FROM books WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        delete_blob_inner(&conn, &data_dir.0, &format!("bookfile:{id}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn library_list_collections(db: State<'_, Db>) -> Result<Vec<Collection>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, created_at FROM collections")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Upsert a collection. On conflict the original `created_at` is preserved, so
/// this doubles as rename.
#[tauri::command]
pub fn library_put_collection(collection: Collection, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO collections (id, name, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name",
        params![collection.id, collection.name, collection.created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete a collection and clear its books' membership (the books stay).
#[tauri::command]
pub fn library_delete_collection(id: String, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE books SET collection_id = NULL WHERE collection_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM collections WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Annotations projection (highlights + notes + asks; one typed table) ---

/// Mirrors the `Annotation` union in apps/web (…/annotations/lib/annotation-types.ts).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub book_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub cfi_range: Option<String>,
    #[serde(default)]
    pub chapter_href: Option<String>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn row_to_annotation(row: &rusqlite::Row) -> rusqlite::Result<Annotation> {
    Ok(Annotation {
        id: row.get("id")?,
        book_id: row.get("book_id")?,
        kind: row.get("type")?,
        cfi_range: row.get("cfi_range")?,
        chapter_href: row.get("chapter_href")?,
        text: row.get("text")?,
        color: row.get("color")?,
        style: row.get("style")?,
        content: row.get("content")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[tauri::command]
pub fn annotations_list(db: State<'_, Db>) -> Result<Vec<Annotation>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM annotations")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_annotation)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn annotation_get(id: String, db: State<'_, Db>) -> Result<Option<Annotation>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match conn.query_row(
        "SELECT * FROM annotations WHERE id = ?1",
        params![id],
        row_to_annotation,
    ) {
        Ok(a) => Ok(Some(a)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn annotation_put(annotation: Annotation, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO annotations
            (id, book_id, type, cfi_range, chapter_href, text, color, style, content,
             created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
         ON CONFLICT(id) DO UPDATE SET
            book_id=excluded.book_id, type=excluded.type, cfi_range=excluded.cfi_range,
            chapter_href=excluded.chapter_href, text=excluded.text, color=excluded.color,
            style=excluded.style, content=excluded.content, created_at=excluded.created_at,
            updated_at=excluded.updated_at",
        params![
            annotation.id,
            annotation.book_id,
            annotation.kind,
            annotation.cfi_range,
            annotation.chapter_href,
            annotation.text,
            annotation.color,
            annotation.style,
            annotation.content,
            annotation.created_at,
            annotation.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn annotation_delete(id: String, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM annotations WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn annotations_search_inner(
    conn: &Connection,
    query: &str,
    book_id: Option<&str>,
    kind: Option<&str>,
) -> Result<Vec<Annotation>, String> {
    let Some(expr) = fts_match_expr(query) else {
        // Nothing indexable in the query (punctuation only) — no matches.
        return Ok(Vec::new());
    };
    let mut sql = String::from(
        "SELECT a.* FROM annotations_fts
         JOIN annotations a ON a.id = annotations_fts.id
         WHERE annotations_fts MATCH ?1",
    );
    let mut binds: Vec<String> = vec![expr];
    if let Some(book_id) = book_id {
        binds.push(book_id.to_string());
        sql.push_str(&format!(" AND a.book_id = ?{}", binds.len()));
    }
    if let Some(kind) = kind {
        binds.push(kind.to_string());
        sql.push_str(&format!(" AND a.type = ?{}", binds.len()));
    }
    sql.push_str(" ORDER BY bm25(annotations_fts)");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(binds.iter()), row_to_annotation)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Full-text search over annotations (best matches first, BM25). The query is
/// segmented exactly like the indexed text (CJK bigrams + word prefixes), so
/// 2-char Chinese words match exactly and English words match by prefix.
#[tauri::command]
pub fn annotations_search(
    query: String,
    book_id: Option<String>,
    kind: Option<String>,
    db: State<'_, Db>,
) -> Result<Vec<Annotation>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    annotations_search_inner(&conn, &query, book_id.as_deref(), kind.as_deref())
}

// --- Memories projection (agent long-term memory; docs/data-model.md §5.2) ---

/// Mirrors `MemoryRecord` in packages/agent (…/src/ports.ts).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: String,
    pub scope: String,
    pub kind: String,
    pub content: String,
    pub importance: f64,
    pub evidence_count: i64,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default = "default_memory_status")]
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

fn default_memory_status() -> String {
    "active".to_string()
}

fn row_to_memory(row: &rusqlite::Row) -> rusqlite::Result<Memory> {
    Ok(Memory {
        id: row.get("id")?,
        scope: row.get("scope")?,
        kind: row.get("kind")?,
        content: row.get("content")?,
        importance: row.get("importance")?,
        evidence_count: row.get("evidence_count")?,
        pinned: row.get::<_, i64>("pinned")? != 0,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[tauri::command]
pub fn memories_list_all(db: State<'_, Db>) -> Result<Vec<Memory>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM memories")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_memory)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn memory_get(id: String, db: State<'_, Db>) -> Result<Option<Memory>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match conn.query_row(
        "SELECT * FROM memories WHERE id = ?1",
        params![id],
        row_to_memory,
    ) {
        Ok(m) => Ok(Some(m)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn memory_put(memory: Memory, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO memories
            (id, scope, kind, content, importance, evidence_count, pinned, status,
             created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(id) DO UPDATE SET
            scope=excluded.scope, kind=excluded.kind, content=excluded.content,
            importance=excluded.importance, evidence_count=excluded.evidence_count,
            pinned=excluded.pinned, status=excluded.status,
            created_at=excluded.created_at, updated_at=excluded.updated_at",
        params![
            memory.id,
            memory.scope,
            memory.kind,
            memory.content,
            memory.importance,
            memory.evidence_count,
            memory.pinned as i64,
            memory.status,
            memory.created_at,
            memory.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// --- AI chat transcripts (per-book conversations + the global thread) ---

/// Mirrors `ChatMessage` in apps/web (…/ai/lib/chat-types.ts); attachments and
/// the assistant part timeline ride as opaque JSON strings until the
/// event-sourced normalization lands.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub seq: i64,
    pub content: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments_json: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parts_json: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn row_to_ai_message(row: &rusqlite::Row) -> rusqlite::Result<AiMessage> {
    Ok(AiMessage {
        id: row.get("id")?,
        conversation_id: row.get("conversation_id")?,
        role: row.get("role")?,
        seq: row.get("seq")?,
        content: row.get("content")?,
        created_at: row.get("created_at")?,
        attachments_json: row.get("attachments_json")?,
        parts_json: row.get("parts_json")?,
        error: row.get("error")?,
    })
}

#[tauri::command]
pub fn ai_chat_load(conversation_id: String, db: State<'_, Db>) -> Result<Vec<AiMessage>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM ai_messages WHERE conversation_id = ?1 ORDER BY seq")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], row_to_ai_message)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn ai_chat_load_all(db: State<'_, Db>) -> Result<Vec<AiMessage>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM ai_messages ORDER BY conversation_id, seq")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_ai_message)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Whole-transcript replace, mirroring the store's save semantics (the hook
/// persists the full message array after each committed turn). `seq` is
/// assigned here from array order.
#[tauri::command]
pub fn ai_chat_replace(
    conversation_id: String,
    messages: Vec<AiMessage>,
    db: State<'_, Db>,
) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO ai_conversations (id, created_at, updated_at, cleared_at)
         VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL)
         ON CONFLICT(id) DO UPDATE SET
            updated_at = excluded.updated_at, cleared_at = NULL",
        params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM ai_messages WHERE conversation_id = ?1",
        params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    for (seq, message) in messages.iter().enumerate() {
        tx.execute(
            "INSERT INTO ai_messages
                (id, conversation_id, role, seq, content, created_at,
                 attachments_json, parts_json, error)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                message.id,
                conversation_id,
                message.role,
                seq as i64,
                message.content,
                message.created_at,
                message.attachments_json,
                message.parts_json,
                message.error,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// One row per non-empty conversation, newest-activity first: id, activity
/// timestamp, message count, and the first user message as a title preview.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatSummary {
    pub id: String,
    pub updated_at: String,
    pub message_count: i64,
    pub preview: Option<String>,
}

#[tauri::command]
pub fn ai_chat_list(db: State<'_, Db>) -> Result<Vec<AiChatSummary>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.updated_at, COUNT(m.id) AS message_count,
                    (SELECT content FROM ai_messages
                     WHERE conversation_id = c.id AND role = 'user'
                     ORDER BY seq LIMIT 1) AS preview
             FROM ai_conversations c
             LEFT JOIN ai_messages m ON m.conversation_id = c.id
             GROUP BY c.id
             HAVING COUNT(m.id) > 0
             ORDER BY c.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(AiChatSummary {
                id: row.get(0)?,
                updated_at: row.get(1)?,
                message_count: row.get(2)?,
                preview: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Clear = delete the messages, keep the conversation row with a `cleared_at`
/// tombstone (cross-device clear semantics per docs/sqlite-schema.sql).
#[tauri::command]
pub fn ai_chat_clear(conversation_id: String, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM ai_messages WHERE conversation_id = ?1",
        params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE ai_conversations
         SET cleared_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?1",
        params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Plugin documents (migration v10) ---

/// One plugin document; mirrors the web `PluginDocumentRow` wire shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDocumentRow {
    pub id: String,
    pub json: String,
    #[serde(default)]
    pub book_id: Option<String>,
    #[serde(default)]
    pub anchor: Option<String>,
    pub updated_at: String,
}

fn row_to_plugin_document(row: &rusqlite::Row) -> rusqlite::Result<PluginDocumentRow> {
    Ok(PluginDocumentRow {
        id: row.get("id")?,
        json: row.get("json")?,
        book_id: row.get("book_id")?,
        anchor: row.get("anchor")?,
        updated_at: row.get("updated_at")?,
    })
}

#[tauri::command]
pub fn plugin_docs_put(
    plugin_id: String,
    collection: String,
    id: String,
    json: String,
    book_id: Option<String>,
    anchor: Option<String>,
    db: State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO plugin_documents
            (plugin_id, collection, id, json, book_id, anchor, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(plugin_id, collection, id) DO UPDATE SET
            json=excluded.json, book_id=excluded.book_id, anchor=excluded.anchor,
            updated_at=excluded.updated_at",
        params![plugin_id, collection, id, json, book_id, anchor],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn plugin_docs_get(
    plugin_id: String,
    collection: String,
    id: String,
    db: State<'_, Db>,
) -> Result<Option<PluginDocumentRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match conn.query_row(
        "SELECT id, json, book_id, anchor, updated_at FROM plugin_documents
         WHERE plugin_id = ?1 AND collection = ?2 AND id = ?3",
        params![plugin_id, collection, id],
        row_to_plugin_document,
    ) {
        Ok(row) => Ok(Some(row)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn plugin_docs_delete(
    plugin_id: String,
    collection: String,
    id: String,
    db: State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM plugin_documents WHERE plugin_id = ?1 AND collection = ?2 AND id = ?3",
        params![plugin_id, collection, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn plugin_docs_list(
    plugin_id: String,
    collection: String,
    book_id: Option<String>,
    limit: Option<i64>,
    oldest_first: Option<bool>,
    db: State<'_, Db>,
) -> Result<Vec<PluginDocumentRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let order = if oldest_first.unwrap_or(false) { "ASC" } else { "DESC" };
    let sql = format!(
        "SELECT id, json, book_id, anchor, updated_at FROM plugin_documents
         WHERE plugin_id = ?1 AND collection = ?2
           AND (?3 IS NULL OR book_id = ?3)
         ORDER BY updated_at {order}
         LIMIT ?4"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            params![plugin_id, collection, book_id, limit.unwrap_or(i64::MAX)],
            row_to_plugin_document,
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Uninstall wipe — documents die with the plugin (their declared lifecycle).
#[tauri::command]
pub fn plugin_docs_clear(plugin_id: String, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM plugin_documents WHERE plugin_id = ?1",
        params![plugin_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// One-time migration: the retired core vocabulary projection moves into the
/// built-in vocabulary plugin's document collection (vocabulary/words), then
/// the source rows are deleted. Idempotent (second run finds no rows).
#[tauri::command]
pub fn vocabulary_migrate_to_plugin_documents(db: State<'_, Db>) -> Result<i64, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let moved: i64;
    {
        let mut stmt = tx
            .prepare(
                "SELECT id, term, language, entry_json, context, book_id, book_title, added_at
                 FROM vocabulary_entries WHERE removed_at IS NULL",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        moved = rows.len() as i64;
        for (id, term, language, entry_json, context, book_id, book_title, added_at) in rows {
            let entry: Value = serde_json::from_str(&entry_json).unwrap_or(Value::Null);
            let doc = serde_json::json!({
                "term": term,
                "language": language,
                "entry": entry,
                "context": context,
                "bookTitle": book_title,
                "addedAt": added_at,
            });
            tx.execute(
                "INSERT OR IGNORE INTO plugin_documents
                    (plugin_id, collection, id, json, book_id, anchor, updated_at)
                 VALUES ('vocabulary', 'words', ?1, ?2, ?3, NULL, ?4)",
                params![id, doc.to_string(), book_id, added_at],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.execute("DELETE FROM vocabulary_entries", [])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(moved)
}

// --- Reading-time projection (migration v9) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingTimeTotalRow {
    pub book_id: String,
    pub total_ms: i64,
    #[serde(default)]
    pub first_started_at: Option<i64>,
    #[serde(default)]
    pub last_read_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingTimeDailyRow {
    pub book_id: String,
    pub local_day: String,
    pub ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingTimeHourlyRow {
    pub book_id: String,
    pub local_hour: i64,
    pub ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingTimeWire {
    pub totals: Vec<ReadingTimeTotalRow>,
    pub daily: Vec<ReadingTimeDailyRow>,
    pub hourly: Vec<ReadingTimeHourlyRow>,
}

#[tauri::command]
pub fn reading_time_load(db: State<'_, Db>) -> Result<ReadingTimeWire, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let totals = {
        let mut stmt = conn
            .prepare("SELECT book_id, total_ms, first_started_at, last_read_at FROM reading_time_totals")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ReadingTimeTotalRow {
                    book_id: row.get(0)?,
                    total_ms: row.get(1)?,
                    first_started_at: row.get(2)?,
                    last_read_at: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    let daily = {
        let mut stmt = conn
            .prepare("SELECT book_id, local_day, ms FROM reading_time_daily")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ReadingTimeDailyRow {
                    book_id: row.get(0)?,
                    local_day: row.get(1)?,
                    ms: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    let hourly = {
        let mut stmt = conn
            .prepare("SELECT book_id, local_hour, ms FROM reading_time_hourly")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ReadingTimeHourlyRow {
                    book_id: row.get(0)?,
                    local_hour: row.get(1)?,
                    ms: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    Ok(ReadingTimeWire { totals, daily, hourly })
}

fn reading_time_record_inner(
    conn: &Connection,
    book_id: &str,
    ms: i64,
    at_epoch_ms: i64,
    local_day: &str,
    local_hour: i64,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO reading_time_totals (book_id, total_ms, first_started_at, last_read_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(book_id) DO UPDATE SET
            total_ms = total_ms + excluded.total_ms,
            first_started_at = COALESCE(first_started_at, excluded.first_started_at),
            last_read_at = MAX(COALESCE(last_read_at, 0), excluded.last_read_at)",
        params![book_id, ms, at_epoch_ms],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO reading_time_daily (book_id, local_day, ms) VALUES (?1, ?2, ?3)
         ON CONFLICT(book_id, local_day) DO UPDATE SET ms = ms + excluded.ms",
        params![book_id, local_day, ms],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO reading_time_hourly (book_id, local_hour, ms) VALUES (?1, ?2, ?3)
         ON CONFLICT(book_id, local_hour) DO UPDATE SET ms = ms + excluded.ms",
        params![book_id, local_hour, ms],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// One active-reading delta (the tracker's tick), bucketed at record time.
#[tauri::command]
pub fn reading_time_record(
    book_id: String,
    ms: i64,
    at_epoch_ms: i64,
    local_day: String,
    local_hour: i64,
    db: State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    reading_time_record_inner(&conn, &book_id, ms, at_epoch_ms, &local_day, local_hour)
}

/// Bulk replace (one-time app_kv migration; the stats demo seed).
#[tauri::command]
pub fn reading_time_import(wire: ReadingTimeWire, db: State<'_, Db>) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute_batch(
        "DELETE FROM reading_time_totals;
         DELETE FROM reading_time_daily;
         DELETE FROM reading_time_hourly;",
    )
    .map_err(|e| e.to_string())?;
    for row in &wire.totals {
        tx.execute(
            "INSERT INTO reading_time_totals (book_id, total_ms, first_started_at, last_read_at)
             VALUES (?1,?2,?3,?4)",
            params![row.book_id, row.total_ms, row.first_started_at, row.last_read_at],
        )
        .map_err(|e| e.to_string())?;
    }
    for row in &wire.daily {
        tx.execute(
            "INSERT INTO reading_time_daily (book_id, local_day, ms) VALUES (?1,?2,?3)",
            params![row.book_id, row.local_day, row.ms],
        )
        .map_err(|e| e.to_string())?;
    }
    for row in &wire.hourly {
        tx.execute(
            "INSERT INTO reading_time_hourly (book_id, local_hour, ms) VALUES (?1,?2,?3)",
            params![row.book_id, row.local_hour, row.ms],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests;
