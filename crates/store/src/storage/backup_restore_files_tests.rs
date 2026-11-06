use super::*;
fn db(path: &Path) -> Connection {
    let mut conn = Connection::open(path).unwrap();
    crate::storage::apply_connection_pragmas(&conn).unwrap();
    crate::storage::register_sql_functions(&conn).unwrap();
    crate::storage::run_migrations(&mut conn).unwrap();
    conn
}
fn digest(bytes: &[u8]) -> FileDigest {
    FileDigest {
        bytes: bytes.len() as u64,
        sha256: format!("{:x}", Sha256::digest(bytes)),
    }
}
fn changes(root: &Path) -> Vec<FileChange> {
    vec![
        FileChange {
            path: "blobs/book.epub".into(),
            before: Some(digest(b"old book")),
            after: Some(FileSource::File {
                path: root.join("incoming"),
                digest: digest(b"new book"),
            }),
        },
        FileChange {
            path: "secret.key".into(),
            before: None,
            after: Some(FileSource::Key(Zeroizing::new(vec![7; 32]))),
        },
        FileChange {
            path: "plugins/proof/obsolete.js".into(),
            before: Some(digest(b"old code")),
            after: None,
        },
    ]
}
fn setup(root: &Path) {
    fs::create_dir_all(root.join("blobs")).unwrap();
    fs::create_dir_all(root.join("plugins/proof")).unwrap();
    fs::write(root.join("blobs/book.epub"), b"old book").unwrap();
    fs::write(root.join("plugins/proof/obsolete.js"), b"old code").unwrap();
    fs::write(root.join("incoming"), b"new book").unwrap();
}
fn assert_before(root: &Path) {
    assert_eq!(fs::read(root.join("blobs/book.epub")).unwrap(), b"old book");
    assert_eq!(
        fs::read(root.join("plugins/proof/obsolete.js")).unwrap(),
        b"old code"
    );
    assert!(!root.join("secret.key").exists());
}
fn assert_after(root: &Path) {
    assert_eq!(fs::read(root.join("blobs/book.epub")).unwrap(), b"new book");
    assert!(!root.join("plugins/proof/obsolete.js").exists());
    assert_eq!(fs::read(root.join("secret.key")).unwrap(), vec![7; 32]);
}
#[test]
fn backup_restore_files_requires_a_write_lock_without_changing_database_evidence() {
    let root = tempfile::tempdir().unwrap();
    setup(root.path());
    let mut conn = db(&root.path().join("db"));
    let sequences = |conn: &Connection| {
        conn.prepare("SELECT name,seq FROM sqlite_sequence ORDER BY name")
            .unwrap()
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    let before = sequences(&conn);
    let tx = conn.transaction().unwrap();
    assert_eq!(
        FileRestore::prepare(&tx, root.path(), changes(root.path()), || Ok(()))
            .err()
            .unwrap()
            .code,
        "backup/incomplete"
    );
    assert!(!root.path().join(DIRECTORY).exists());
    tx.rollback().unwrap();
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    let writes = tx.total_changes();
    let _restore = FileRestore::prepare(&tx, root.path(), changes(root.path()), || Ok(())).unwrap();
    assert_eq!(tx.total_changes(), writes);
    assert_eq!(sequences(&tx), before);
    assert_before(root.path());
    tx.rollback().unwrap();
}
#[test]
fn backup_restore_files_commit_and_rollback_follow_the_database_decision() {
    for commit in [false, true] {
        let root = tempfile::tempdir().unwrap();
        setup(root.path());
        let mut conn = db(&root.path().join("db"));
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        let restore =
            FileRestore::prepare(&tx, root.path(), changes(root.path()), || Ok(())).unwrap();
        assert_before(root.path());
        restore.install(|| Ok(())).unwrap();
        assert_after(root.path());
        tx.execute(
            "INSERT INTO app_kv(key,value_json,updated_at) VALUES ('data','\"restored\"','now')",
            [],
        )
        .unwrap();
        restore.accept(&tx).unwrap();
        if commit {
            tx.commit().unwrap();
        } else {
            tx.rollback().unwrap();
        }
        drop(restore);
        recover(&mut conn, root.path()).unwrap();
        if commit {
            assert_after(root.path());
        } else {
            assert_before(root.path());
        }
        assert_eq!(
            conn.query_row("SELECT count(*) FROM app_kv WHERE key='data'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            i64::from(commit)
        );
        assert_eq!(
            fs::read_dir(root.path().join(DIRECTORY)).unwrap().count(),
            0
        );
        recover(&mut conn, root.path()).unwrap();
    }
}
#[test]
fn backup_restore_files_cancellation_after_first_replacement_keeps_a_recoverable_baseline() {
    let root = tempfile::tempdir().unwrap();
    setup(root.path());
    let mut conn = db(&root.path().join("db"));
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    let restore = FileRestore::prepare(&tx, root.path(), changes(root.path()), || Ok(())).unwrap();
    let error = restore
        .install(|| {
            if fs::read(root.path().join("blobs/book.epub"))? == b"new book" {
                Err(CommandError::new(
                    "backup/cancelled",
                    "injected cancellation",
                ))
            } else {
                Ok(())
            }
        })
        .unwrap_err();
    assert_eq!(error.code, "backup/cancelled");
    tx.rollback().unwrap();
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    assert!(FileRestore::prepare(&tx, root.path(), changes(root.path()), || Ok(())).is_err());
    tx.rollback().unwrap();
    recover(&mut conn, root.path()).unwrap();
    assert_before(root.path());
}
#[test]
fn backup_restore_files_recovery_waits_for_active_writer_and_retains_damaged_baseline() {
    let root = tempfile::tempdir().unwrap();
    setup(root.path());
    let mut conn = db(&root.path().join("db"));
    let mut other = db(&root.path().join("db"));
    other.busy_timeout(std::time::Duration::ZERO).unwrap();
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    let restore = FileRestore::prepare(&tx, root.path(), changes(root.path()), || Ok(())).unwrap();
    restore.install(|| Ok(())).unwrap();
    assert!(recover(&mut other, root.path()).is_err());
    assert_after(root.path());
    tx.rollback().unwrap();
    fs::write(restore.directory.join("0.before"), b"damaged").unwrap();
    assert!(recover(&mut other, root.path()).is_err());
    assert!(restore.directory.join("ready.json").exists());
    fs::write(restore.directory.join("0.before"), b"old book").unwrap();
    recover(&mut other, root.path()).unwrap();
    assert_before(root.path());
}
#[test]
fn backup_restore_files_rejects_changed_bytes_and_unsafe_destinations_before_live_writes() {
    let root = tempfile::tempdir().unwrap();
    setup(root.path());
    let mut conn = db(&root.path().join("db"));
    for bad in [
        "changed",
        "traversal",
        "database",
        "key-replacement",
        "unexpected",
    ] {
        let mut selected = changes(root.path());
        match bad {
            "changed" => selected[0].before = Some(digest(b"different")),
            "traversal" => selected[0].path = "blobs/../database.sqlite".into(),
            "database" => selected[0].path = "database.sqlite".into(),
            "key-replacement" => selected[1].before = Some(digest(&[9; 32])),
            _ => selected[0].before = None,
        }
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        assert!(FileRestore::prepare(&tx, root.path(), selected, || Ok(())).is_err());
        tx.rollback().unwrap();
        recover(&mut conn, root.path()).unwrap();
        assert_before(root.path());
    }
}

// Exit without destructors: the parent proves SQLite recovery and the durable
// filesystem journal agree after an actual process dies on either side of COMMIT.
#[test]
#[ignore]
fn backup_restore_files_crash_child() {
    let root = PathBuf::from(std::env::var("READAWARE_RESTORE_CRASH_ROOT").unwrap());
    let mut conn = db(&root.join("db"));
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    let restore = FileRestore::prepare(&tx, &root, changes(&root), || Ok(())).unwrap();
    restore.install(|| Ok(())).unwrap();
    tx.execute(
        "INSERT INTO app_kv(key,value_json,updated_at) VALUES ('data','\"restored\"','now')",
        [],
    )
    .unwrap();
    restore.accept(&tx).unwrap();
    if std::env::var("READAWARE_RESTORE_CRASH_COMMIT").unwrap() == "yes" {
        tx.commit().unwrap();
    }
    std::process::exit(73);
}
#[test]
fn backup_restore_files_recovers_real_process_exit_before_and_after_sqlite_commit() {
    for commit in [false, true] {
        let root = tempfile::tempdir().unwrap();
        setup(root.path());
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "storage::backup_restore_files::tests::backup_restore_files_crash_child",
            ])
            .env("READAWARE_RESTORE_CRASH_ROOT", root.path())
            .env(
                "READAWARE_RESTORE_CRASH_COMMIT",
                if commit { "yes" } else { "no" },
            )
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(73));
        let mut conn = db(&root.path().join("db"));
        recover(&mut conn, root.path()).unwrap();
        if commit {
            assert_after(root.path());
        } else {
            assert_before(root.path());
        }
        assert_eq!(
            conn.query_row("SELECT count(*) FROM app_kv WHERE key='data'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            i64::from(commit)
        );
    }
}
