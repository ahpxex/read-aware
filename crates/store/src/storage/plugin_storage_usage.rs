//! Metadata only, scoped to the requesting plugin by the host bridge.
use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDataUsage {
    items: u64,
    value_bytes: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginStorageUsage {
    kv: PluginDataUsage,
    documents: PluginDataUsage,
    assets: PluginDataUsage,
}

fn usage(conn: &Connection, id: &str) -> Result<PluginStorageUsage, CommandError> {
    if !crate::plugins::valid_plugin_id(id) {
        return Err(CommandError::new(
            "plugin/invalid-argument",
            "Invalid storage owner",
        ));
    }
    let prefix = format!("read-aware-plugin.{id}.");
    let kv = conn.query_row("SELECT count(*), coalesce(sum(length(CAST(value_json AS BLOB))),0) FROM app_kv WHERE substr(key,1,length(?1))=?1", [&prefix], |r| Ok(PluginDataUsage { items:r.get(0)?, value_bytes:r.get(1)? }))?;
    // Reserved host collections are not plugin documents. Asset bytes are
    // counted separately; text history and other host metadata stay private.
    let documents = conn.query_row("SELECT count(*), coalesce(sum(length(CAST(json AS BLOB))),0) FROM plugin_documents WHERE plugin_id=?1 AND collection GLOB '[a-z0-9]*'", [id], |r| Ok(PluginDataUsage { items:r.get(0)?, value_bytes:r.get(1)? }))?;
    let (items, value_bytes) = plugin_assets::totals(conn, id)?;
    Ok(PluginStorageUsage {
        kv,
        documents,
        assets: PluginDataUsage {
            items: items as u64,
            value_bytes,
        },
    })
}

#[tauri::command]
pub async fn plugin_storage_usage(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<PluginStorageUsage, CommandError> {
    blocking("plugin_storage_usage", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        let tx = conn.transaction()?;
        let result = usage(&tx, &plugin_id)?;
        tx.commit()?;
        Ok(result)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_usage_counts_utf8_payloads_without_foreign_or_host_documents() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE app_kv(key TEXT,value_json TEXT); CREATE TABLE plugin_documents(plugin_id TEXT,collection TEXT,id TEXT,json TEXT,book_id TEXT,anchor TEXT,updated_at TEXT,revision TEXT);
          INSERT INTO app_kv VALUES ('read-aware-plugin.proof.a','中文'),('read-aware-plugin.proof-other.a','foreign');
          INSERT INTO plugin_documents VALUES ('proof','notes','one','中文',NULL,NULL,'now','r'),('proof','_host_text_history','one','hidden',NULL,NULL,'now','r'),('other','notes','one','foreign',NULL,NULL,'now','r');").unwrap();
        let result = usage(&conn, "proof").unwrap();
        assert_eq!((result.kv.items, result.kv.value_bytes), (1, 6));
        assert_eq!(
            (result.documents.items, result.documents.value_bytes),
            (1, 6)
        );
        assert_eq!((result.assets.items, result.assets.value_bytes), (0, 0));
        assert!(usage(&conn, "../foreign").is_err());
        assert_eq!(usage(&conn, "missing").unwrap().kv.items, 0);
    }
}
