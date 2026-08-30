//! Roaming-preference projection reads. Writes never happen here — the table
//! is populated exclusively by `apply.rs` from `preference.changed` events
//! (key-level last-writer-wins in HLC order); this module only hands the
//! current snapshot to the webview's boot overlay and post-pull refresh.
use crate::error::CommandError;
use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceRow {
    pub key: String,
    pub value_json: String,
}

pub(crate) fn preferences_load_all_inner(conn: &Connection) -> Result<Vec<PreferenceRow>, CommandError> {
    let mut stmt = conn
        .prepare("SELECT key, value_json FROM synced_preferences ORDER BY key")
        ?;
    let iter = stmt
        .query_map([], |row| {
            Ok(PreferenceRow {
                key: row.get(0)?,
                value_json: row.get(1)?,
            })
        })
        ?;
    let mut out = Vec::new();
    for row in iter {
        out.push(row?);
    }
    Ok(out)
}

#[tauri::command]
pub fn preferences_load_all(db: State<'_, Db>) -> Result<Vec<PreferenceRow>, CommandError> {
    let conn = db.0.lock()?;
    preferences_load_all_inner(&conn)
}
