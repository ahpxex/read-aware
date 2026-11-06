//! Highlights, notes, and asks in one typed table, with FTS5-backed search
//! (CJK bigram segmentation — see `schema.rs`).
//!
//! Split out of `storage/mod.rs`; `use super::*` keeps the shared types in
//! scope, so this is a move rather than a rewrite.
use super::*;
use crate::error::CommandError;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<serde_json::Value>,
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

pub fn row_to_annotation(row: &rusqlite::Row) -> rusqlite::Result<Annotation> {
    Ok(Annotation {
        id: row.get("id")?,
        book_id: row.get("book_id")?,
        kind: row.get("type")?,
        cfi_range: row.get("cfi_range")?,
        range: row
            .get::<_, Option<String>>("range_json")?
            .map(|value| {
                serde_json::from_str(&value).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        0,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })
            })
            .transpose()?,
        chapter_href: row.get("chapter_href")?,
        text: row.get("text")?,
        color: row.get("color")?,
        style: row.get("style")?,
        content: row.get("content")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[derive(Debug, Serialize)]
pub struct ObservedAnnotation {
    #[serde(flatten)]
    pub annotation: Annotation,
    pub revision: String,
}

pub fn annotations_observe_inner(
    conn: &mut Connection,
    book_id: Option<&str>,
) -> Result<Vec<ObservedAnnotation>, CommandError> {
    // Native lists carry the SAME token as inspect, captured with their displayed
    // rows in one read transaction. Never refresh a token just before a stale edit.
    let tx = conn.transaction()?;
    let rows = annotations_list_inner(&tx, book_id)?;
    let snapshots = rows
        .into_iter()
        .map(|annotation| {
            let snapshot = super::annotation_mutations::snapshot_for_annotation(&tx, annotation)?;
            Ok(ObservedAnnotation {
                annotation: snapshot.annotation,
                revision: snapshot.revision,
            })
        })
        .collect::<Result<Vec<_>, CommandError>>()?;
    tx.commit()?;
    Ok(snapshots)
}

pub fn annotations_list_inner(
    conn: &Connection,
    book_id: Option<&str>,
) -> Result<Vec<Annotation>, CommandError> {
    let sql = if book_id.is_some() {
        "SELECT * FROM annotations WHERE book_id = ?1"
    } else {
        "SELECT * FROM annotations"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(book_id), row_to_annotation)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn annotations_search_inner(
    conn: &Connection,
    query: &str,
    book_id: Option<&str>,
    kind: Option<&str>,
) -> Result<Vec<Annotation>, CommandError> {
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
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(binds.iter()), row_to_annotation)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[cfg(test)]
mod observation_tests {
    use super::*;

    fn database() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_connection_pragmas(&conn).unwrap();
        register_sql_functions(&conn).unwrap();
        run_migrations(&mut conn).unwrap();
        for (id, book) in [("a", "first"), ("b", "second"), ("c", "first")] {
            conn.execute("INSERT INTO annotations(id,book_id,type,text,created_at,updated_at) VALUES (?1,?2,'note','body','2026-09-10','2026-09-10')", [id, book]).unwrap();
        }
        conn
    }

    #[test]
    fn annotation_book_reads_are_scoped_before_rows_are_decoded() {
        let mut conn = database();
        assert_eq!(annotations_list_inner(&conn, None).unwrap().len(), 3);
        assert_eq!(
            annotations_list_inner(&conn, Some("first")).unwrap().len(),
            2
        );
        assert_eq!(
            annotations_observe_inner(&mut conn, Some("first"))
                .unwrap()
                .len(),
            2
        );
        assert!(annotations_list_inner(&conn, Some("missing"))
            .unwrap()
            .is_empty());
        conn.execute("UPDATE annotations SET created_at=X'00' WHERE id='b'", [])
            .unwrap();
        assert_eq!(
            annotations_list_inner(&conn, Some("first")).unwrap().len(),
            2
        );
        assert_eq!(
            annotations_observe_inner(&mut conn, Some("first"))
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            annotations_observe_inner(&mut conn, Some("second"))
                .unwrap_err()
                .code,
            "db/error"
        );
        assert_eq!(
            annotations_list_inner(&conn, Some("second"))
                .unwrap_err()
                .code,
            "db/error"
        );
        assert!(annotations_list_inner(&conn, None).is_err());
        conn.execute(
            "UPDATE annotations SET created_at='2026-09-10' WHERE id='b'",
            [],
        )
        .unwrap();
        assert_eq!(
            annotations_list_inner(&conn, Some("second")).unwrap().len(),
            1
        );
    }
}
