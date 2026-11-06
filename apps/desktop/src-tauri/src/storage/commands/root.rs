//! IPC commands over the store root: device identity, KV and boot reads.
use crate::error::CommandError;
use crate::storage::*;

#[tauri::command]
pub async fn local_device_get(app: tauri::AppHandle) -> Result<LocalDeviceInfo, CommandError> {
    crate::storage::blocking("local_device_get", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        let device_id = ensure_local_device(&conn)?;
        // The log's newest stamp — OR a restored checkpoint's frontier, which is
        // newer than anything a still-backfilling log holds: the projections
        // already reflect events up to it, so local stamps must sort after it.
        let last = log_frontier(&conn)?;
        Ok(LocalDeviceInfo {
            device_id,
            last_hlc_wall_ms: last.map(|(wall, _)| wall),
            last_hlc_counter: last.map(|(_, counter)| counter),
        })
    })
    .await
}

/// Load the entire `app_kv` store as a `{ key: value_json }` map. Called once at
/// boot to hydrate the synchronous in-memory snapshot the settings modules read.
#[tauri::command]
pub async fn load_kv_all(
    app: tauri::AppHandle,
) -> Result<std::collections::HashMap<String, String>, CommandError> {
    crate::storage::blocking("load_kv_all", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        let mut stmt = conn.prepare("SELECT key, value_json FROM app_kv")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut map = std::collections::HashMap::new();
        for row in rows {
            let (key, value) = row?;
            map.insert(key, value);
        }
        Ok(map)
    })
    .await
}

#[tauri::command]
pub async fn get_kv(app: tauri::AppHandle, key: String) -> Result<Option<String>, CommandError> {
    blocking("get_kv", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        get_kv_inner(&conn, &key)
    })
    .await
}

/// Upsert one config key (write-through from `localKV.setItem`).
#[tauri::command]
pub async fn set_kv(key: String, value: String, app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::storage::blocking("set_kv", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        let entries = vec![(key, Some(value))];
        crate::desktop_preferences::commit_entries(&app, &entries, || {
            set_kv_batch_inner(&mut conn, entries.clone())
        })
    })
    .await
}

/// A settings command can span several preference records, but commits all or
/// none. Roaming keys pass their `preference.changed` events so the log entry
/// commits with the KV write.
#[tauri::command]
pub async fn set_kv_batch(
    entries: Vec<(String, Option<String>)>,
    events: Option<Vec<EventRow>>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("set_kv_batch", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        let events = events.unwrap_or_default();
        crate::desktop_preferences::commit_entries(&app, &entries, || {
            set_kv_batch_with_preferences_inner(&mut conn, entries.clone(), &events)
        })
    })
    .await
}

/// Delete one config key (write-through from `localKV.removeItem`).
#[tauri::command]
pub async fn delete_kv(key: String, app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::storage::blocking("delete_kv", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        let entries = vec![(key, None)];
        crate::desktop_preferences::commit_entries(&app, &entries, || {
            set_kv_batch_inner(&mut conn, entries.clone())
        })
    })
    .await
}

/// Replace one namespaced KV snapshot in a single transaction. Plugin update
/// recovery uses this instead of racing individual fire-and-forget writes.
#[tauri::command]
pub async fn replace_kv_prefix(
    prefix: String,
    entries: std::collections::HashMap<String, String>,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    crate::storage::blocking("replace_kv_prefix", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        let general =
            if let Some(suffix) = crate::desktop_preferences::GENERAL_KEY.strip_prefix(&prefix) {
                vec![(
                    crate::desktop_preferences::GENERAL_KEY.to_string(),
                    entries.get(suffix).cloned(),
                )]
            } else {
                vec![]
            };
        crate::desktop_preferences::commit_entries(&app, &general, || {
            replace_kv_prefix_inner(&mut conn, &prefix, entries)
        })
    })
    .await
}
