//! Highlights, notes, and asks in one typed table, with FTS5-backed search
//! (CJK bigram segmentation — see `schema.rs`).
//!
//! Split out of `storage/mod.rs`; `use super::*` keeps the shared types in
//! scope, so this is a move rather than a rewrite.
use super::*;

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

pub(crate) fn row_to_annotation(row: &rusqlite::Row) -> rusqlite::Result<Annotation> {
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

pub(crate) fn annotations_search_inner(
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

