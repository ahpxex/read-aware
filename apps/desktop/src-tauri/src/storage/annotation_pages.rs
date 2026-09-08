//! Live keyset paging. The cursor never grants access or substitutes filters.
use super::schema::fts_match_expr;
use super::{row_to_annotation, Annotation};
use crate::error::CommandError;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnotationPageQuery {
    pub book_id: Option<String>,
    pub kind: Option<String>,
    pub query: Option<String>,
    pub limit: Option<usize>,
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationPage {
    pub items: Vec<Annotation>,
    pub next_cursor: Option<String>,
    pub consistency: &'static str,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Cursor {
    v: u8,
    book_id: Option<String>,
    kind: Option<String>,
    query: Option<String>,
    created_at: String,
    id: String,
}

fn invalid_cursor() -> CommandError {
    CommandError::new(
        "annotations/invalid-cursor",
        "Cursor is malformed or belongs to another query",
    )
}

pub(crate) fn annotations_page_inner(
    conn: &Connection,
    mut input: AnnotationPageQuery,
) -> Result<AnnotationPage, CommandError> {
    let limit = input.limit.unwrap_or(20);
    if !(1..=100).contains(&limit)
        || input
            .book_id
            .as_ref()
            .is_some_and(|id| id.trim().is_empty() || id.encode_utf16().count() > 512)
        || input
            .kind
            .as_deref()
            .is_some_and(|kind| !["highlight", "note", "ask"].contains(&kind))
        || input
            .query
            .as_ref()
            .is_some_and(|query| query.encode_utf16().count() > 500)
    {
        return Err(CommandError::new(
            "annotations/invalid-input",
            "Invalid annotation page query",
        ));
    }
    input.query = input
        .query
        .map(|query| query.trim().to_string())
        .filter(|query| !query.is_empty());
    let cursor = input
        .cursor
        .as_ref()
        .map(|raw| {
            if raw.len() > 8192 {
                return Err(invalid_cursor());
            }
            let bytes = URL_SAFE_NO_PAD.decode(raw).map_err(|_| invalid_cursor())?;
            let cursor: Cursor = serde_json::from_slice(&bytes).map_err(|_| invalid_cursor())?;
            if cursor.v != 1
                || cursor.book_id != input.book_id
                || cursor.kind != input.kind
                || cursor.query != input.query
                || cursor.id.is_empty()
                || cursor.id.len() > 2048
                || cursor.created_at.is_empty()
                || cursor.created_at.len() > 128
            {
                return Err(invalid_cursor());
            }
            Ok(cursor)
        })
        .transpose()?;

    let mut sql = String::from("SELECT a.* FROM annotations a WHERE 1=1");
    let mut binds: Vec<String> = Vec::new();
    if let Some(query) = &input.query {
        let Some(expr) = fts_match_expr(query) else {
            return Ok(AnnotationPage {
                items: vec![],
                next_cursor: None,
                consistency: "live",
            });
        };
        binds.push(expr);
        sql.push_str(
            " AND a.rowid IN (SELECT rowid FROM annotations_fts WHERE annotations_fts MATCH ?1)",
        );
    }
    for (column, value) in [("book_id", &input.book_id), ("type", &input.kind)] {
        if let Some(value) = value {
            binds.push(value.clone());
            sql.push_str(&format!(" AND a.{column} = ?{}", binds.len()));
        }
    }
    if let Some(cursor) = cursor {
        binds.push(cursor.created_at);
        binds.push(cursor.id);
        sql.push_str(&format!(
            " AND (a.created_at, a.id) < (?{}, ?{})",
            binds.len() - 1,
            binds.len()
        ));
    }
    sql.push_str(&format!(
        " ORDER BY a.created_at DESC, a.id DESC LIMIT {}",
        limit + 1
    ));
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(binds.iter()), row_to_annotation)?;
    let mut items = rows.collect::<Result<Vec<_>, _>>()?;
    let next_cursor = if items.len() > limit {
        items.truncate(limit);
        let last = items.last().expect("positive page limit");
        Some(
            URL_SAFE_NO_PAD.encode(
                serde_json::to_vec(&Cursor {
                    v: 1,
                    book_id: input.book_id,
                    kind: input.kind,
                    query: input.query,
                    created_at: last.created_at.clone(),
                    id: last.id.clone(),
                })
                .map_err(|error| CommandError::internal(error.to_string()))?,
            ),
        )
    } else {
        None
    };
    Ok(AnnotationPage {
        items,
        next_cursor,
        consistency: "live",
    })
}

#[cfg(test)]
mod tests {
    use super::super::{apply_connection_pragmas, register_sql_functions, run_migrations};
    use super::*;

    fn database() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_connection_pragmas(&conn).unwrap();
        register_sql_functions(&conn).unwrap();
        run_migrations(&mut conn).unwrap();
        conn
    }
    fn insert(conn: &Connection, id: &str, book: &str, kind: &str, text: &str) {
        conn.execute("INSERT INTO annotations(id,book_id,type,text,created_at,updated_at) VALUES (?1,?2,?3,?4,'2026-09-09T00:00:00Z','2026-09-09T00:00:00Z')",
            [id, book, kind, text]).unwrap();
    }
    fn query(limit: usize) -> AnnotationPageQuery {
        AnnotationPageQuery {
            limit: Some(limit),
            ..Default::default()
        }
    }

    #[test]
    fn annotations_page_traverses_equal_timestamps_without_duplicates() {
        let conn = database();
        for n in 0..253 {
            insert(&conn, &format!("id-{n:04}"), "book", "note", "Note");
        }
        let mut input = query(17);
        let mut ids = vec![];
        loop {
            let page = annotations_page_inner(&conn, input.clone()).unwrap();
            assert!(page.items.len() <= 17);
            assert_eq!(page.consistency, "live");
            ids.extend(page.items.into_iter().map(|item| item.id));
            input.cursor = page.next_cursor;
            if input.cursor.is_none() {
                break;
            }
        }
        assert_eq!(
            ids,
            (0..253)
                .rev()
                .map(|n| format!("id-{n:04}"))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn annotations_page_live_bookmark_survives_deleted_boundary_and_newer_inserts() {
        let conn = database();
        for id in ["a", "b", "c", "d"] {
            insert(&conn, id, "book", "note", "Note");
        }
        let first = annotations_page_inner(&conn, query(2)).unwrap();
        assert_eq!(first.items[1].id, "c");
        conn.execute("DELETE FROM annotations WHERE id = 'c'", [])
            .unwrap();
        insert(&conn, "z", "book", "note", "Newer insertion");
        let next = annotations_page_inner(
            &conn,
            AnnotationPageQuery {
                cursor: first.next_cursor,
                ..query(10)
            },
        )
        .unwrap();
        assert_eq!(
            next.items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["b", "a"]
        );
        assert!(next.next_cursor.is_none());
    }

    #[test]
    fn annotations_page_composes_fts_book_kind_and_rejects_cursor_retargeting() {
        let conn = database();
        for id in ["a", "b", "c"] {
            insert(&conn, id, "book", "note", "习惯与 habits");
        }
        insert(&conn, "z", "other", "note", "习惯");
        insert(&conn, "y", "book", "ask", "习惯");
        let mut input = AnnotationPageQuery {
            book_id: Some("book".into()),
            kind: Some("note".into()),
            query: Some(" 习惯 ".into()),
            ..query(1)
        };
        let first = annotations_page_inner(&conn, input.clone()).unwrap();
        assert_eq!(first.items[0].id, "c");
        input.cursor = first.next_cursor;
        input.query = Some("习惯".into());
        assert_eq!(
            annotations_page_inner(&conn, input.clone()).unwrap().items[0].id,
            "b"
        );
        for changed in [
            AnnotationPageQuery {
                book_id: Some("other".into()),
                ..input.clone()
            },
            AnnotationPageQuery {
                kind: Some("ask".into()),
                ..input.clone()
            },
            AnnotationPageQuery {
                query: Some("habit".into()),
                ..input.clone()
            },
            AnnotationPageQuery {
                book_id: None,
                ..input.clone()
            },
        ] {
            assert_eq!(
                annotations_page_inner(&conn, changed).unwrap_err().code,
                "annotations/invalid-cursor"
            );
        }
        let english = annotations_page_inner(
            &conn,
            AnnotationPageQuery {
                query: Some("habit".into()),
                ..query(100)
            },
        )
        .unwrap();
        assert_eq!(english.items.len(), 3);
        assert!(annotations_page_inner(
            &conn,
            AnnotationPageQuery {
                query: Some("??".into()),
                ..query(1)
            }
        )
        .unwrap()
        .items
        .is_empty());
    }

    #[test]
    fn annotations_page_validates_limits_and_cursor_envelopes() {
        let conn = database();
        for limit in [0, 101, usize::MAX] {
            assert_eq!(
                annotations_page_inner(&conn, query(limit))
                    .unwrap_err()
                    .code,
                "annotations/invalid-input"
            );
        }
        for cursor in [
            String::new(),
            "not-json".into(),
            "x".repeat(8193),
            URL_SAFE_NO_PAD.encode(br#"{"v":99}"#),
        ] {
            assert_eq!(
                annotations_page_inner(
                    &conn,
                    AnnotationPageQuery {
                        cursor: Some(cursor),
                        ..query(20)
                    }
                )
                .unwrap_err()
                .code,
                "annotations/invalid-cursor"
            );
        }
        assert_eq!(
            annotations_page_inner(
                &conn,
                AnnotationPageQuery {
                    kind: Some("invalid".into()),
                    ..query(1)
                }
            )
            .unwrap_err()
            .code,
            "annotations/invalid-input"
        );
        conn.execute("DROP TABLE annotations", []).unwrap();
        assert_eq!(
            annotations_page_inner(&conn, query(1)).unwrap_err().code,
            "db/error"
        );
    }

    #[test]
    fn annotations_page_indexes_support_filtered_keyset_order_without_temp_sort() {
        let conn = database();
        let mut query = conn.prepare("EXPLAIN QUERY PLAN SELECT * FROM annotations WHERE book_id='book' AND type='note' AND (created_at,id)<('2026','id') ORDER BY created_at DESC,id DESC LIMIT 21").unwrap();
        let plan = query
            .query_map([], |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .join("\n");
        assert!(plan.contains("ix_annotations_book_kind_page"), "{plan}");
        assert!(!plan.contains("TEMP B-TREE"), "{plan}");
    }
}

#[tauri::command]
pub fn annotations_page(
    input: AnnotationPageQuery,
    db: tauri::State<'_, super::Db>,
) -> Result<AnnotationPage, CommandError> {
    let conn = db.0.lock()?;
    annotations_page_inner(&conn, input)
}
