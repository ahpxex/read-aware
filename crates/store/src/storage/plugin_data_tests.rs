use super::*;

fn database() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    conn
}

fn seed(conn: &Connection, owner: &str, value: &str) {
    conn.execute(
        "INSERT OR REPLACE INTO app_kv (key,value_json,updated_at) VALUES (?1,?2,'now')",
        params![format!("read-aware-plugin.{owner}.setting"), value],
    )
    .unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO app_kv (key,value_json,updated_at) VALUES (?1,?2,'now')",
        params![format!("read-aware-plugin-host.schema.{owner}"), value],
    )
    .unwrap();
    conn.execute("INSERT OR REPLACE INTO plugin_documents (plugin_id,collection,id,json,updated_at) VALUES (?1,'notes','one',?2,'now')",
        params![owner, format!("\"{value}\"")]).unwrap();
}

#[test]
fn plugin_data_joint_restore_restores_exact_baseline_and_only_its_owner() {
    let mut conn = database();
    seed(&conn, "sample", "1");
    seed(&conn, "sample-other", "other");
    let baseline = plugin_data_snapshot_inner(&mut conn, "sample").unwrap();
    assert_eq!(baseline.kv.len(), 1);
    seed(&conn, "sample", "2");
    conn.execute("INSERT INTO app_kv (key,value_json,updated_at) VALUES ('read-aware-plugin.sample.added','new','now')", []).unwrap();
    plugin_data_restore_inner(&mut conn, "sample", baseline.clone()).unwrap();
    let restored = plugin_data_snapshot_inner(&mut conn, "sample").unwrap();
    assert_eq!(
        serde_json::to_value(restored).unwrap(),
        serde_json::to_value(baseline).unwrap()
    );
    assert_eq!(
        plugin_data_snapshot_inner(&mut conn, "sample-other")
            .unwrap()
            .schema
            .as_deref(),
        Some("other")
    );
}

#[test]
fn plugin_data_failed_document_or_schema_restore_rolls_back_every_table() {
    for table in ["plugin_documents", "app_kv"] {
        let mut conn = database();
        seed(&conn, "sample", "1");
        let baseline = plugin_data_snapshot_inner(&mut conn, "sample").unwrap();
        seed(&conn, "sample", "2");
        let before = plugin_data_snapshot_inner(&mut conn, "sample").unwrap();
        let generations: Vec<(String, String)> = conn
            .prepare("SELECT collection, generation FROM plugin_document_generations")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let predicate = if table == "app_kv" {
            "WHEN new.key='read-aware-plugin-host.schema.sample'"
        } else {
            ""
        };
        conn.execute_batch(&format!("CREATE TRIGGER fail_restore BEFORE INSERT ON {table} {predicate} BEGIN SELECT RAISE(ABORT,'test failure'); END;")).unwrap();
        assert_eq!(
            plugin_data_restore_inner(&mut conn, "sample", baseline.clone())
                .unwrap_err()
                .code,
            "db/error"
        );
        assert_eq!(
            serde_json::to_value(plugin_data_snapshot_inner(&mut conn, "sample").unwrap()).unwrap(),
            serde_json::to_value(before).unwrap()
        );
        let after: Vec<(String, String)> = conn
            .prepare("SELECT collection, generation FROM plugin_document_generations")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(generations, after);
        conn.execute_batch("DROP TRIGGER fail_restore").unwrap();
        plugin_data_restore_inner(&mut conn, "sample", baseline).unwrap();
    }
}

#[test]
fn plugin_data_empty_baseline_and_invalid_owners() {
    let mut conn = database();
    let empty = plugin_data_snapshot_inner(&mut conn, "sample").unwrap();
    seed(&conn, "sample", "2");
    assert_eq!(
        plugin_data_restore_inner(&mut conn, "other", empty.clone())
            .unwrap_err()
            .code,
        "plugin/invalid-argument"
    );
    plugin_data_restore_inner(&mut conn, "sample", empty).unwrap();
    let empty = plugin_data_snapshot_inner(&mut conn, "sample").unwrap();
    assert!(empty.kv.is_empty() && empty.documents.is_empty() && empty.schema.is_none());
    for id in ["", "../sample", "sample.other", "-sample", "SAMPLE"] {
        assert_eq!(
            plugin_data_snapshot_inner(&mut conn, id).unwrap_err().code,
            "plugin/invalid-argument"
        );
    }
}

#[test]
fn plugin_data_preserves_arbitrary_owned_key_suffixes_through_recovery() {
    let mut conn = database();
    for key in ["", "line\nbreak", "\0", "__proto__"] {
        conn.execute(
            "INSERT INTO app_kv(key,value_json,updated_at) VALUES (?1,'true','now')",
            [format!("read-aware-plugin.sample.{key}")],
        )
        .unwrap();
    }
    let snapshot = plugin_data_snapshot_inner(&mut conn, "sample").unwrap();
    assert_eq!(snapshot.kv.len(), 4);
    for key in ["", "line\nbreak", "\0", "__proto__"] {
        assert_eq!(snapshot.kv.get(key).map(String::as_str), Some("true"));
    }
    plugin_data_restore_inner(&mut conn, "sample", snapshot.clone()).unwrap();
    assert_eq!(
        plugin_data_snapshot_inner(&mut conn, "sample").unwrap().kv,
        snapshot.kv
    );
}
