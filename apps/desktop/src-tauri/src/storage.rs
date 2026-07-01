// Local-first storage backend (desktop) — SQLite event log + blob store.
//
// This is the desktop implementation of @read-aware/core's `StorageAdapter`.
// The event log is the source of truth and the unit of sync; structured tables
// and the vector index are derived projections rebuilt from it.
//
// Vector search (upsert/query) is stubbed until an embedding pipeline exists;
// it will be backed by LanceDB. See CLAUDE.md > Storage Responsibilities.

use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventRow {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub hlc: Hlc,
    pub payload: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorItem {
    pub id: String,
    pub embedding: Vec<f32>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VectorMatch {
    pub id: String,
    pub score: f32,
    pub metadata: Option<Value>,
}

/// Managed Tauri state: the single SQLite connection behind a mutex.
pub struct Db(pub Mutex<Connection>);

/// Ordered schema migrations. Each `(version, name, sql)` is applied once, in
/// version order, inside a transaction, and recorded in `schema_migrations`.
///
/// Rules: never edit an already-shipped migration's SQL (users have applied it);
/// evolve the schema by appending a new `(version, ...)` entry. Statements are
/// `IF NOT EXISTS` so first-run on a database created by the old ad-hoc
/// `init_db` (bare `events`/`blobs`) is idempotent and never wipes data.
///
/// Faithful to docs/sqlite-schema.sql for the columns v1 uses. Pragmatic v1
/// deviations (documented): bytes live inline in `blobs`, so blob-key columns
/// are plain TEXT (no `blob_objects` FK yet), and the memory/vector/sync tables
/// (no producer yet) are omitted.
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
        //     goes to the blob store (`blobs`, key `bookfile:<id>`).
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
];

/// Apply any migrations newer than the highest recorded version.
fn run_migrations(conn: &mut Connection) -> Result<(), String> {
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
        if *version > current {
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

/// Open (creating if needed) the app database, enforce foreign keys, and run
/// migrations. The connection is long-lived (managed Tauri state), so asserting
/// `PRAGMA foreign_keys = ON` once here holds for the process — the per-
/// connection FK requirement docs/sqlite-schema.sql calls out.
pub fn init_db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut conn = Connection::open(dir.join("read-aware.db")).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| e.to_string())?;
    run_migrations(&mut conn)?;
    Ok(conn)
}

fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<EventRow> {
    let payload_str: String = row.get(5)?;
    let payload: Value = serde_json::from_str(&payload_str).unwrap_or(Value::Null);
    Ok(EventRow {
        id: row.get(0)?,
        event_type: row.get(1)?,
        hlc: Hlc {
            wall_ms: row.get(2)?,
            counter: row.get(3)?,
            device_id: row.get(4)?,
        },
        payload,
    })
}

// --- Event log (the sync unit) ---

#[tauri::command]
pub fn append_events(events: Vec<EventRow>, db: State<'_, Db>) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for ev in &events {
        let payload = serde_json::to_string(&ev.payload).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO events
                (id, type, hlc_wall, hlc_counter, hlc_device, payload)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                ev.id,
                ev.event_type,
                ev.hlc.wall_ms,
                ev.hlc.counter,
                ev.hlc.device_id,
                payload
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn read_events_since(after: Option<Hlc>, db: State<'_, Db>) -> Result<Vec<EventRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    match after {
        Some(a) => {
            let mut stmt = conn
                .prepare(
                    "SELECT id, type, hlc_wall, hlc_counter, hlc_device, payload FROM events
                     WHERE (hlc_wall, hlc_counter, hlc_device) > (?1, ?2, ?3)
                     ORDER BY hlc_wall, hlc_counter, hlc_device",
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
                    "SELECT id, type, hlc_wall, hlc_counter, hlc_device, payload FROM events
                     ORDER BY hlc_wall, hlc_counter, hlc_device",
                )
                .map_err(|e| e.to_string())?;
            let iter = stmt.query_map([], row_to_event).map_err(|e| e.to_string())?;
            for r in iter {
                out.push(r.map_err(|e| e.to_string())?);
            }
        }
    }
    Ok(out)
}

// --- Blobs (book files + derivatives) ---

#[tauri::command]
pub fn put_blob(key: String, data: Vec<u8>, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO blobs (key, data) VALUES (?1, ?2)",
        params![key, data],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_blob(key: String, db: State<'_, Db>) -> Result<Option<Vec<u8>>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match conn.query_row(
        "SELECT data FROM blobs WHERE key = ?1",
        params![key],
        |row| row.get::<_, Vec<u8>>(0),
    ) {
        Ok(data) => Ok(Some(data)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_blob(key: String, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM blobs WHERE key = ?1", params![key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Device-local key/value config (backs the settings seam) ---

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

// --- Library projection (books + collections; book-file bytes via `blobs`) ---

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
        mime_type: row.get::<_, Option<String>>("mime_type")?.unwrap_or_default(),
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
    let mut stmt = conn.prepare("SELECT * FROM books").map_err(|e| e.to_string())?;
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
    match conn.query_row("SELECT * FROM books WHERE id = ?1", params![id], row_to_library_book) {
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
pub fn library_delete_books(ids: Vec<String>, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for id in &ids {
        conn.execute("DELETE FROM books WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM blobs WHERE key = ?1",
            params![format!("bookfile:{id}")],
        )
        .map_err(|e| e.to_string())?;
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

// --- Annotations projection (highlights + notes; one typed table) ---

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

// --- Vector index (stubbed; LanceDB-backed later) ---

#[tauri::command]
pub fn upsert_vectors(_items: Vec<VectorItem>) -> Result<(), String> {
    // TODO(local-first): persist into LanceDB once an embedding pipeline exists.
    Ok(())
}

#[tauri::command]
pub fn query_vectors(_embedding: Vec<f32>, _k: u32) -> Result<Vec<VectorMatch>, String> {
    // TODO(local-first): query LanceDB. No-op until vectors are written.
    Ok(Vec::new())
}
