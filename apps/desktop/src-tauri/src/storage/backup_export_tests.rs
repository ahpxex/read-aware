use super::*;
use crate::error::CODE_EXPORT_TARGET_INVALID;
use crate::save_targets::{LocalFiles, SaveTarget};
use crate::storage::backup_tasks::IDLE_LIMIT;
use std::time::Instant;
#[test]
fn backup_export_sources_include_all_blob_kinds_and_reject_unsafe_locations() {
    let data = tempfile::tempdir().unwrap();
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::storage::register_sql_functions(&conn).unwrap();
    crate::storage::run_migrations(&mut conn).unwrap();
    for key in ["bookfile:one", "booktext:one", "cover:one", "plugin:one"] {
        crate::storage::put_blob_inner(&conn, data.path(), key, None, b"source").unwrap();
    }
    assert!(missing_sources(&conn, data.path()).unwrap().is_empty());
    conn.execute(
        "UPDATE blob_objects SET storage_uri=NULL WHERE key='booktext:one'",
        [],
    )
    .unwrap();
    std::fs::remove_file(
        data.path()
            .join("blobs")
            .join(crate::storage::blob_file_name("cover:one")),
    )
    .unwrap();
    assert_eq!(
        missing_sources(&conn, data.path()).unwrap(),
        ["booktext:one", "cover:one"]
    );
    conn.execute(
        "UPDATE blob_objects SET deleted_at='now' WHERE key='booktext:one'",
        [],
    )
    .unwrap();
    assert_eq!(missing_sources(&conn, data.path()).unwrap(), ["cover:one"]);
    conn.execute(
        "UPDATE blob_objects SET storage_uri='../escape' WHERE key='plugin:one'",
        [],
    )
    .unwrap();
    assert_eq!(
        missing_sources(&conn, data.path()).unwrap_err().code,
        "backup/incomplete"
    );
}
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn make_snapshot(root: &Path, staging: &Path) -> backup_snapshot::BackupSnapshot {
    let mut conn = rusqlite::Connection::open(root.join("db")).unwrap();
    crate::storage::apply_connection_pragmas(&conn).unwrap();
    crate::storage::register_sql_functions(&conn).unwrap();
    crate::storage::run_migrations(&mut conn).unwrap();
    crate::storage::ensure_local_device(&conn).unwrap();
    conn.execute("INSERT OR REPLACE INTO app_kv(key,value_json,updated_at) VALUES ('private','PRIVATE EXPORT CONTENT','now')", []).unwrap();
    backup_snapshot::capture_fixture(&mut conn, root, staging, |_| Ok(())).unwrap()
}
#[test]
fn backup_export_cancel_keeps_physical_owner_reserved_and_rejects_foreign_access() {
    let tasks = BackupTasks::default();
    let task_id = id();
    let lease = tasks.begin("main", &task_id).unwrap();
    tasks.cancel("foreign", Some(&task_id)).unwrap();
    lease.check().unwrap();
    tasks.cancel("main", Some(&task_id)).unwrap();
    assert_eq!(lease.check().unwrap_err().code, "backup/cancelled");
    assert!(tasks.begin("main", &id()).is_err());
    drop(lease);
    assert!(tasks.is_empty());
    assert!(tasks.take("main", &task_id, Phase::Export).is_err());
    assert!(tasks.begin("main", &id()).is_ok());
}
#[test]
fn backup_export_idle_expiry_and_owner_release_erase_plaintext_without_affecting_active_work() {
    let data = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let tasks = BackupTasks::default();
    let task_id = id();
    let lease = tasks.begin("main", &task_id).unwrap();
    tasks.expire_ready(Instant::now() + IDLE_LIMIT).unwrap();
    lease.check().unwrap();
    let snapshot = make_snapshot(data.path(), staging.path());
    let private = snapshot.directory().to_owned();
    lease.publish(snapshot).unwrap();
    assert!(private.exists());
    assert!(tasks.take("foreign", &task_id, Phase::Export).is_err());
    tasks.expire_ready(Instant::now() + IDLE_LIMIT).unwrap();
    assert!(!private.exists());
    assert!(tasks.take("main", &task_id, Phase::Export).is_err());
    let lease = tasks.begin("main", &id()).unwrap();
    let snapshot = make_snapshot(data.path(), staging.path());
    let private = snapshot.directory().to_owned();
    lease.publish(snapshot).unwrap();
    tasks.cancel_owner("main");
    assert!(!private.exists());
}
#[test]
fn backup_export_writes_only_encrypted_output_then_retires_the_private_snapshot_and_token() {
    let data = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let tasks = BackupTasks::default();
    let task_id = id();
    let lease = tasks.begin("main", &task_id).unwrap();
    let snapshot = make_snapshot(data.path(), staging.path());
    let private = snapshot.directory().to_owned();
    lease.publish(snapshot).unwrap();
    let destination = out.path().join("backup.age");
    let targets = SaveTargets::default();
    targets
        .bind_session(
            "main",
            &task_id,
            SaveTarget::Picked(FilePath::Path(destination.clone())),
        )
        .unwrap();
    write(
        &tasks,
        &targets,
        "main",
        &task_id,
        SecretString::from("a real export task password".to_owned()),
        &LocalFiles::paths(),
        data.path(),
    )
    .unwrap();
    let bytes = std::fs::read(destination).unwrap();
    assert!(bytes.starts_with(b"age-encryption.org/v1\n"));
    assert!(!String::from_utf8_lossy(&bytes).contains("PRIVATE EXPORT CONTENT"));
    assert!(!private.exists());
    assert!(tasks.take("main", &task_id, Phase::Export).is_err());
}
#[test]
fn backup_export_rejects_managed_destinations_and_failures_consume_ready_tasks() {
    let data = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let tasks = BackupTasks::default();
    let task_id = id();
    let lease = tasks.begin("main", &task_id).unwrap();
    let snapshot = make_snapshot(data.path(), staging.path());
    let private = snapshot.directory().to_owned();
    lease.publish(snapshot).unwrap();
    let targets = SaveTargets::default();
    targets
        .bind_session(
            "main",
            &task_id,
            SaveTarget::Picked(FilePath::Path(data.path().join("db"))),
        )
        .unwrap();
    assert_eq!(
        write(
            &tasks,
            &targets,
            "main",
            &task_id,
            SecretString::from("a real export task password".to_owned()),
            &LocalFiles::paths(),
            data.path()
        )
        .unwrap_err()
        .code,
        "backup/invalid-archive"
    );
    assert!(!private.exists());
    assert!(tasks.is_empty());
    let conn = rusqlite::Connection::open(data.path().join("db")).unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT value_json FROM app_kv WHERE key='private'",
            [],
            |row| row.get::<_, String>(0)
        )
        .unwrap(),
        "PRIVATE EXPORT CONTENT"
    );
}
#[test]
fn backup_export_writes_only_to_the_dialog_grant_of_its_own_window_and_task_once() {
    let data = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let password = || SecretString::from("a real export task password".to_owned());
    let tasks = BackupTasks::default();
    let targets = SaveTargets::default();
    let ready = |task_id: &str| {
        let lease = tasks.begin("main", task_id).unwrap();
        lease
            .publish(make_snapshot(data.path(), staging.path()))
            .unwrap();
    };
    let destination = out.path().join("backup.age");
    let attempt = |task_id: &str| {
        write(
            &tasks,
            &targets,
            "main",
            task_id,
            password(),
            &LocalFiles::paths(),
            data.path(),
        )
    };

    // No dialog grant: nothing is written and the ready task is consumed.
    let forged = id();
    ready(&forged);
    assert_eq!(
        attempt(&forged).unwrap_err().code,
        CODE_EXPORT_TARGET_INVALID
    );
    assert!(tasks.is_empty());

    // A grant for another window or another task does not authorize this one.
    let task_id = id();
    ready(&task_id);
    targets
        .bind_session(
            "other",
            &task_id,
            SaveTarget::Picked(FilePath::Path(destination.clone())),
        )
        .unwrap();
    targets
        .bind_session(
            "main",
            &id(),
            SaveTarget::Picked(FilePath::Path(destination.clone())),
        )
        .unwrap();
    assert_eq!(
        attempt(&task_id).unwrap_err().code,
        CODE_EXPORT_TARGET_INVALID
    );
    assert!(!destination.exists());

    // The task's own grant writes once; the grant does not survive the write.
    let task_id = id();
    ready(&task_id);
    targets
        .bind_session(
            "main",
            &task_id,
            SaveTarget::Picked(FilePath::Path(destination.clone())),
        )
        .unwrap();
    attempt(&task_id).unwrap();
    assert!(std::fs::read(&destination)
        .unwrap()
        .starts_with(b"age-encryption.org/v1\n"));
    assert_eq!(
        targets.redeem_session("main", &task_id).unwrap_err().code,
        CODE_EXPORT_TARGET_INVALID
    );

    // A failed write attempt (task gone) still spends the grant.
    targets
        .bind_session(
            "main",
            &task_id,
            SaveTarget::Picked(FilePath::Path(destination.clone())),
        )
        .unwrap();
    assert!(attempt(&task_id).is_err());
    assert!(targets.redeem_session("main", &task_id).is_err());
}
