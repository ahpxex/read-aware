use super::super::{
    apply_connection_pragmas,
    blobs::{get_blob_inner, put_blob_inner},
    register_sql_functions, run_migrations,
};
use super::*;

fn open(path: &Path) -> Connection {
    let mut conn = Connection::open(path).unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    conn
}
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn book(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO books(id,title,author,format,file_name,file_size,created_at,updated_at)
        VALUES (?1,'Imported','Test','fb2','test.fb2',4,'now','now')",
        [id],
    )
    .unwrap();
}
fn pending(conn: &Connection, id: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM book_import_cleanup WHERE book_id=?1)",
        [id],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn restart_recovers_only_prior_uncommitted_imports_and_keeps_current_writer() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let conn = open(&path);
    let abandoned = id();
    let current = id();
    let committed = id();
    for (id, owner) in [(&abandoned, "old"), (&current, "new"), (&committed, "old")] {
        begin_inner(&conn, dir.path(), id, owner).unwrap();
        put_blob_inner(&conn, dir.path(), &format!("bookfile:{id}"), None, b"book").unwrap();
        put_blob_inner(&conn, dir.path(), &format!("cover:{id}"), None, b"cover").unwrap();
    }
    book(&conn, &committed);
    assert!(!pending(&conn, &committed));
    drop(conn);
    let db = Db::new(open(&path));
    recover_import_cleanup(&db, dir.path(), "new").unwrap();
    let conn = db.0.lock().unwrap();
    assert!(!pending(&conn, &abandoned));
    assert!(pending(&conn, &current));
    for key in ["bookfile", "cover"] {
        assert!(
            get_blob_inner(&conn, dir.path(), &format!("{key}:{abandoned}"))
                .unwrap()
                .is_empty()
        );
    }
    for id in [&current, &committed] {
        assert_eq!(
            get_blob_inner(&conn, dir.path(), &format!("bookfile:{id}")).unwrap(),
            b"book"
        );
    }
}

#[test]
fn failed_projection_transaction_preserves_intent_and_cleanup_failure_remains_retryable() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open(&dir.path().join("db"));
    let id = id();
    begin_inner(&conn, dir.path(), &id, "old").unwrap();
    put_blob_inner(&conn, dir.path(), &format!("bookfile:{id}"), None, b"book").unwrap();
    {
        let tx = conn.transaction().unwrap();
        book(&tx, &id);
        assert!(!pending(&tx, &id));
    }
    assert!(pending(&conn, &id));
    super::super::events::set_projections_stale_conn(&conn, true).unwrap();
    assert_eq!(
        finish_inner(&mut conn, dir.path(), &id, "old")
            .unwrap_err()
            .code,
        "library/cleanup-stale"
    );
    assert_eq!(
        get_blob_inner(&conn, dir.path(), &format!("bookfile:{id}")).unwrap(),
        b"book"
    );
    super::super::events::set_projections_stale_conn(&conn, false).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_import_cleanup BEFORE UPDATE OF deleted_at ON blob_objects BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    assert!(finish_inner(&mut conn, dir.path(), &id, "old").is_err());
    assert!(pending(&conn, &id));
    conn.execute_batch("DROP TRIGGER reject_import_cleanup;")
        .unwrap();
    finish_inner(&mut conn, dir.path(), &id, "old").unwrap();
    assert!(!pending(&conn, &id));
    finish_inner(&mut conn, dir.path(), &id, "old").unwrap();
}

#[test]
fn fresh_id_and_owner_guards_never_adopt_existing_or_unowned_assets() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open(&dir.path().join("db"));
    let existing = id();
    let own = id();
    put_blob_inner(
        &conn,
        dir.path(),
        &format!("bookfile:{existing}"),
        None,
        b"keep",
    )
    .unwrap();
    assert!(begin_inner(&conn, dir.path(), &existing, "new").is_err());
    assert!(begin_inner(&conn, dir.path(), "invalid", "new").is_err());
    begin_inner(&conn, dir.path(), &own, "old").unwrap();
    put_blob_inner(&conn, dir.path(), &format!("bookfile:{own}"), None, b"keep").unwrap();
    finish_inner(&mut conn, dir.path(), &own, "new").unwrap();
    assert!(pending(&conn, &own));
    finish_inner(&mut conn, dir.path(), &existing, "new").unwrap();
    assert_eq!(
        get_blob_inner(&conn, dir.path(), &format!("bookfile:{existing}")).unwrap(),
        b"keep"
    );
}

#[test]
fn recovery_releases_owned_unregistered_files_and_temporary_copies_only() {
    let dir = tempfile::tempdir().unwrap();
    let conn = open(&dir.path().join("db"));
    let abandoned = id();
    let unowned = id();
    begin_inner(&conn, dir.path(), &abandoned, "old").unwrap();
    std::fs::create_dir_all(dir.path().join("blobs")).unwrap();
    for path in paths(dir.path(), &abandoned) {
        std::fs::write(path, b"interrupted copy").unwrap();
    }
    let keep = paths(dir.path(), &unowned).remove(0);
    std::fs::write(&keep, b"retain").unwrap();
    assert!(begin_inner(&conn, dir.path(), &unowned, "new").is_err());
    let db = Db::new(conn);
    recover_import_cleanup(&db, dir.path(), "new").unwrap();
    assert!(paths(dir.path(), &abandoned).iter().all(|p| !p.exists()));
    assert_eq!(std::fs::read(keep).unwrap(), b"retain");
}
