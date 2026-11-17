use super::super::tests::{db, rows, source};
use super::*;
use rusqlite::params;
use std::{
    fs,
    sync::{atomic::AtomicBool, Arc},
};
use storage::{backup_archive, backup_snapshot};

fn kv(conn: &Connection, key: &str, value: &str) {
    conn.execute(
        "INSERT INTO app_kv(key,value_json,updated_at) VALUES (?1,?2,'now')",
        params![key, value],
    )
    .unwrap();
}
fn secret(conn: &Connection, root: &Path, value: &str) {
    kv(
        conn,
        "read-aware-secret:ai-api-key.proof",
        &crate::secrets::encrypt(root, value).unwrap(),
    );
}
/// A book as the app makes one: its import event at `when` (ms), projected by
/// the shared rules. In a merge, the later import is the book's state.
fn book(conn: &Connection, root: &Path, title: &str, bytes: &[u8], when: i64) {
    let payload = serde_json::json!({"bookId":"book","title":title,"author":"Author","format":"epub","fileName":"book.epub","fileSize":bytes.len()});
    conn.execute(
        "INSERT INTO domain_events(id,type,hlc_wall_ms,hlc_counter,hlc_device,aggregate_type,aggregate_id,payload_json,created_at) VALUES (?1,'book.imported',?3,0,?1,'book','book',?2,'old')",
        params![format!("import-{title}"), payload.to_string(), when],
    )
    .unwrap();
    let tx = conn.unchecked_transaction().unwrap();
    storage::events::replay_into(&tx).unwrap();
    tx.commit().unwrap();
    storage::put_blob_inner(
        conn,
        root,
        "bookfile:book",
        Some("application/epub+zip"),
        bytes,
    )
    .unwrap();
}
fn plugin(conn: &Connection, root: &Path, side: &str) {
    let dir = root.join("plugins/proof");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("manifest.json"),
        r#"{"id":"proof","name":"Proof","version":"1.0.0","schemaVersion":1,"requires":{}}"#,
    )
    .unwrap();
    fs::write(
        dir.join("main.js"),
        format!("// {side}\nexport default {{ activate() {{}} }};"),
    )
    .unwrap();
    kv(conn, "read-aware-plugin-host.schema.proof", "1");
    kv(
        conn,
        "read-aware-plugin.proof.value",
        &serde_json::json!(side).to_string(),
    );
    kv(
        conn,
        "read-aware-plugin.proof.schedule-state",
        &serde_json::json!(format!("{side} queue")).to_string(),
    );
    conn.execute("INSERT INTO plugin_documents(plugin_id,collection,id,json,updated_at) VALUES ('proof','notes','one',?1,'old')",[serde_json::json!({"side":side}).to_string()]).unwrap();
}
fn request(plan: &FilePlan, conn: &mut Connection, root: &Path) -> RestoreRequest {
    let tx = conn.transaction().unwrap();
    let facts = plan.program_facts(&tx, root, || Ok(())).unwrap();
    let mut programs = BTreeMap::new();
    let mut results = BTreeMap::new();
    for fact in facts {
        let candidate = fact
            .candidates
            .iter()
            .find(|p| {
                p.side
                    == if fact.builtin {
                        Side::Target
                    } else {
                        Side::Source
                    }
            })
            .or(fact.candidates.first());
        let reference = candidate.map(|c| ProgramRef {
            side: c.side,
            root: c.root.clone(),
            sha256: c.sha256.clone(),
        });
        if let Some(program) = &reference {
            results.insert(
                fact.id.clone(),
                ProgramResult {
                    program: program.clone(),
                    consented: true,
                    book_access: (program.side == Side::Source).then_some(PluginBookAccess::All),
                    has_migration: false,
                    migrated: None,
                },
            );
        }
        programs.insert(
            fact.id,
            ProgramChoice {
                program: reference,
                data: Side::Source,
            },
        );
    }
    let credentials = plan
        .credential_facts(&tx, root, || Ok(()))
        .unwrap()
        .into_iter()
        .map(|f| (f.slot, CredentialChoice::SourceLocal))
        .collect();
    let files = plan
        .matches
        .values()
        .filter(|f| {
            matches!(f.policy, FilePolicy::Blob)
                && f.source.is_some()
                && f.kind != super::super::super::FileMatchKind::Same
        })
        .map(|f| (f.path.clone(), Side::Source))
        .collect();
    RestoreRequest {
        files,
        programs,
        program_results: results,
        credentials,
    }
}
fn original(root: &Path) -> PathBuf {
    root.join(format!(
        "blobs/{}",
        storage::blob_file_name("bookfile:book")
    ))
}
fn title(conn: &Connection) -> String {
    conn.query_row("SELECT title FROM books WHERE id='book'", [], |r| r.get(0))
        .unwrap()
}

#[test]
fn plugin_book_access_restore_shape_matches_the_plugin_store_contract() {
    assert_eq!(
        serde_json::to_value(PluginBookAccess::All).unwrap(),
        serde_json::json!({"mode":"all"})
    );
    assert_eq!(
        serde_json::to_value(PluginBookAccess::Current).unwrap(),
        serde_json::json!({"mode":"current"})
    );
    assert_eq!(
        serde_json::to_value(PluginBookAccess::Book {
            book_id: "book-1".into(),
        })
        .unwrap(),
        serde_json::json!({"mode":"book","bookId":"book-1"})
    );
    assert!(
        serde_json::from_value::<PluginBookAccess>(serde_json::json!({
            "mode":"book",
            "book_id":"book-1"
        }))
        .is_err()
    );
}

use std::path::PathBuf;

#[test]
fn backup_restore_apply_encrypted_archive_restores_books_files_plugins_credentials_and_replays() {
    use age::secrecy::SecretString;
    let incoming = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let mut src = db(incoming.path());
    book(
        &src,
        incoming.path(),
        "Restored book",
        b"source epub bytes",
        2000,
    );
    plugin(&src, incoming.path(), "source");
    secret(&src, incoming.path(), "source API key");
    kv(&src, "read-aware-theme", "\"dark\"");
    kv(
        &src,
        "read-aware-plugins-book-access",
        r#"{"proof":{"mode":"book","bookId":"source-book"},"source-only":{"mode":"current"}}"#,
    );
    kv(&src, "read-aware-sync-token", "\"source connection\"");
    let snapshot =
        backup_snapshot::capture_fixture(&mut src, incoming.path(), stage.path(), |_| Ok(()))
            .unwrap();
    let path = stage.path().join("full.age");
    let password = || SecretString::from("full restore test passphrase".to_owned());
    backup_archive::write_archive(&snapshot, password(), &path, || Ok(())).unwrap();
    let staging = storage::backup_staging::BackupStaging::fixture(stage.path());
    let archive =
        backup_archive::read_archive(fs::File::open(path).unwrap(), password(), &staging, || {
            Ok(())
        })
        .unwrap();
    let src = backup_archive::preflight(archive, Arc::new(AtomicBool::new(false))).unwrap();
    let mut target = db(root.path());
    book(&target, root.path(), "Target book", b"old epub", 1000);
    plugin(&target, root.path(), "target");
    secret(&target, root.path(), "target API key");
    fs::write(
        root.path().join("plugins/proof/obsolete.js"),
        b"obsolete code",
    )
    .unwrap();
    kv(
        &target,
        "read-aware-plugins-book-access",
        r#"{"proof":{"mode":"current"},"target-only":{"mode":"book","bookId":"target-book"}}"#,
    );
    kv(&target, "read-aware-sync-token", "\"target connection\"");
    let key = fs::read(root.path().join("secret.key")).unwrap();
    let plan = rows(src, &mut target, stage.path())
        .plan_fixture_files(&mut target, root.path(), || Ok(()))
        .unwrap();
    let request = request(&plan, &mut target, root.path());
    let receipt = plan
        .restore(&mut target, root.path(), request, || Ok(()))
        .unwrap();
    assert!(receipt.domain_rows >= 1);
    assert!(!receipt.cleanup_pending);
    assert_eq!(title(&target), "Restored book");
    assert_eq!(
        fs::read(original(root.path())).unwrap(),
        b"source epub bytes"
    );
    assert_eq!(fs::read(root.path().join("secret.key")).unwrap(), key);
    let sealed: String = target
        .query_row(
            "SELECT value_json FROM app_kv WHERE key='read-aware-secret:ai-api-key.proof'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        crate::secrets::decrypt_existing(root.path(), &sealed).unwrap(),
        "source API key"
    );
    assert_eq!(
        target
            .query_row(
                "SELECT value_json FROM app_kv WHERE key='read-aware-sync-token'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "\"target connection\""
    );
    assert_eq!(
        target
            .query_row(
                "SELECT value_json FROM app_kv WHERE key='read-aware-plugin.proof.schedule-state'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "\"target queue\""
    );
    let grants: serde_json::Value = serde_json::from_str(
        &target
            .query_row(
                "SELECT value_json FROM app_kv WHERE key='read-aware-plugins-book-access'",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        grants,
        serde_json::json!({
            "proof":{"mode":"all"},
            "target-only":{"mode":"book","bookId":"target-book"}
        })
    );
    assert_eq!(
        target
            .query_row(
                "SELECT json FROM plugin_documents WHERE plugin_id='proof'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "{\"side\":\"source\"}"
    );
    assert!(
        fs::read_to_string(root.path().join("plugins/proof/main.js"))
            .unwrap()
            .contains("source")
    );
    assert!(!root.path().join("plugins/proof/obsolete.js").exists());
    assert_eq!(
        target
            .query_row(
                "SELECT count(*) FROM restored_credential_publications",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    let tx = target.transaction().unwrap();
    storage::events::replay_into(&tx).unwrap();
    assert_eq!(title(&tx), "Restored book");
    tx.rollback().unwrap();
}

#[test]
fn backup_restore_apply_cancellation_after_file_install_rolls_back_every_data_category() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(root.path());
    book(&target, root.path(), "Before", b"before", 1000);
    plugin(&target, root.path(), "target");
    let src = source(|conn, dir| {
        book(conn, dir, "After", b"after", 2000);
        plugin(conn, dir, "source");
        secret(conn, dir, "new key");
    });
    let plan = rows(src, &mut target, stage.path())
        .plan_fixture_files(&mut target, root.path(), || Ok(()))
        .unwrap();
    let request = request(&plan, &mut target, root.path());
    let error = plan
        .restore(&mut target, root.path(), request, || {
            if root.path().join("secret.key").exists() {
                Err(CommandError::new(
                    "backup/cancelled",
                    "cancel after file installation",
                ))
            } else {
                Ok(())
            }
        })
        .unwrap_err();
    assert_eq!(error.code, "backup/cancelled");
    assert_eq!(title(&target), "Before");
    assert_eq!(fs::read(original(root.path())).unwrap(), b"before");
    assert!(!root.path().join("secret.key").exists());
    // Only this device's own history remains; no archive event survived.
    assert_eq!(
        target
            .query_row("SELECT group_concat(id) FROM domain_events", [], |r| r
                .get::<_, String>(
                0
            ))
            .unwrap(),
        "import-Before"
    );
    assert_eq!(
        target
            .query_row("SELECT json FROM plugin_documents", [], |r| r
                .get::<_, String>(0))
            .unwrap(),
        "{\"side\":\"target\"}"
    );
    assert!(
        fs::read_to_string(root.path().join("plugins/proof/main.js"))
            .unwrap()
            .contains("target")
    );
    assert_eq!(
        fs::read_dir(root.path().join("full-restore-v1"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn backup_restore_apply_rejects_skipped_required_blob_and_unapproved_program() {
    for reject in ["blob", "consent"] {
        let root = tempfile::tempdir().unwrap();
        let stage = tempfile::tempdir().unwrap();
        let mut target = db(root.path());
        let src = source(|conn, dir| {
            book(conn, dir, "Source", b"book", 2000);
            plugin(conn, dir, "source");
        });
        let plan = rows(src, &mut target, stage.path())
            .plan_fixture_files(&mut target, root.path(), || Ok(()))
            .unwrap();
        let mut request = request(&plan, &mut target, root.path());
        if reject == "blob" {
            for choice in request.files.values_mut() {
                *choice = Side::Target;
            }
        } else {
            request.program_results.get_mut("proof").unwrap().consented = false;
        }
        assert_eq!(
            plan.restore(&mut target, root.path(), request, || Ok(()))
                .unwrap_err()
                .code,
            "backup/incomplete"
        );
        assert_eq!(
            target
                .query_row("SELECT count(*) FROM books", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(!original(root.path()).exists());
        assert!(!root.path().join("plugins/proof/main.js").exists());
    }
}

#[test]
fn backup_restore_apply_fresh_credential_key_and_explicit_deletion_keep_target_identity() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(root.path());
    let src = source(|conn, dir| secret(conn, dir, "fresh credential"));
    let source_key = fs::read(src.archive().directory().join("secret.key")).unwrap();
    let plan = rows(src, &mut target, stage.path())
        .plan_fixture_files(&mut target, root.path(), || Ok(()))
        .unwrap();
    let selected = request(&plan, &mut target, root.path());
    plan.restore(&mut target, root.path(), selected, || Ok(()))
        .unwrap();
    let target_key = fs::read(root.path().join("secret.key")).unwrap();
    assert_ne!(target_key, source_key);
    let sealed: String = target
        .query_row(
            "SELECT value_json FROM app_kv WHERE key='read-aware-secret:ai-api-key.proof'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        crate::secrets::decrypt_existing(root.path(), &sealed).unwrap(),
        "fresh credential"
    );
    let src = source(|_, _| {});
    let plan = rows(src, &mut target, stage.path())
        .plan_fixture_files(&mut target, root.path(), || Ok(()))
        .unwrap();
    let selected = request(&plan, &mut target, root.path());
    plan.restore(&mut target, root.path(), selected, || Ok(()))
        .unwrap();
    assert_eq!(
        fs::read(root.path().join("secret.key")).unwrap(),
        target_key
    );
    assert_eq!(
        target
            .query_row(
                "SELECT count(*) FROM app_kv WHERE key='read-aware-secret:ai-api-key.proof'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        target
            .query_row(
                "SELECT count(*) FROM restored_credential_publications",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}

#[test]
fn backup_restore_apply_data_only_retains_code_but_disables_it_atomically() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(root.path());
    plugin(&target, root.path(), "target");
    kv(
        &target,
        "read-aware-plugins-enabled",
        r#"{"proof":true,"other":true}"#,
    );
    let input = source(|conn, root| plugin(conn, root, "source"));
    let plan = rows(input, &mut target, stage.path())
        .plan_fixture_files(&mut target, root.path(), || Ok(()))
        .unwrap();
    let mut selected = request(&plan, &mut target, root.path());
    selected.programs.get_mut("proof").unwrap().program = None;
    selected.program_results.clear();
    plan.restore(&mut target, root.path(), selected, || Ok(()))
        .unwrap();
    assert!(
        fs::read_to_string(root.path().join("plugins/proof/main.js"))
            .unwrap()
            .contains("target")
    );
    let enabled: serde_json::Value = serde_json::from_str(
        &storage::get_kv_inner(&target, "read-aware-plugins-enabled")
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(enabled, serde_json::json!({"proof":false,"other":true}));
    assert_eq!(
        storage::get_kv_inner(&target, "read-aware-plugin.proof.value")
            .unwrap()
            .as_deref(),
        Some("\"source\"")
    );
}
