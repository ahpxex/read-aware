use super::*;

fn database() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    crate::storage::register_sql_functions(&conn).unwrap();
    crate::storage::run_migrations(&mut conn).unwrap();
    conn
}
fn clock(conn: &mut Connection) -> String {
    crate::storage::context_bundle_source_revision_inner(conn).unwrap()
}
fn artifact() -> Vec<u8> {
    include_bytes!("../../../../packages/core/src/context-bundle.golden.json").to_vec()
}
fn staged(entries: &mut HashMap<String, Entry>, bytes: &[u8]) -> ResourceInfo {
    let info = insert(entries, None).unwrap();
    for (index, chunk) in bytes.chunks(MAX_CHUNK).enumerate() {
        append(entries, &info.id, (index * MAX_CHUNK) as u64, chunk).unwrap();
    }
    info
}
fn mutate(conn: &Connection, value: &str) {
    conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES('context-test',?1,'now') ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json", [value]).unwrap();
}

#[test]
fn sealing_validates_artifact_and_binds_once_without_allowing_generic_consumption() {
    let mut conn = database();
    let revision = clock(&mut conn);
    let mut entries = HashMap::new();
    let original = artifact();
    let info = staged(&mut entries, &original);
    seal(&mut conn, &mut entries, &info.id, &revision).unwrap();
    assert!(entries[&info.id].ready);
    assert_eq!(entries[&info.id].context_revision.as_deref(), Some(revision.as_str()));
    assert_eq!(with_revision(&mut conn, &revision, || read(&mut entries, &info.id, 0, MAX_CHUNK)).unwrap(), original);
    assert!(lease(&mut entries, &info.id).is_err());
    assert!(append(&mut entries, &info.id, original.len() as u64, b"!").is_err());
    assert!(seal(&mut conn, &mut entries, &info.id, &revision).is_err());
    mutate(&conn, "changed");
    let newer = clock(&mut conn);
    assert!(seal(&mut conn, &mut entries, &info.id, &newer).is_err());
    assert_eq!(with_revision(&mut conn, &revision, || read(&mut entries, &info.id, 0, 1)).unwrap_err().code, "memory/conflict");
    entries.remove(&info.id);
    assert!(entries.is_empty());
}

#[test]
fn invalid_json_hash_and_stale_sources_never_seal_or_replace_output() {
    let mut conn = database();
    let revision = clock(&mut conn);
    let mut entries = HashMap::new();
    let mut bad: serde_json::Value = serde_json::from_slice(&artifact()).unwrap();
    bad["version"] = "cb1:forged".into();
    for bytes in [b"not json".to_vec(), serde_json::to_vec(&bad).unwrap(), vec![b' '; 2 * MAX_CHUNK + 1]] {
        let info = staged(&mut entries, &bytes);
        assert!(seal(&mut conn, &mut entries, &info.id, &revision).is_err());
        assert!(!entries[&info.id].ready);
        assert!(entries[&info.id].context_revision.is_none());
        entries.remove(&info.id);
    }
    let info = staged(&mut entries, &artifact());
    mutate(&conn, "before seal");
    assert_eq!(seal(&mut conn, &mut entries, &info.id, &revision).unwrap_err().code, "memory/conflict");
    assert!(!entries[&info.id].ready);
    let current = clock(&mut conn);
    seal(&mut conn, &mut entries, &info.id, &current).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("bundle.json");
    std::fs::write(&path, b"previous").unwrap();
    mutate(&conn, "before save");
    assert!(with_revision(&mut conn, &current, || save(&mut entries, &info.id, &path)).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"previous");
}

#[test]
fn rollback_keeps_admission_but_aba_missing_or_corrupt_state_deny() {
    let mut conn = database();
    mutate(&conn, "A");
    let revision = clock(&mut conn);
    { let tx = conn.transaction().unwrap(); mutate(&tx, "rollback"); }
    with_revision(&mut conn, &revision, || Ok(())).unwrap();
    mutate(&conn, "B"); mutate(&conn, "A");
    assert!(with_revision(&mut conn, &revision, || Ok(())).is_err());
    let current = clock(&mut conn);
    conn.execute("DELETE FROM context_bundle_source_clock", []).unwrap();
    assert!(with_revision(&mut conn, &current, || Ok(())).is_err());
    assert_eq!(conn.query_row("SELECT count(*) FROM context_bundle_source_clock", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
    let current = clock(&mut conn);
    conn.execute("UPDATE context_bundle_source_clock SET generation='invalid'", []).unwrap();
    assert!(with_revision(&mut conn, &current, || Ok(())).is_err());
    assert!(with_revision(&mut conn, "cbsource1:invalid:0", || Ok(())).is_err());
    conn.execute("DROP TABLE context_bundle_source_clock", []).unwrap();
    assert!(with_revision(&mut conn, &current, || Ok(())).is_err());
}

#[test]
fn second_connection_changes_are_checked_at_native_admission_and_not_only_in_js() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.sqlite");
    let mut conn = Connection::open(&path).unwrap();
    crate::storage::register_sql_functions(&conn).unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
    crate::storage::run_migrations(&mut conn).unwrap();
    let other = Connection::open(&path).unwrap();
    crate::storage::register_sql_functions(&other).unwrap();
    let revision = clock(&mut conn);
    let mut entries = HashMap::new();
    let info = staged(&mut entries, &artifact());
    seal(&mut conn, &mut entries, &info.id, &revision).unwrap();
    let output = dir.path().join("bundle.json");
    with_revision(&mut conn, &revision, || {
        mutate(&other, "after admission");
        save(&mut entries, &info.id, &output)
    }).unwrap();
    assert_eq!(std::fs::read(&output).unwrap(), artifact());
    assert!(with_revision(&mut conn, &revision, || read(&mut entries, &info.id, 0, 1)).is_err());
    drop(conn);
    let mut reopened = Connection::open(path).unwrap();
    assert!(with_revision(&mut reopened, &revision, || Ok(())).is_err());
}

#[test]
fn stale_projection_and_wipe_reject_retained_files_without_recreating_a_proof() {
    let mut conn = database();
    let revision = clock(&mut conn);
    let mut entries = HashMap::new();
    let info = staged(&mut entries, &artifact());
    seal(&mut conn, &mut entries, &info.id, &revision).unwrap();
    conn.execute("INSERT INTO sync_profile(id,projections_stale,updated_at) VALUES(1,1,'now')", []).unwrap();
    assert_eq!(with_revision(&mut conn, &revision, || Ok(())).unwrap_err().code, "memory/conflict");
    conn.execute("UPDATE sync_profile SET projections_stale=0", []).unwrap();
    with_revision(&mut conn, &revision, || Ok(())).unwrap();
    let dir = tempfile::tempdir().unwrap();
    crate::storage::wipe_all_data_inner(&mut conn, dir.path()).unwrap();
    assert!(with_revision(&mut conn, &revision, || read(&mut entries, &info.id, 0, 1)).is_err());
    assert_ne!(clock(&mut conn), revision);
    entries.remove(&info.id);
    assert!(entries.is_empty());
}
