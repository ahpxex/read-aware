//! IPC commands over `read_aware_store::storage::annotations`.
use crate::error::CommandError;
use crate::storage::*;

#[tauri::command]
pub async fn annotations_list(
    book_id: Option<String>,
    app: tauri::AppHandle,
) -> Result<Vec<ObservedAnnotation>, CommandError> {
    crate::storage::blocking("annotations_list", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        annotations_observe_inner(&mut conn, book_id.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn annotation_get(
    id: String,
    app: tauri::AppHandle,
) -> Result<Option<Annotation>, CommandError> {
    crate::storage::blocking("annotation_get", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        match conn.query_row(
            "SELECT * FROM annotations WHERE id = ?1",
            params![id],
            row_to_annotation,
        ) {
            Ok(a) => Ok(Some(a)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    })
    .await
}

/// LEGACY-MIGRATION-ONLY projection writer, exempt from the `apply_event` rule
/// in `apply.rs`. Its only caller is the one-time, flag-gated pre-SQLite boot
/// migration (`apps/web/src/platform/desktop-import.ts`); boot-time genesis
/// reconciliation then synthesizes the creation events the log never saw.
/// Every other write goes through `commit_events` — do not add callers.
#[tauri::command]
pub async fn annotation_put(
    annotation: Annotation,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("annotation_put", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        conn.execute(
            "INSERT INTO annotations
            (id, book_id, type, cfi_range, chapter_href, text, color, style, content,
             created_at, updated_at, range_json)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
         ON CONFLICT(id) DO UPDATE SET
            book_id=excluded.book_id, type=excluded.type, cfi_range=excluded.cfi_range,
            chapter_href=excluded.chapter_href, text=excluded.text, color=excluded.color,
            style=excluded.style, content=excluded.content, created_at=excluded.created_at,
            updated_at=excluded.updated_at, range_json=excluded.range_json",
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
                annotation
                    .range
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()?,
            ],
        )?;
        Ok(())
    })
    .await
}

/// Full-text search over annotations (best matches first, BM25). The query is
/// segmented exactly like the indexed text (CJK bigrams + word prefixes), so
/// 2-char Chinese words match exactly and English words match by prefix.
#[tauri::command]
pub async fn annotations_search(
    query: String,
    book_id: Option<String>,
    kind: Option<String>,
    app: tauri::AppHandle,
) -> Result<Vec<Annotation>, CommandError> {
    crate::storage::blocking("annotations_search", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        annotations_search_inner(&conn, &query, book_id.as_deref(), kind.as_deref())
    })
    .await
}
