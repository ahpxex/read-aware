use super::*;
fn database(path: &Path) -> Connection {
    let mut conn = Connection::open(path).unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    conn
}
fn input(bytes: &[u8]) -> File {
    let mut file = tempfile::tempfile().unwrap();
    file.write_all(bytes).unwrap();
    use std::io::{Seek, SeekFrom};
    file.seek(SeekFrom::Start(0)).unwrap();
    file
}
fn save(
    conn: &mut Connection,
    dir: &Path,
    owner: &str,
    key: &str,
    revision: Option<&str>,
    data: &[u8],
) -> PluginAssetReceipt {
    store_inner(
        conn,
        dir,
        owner,
        key,
        revision,
        AssetInput {
            filename: "image.png",
            mime: "image/png",
            source: input(data),
        },
    )
    .unwrap()
}
fn bytes(conn: &Connection, dir: &Path, owner: &str, asset: &PluginAsset) -> Vec<u8> {
    let (mut file, _) = open_inner(conn, dir, owner, &asset.key, &asset.revision).unwrap();
    let mut bytes = vec![];
    file.read_to_end(&mut bytes).unwrap();
    bytes
}
#[test]
fn plugin_assets_survive_reopen_and_isolate_names_and_bytes_without_sync_outbox() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db.sqlite");
    let mut conn = database(&path);
    let a = save(&mut conn, dir.path(), "a", "cover", None, &[0, 255, 1, 128]);
    let b = save(&mut conn, dir.path(), "b", "cover", None, &[5, 6]);
    assert!(!a.cleanup_pending);
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM blob_sync_state", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM blob_objects WHERE kind='plugin_asset' AND sync_required=0",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        2
    );
    drop(conn);
    let conn = database(&path);
    assert_eq!(bytes(&conn, dir.path(), "a", &a.asset), [0, 255, 1, 128]);
    assert_eq!(bytes(&conn, dir.path(), "b", &b.asset), [5, 6]);
    assert_eq!(
        open_inner(&conn, dir.path(), "b", "cover", &a.asset.revision)
            .unwrap_err()
            .code,
        "plugin/asset-conflict"
    );
    assert!(get_inner(&conn, "a", "../b").is_err());
}
#[test]
fn plugin_assets_cas_and_atomic_metadata_failure_preserve_the_old_file() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = database(&dir.path().join("db.sqlite"));
    let a = save(&mut conn, dir.path(), "a", "cover", None, b"old").asset;
    assert_eq!(
        store_inner(
            &mut conn,
            dir.path(),
            "a",
            "cover",
            None,
            AssetInput {
                filename: "a",
                mime: "text/plain",
                source: input(b"wrong")
            },
        )
        .unwrap_err()
        .code,
        "plugin/asset-conflict"
    );
    conn.execute_batch("CREATE TRIGGER reject_asset BEFORE UPDATE ON plugin_documents WHEN old.collection='_host_assets' BEGIN SELECT RAISE(ABORT,'failure'); END").unwrap();
    assert!(store_inner(
        &mut conn,
        dir.path(),
        "a",
        "cover",
        Some(&a.revision),
        AssetInput {
            filename: "a",
            mime: "text/plain",
            source: input(b"new")
        },
    )
    .is_err());
    assert_eq!(bytes(&conn, dir.path(), "a", &a), b"old");
    assert_eq!(fs::read_dir(dir.path().join("blobs")).unwrap().count(), 1);
    conn.execute_batch("DROP TRIGGER reject_asset").unwrap();
    let next = save(
        &mut conn,
        dir.path(),
        "a",
        "cover",
        Some(&a.revision),
        b"new",
    )
    .asset;
    assert_ne!(a.revision, next.revision);
    assert_eq!(bytes(&conn, dir.path(), "a", &next), b"new");
    assert_eq!(
        delete_inner(&mut conn, dir.path(), "a", "cover", &a.revision)
            .unwrap_err()
            .code,
        "plugin/asset-conflict"
    );
    assert!(
        !delete_inner(&mut conn, dir.path(), "a", "cover", &next.revision)
            .unwrap()
            .cleanup_pending
    );
    assert!(get_inner(&conn, "a", "cover").unwrap().is_none());
    assert_eq!(fs::read_dir(dir.path().join("blobs")).unwrap().count(), 0);
}
#[test]
fn plugin_assets_content_dedup_keeps_shared_bytes_until_the_last_owned_name_is_removed() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = database(&dir.path().join("db.sqlite"));
    let a = save(&mut conn, dir.path(), "a", "one", None, b"shared").asset;
    let b = save(&mut conn, dir.path(), "a", "two", None, b"shared").asset;
    assert_eq!(fs::read_dir(dir.path().join("blobs")).unwrap().count(), 1);
    delete_inner(&mut conn, dir.path(), "a", "one", &a.revision).unwrap();
    assert_eq!(bytes(&conn, dir.path(), "a", &b), b"shared");
    delete_inner(&mut conn, dir.path(), "a", "two", &b.revision).unwrap();
    assert_eq!(fs::read_dir(dir.path().join("blobs")).unwrap().count(), 0);
}
#[test]
fn plugin_assets_recover_unpublished_files_without_cross_owner_cleanup_and_fail_closed_on_bad_metadata(
) {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = database(&dir.path().join("db.sqlite"));
    let a = save(&mut conn, dir.path(), "a", "cover", None, b"a").asset;
    let b = save(&mut conn, dir.path(), "a-other", "cover", None, b"b").asset;
    let stray = dir
        .path()
        .join("blobs")
        .join(blob_file_name(&blob_key("a", &"f".repeat(64))));
    fs::write(&stray, b"orphan").unwrap();
    let temp_b = dir.path().join("blobs/.pluginasset-7-a-other-unfinished");
    fs::write(&temp_b, b"pending").unwrap();
    reclaim(&conn, dir.path(), "a").unwrap();
    assert!(!stray.exists());
    assert!(temp_b.exists());
    assert_eq!(bytes(&conn, dir.path(), "a-other", &b), b"b");
    recover_all(&conn, dir.path());
    assert!(!temp_b.exists());
    assert_eq!(bytes(&conn, dir.path(), "a", &a), b"a");
    conn.execute(
        "UPDATE plugin_documents SET json='{}' WHERE plugin_id='a'",
        [],
    )
    .unwrap();
    assert!(reclaim(&conn, dir.path(), "a").is_err());
    assert_eq!(fs::read_dir(dir.path().join("blobs")).unwrap().count(), 2);
}
#[test]
fn plugin_assets_quota_and_corrupt_source_fail_before_false_success() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = database(&dir.path().join("db.sqlite"));
    let huge = input(b"");
    huge.set_len(MAX_BYTES + 1).unwrap();
    assert_eq!(
        store_inner(
            &mut conn,
            dir.path(),
            "a",
            "big",
            None,
            AssetInput {
                filename: "big",
                mime: "text/plain",
                source: huge
            },
        )
        .unwrap_err()
        .code,
        "plugin/quota-exceeded"
    );
    let a = save(&mut conn, dir.path(), "a", "cover", None, b"image").asset;
    let path: String = conn
        .query_row(
            "SELECT storage_uri FROM blob_objects WHERE deleted_at IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    fs::write(dir.path().join(&path), b"other").unwrap();
    assert!(open_inner(&conn, dir.path(), "a", "cover", &a.revision).is_err());
    fs::remove_file(dir.path().join(&path)).unwrap();
    assert_eq!(
        open_inner(&conn, dir.path(), "a", "cover", &a.revision)
            .unwrap_err()
            .code,
        "fs/not-found"
    );
}
#[test]
fn plugin_assets_join_namespace_snapshots_and_reject_writes_during_upgrade() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = database(&dir.path().join("db.sqlite"));
    let a = save(&mut conn, dir.path(), "a", "cover", None, b"asset").asset;
    let baseline = plugin_data_snapshot_inner(&mut conn, "a").unwrap();
    assert_eq!(baseline.documents[0].collection, COLLECTION);
    conn.execute("INSERT INTO plugin_update_journal(update_id,plugin_id,baseline_json,phase) VALUES ('update','a',?1,'prepared')", [serde_json::to_string(&baseline).unwrap()]).unwrap();
    assert_eq!(
        store_inner(
            &mut conn,
            dir.path(),
            "a",
            "cover",
            Some(&a.revision),
            AssetInput {
                filename: "a",
                mime: "text/plain",
                source: input(b"new")
            },
        )
        .unwrap_err()
        .code,
        "plugin/data-busy"
    );
    // A failed candidate can restore private metadata without copying binary
    // bytes into the journal or changing immutable asset content.
    plugin_data_restore_inner(&mut conn, "a", baseline).unwrap();
    let restored = get_inner(&conn, "a", "cover").unwrap().unwrap();
    assert_ne!(restored.revision, a.revision);
    assert_eq!(bytes(&conn, dir.path(), "a", &restored), b"asset");
    recover_all(&conn, dir.path());
    assert_eq!(bytes(&conn, dir.path(), "a", &restored), b"asset");
}

#[test]
fn plugin_assets_full_backup_captures_private_metadata_and_bytes_and_restores_a_readable_namespace()
{
    let source = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut conn = database(&source.path().join("db.sqlite"));
    ensure_local_device(&conn).unwrap();
    let asset = save(
        &mut conn,
        source.path(),
        "proof",
        "cover",
        None,
        &[0, 255, 4],
    )
    .asset;
    let snapshot =
        backup_snapshot::capture_fixture(&mut conn, source.path(), stage.path(), |_| Ok(()))
            .unwrap();
    let database_file = snapshot.directory().join("database.sqlite");
    let mut snapshot_db = Connection::open(database_file).unwrap();
    register_sql_functions(&snapshot_db).unwrap();
    validate_namespaces(&snapshot_db).unwrap();
    let namespace = plugin_data_snapshot_inner(&mut snapshot_db, "proof").unwrap();
    assert_eq!(namespace.documents.len(), 1);
    let registry_path: String = snapshot_db
        .query_row(
            "SELECT storage_uri FROM blob_objects WHERE kind='plugin_asset'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(snapshot
        .manifest
        .files
        .iter()
        .any(|file| file.path == registry_path));
    assert_eq!(
        fs::read(snapshot.directory().join(&registry_path)).unwrap(),
        [0, 255, 4]
    );
    // Namespace restoration and the selected immutable blob use the same
    // primitives as complete restore; no live source file is needed afterward.
    let target = tempfile::tempdir().unwrap();
    let mut target_db = database(&target.path().join("db.sqlite"));
    let copied = fs::read(snapshot.directory().join(&registry_path)).unwrap();
    let source_key: String = snapshot_db
        .query_row(
            "SELECT key FROM blob_objects WHERE kind='plugin_asset'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    put_blob_inner(
        &target_db,
        target.path(),
        &source_key,
        Some("image/png"),
        &copied,
    )
    .unwrap();
    plugin_data_restore_inner(&mut target_db, "proof", namespace).unwrap();
    let restored = get_inner(&target_db, "proof", &asset.key).unwrap().unwrap();
    assert_eq!(bytes(&target_db, target.path(), "proof", &restored), copied);
    target_db
        .execute("DELETE FROM plugin_documents WHERE plugin_id='proof'", [])
        .unwrap();
    reclaim(&target_db, target.path(), "proof").unwrap();
    assert_eq!(
        fs::read_dir(target.path().join("blobs")).unwrap().count(),
        0
    );
}

#[test]
fn plugin_assets_reject_forged_registry_paths_without_removing_other_owned_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = database(&dir.path().join("db.sqlite"));
    // Equal bytes make a hash-only check insufficient to establish ownership.
    let a = save(&mut conn, dir.path(), "a", "cover", None, b"same").asset;
    let b = save(&mut conn, dir.path(), "b", "cover", None, b"same").asset;
    let other_path: String = conn
        .query_row(
            "SELECT storage_uri FROM blob_objects WHERE key LIKE 'pluginasset:b:%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    conn.execute(
        "UPDATE blob_objects SET storage_uri=?1 WHERE key LIKE 'pluginasset:a:%'",
        [&other_path],
    )
    .unwrap();
    assert!(open_inner(&conn, dir.path(), "a", "cover", &a.revision).is_err());
    assert!(reclaim(&conn, dir.path(), "a").is_err());
    let receipt = delete_inner(&mut conn, dir.path(), "a", "cover", &a.revision).unwrap();
    assert!(receipt.deleted && receipt.cleanup_pending);
    recover_all(&conn, dir.path());
    assert_eq!(bytes(&conn, dir.path(), "b", &b), b"same");
}

#[cfg(unix)]
#[test]
fn plugin_assets_do_not_follow_symlinked_immutable_files() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = database(&dir.path().join("db.sqlite"));
    let a = save(&mut conn, dir.path(), "a", "cover", None, b"same").asset;
    let path: String = conn
        .query_row("SELECT storage_uri FROM blob_objects", [], |r| r.get(0))
        .unwrap();
    let external = dir.path().join("external");
    fs::write(&external, b"same").unwrap();
    fs::remove_file(dir.path().join(&path)).unwrap();
    std::os::unix::fs::symlink(&external, dir.path().join(&path)).unwrap();
    assert!(open_inner(&conn, dir.path(), "a", "cover", &a.revision).is_err());
    assert!(store_inner(
        &mut conn,
        dir.path(),
        "a",
        "second",
        None,
        AssetInput {
            filename: "a",
            mime: "text/plain",
            source: input(b"same")
        },
    )
    .is_err());
    delete_inner(&mut conn, dir.path(), "a", "cover", &a.revision).unwrap();
    assert_eq!(fs::read(external).unwrap(), b"same");
}

#[test]
fn plugin_assets_enforce_name_and_logical_byte_quotas_without_evicting_existing_assets() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = database(&dir.path().join("db.sqlite"));
    let a = save(&mut conn, dir.path(), "a", "cover", None, b"saved").asset;
    let metadata_json: String = conn
        .query_row(
            "SELECT json FROM plugin_documents WHERE plugin_id='a'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    // Build quota fixtures through the same private namespace storage primitive;
    // no giant binary allocation is needed to test dispatch admission.
    for n in 1..MAX_COUNT {
        plugin_docs::plugin_docs_put_inner(
            &conn,
            "a",
            COLLECTION,
            &format!("item{n}"),
            &metadata_json,
            None,
            None,
        )
        .unwrap();
    }
    assert_eq!(
        store_inner(
            &mut conn,
            dir.path(),
            "a",
            "overflow",
            None,
            AssetInput {
                filename: "a",
                mime: "text/plain",
                source: input(b"new")
            },
        )
        .unwrap_err()
        .code,
        "plugin/quota-exceeded"
    );
    assert_eq!(bytes(&conn, dir.path(), "a", &a), b"saved");
    conn.execute(
        "DELETE FROM plugin_documents WHERE plugin_id='a' AND id!='cover'",
        [],
    )
    .unwrap();
    let mut data: AssetData = serde_json::from_str(&metadata_json).unwrap();
    data.size = MAX_BYTES;
    for n in 0..8 {
        plugin_docs::plugin_docs_put_inner(
            &conn,
            "a",
            COLLECTION,
            &format!("large{n}"),
            &serde_json::to_string(&data).unwrap(),
            None,
            None,
        )
        .unwrap();
    }
    assert_eq!(
        store_inner(
            &mut conn,
            dir.path(),
            "a",
            "overflow",
            None,
            AssetInput {
                filename: "a",
                mime: "text/plain",
                source: input(b"new")
            },
        )
        .unwrap_err()
        .code,
        "plugin/quota-exceeded"
    );
    assert_eq!(bytes(&conn, dir.path(), "a", &a), b"saved");
}
