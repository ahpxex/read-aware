use super::*;
use crate::storage::backup_snapshot;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

fn cancellation() -> Arc<AtomicBool> {
    Arc::new(AtomicBool::new(false))
}

// These fixtures represent the owned output of decryption. The archive test
// separately drives the real password codec through this same public preflight.
fn fixture() -> AuthenticatedBackup {
    let source = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let mut conn = Connection::open_in_memory().unwrap();
    storage::register_sql_functions(&conn).unwrap();
    storage::run_migrations(&mut conn).unwrap();
    storage::ensure_local_device(&conn).unwrap();
    conn.execute_batch("INSERT INTO memories(id,scope,kind,content,importance,evidence_count,created_at,updated_at) VALUES ('legacy','global','fact','historical memory without a corresponding event',1,1,'now','now');
        INSERT INTO ai_conversations(id,created_at,updated_at) VALUES ('global-one','now','now');
        INSERT INTO ai_messages(id,conversation_id,role,seq,content,created_at,parts_json,error) VALUES ('message-one','global-one','assistant',0,'retained','now','[]','presentation only');
        INSERT INTO domain_events(id,type,hlc_wall_ms,hlc_counter,hlc_device,payload_json,created_at) VALUES ('event-one','future.opaqueFact',100,0,'old-device','{\"preserved\":true}','now');
        INSERT INTO plugin_documents(plugin_id,collection,id,json,book_id,updated_at) VALUES ('proof','notes','note','{\"private\":true}','previously-deleted-book','now');
        INSERT INTO app_kv(key,value_json,updated_at) VALUES ('read-aware-plugin.proof.arbitrary','not JSON','now');").unwrap();
    storage::put_blob_inner(&conn, source.path(), "bookfile:one", None, b"book contents").unwrap();
    let sealed = crate::secrets::encrypt(source.path(), "source credential").unwrap();
    conn.execute(
        "INSERT INTO app_kv(key,value_json,updated_at) VALUES ('read-aware-secret:proof',?1,'now')",
        [&sealed],
    )
    .unwrap();
    fs::create_dir_all(source.path().join("plugins/proof")).unwrap();
    fs::write(
        source.path().join("plugins/proof/manifest.json"),
        "{\"id\":\"proof\",\"schemaVersion\":1}",
    )
    .unwrap();
    let snapshot =
        backup_snapshot::capture_fixture(&mut conn, source.path(), staging.path(), |_| Ok(()))
            .unwrap();
    let directory = tempfile::tempdir().unwrap();
    for file in &snapshot.manifest.files {
        let to = directory.path().join(&file.path);
        fs::create_dir_all(to.parent().unwrap()).unwrap();
        fs::copy(snapshot.directory().join(&file.path), to).unwrap();
    }
    AuthenticatedBackup {
        directory: crate::storage::backup_staging::BackupDirectory::fixture(directory),
        manifest: snapshot.manifest.clone(),
    }
}

fn edit(archive: &mut AuthenticatedBackup, change: impl FnOnce(&Connection, &Path)) {
    let conn = Connection::open(archive.directory().join("database.sqlite")).unwrap();
    storage::register_sql_functions(&conn).unwrap();
    change(&conn, archive.directory());
    let mut statement = conn
        .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
        .unwrap();
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    archive.manifest.tables.clear();
    for name in names
        .into_iter()
        .filter(|name| !name.starts_with("sqlite_"))
    {
        let count: u64 = conn
            .query_row(
                &format!("SELECT count(*) FROM \"{}\"", name.replace('"', "\"\"")),
                [],
                |row| row.get(0),
            )
            .unwrap();
        archive.manifest.tables.insert(name, count);
    }
    drop(statement);
    drop(conn);
    refresh_files(archive);
}
fn refresh_files(archive: &mut AuthenticatedBackup) {
    let root = archive.directory().to_owned();
    archive
        .manifest
        .files
        .retain(|file| root.join(&file.path).exists());
    for file in &mut archive.manifest.files {
        let bytes = fs::read(root.join(&file.path)).unwrap();
        file.byte_size = bytes.len() as u64;
        file.sha256 = format!("{:x}", Sha256::digest(bytes));
    }
}

#[test]
fn backup_preflight_preserves_actual_state_and_pins_a_read_only_source() {
    let mut archive = fixture();
    // Production startup drops the empty inline table; VACUUM/ANALYZE are valid.
    edit(&mut archive, |conn, _| {
        conn.execute_batch("DROP TABLE blobs; VACUUM; ANALYZE;")
            .unwrap()
    });
    let path = archive.directory().to_owned();
    let before = fs::read(path.join("database.sqlite")).unwrap();
    let result = preflight(archive, cancellation()).unwrap();
    assert_eq!(result.report.events, 1);
    assert_eq!(result.report.blobs, 1);
    assert_eq!(result.report.credentials, 1);
    assert_eq!(result.report.plugin_programs, 1);
    assert_eq!(result.archive().directory(), path);
    assert_eq!(result.report.tables["memories"], 1);
    assert_eq!(
        result
            .connection()
            .query_row("SELECT error FROM ai_messages", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "presentation only"
    );
    assert_eq!(
        result
            .connection()
            .query_row("SELECT content FROM memories", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "historical memory without a corresponding event"
    );
    assert!(result
        .connection()
        .execute("DELETE FROM memories", [])
        .is_err());
    assert!(result
        .connection()
        .execute_batch("ATTACH ':memory:' AS other")
        .is_err());
    assert!(result
        .connection()
        .query_row("SELECT load_extension('/does-not-exist')", [], |_| Ok(()))
        .is_err());
    assert!(!result.connection().is_autocommit());
    assert_eq!(fs::read(path.join("database.sqlite")).unwrap(), before);
    assert!(!path.join("database.sqlite-wal").exists());
    drop(result);
    assert!(!path.exists());
}

#[test]
fn backup_preflight_rejects_source_schema_identity_rows_and_reference_corruption() {
    for (sql, reason) in [
        ("CREATE TABLE unexpected(data TEXT)", "schema object"),
        ("CREATE VIEW unexpected AS SELECT load_extension('/does-not-exist')", "schema object"),
        ("CREATE TRIGGER unexpected AFTER DELETE ON memories BEGIN SELECT load_extension('/does-not-exist'); END", "schema object"),
        ("DROP INDEX ix_domain_events_hlc", "schema object"),
        ("INSERT INTO plugin_update_journal(update_id,plugin_id,baseline_json,phase) VALUES ('pending','proof','{}','prepared')", "unfinished plugin update"),
        ("UPDATE schema_migrations SET name='forged' WHERE version=41", "migration history"),
        ("UPDATE memories SET importance='not a number'", "storage type"),
        ("UPDATE domain_events SET payload_json='not JSON'", "persisted JSON"),
        ("UPDATE domain_events SET payload_json='null'", "payload must be an object"),
        ("UPDATE domain_events SET hlc_counter=-1", "logical clock"),
        ("UPDATE domain_events SET id=''", "event identity"),
        ("UPDATE domain_events SET schema_version=2", "event version"),
        ("UPDATE blob_objects SET storage_uri='../outside'", "blob reference"),
        ("UPDATE blob_objects SET byte_size=99999", "blob registry"),
        ("UPDATE blob_objects SET sha256='invalid'", "blob registry"),
        ("UPDATE ai_messages SET conversation_id='missing'", "no conversation"),
        ("UPDATE plugin_documents SET plugin_id='../foreign'", "document owner"),
        ("INSERT INTO app_kv VALUES ('read-aware-plugin-host.schema.proof','-1','now')", "stored plugin schema"),
        ("PRAGMA foreign_keys=OFF; INSERT INTO entity_aliases VALUES ('missing','alias','now')", "declared references"),
        ("INSERT INTO books(id,title,author,format,file_name,file_size,created_at,updated_at) VALUES ('absent','Title','Author','epub','missing.epub',1,'now','now')", "original or ready cover"),
        ("INSERT INTO books(id,title,author,format,file_name,file_size,created_at,updated_at) VALUES ('absent','Title','Author','virtual','',0,'now','now')", "content binding"),
    ] {
        let mut archive = fixture();
        edit(&mut archive, |conn, _| conn.execute_batch(sql).unwrap());
        let path = archive.directory().to_owned();
        let error = preflight(archive, cancellation()).unwrap_err();
        assert_eq!(error.code, super::super::CODE_INVALID, "{sql}: {error:?}");
        assert!(error.message.contains(reason), "{sql}: {error:?}");
        assert!(!path.exists());
    }
}

#[test]
fn backup_preflight_rejects_forged_manifest_and_files_without_creating_keys() {
    for case in 0..5 {
        let mut archive = fixture();
        let reason = match case {
            0 => {
                archive.manifest.tables.insert("domain_events".into(), 100);
                "table counts"
            }
            1 => {
                archive.manifest.schema_version -= 1;
                "schema differs from its manifest"
            }
            2 => {
                fs::remove_file(archive.directory().join("secret.key")).unwrap();
                refresh_files(&mut archive);
                "credential key is missing"
            }
            3 => {
                fs::write(archive.directory().join("secret.key"), [0; 32]).unwrap();
                refresh_files(&mut archive);
                "failed to decrypt secret"
            }
            _ => {
                fs::write(
                    archive.directory().join("plugins/proof/manifest.json"),
                    "{\"id\":\"foreign\",\"schemaVersion\":1}",
                )
                .unwrap();
                refresh_files(&mut archive);
                "manifest identity"
            }
        };
        let error = preflight(archive, cancellation()).unwrap_err();
        assert!(error.message.contains(reason), "case {case}: {error:?}");
    }
    let directory = tempfile::tempdir().unwrap();
    assert!(crate::secrets::decrypt_existing(directory.path(), "anything").is_err());
    assert!(!directory.path().join("secret.key").exists());
    fs::write(directory.path().join("secret.key"), b"bad").unwrap();
    assert!(crate::secrets::decrypt_existing(directory.path(), "anything").is_err());
    assert_eq!(
        fs::read(directory.path().join("secret.key")).unwrap(),
        b"bad"
    );
}

#[test]
fn backup_preflight_rejects_wal_mode_before_sqlite_can_create_sidecars() {
    let archive = fixture();
    let path = archive.directory().to_owned();
    let mut bytes = fs::read(path.join("database.sqlite")).unwrap();
    bytes[18] = 2;
    bytes[19] = 2;
    fs::write(path.join("database.sqlite"), bytes).unwrap();
    assert!(preflight(archive, cancellation())
        .unwrap_err()
        .message
        .contains("self-contained"));
    assert!(!path.exists());
    let archive = fixture();
    let path = archive.directory().to_owned();
    fs::remove_file(path.join("database.sqlite")).unwrap();
    assert_eq!(
        preflight(archive, cancellation()).unwrap_err().code,
        "fs/not-found"
    );
    assert!(!path.exists());
}

#[test]
fn backup_preflight_cancellation_interrupts_sql_and_cleans_owned_files() {
    let archive = fixture();
    let path = archive.directory().to_owned();
    let cancelled = cancellation();
    cancelled.store(true, Ordering::Relaxed);
    assert_eq!(
        preflight(archive, cancelled).unwrap_err().code,
        storage::backup_snapshot::CODE_CANCELLED
    );
    assert!(!path.exists());
    let archive = fixture();
    let cancelled = cancellation();
    let control = Control {
        cancelled: cancelled.clone(),
    };
    let conn = open_source(&archive, &control).unwrap();
    cancelled.store(true, Ordering::Relaxed);
    let error = conn.query_row("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000) SELECT sum(x) FROM n", [], |row| row.get::<_, i64>(0)).unwrap_err();
    assert_eq!(
        error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::OperationInterrupted)
    );
}

#[test]
fn backup_preflight_rejects_unclosed_reading_facts_in_v2_even_with_valid_member_hashes() {
    let mut archive = fixture();
    edit(&mut archive, |conn, _| {
        conn.execute("INSERT INTO reading_sessions_pending(book_id,local_day,local_hour,ms,started_at,last_at) VALUES ('b1','2026-09-12',15,20,1000,1020)",[]).unwrap();
    });
    let path = archive.directory().to_owned();
    assert_eq!(
        preflight(archive, cancellation()).unwrap_err().code,
        "backup/invalid-archive"
    );
    assert!(!path.exists());
}

/// An archive written by an older build: the schema as that build's own
/// migrations produced it, holding a row that predates the newer migrations.
fn older_archive(version: i64) -> AuthenticatedBackup {
    let mut archive = fixture();
    let path = archive.directory().join("database.sqlite");
    fs::remove_file(&path).unwrap();
    let mut conn = Connection::open(&path).unwrap();
    storage::register_sql_functions(&conn).unwrap();
    storage::run_migrations_up_to(&mut conn, version).unwrap();
    conn.execute_batch("INSERT INTO memories(id,scope,kind,content,importance,evidence_count,created_at,updated_at) VALUES ('kept','global','fact','written before the upgrade',1,1,'now','now');").unwrap();
    // The archive's file members stay registered, as the older build left them.
    storage::put_blob_inner(
        &conn,
        archive.directory(),
        "bookfile:one",
        None,
        b"book contents",
    )
    .unwrap();
    drop(conn);
    archive.manifest.schema_version = version;
    edit(&mut archive, |_, _| {});
    archive
}

#[test]
fn backup_preflight_brings_an_older_archive_to_this_schema_and_keeps_its_rows() {
    let version = storage::SCHEMA_VERSION - 6;
    let archive = older_archive(version);
    let preflighted = preflight(archive, cancellation()).unwrap();
    let conn = preflighted.connection();
    assert_eq!(
        storage::schema_version(conn).unwrap(),
        storage::SCHEMA_VERSION
    );
    let kept: String = conn
        .query_row("SELECT content FROM memories WHERE id='kept'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(kept, "written before the upgrade");
}

#[test]
fn backup_preflight_checks_an_older_archive_against_its_own_version_before_migrating() {
    let version = storage::SCHEMA_VERSION - 6;
    let mut archive = older_archive(version);
    // A trigger no build of that version would create must never get to run.
    edit(&mut archive, |conn, _| {
        conn.execute_batch(
            "CREATE TRIGGER planted AFTER INSERT ON memories BEGIN DELETE FROM memories; END;",
        )
        .unwrap();
    });
    let error = preflight(archive, cancellation()).unwrap_err();
    assert_eq!(error.code, super::super::CODE_INVALID);
    assert!(format!("{error:?}").contains("planted"), "{error:?}");
}

#[test]
fn backup_preflight_names_an_archive_from_a_newer_build() {
    let mut archive = fixture();
    archive.manifest.schema_version = storage::SCHEMA_VERSION + 1;
    assert_eq!(
        preflight(archive, cancellation()).unwrap_err().code,
        CODE_NEWER_VERSION
    );
}
