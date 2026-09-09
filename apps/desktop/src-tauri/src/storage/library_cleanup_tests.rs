use super::*;
use super::super::{apply_connection_pragmas, register_sql_functions, run_migrations, blobs::{put_blob_inner, get_blob_inner}};

fn open(path: &Path) -> Connection {
    let mut conn = Connection::open(path).unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    conn
}
fn book(conn: &Connection, id: &str) {
    conn.execute("INSERT INTO books(id,title,author,format,file_name,file_size,created_at,updated_at)
        VALUES (?1,?1,'Test','fb2','test.fb2',4,'2026-09-09','2026-09-09')", [id]).unwrap();
}
fn pending(conn: &Connection) -> Vec<String> {
    list_removal_cleanup_inner(conn, None, 100).unwrap().items.into_iter().map(|item| item.book_id).collect()
}

#[test]
fn cleanup_intent_is_atomic_with_record_deletion() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open(&dir.path().join("db"));
    book(&conn, "a"); book(&conn, "b");
    conn.execute_batch("CREATE TRIGGER reject_second BEFORE DELETE ON books WHEN old.id='b'
        BEGIN SELECT RAISE(ABORT,'reject'); END;").unwrap();
    {
        let tx = conn.transaction().unwrap();
        tx.execute("DELETE FROM books WHERE id='a'", []).unwrap();
        assert!(tx.execute("DELETE FROM books WHERE id='b'", []).is_err());
    }
    assert!(pending(&conn).is_empty());
    assert_eq!(conn.query_row("SELECT count(*) FROM books", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
    conn.execute_batch("DROP TRIGGER reject_second; DELETE FROM books;").unwrap();
    assert_eq!(pending(&conn), ["a", "b"]);
}

#[test]
fn failed_cleanup_survives_reopen_and_boot_recovers_without_record_writes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let mut conn = open(&path);
    book(&conn, "a");
    put_blob_inner(&conn, dir.path(), "bookfile:a", None, b"book").unwrap();
    conn.execute_batch("DELETE FROM books; CREATE TRIGGER reject_files BEFORE UPDATE OF deleted_at ON blob_objects
        WHEN new.key='bookfile:a' BEGIN SELECT RAISE(ABORT,'reject'); END;").unwrap();
    assert!(release_book_files_inner(&mut conn, dir.path(), &["a".into()]).is_err());
    assert_eq!(pending(&conn), ["a"]);
    drop(conn);
    let conn = open(&path);
    assert_eq!(pending(&conn), ["a"]);
    conn.execute_batch("DROP TRIGGER reject_files;").unwrap();
    let db = Db(std::sync::Mutex::new(conn));
    recover_book_removal_cleanup(&db, dir.path()).unwrap();
    let conn = db.0.lock().unwrap();
    assert!(pending(&conn).is_empty());
    assert!(get_blob_inner(&conn, dir.path(), "bookfile:a").unwrap().is_empty());
    assert_eq!(conn.query_row("SELECT count(*) FROM domain_events", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
}

#[test]
fn restore_cancels_intent_and_whole_batch_preflight_preserves_other_files() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open(&dir.path().join("db"));
    for id in ["a", "b"] {
        book(&conn, id);
        put_blob_inner(&conn, dir.path(), &format!("bookfile:{id}"), None, b"book").unwrap();
    }
    conn.execute("DELETE FROM books", []).unwrap();
    book(&conn, "b");
    assert_eq!(pending(&conn), ["a"]);
    assert!(release_book_files_inner(&mut conn, dir.path(), &["a".into(), "b".into()]).is_err());
    assert_eq!(get_blob_inner(&conn, dir.path(), "bookfile:a").unwrap(), b"book");
    assert_eq!(get_blob_inner(&conn, dir.path(), "bookfile:b").unwrap(), b"book");
}

#[test]
fn keyset_progresses_past_failures_and_stale_projections_forbid_cleanup() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open(&dir.path().join("db"));
    for id in ["a", "b", "c"] { book(&conn, id); }
    conn.execute("DELETE FROM books", []).unwrap();
    let first = list_removal_cleanup_inner(&conn, None, 2).unwrap();
    assert_eq!(first.next_cursor.as_deref(), Some("b"));
    let second = list_removal_cleanup_inner(&conn, first.next_cursor.as_deref(), 2).unwrap();
    assert_eq!(second.items[0].book_id, "c"); assert!(second.next_cursor.is_none());
    assert!(list_removal_cleanup_inner(&conn, None, 101).is_err());
    assert!(list_removal_cleanup_inner(&conn, Some(" "), 2).is_err());
    assert!(list_removal_cleanup_inner(&conn, Some(&"\u{1F600}".repeat(129)), 2).is_err());
    super::super::events::set_projections_stale_conn(&conn, true).unwrap();
    assert!(list_removal_cleanup_inner(&conn, None, 2).is_err());
    assert!(release_book_files_inner(&mut conn, dir.path(), &["a".into()]).is_err());
    super::super::events::set_projections_stale_conn(&conn, false).unwrap();
    assert_eq!(pending(&conn), ["a", "b", "c"]);
}

#[test]
fn boot_does_not_starve_later_pages_when_one_intent_fails() {
    let dir = tempfile::tempdir().unwrap();
    let conn = open(&dir.path().join("db"));
    for index in 0..105 { book(&conn, &format!("b{index:03}")); }
    conn.execute_batch("DELETE FROM books; CREATE TRIGGER reject_intent BEFORE DELETE ON book_removal_cleanup
        WHEN old.book_id='b000' BEGIN SELECT RAISE(ABORT,'reject'); END;").unwrap();
    let db = Db(std::sync::Mutex::new(conn));
    recover_book_removal_cleanup(&db, dir.path()).unwrap();
    assert_eq!(pending(&db.0.lock().unwrap()), ["b000"]);
}

#[test]
fn factory_reset_clears_intents_produced_by_its_book_deletes() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open(&dir.path().join("db"));
    book(&conn, "pending");
    conn.execute("DELETE FROM books", []).unwrap();
    book(&conn, "current");
    super::super::wipe_all_data_inner(&mut conn, dir.path()).unwrap();
    assert!(pending(&conn).is_empty());
    assert_eq!(conn.query_row("SELECT count(*) FROM books", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
}
