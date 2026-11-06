//! Host-owned update baselines. KV, documents and schema belong to one rollback.
use super::*;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginDataSnapshot {
    pub plugin_id: String,
    pub kv: BTreeMap<String, String>,
    pub documents: Vec<PluginDocumentSnapshotRow>,
    pub schema: Option<String>,
}

fn keys(plugin_id: &str) -> Result<(String, String), CommandError> {
    if plugin_id.is_empty()
        || plugin_id.len() > 64
        || plugin_id.starts_with('-')
        || !plugin_id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    {
        return Err(CommandError::new(
            "plugin/invalid-argument",
            "invalid plugin data owner",
        ));
    }
    Ok((
        format!("read-aware-plugin.{plugin_id}."),
        format!("read-aware-plugin-host.schema.{plugin_id}"),
    ))
}

pub(crate) fn plugin_data_snapshot_inner(
    conn: &mut Connection,
    plugin_id: &str,
) -> Result<PluginDataSnapshot, CommandError> {
    let tx = conn.transaction()?;
    let snapshot = plugin_data_snapshot_tx(&tx, plugin_id)?;
    tx.commit()?;
    Ok(snapshot)
}

pub(crate) fn plugin_data_snapshot_tx(
    tx: &Transaction,
    plugin_id: &str,
) -> Result<PluginDataSnapshot, CommandError> {
    plugin_data_snapshot_conn(tx, plugin_id)
}

pub(crate) fn plugin_data_snapshot_conn(
    tx: &Connection,
    plugin_id: &str,
) -> Result<PluginDataSnapshot, CommandError> {
    let (prefix, schema_key) = keys(plugin_id)?;
    let kv = {
        let mut stmt = tx.prepare(
            "SELECT key, value_json FROM app_kv WHERE substr(key, 1, length(?1))=?1 ORDER BY key",
        )?;
        let rows = stmt
            .query_map(params![prefix], |row| {
                // SQLite text substr truncates at NUL; keys are arbitrary plugin
                // strings, so preserve the full key and strip its ASCII prefix here.
                let key = row.get::<_, String>(0)?;
                Ok((key[prefix.len()..].to_owned(), row.get::<_, String>(1)?))
            })?
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        rows
    };
    let documents = plugin_docs::plugin_docs_snapshot_inner(tx, plugin_id)?;
    let schema = get_kv_inner(tx, &schema_key)?;
    Ok(PluginDataSnapshot {
        plugin_id: plugin_id.into(),
        kv,
        documents,
        schema,
    })
}

pub(crate) fn plugin_data_restore_inner(
    conn: &mut Connection,
    plugin_id: &str,
    snapshot: PluginDataSnapshot,
) -> Result<(), CommandError> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    plugin_data_restore_tx(&tx, plugin_id, snapshot)?;
    Ok(tx.commit()?)
}

pub(crate) fn plugin_data_restore_tx(
    tx: &Transaction,
    plugin_id: &str,
    snapshot: PluginDataSnapshot,
) -> Result<(), CommandError> {
    let (prefix, schema_key) = keys(plugin_id)?;
    if snapshot.plugin_id != plugin_id {
        return Err(CommandError::new(
            "plugin/invalid-argument",
            "rollback baseline belongs to another plugin",
        ));
    }
    tx.execute(
        "DELETE FROM app_kv WHERE substr(key, 1, length(?1))=?1 OR key=?2",
        params![prefix, schema_key],
    )?;
    for (suffix, value) in snapshot.kv {
        tx.execute("INSERT INTO app_kv (key, value_json, updated_at) VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![format!("{prefix}{suffix}"), value])?;
    }
    if let Some(schema) = snapshot.schema {
        tx.execute("INSERT INTO app_kv (key, value_json, updated_at) VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))", params![schema_key, schema])?;
    }
    plugin_docs::replace_plugin_documents(tx, plugin_id, snapshot.documents)?;
    Ok(())
}

#[tauri::command]
pub async fn plugin_data_snapshot(
    plugin_id: String,
    app: AppHandle,
) -> Result<PluginDataSnapshot, CommandError> {
    blocking("plugin_data_snapshot", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        plugin_data_snapshot_inner(&mut conn, &plugin_id)
    })
    .await
}

#[tauri::command]
pub async fn plugin_data_restore(
    plugin_id: String,
    snapshot: PluginDataSnapshot,
    app: AppHandle,
) -> Result<(), CommandError> {
    blocking("plugin_data_restore", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        plugin_data_restore_inner(&mut conn, &plugin_id, snapshot)
    })
    .await
}

#[cfg(test)]
#[path = "plugin_data_tests.rs"]
mod tests;
