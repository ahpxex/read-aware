//! A full-backup capture carries plugin assets' private metadata and bytes.
use super::*;
use read_aware_store::storage::plugin_assets::*;
use std::fs::{self, File};
use std::io::{Read, Write};
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
