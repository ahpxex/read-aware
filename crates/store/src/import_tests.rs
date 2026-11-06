use super::*;
use crate::storage::{init_db, put_blob_inner, StoreLock, Wait};

struct Library {
    dir: tempfile::TempDir,
    db: Db,
    _lock: StoreLock,
}

fn library() -> Library {
    let dir = tempfile::tempdir().unwrap();
    let lock = StoreLock::acquire(dir.path(), Wait::Fail).unwrap();
    let db = Db::new(init_db(dir.path(), &lock, Wait::Fail).unwrap());
    Library {
        dir,
        db,
        _lock: lock,
    }
}

fn request(file_name: &str) -> ImportBookRequest {
    ImportBookRequest {
        book_id: uuid::Uuid::new_v4().to_string(),
        file_name: file_name.to_owned(),
        mime_type: None,
        source_path: None,
        origin: None,
        dedupe_by_name: true,
    }
}

fn source(lib: &Library, name: &str, bytes: &[u8]) -> std::path::PathBuf {
    let path = lib.dir.path().join("picked").join(name);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, bytes).unwrap();
    path
}

fn count(lib: &Library, sql: &str) -> i64 {
    lib.db
        .0
        .lock()
        .unwrap()
        .query_row(sql, [], |row| row.get(0))
        .unwrap()
}

fn import(
    lib: &Library,
    request: &ImportBookRequest,
    path: &Path,
) -> Result<ImportBookOutcome, CommandError> {
    import_book(
        &lib.db,
        lib.dir.path(),
        "owner",
        request,
        StageFrom::File(path),
        ImportIntent::Record,
    )
}

const PROSE: &[u8] = b"It was the best of times, it was the worst of times.\n";

#[test]
fn a_text_file_imports_with_its_file_name_and_a_settled_verdict() {
    let lib = library();
    let path = source(&lib, "a tale of two cities - charles dickens.txt", PROSE);
    let req = request("a tale of two cities - charles dickens.txt");
    let ImportBookOutcome::Imported {
        book,
        cover,
        metadata_deferred,
        events,
    } = import(&lib, &req, &path).unwrap()
    else {
        panic!("expected an import");
    };
    assert_eq!(book.id, req.book_id);
    assert_eq!(book.title, "A Tale Of Two Cities");
    assert_eq!(book.author, "Charles Dickens");
    assert_eq!(book.format, "txt");
    assert_eq!(book.file_size, PROSE.len() as i64);
    assert_eq!(book.cover_status, "none");
    assert_eq!(book.metadata_status.as_deref(), Some("settled"));
    assert_eq!(cover, CoverOutcome::None);
    assert!(!metadata_deferred);
    let types: Vec<_> = events
        .iter()
        .map(|event| event.event_type.as_str())
        .collect();
    assert_eq!(types, ["book.imported", "book.coverExtracted"]);
    assert_eq!(count(&lib, "SELECT COUNT(*) FROM book_import_cleanup"), 0);
    assert_eq!(count(&lib, "SELECT COUNT(*) FROM event_sync_state"), 2);
    assert!(lib
        .dir
        .path()
        .join("blobs")
        .join(blob_file_name(&format!("bookfile:{}", req.book_id)))
        .exists());
}

#[test]
fn the_same_file_again_is_a_duplicate_by_name_or_by_content() {
    let lib = library();
    let path = source(&lib, "book.txt", PROSE);
    let ImportBookOutcome::Imported { book: first, .. } =
        import(&lib, &request("book.txt"), &path).unwrap()
    else {
        panic!("expected an import");
    };
    // Same name and size: no copy at all.
    match import(&lib, &request("book.txt"), &path).unwrap() {
        ImportBookOutcome::Duplicate { book } => assert_eq!(book.id, first.id),
        other => panic!("expected a duplicate, got {other:?}"),
    }
    // Renamed: caught by content, and this import's files are released.
    let renamed = source(&lib, "renamed.txt", PROSE);
    let req = request("renamed.txt");
    match import(&lib, &req, &renamed).unwrap() {
        ImportBookOutcome::Duplicate { book } => assert_eq!(book.id, first.id),
        other => panic!("expected a duplicate, got {other:?}"),
    }
    assert_eq!(count(&lib, "SELECT COUNT(*) FROM books"), 1);
    assert_eq!(count(&lib, "SELECT COUNT(*) FROM book_import_cleanup"), 0);
    assert!(!lib
        .dir
        .path()
        .join("blobs")
        .join(blob_file_name(&format!("bookfile:{}", req.book_id)))
        .exists());
}

#[test]
fn an_unreadable_format_leaves_nothing_behind() {
    let lib = library();
    let junk: Vec<u8> = (0..256).map(|i| (i * 37 + 11) as u8).collect();
    let path = source(&lib, "mystery.bin", &junk);
    let error = import(&lib, &request("mystery.bin"), &path).unwrap_err();
    assert_eq!(error.code, "book/unsupported-format");
    assert_eq!(count(&lib, "SELECT COUNT(*) FROM books"), 0);
    assert_eq!(count(&lib, "SELECT COUNT(*) FROM book_import_cleanup"), 0);
    assert_eq!(count(&lib, "SELECT COUNT(*) FROM blob_objects"), 0);
}

#[test]
fn engine_only_formats_wait_for_the_reader_and_a_settlement_closes_them() {
    let lib = library();
    let path = source(
        &lib,
        "comic.cbr",
        b"Rar!\x1a\x07\x00 not really a rar archive",
    );
    let req = request("comic.cbr");
    let ImportBookOutcome::Imported {
        book,
        cover,
        metadata_deferred,
        events,
    } = import(&lib, &req, &path).unwrap()
    else {
        panic!("expected an import");
    };
    assert_eq!(cover, CoverOutcome::Deferred);
    assert!(metadata_deferred);
    assert_eq!(book.cover_status, "unchecked");
    assert_eq!(book.metadata_status.as_deref(), Some("deferred"));
    assert_eq!(events.len(), 1, "no cover verdict yet");

    let mut conn = lib.db.0.lock().unwrap();
    let tx = conn.transaction().unwrap();
    let hlc = next_local_stamps(&tx, 1).unwrap().remove(0);
    let settled = EventRow {
        id: uuid::Uuid::new_v4().to_string(),
        event_type: "book.metadataSettled".into(),
        hlc,
        schema_version: Some(1),
        aggregate_type: Some("book".into()),
        aggregate_id: Some(req.book_id.clone()),
        actor_id: None,
        origin: Some("system".into()),
        created_at: None,
        payload: serde_json::json!({ "bookId": req.book_id }),
    };
    commit_events_in_transaction(&tx, &[settled]).unwrap();
    tx.commit().unwrap();
    let book = get_book_inner(&conn, &req.book_id).unwrap().unwrap();
    assert_eq!(book.metadata_status.as_deref(), Some("settled"));
}

#[test]
fn bytes_the_host_staged_import_under_the_intent_it_recorded() {
    let lib = library();
    let req = request("dropped.txt");
    {
        let conn = lib.db.0.lock().unwrap();
        begin_inner(&conn, lib.dir.path(), &req.book_id, "owner").unwrap();
        put_blob_inner(
            &conn,
            lib.dir.path(),
            &format!("bookfile:{}", req.book_id),
            None,
            PROSE,
        )
        .unwrap();
    }
    let outcome = import_book(
        &lib.db,
        lib.dir.path(),
        "owner",
        &req,
        StageFrom::Staged,
        ImportIntent::AlreadyRecorded,
    )
    .unwrap();
    assert!(matches!(outcome, ImportBookOutcome::Imported { .. }));
    // The committed book cleared the host's intent.
    assert_eq!(count(&lib, "SELECT COUNT(*) FROM book_import_cleanup"), 0);
}

#[test]
fn native_stamps_follow_a_frontier_from_the_future() {
    let lib = library();
    let future = 4_102_444_800_000_i64;
    {
        let conn = lib.db.0.lock().unwrap();
        let device: String = conn
            .query_row("SELECT device_id FROM local_device WHERE id=1", [], |row| {
                row.get(0)
            })
            .unwrap();
        conn.execute(
            "INSERT INTO domain_events (id, type, schema_version, hlc_wall_ms, hlc_counter, hlc_device, payload_json, created_at)
             VALUES ('ahead', 'book.starred', 1, ?1, 4, ?2, '{}', 'now')",
            params![future, device],
        )
        .unwrap();
    }
    let path = source(&lib, "later.txt", PROSE);
    let ImportBookOutcome::Imported { events, .. } =
        import(&lib, &request("later.txt"), &path).unwrap()
    else {
        panic!("expected an import");
    };
    let stamps: Vec<_> = events
        .iter()
        .map(|event| (event.hlc.wall_ms, event.hlc.counter))
        .collect();
    assert_eq!(stamps, [(future, 5), (future, 6)]);
}
