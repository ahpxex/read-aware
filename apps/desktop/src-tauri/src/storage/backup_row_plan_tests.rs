use super::*;
use crate::storage::{
    self,
    backup_archive::{self, AuthenticatedBackup},
    backup_snapshot,
};
use rusqlite::params;
use std::{
    fs,
    sync::{atomic::AtomicBool, Arc},
};

fn db(path: &std::path::Path) -> Connection {
    let mut conn = Connection::open(path).unwrap();
    storage::apply_connection_pragmas(&conn).unwrap();
    storage::register_sql_functions(&conn).unwrap();
    storage::run_migrations(&mut conn).unwrap();
    storage::ensure_local_device(&conn).unwrap();
    conn
}
fn incoming(edit: impl FnOnce(&Connection, &std::path::Path)) -> backup_archive::PreflightedBackup {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut conn = db(&root.path().join("db"));
    edit(&conn, root.path());
    let snapshot =
        backup_snapshot::capture_fixture(&mut conn, root.path(), stage.path(), |_| Ok(())).unwrap();
    let directory = tempfile::tempdir().unwrap();
    for file in &snapshot.manifest.files {
        let to = directory.path().join(&file.path);
        fs::create_dir_all(to.parent().unwrap()).unwrap();
        fs::copy(snapshot.directory().join(&file.path), to).unwrap();
    }
    backup_archive::preflight(
        AuthenticatedBackup {
            directory: crate::storage::backup_staging::BackupDirectory::fixture(directory),
            manifest: snapshot.manifest.clone(),
        },
        Arc::new(AtomicBool::new(false)),
    )
    .unwrap()
}
fn memory(conn: &Connection, id: &str, content: &str) {
    conn.execute("INSERT INTO memories(id,scope,kind,content,importance,evidence_count,created_at,updated_at) VALUES (?1,'global','fact',?2,1,1,'now','now')", params![id,content]).unwrap();
}
fn kv(conn: &Connection, key: &str, value: &str) {
    conn.execute(
        "INSERT INTO app_kv(key,value_json,updated_at) VALUES (?1,?2,'now')",
        params![key, value],
    )
    .unwrap();
}

#[path = "backup_restore_rows_tests.rs"]
mod restore_tests;
#[test]
fn backup_row_plan_knows_a_restore_rule_for_every_current_table() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(&root.path().join("db"));
    let plan = backup_archive::plan_events_fixture(
        incoming(|conn, _| memory(conn, "source", "private")),
        &mut target,
        stage.path(),
        || Ok(()),
    )
    .unwrap()
    .plan_rows(&mut target, || Ok(()))
    .unwrap();
    // Every table the current schema has, on either side, was routed.
    let mut statement = target
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .unwrap();
    for name in statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
    {
        let name = name.unwrap();
        assert!(plan.tables.contains_key(&name), "{name}");
    }
    assert_eq!(plan.tables["memories"].source_rows, 1);
}

#[test]
fn backup_row_plan_rejects_unknown_tables_unsettled_updates_and_stale_targets_and_cleans_partial_stages(
) {
    for case in 0..4 {
        let root = tempfile::tempdir().unwrap();
        let stage = tempfile::tempdir().unwrap();
        let mut target = db(&root.path().join("db"));
        if case == 0 {
            target
                .execute_batch("CREATE TABLE future_unknown(id TEXT PRIMARY KEY)")
                .unwrap();
        }
        if case == 1 {
            target.execute_batch("INSERT INTO plugin_update_journal(update_id,plugin_id,baseline_json,phase) VALUES ('pending','proof','{}','prepared')").unwrap();
        }
        let events = backup_archive::plan_events_fixture(
            incoming(|conn, _| memory(conn, "source", "private")),
            &mut target,
            stage.path(),
            || Ok(()),
        )
        .unwrap();
        let source_path = events.source().archive().directory().to_owned();
        if case == 2 {
            kv(&target, "after-preview", "changed");
        }
        let mut calls = 0;
        let error = events
            .plan_rows(&mut target, || {
                calls += 1;
                if case == 3 && calls > 3 {
                    Err(CommandError::new("backup/cancelled", "cancelled"))
                } else {
                    Ok(())
                }
            })
            .unwrap_err();
        assert_eq!(
            error.code,
            match case {
                0 => "backup/incomplete",
                1 => "plugin/recovery-required",
                2 => "backup/changed",
                _ => "backup/cancelled",
            }
        );
        assert!(!source_path.exists());
        assert_eq!(
            crate::storage::backup_staging::fixture_entries(stage.path())
                .unwrap()
                .count(),
            0
        );
        assert!(target.is_autocommit());
    }
}
