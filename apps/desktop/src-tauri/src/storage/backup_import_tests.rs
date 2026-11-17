use super::*;
use crate::storage::backup_archive::ReviewQuery;
fn database(root: &Path) -> rusqlite::Connection {
    let mut conn = rusqlite::Connection::open(root.join("db")).unwrap();
    crate::storage::apply_connection_pragmas(&conn).unwrap();
    crate::storage::register_sql_functions(&conn).unwrap();
    crate::storage::run_migrations(&mut conn).unwrap();
    crate::storage::ensure_local_device(&conn).unwrap();
    conn
}
const PASSWORD: &str = "a real import password";
fn archive(source: &Path, out: &Path, staging: &Path) -> std::path::PathBuf {
    let mut conn = database(source);
    conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES ('private','\"PRIVATE IMPORT CONTENT\"','now')", []).unwrap();
    crate::storage::put_blob_inner(
        &conn,
        source,
        "booktext:synthetic",
        None,
        b"PRIVATE FILE CONTENT",
    )
    .unwrap();
    let snapshot =
        crate::storage::backup_snapshot::capture_fixture(&mut conn, source, staging, |_| Ok(()))
            .unwrap();
    let path = out.join("source.age");
    backup_archive::write_archive(
        &snapshot,
        SecretString::from(PASSWORD.to_owned()),
        &path,
        || Ok(()),
    )
    .unwrap();
    path
}

#[test]
fn backup_import_apply_consumes_the_owned_plan_and_returns_only_a_committed_receipt() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let path = archive(source.path(), out.path(), staging.path());
    let root = BackupStaging::fixture(staging.path());
    let tasks = BackupTasks::default();
    let id = uuid::Uuid::new_v4().to_string();
    let mut conn = database(target.path());
    open_source(
        tasks.begin("main", &id).unwrap(),
        id.clone(),
        &path,
        SecretString::from(PASSWORD.to_owned()),
        &root,
        |_| Ok(()),
    )
    .unwrap();
    build_plan(
        &tasks,
        "main",
        id.clone(),
        &mut conn,
        PlanRoots {
            data_dir: target.path(),
            bundled: crate::plugins::BundledPrograms::fixture(target.path()),
            staging: &root,
        },
        |_| Ok(()),
    )
    .unwrap();
    let file = format!(
        "blobs/{}",
        crate::storage::blob_file_name("booktext:synthetic")
    );
    let request = serde_json::json!({"files":{file:"source"},"programs":{},"programResults":{},"credentials":{}});
    assert!(execute_plan(
        &tasks,
        "foreign",
        id.clone(),
        &mut conn,
        target.path(),
        serde_json::from_value(request.clone()).unwrap(),
        |_| Ok(())
    )
    .is_err());
    let receipt = execute_plan(
        &tasks,
        "main",
        id.clone(),
        &mut conn,
        target.path(),
        serde_json::from_value(request.clone()).unwrap(),
        |_| Ok(()),
    )
    .unwrap();
    assert_eq!(receipt.task_id, id);
    assert_eq!(receipt.format, 2);
    assert!(receipt.restored.files > 0);
    assert!(!serde_json::to_string(&receipt).unwrap().contains("PRIVATE"));
    assert_eq!(
        conn.query_row(
            "SELECT value_json FROM app_kv WHERE key='private'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "\"PRIVATE IMPORT CONTENT\""
    );
    assert!(execute_plan(
        &tasks,
        "main",
        id.clone(),
        &mut conn,
        target.path(),
        serde_json::from_value(request).unwrap(),
        |_| Ok(())
    )
    .is_err());
    assert_eq!(root.cleanup().unwrap().active, 0);
    assert!(tasks
        .begin("main", &uuid::Uuid::new_v4().to_string())
        .is_ok());
}
#[test]
fn backup_import_real_archive_to_private_plan_preserves_target_and_rejects_wrong_owner_or_phase() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let path = archive(source.path(), out.path(), staging.path());
    let ciphertext = std::fs::read(&path).unwrap();
    let mut conn = database(target.path());
    let root = BackupStaging::fixture(staging.path());
    let tasks = BackupTasks::default();
    let id = uuid::Uuid::new_v4().to_string();
    let source_receipt = open_source(
        tasks.begin("main", &id).unwrap(),
        id.clone(),
        &path,
        SecretString::from(PASSWORD.to_owned()),
        &root,
        |_| Ok(()),
    )
    .unwrap();
    assert_eq!(source_receipt.blobs, 1);
    assert_eq!(source_receipt.format, 2);
    assert!(!serde_json::to_string(&source_receipt)
        .unwrap()
        .contains("PRIVATE"));
    assert!(tasks
        .begin("main", &uuid::Uuid::new_v4().to_string())
        .is_err());
    assert!(tasks.take("foreign", &id, Phase::Source).is_err());
    assert!(tasks.take("main", &id, Phase::Export).is_err());
    let receipt = build_plan(
        &tasks,
        "main",
        id.clone(),
        &mut conn,
        PlanRoots {
            data_dir: target.path(),
            bundled: crate::plugins::BundledPrograms::fixture(target.path()),
            staging: &root,
        },
        |_| Ok(()),
    )
    .unwrap();
    assert_eq!(receipt.files.source_only, 1);
    assert!(receipt.tables["app_kv"].source_rows > 0);
    assert!(!serde_json::to_string(&receipt).unwrap().contains("PRIVATE"));
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM app_kv WHERE key='private'", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(std::fs::read(&path).unwrap(), ciphertext);
    assert!(tasks.take("main", &id, Phase::Source).is_err());
    let (lease, prepared) = tasks.take("main", &id, Phase::Plan).unwrap();
    let PreparedBackup::Plan(plan) = prepared else {
        panic!("expected plan")
    };
    let private = plan
        .rows()
        .events()
        .source()
        .archive()
        .directory()
        .to_owned();
    {
        let tx = conn.transaction().unwrap();
        plan.verify_target(&tx, target.path(), || Ok(())).unwrap();
    }
    conn.execute(
        "INSERT INTO app_kv(key,value_json,updated_at) VALUES ('changed','true','now')",
        [],
    )
    .unwrap();
    {
        let tx = conn.transaction().unwrap();
        assert_eq!(
            plan.verify_target(&tx, target.path(), || Ok(()))
                .unwrap_err()
                .code,
            "backup/changed"
        );
    }
    lease.publish(PreparedBackup::Plan(plan)).unwrap();
    tasks.cancel_owner("main");
    assert!(!private.exists());
    assert!(tasks.is_empty());
}
#[test]
fn backup_import_failure_and_cancellation_release_source_and_shared_reservation() {
    let source = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let path = archive(source.path(), out.path(), staging.path());
    let root = BackupStaging::fixture(staging.path());
    let tasks = BackupTasks::default();
    for cancel in [false, true] {
        let id = uuid::Uuid::new_v4().to_string();
        let lease = tasks.begin("main", &id).unwrap();
        let error = open_source(
            lease,
            id.clone(),
            &path,
            SecretString::from("incorrect password".to_owned()),
            &root,
            |_| {
                if cancel {
                    tasks.cancel("main", Some(&id))?;
                }
                Ok(())
            },
        )
        .err()
        .unwrap();
        assert_eq!(
            error.code,
            if cancel {
                "backup/cancelled"
            } else {
                "backup/unlock-failed"
            }
        );
        assert!(tasks.is_empty());
        assert_eq!(
            crate::storage::backup_staging::fixture_entries(staging.path())
                .unwrap()
                .count(),
            0
        );
        assert_eq!(root.cleanup().unwrap().active, 0);
    }
}

#[test]
fn backup_import_cancel_after_decryption_and_during_planning_erases_private_work() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let path = archive(source.path(), out.path(), staging.path());
    let root = BackupStaging::fixture(staging.path());
    let tasks = BackupTasks::default();
    let id = uuid::Uuid::new_v4().to_string();
    let error = open_source(
        tasks.begin("main", &id).unwrap(),
        id.clone(),
        &path,
        SecretString::from(PASSWORD.to_owned()),
        &root,
        |phase| {
            if phase == ImportProgress::CheckingSource {
                tasks.cancel("main", Some(&id))?;
            }
            Ok(())
        },
    )
    .err()
    .unwrap();
    assert_eq!(error.code, "backup/cancelled");
    assert!(tasks.is_empty());
    assert_eq!(
        crate::storage::backup_staging::fixture_entries(staging.path())
            .unwrap()
            .count(),
        0
    );
    assert_eq!(root.cleanup().unwrap().active, 0);

    let id = uuid::Uuid::new_v4().to_string();
    open_source(
        tasks.begin("main", &id).unwrap(),
        id.clone(),
        &path,
        SecretString::from(PASSWORD.to_owned()),
        &root,
        |_| Ok(()),
    )
    .unwrap();
    let mut conn = database(target.path());
    let error = build_plan(
        &tasks,
        "main",
        id.clone(),
        &mut conn,
        PlanRoots {
            data_dir: target.path(),
            bundled: crate::plugins::BundledPrograms::fixture(target.path()),
            staging: &root,
        },
        |phase| {
            if phase == ImportProgress::ComparingRows {
                tasks.cancel("main", Some(&id))?;
            }
            Ok(())
        },
    )
    .err()
    .unwrap();
    assert_eq!(error.code, "backup/cancelled");
    assert!(tasks.is_empty());
    assert_eq!(
        crate::storage::backup_staging::fixture_entries(staging.path())
            .unwrap()
            .count(),
        0
    );
    assert_eq!(root.cleanup().unwrap().active, 0);
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM app_kv WHERE key='private'", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn backup_import_review_pages_are_stable_private_evidence_and_invalid_queries_keep_the_plan() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let mut source_db = database(source.path());
    let program = source.path().join("plugins/proof");
    std::fs::create_dir_all(&program).unwrap();
    std::fs::write(program.join("manifest.json"), r#"{"id":"proof","name":"Proof","version":"1.0.0","schemaVersion":1,"requires":{"services":{}},"permissions":[]}"#).unwrap();
    std::fs::write(program.join("main.js"), "export default {};").unwrap();
    source_db.execute_batch("INSERT INTO app_kv(key,value_json,updated_at) VALUES ('read-aware-plugin.other.note','\"PRIVATE NOTE\"','now'),('read-aware-plugin.proof.note','\"PRIVATE NOTE\"','now');
        INSERT INTO domain_events(id,type,hlc_wall_ms,hlc_counter,hlc_device,payload_json,created_at) VALUES ('a','preference.changed',1,0,'source','{\"key\":\"read-aware-theme\",\"value\":\"paper\"}','now'),('b','preference.changed',2,0,'source','{\"key\":\"read-aware-theme\",\"value\":\"paper\"}','now');").unwrap();
    let sealed = crate::secrets::encrypt(source.path(), "PRIVATE SOURCE KEY").unwrap();
    source_db.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES ('read-aware-secret:ai-api-key.proof',?1,'now')", [&sealed]).unwrap();
    source_db
        .execute("INSERT INTO app_kv VALUES ('restorable','true','now')", [])
        .unwrap();
    let snapshot = crate::storage::backup_snapshot::capture_fixture(
        &mut source_db,
        source.path(),
        staging.path(),
        |_| Ok(()),
    )
    .unwrap();
    let path = out.path().join("source.age");
    backup_archive::write_archive(
        &snapshot,
        SecretString::from(PASSWORD.to_owned()),
        &path,
        || Ok(()),
    )
    .unwrap();
    drop(snapshot);
    let mut conn = database(target.path());
    let sealed = crate::secrets::encrypt(target.path(), "PRIVATE TARGET KEY").unwrap();
    conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES ('read-aware-secret:ai-api-key.proof',?1,'now')", [&sealed]).unwrap();
    let root = BackupStaging::fixture(staging.path());
    let tasks = BackupTasks::default();
    let id = uuid::Uuid::new_v4().to_string();
    open_source(
        tasks.begin("main", &id).unwrap(),
        id.clone(),
        &path,
        SecretString::from(PASSWORD.to_owned()),
        &root,
        |_| Ok(()),
    )
    .unwrap();
    build_plan(
        &tasks,
        "main",
        id.clone(),
        &mut conn,
        PlanRoots {
            data_dir: target.path(),
            bundled: crate::plugins::BundledPrograms::fixture(target.path()),
            staging: &root,
        },
        |_| Ok(()),
    )
    .unwrap();
    let read = |query| {
        tasks.with_plan("main", &id, |plan, lease| {
            plan.review_page(query, || lease.check())
        })
    };
    assert!(read(ReviewQuery::Programs {
        after: None,
        limit: 101
    })
    .is_err());
    let events = serde_json::to_value(
        read(ReviewQuery::Events {
            after: None,
            limit: 1,
        })
        .unwrap(),
    )
    .unwrap();
    assert_eq!(events["kind"], "events");
    assert_eq!(events["entries"][0]["sourceId"], "a");
    assert_eq!(events["nextAfter"], "a");
    let events = serde_json::to_value(
        read(ReviewQuery::Events {
            after: Some("a".into()),
            limit: 1,
        })
        .unwrap(),
    )
    .unwrap();
    assert_eq!(events["entries"][0]["sourceId"], "b");
    assert!(events["nextAfter"].is_null());

    assert_eq!(
        conn.query_row(
            "SELECT count(*) FROM app_kv WHERE key='restorable'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    let files = serde_json::to_value(
        read(ReviewQuery::Files {
            after: None,
            limit: 100,
        })
        .unwrap(),
    )
    .unwrap();
    assert!(files["entries"]
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["path"] == "plugins/proof/main.js"));
    assert!(!files.to_string().contains(source.path().to_str().unwrap()));
    let first = serde_json::to_value(
        read(ReviewQuery::Programs {
            after: None,
            limit: 1,
        })
        .unwrap(),
    )
    .unwrap();
    assert_eq!(first["entries"][0]["id"], "other");
    assert_eq!(first["nextAfter"], "other");
    let second = serde_json::to_value(
        read(ReviewQuery::Programs {
            after: Some("other".into()),
            limit: 1,
        })
        .unwrap(),
    )
    .unwrap();
    assert_eq!(second["entries"][0]["id"], "proof");
    assert_eq!(second["entries"][0]["candidates"][0]["mainPresent"], true);
    let credentials = serde_json::to_value(
        read(ReviewQuery::Credentials {
            after: None,
            limit: 100,
        })
        .unwrap(),
    )
    .unwrap();
    assert_eq!(credentials["entries"][0]["localEqual"], false);
    assert!(!credentials.to_string().contains("PRIVATE"));
    // Review remains the original comparison even when the live target changes.
    conn.execute(
        "DELETE FROM app_kv WHERE key LIKE 'read-aware-secret:%'",
        [],
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(
            read(ReviewQuery::Credentials {
                after: None,
                limit: 100
            })
            .unwrap()
        )
        .unwrap(),
        credentials
    );
    assert!(tasks
        .with_plan("foreign", &id, |plan, lease| plan.review_page(
            ReviewQuery::Files {
                after: None,
                limit: 1
            },
            || lease.check()
        ))
        .is_err());
    let cancelled_read = tasks.with_plan("main", &id, |plan, lease| {
        tasks.cancel("main", Some(&id))?;
        assert!(tasks
            .begin("main", &uuid::Uuid::new_v4().to_string())
            .is_err());
        plan.review_page(
            ReviewQuery::Files {
                after: None,
                limit: 1,
            },
            || lease.check(),
        )
    });
    assert_eq!(cancelled_read.err().unwrap().code, "backup/cancelled");
    assert!(tasks.is_empty());
    assert_eq!(
        crate::storage::backup_staging::fixture_entries(staging.path())
            .unwrap()
            .count(),
        0
    );
}
