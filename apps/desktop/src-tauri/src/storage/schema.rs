//! Schema: the ordered migrations, the connection PRAGMA baseline, and the
//! custom SQL functions the FTS triggers call.
//!
//! Split out of `storage/mod.rs`. The migration list alone is several hundred
//! lines and changes for entirely different reasons than the query code that
//! used to sit beside it.
use super::*;

/// Ordered schema migrations. Each `(version, name, sql)` is applied once, in
/// version order, inside a transaction, and recorded in `schema_migrations`.
///
/// Rules: never edit an already-shipped migration's SQL (users have applied it);
/// evolve the schema by appending a new `(version, ...)` entry. Statements are
/// `IF NOT EXISTS` so first-run on a database created by the old ad-hoc
/// `init_db` (bare `events`/`blobs`) is idempotent and never wipes data.
pub(crate) const MIGRATIONS: &[(i64, &str, &str)] = &[
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
        // JSON blob。两者的事件（vocabulary.*、book.timeRecorded）已在
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
    (
        11,
        "shelf_event_vocabulary",
        // reading 域并入 shelf（其 stats 面）后，事件词汇随之更名：阅读事实
        // 挂回 book 聚合（book.progressed / book.timeRecorded）。历史行一并
        // 改写 —— 重放、校验与 genesis 幂等检查从此只认新名。payload 形状
        // 不变，语义不变，纯改名。
        "UPDATE domain_events SET type = 'book.progressed'
          WHERE type = 'reading.progressed';
         UPDATE domain_events SET type = 'book.timeRecorded'
          WHERE type = 'reading.timeRecorded';",
    ),
    (
        12,
        "sync_profile_and_cursors",
        // [device-local] 同步引擎的本机运行状态（docs/sync-engine.md §7.5，
        // 表形状照 docs/sqlite-schema.sql）。sync_profile 单行：账号连接与
        // E2E 密钥引用（encryption_key_ref 指向 secrets.rs 条目，不存密钥
        // 材料）；sync_cursors 按 feed 记"拉到哪了"——remote_cursor 是中继的
        // server_seq，HLC 三列是已合并的最新事件戳。sync_devices（非对称
        // 设备信任）留给 v2，此处不建。
        "CREATE TABLE IF NOT EXISTS sync_profile (
            id                 INTEGER PRIMARY KEY CHECK (id = 1),
            sync_enabled       INTEGER NOT NULL DEFAULT 0,
            remote_account_id  TEXT,
            encryption_key_ref TEXT,
            last_push_at       TEXT,
            last_pull_at       TEXT,
            updated_at         TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS sync_cursors (
            feed_name     TEXT PRIMARY KEY,
            remote_cursor TEXT,
            hlc_wall_ms   INTEGER,
            hlc_counter   INTEGER,
            hlc_device    TEXT,
            updated_at    TEXT NOT NULL
         );",
    ),
    (
        13,
        "booktext_blobs_are_derivable",
        // booktext:* 是从 bookfile 派生的缓存，早期 blob_kind() 没有映射它，
        // 落成 kind='unknown' / sync_required=1 —— 会被同步引擎当用户数据
        // 推给中继。改正历史行并清掉它们误入的 outbox；blob_kind() 同步
        // 加了 'booktext' 前缀映射，新行不再走错。
        "UPDATE blob_objects SET kind = 'book_text', sync_required = 0
          WHERE key LIKE 'booktext:%';
         DELETE FROM blob_sync_state WHERE blob_key LIKE 'booktext:%';",
    ),
];

/// Apply migrations newer than the highest recorded version, up to `max_version`
/// (`i64::MAX` in production; tests use lower caps to stage old databases).
pub(crate) fn run_migrations_up_to(conn: &mut Connection, max_version: i64) -> Result<(), String> {
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

pub(crate) fn run_migrations(conn: &mut Connection) -> Result<(), String> {
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
pub(crate) fn apply_connection_pragmas(conn: &Connection) -> Result<(), String> {
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
pub(crate) fn fts_segment(text: &str) -> String {
    fts_tokens(text).join(" ")
}

/// Build an fts5 MATCH expression from a user query, mirroring the index-side
/// segmentation. Each CJK run becomes a quoted PHRASE of its bigrams (they are
/// consecutive tokens in the index); each word / lone CJK char becomes a quoted
/// prefix token (`"hab"*` matches "habits", `"习"*` matches the bigram 习惯).
/// Quoting every token also neutralizes fts5 operators (AND/OR/NEAR/parens) in
/// user input. Returns None when the query has no indexable tokens.
pub(crate) fn fts_match_expr(query: &str) -> Option<String> {
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

