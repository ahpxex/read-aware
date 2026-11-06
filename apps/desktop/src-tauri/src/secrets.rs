//! Secret IPC commands. The sealing scheme and its rationale live in
//! `read_aware_store::secrets`.
use crate::error::CommandError;
use crate::storage::{DataDir, Db};
pub use read_aware_store::secrets::*;
use rusqlite::{params, OptionalExtension};
use tauri::Manager;

#[tauri::command]
pub async fn secret_set(
    app: tauri::AppHandle,
    key: String,
    value: String,
    roam: Option<bool>,
    source: Option<serde_json::Value>,
) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        set_inner(&app, &key, &value, roam.unwrap_or(true), source.as_ref())
    })
    .await
    .map_err(|e| format!("secret_set task failed: {e}"))?
}

#[tauri::command]
pub async fn secret_get(
    app: tauri::AppHandle,
    key: String,
) -> Result<Option<String>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || get_inner(&app, &key))
        .await
        .map_err(|e| format!("secret_get task failed: {e}"))?
}

#[tauri::command]
pub async fn secret_delete(
    app: tauri::AppHandle,
    key: String,
    roam: Option<bool>,
    source: Option<serde_json::Value>,
) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_inner(&app, &key, roam.unwrap_or(true), source.as_ref())
    })
    .await
    .map_err(|e| format!("secret_delete task failed: {e}"))?
}

/// Stored secret key names under a prefix (names only, never values) —
/// lets hydration discover per-provider slots without a hardcoded roster.
#[tauri::command]
pub async fn secret_keys(
    app: tauri::AppHandle,
    prefix: String,
) -> Result<Vec<String>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || keys_inner(&app, &prefix))
        .await
        .map_err(|e| format!("secret_keys task failed: {e}"))?
}

fn set_inner(
    app: &tauri::AppHandle,
    key: &str,
    value: &str,
    roam: bool,
    source: Option<&serde_json::Value>,
) -> Result<(), CommandError> {
    let sealed = encrypt(&app.state::<DataDir>().0, value)?;
    let db = app.state::<Db>();
    let mut conn = db.0.lock()?;
    write_sealed_with_source(&mut conn, key, Some(&sealed), roam, source)
}

fn get_inner(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, CommandError> {
    let sealed: Option<String> = {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        conn.query_row(
            "SELECT value_json FROM app_kv WHERE key = ?1",
            params![format!("{KV_PREFIX}{key}")],
            |row| row.get(0),
        )
        .optional()?
    };
    match sealed {
        Some(value) => decrypt(&app.state::<DataDir>().0, &value).map(Some),
        None => Ok(None),
    }
}

fn delete_inner(
    app: &tauri::AppHandle,
    key: &str,
    roam: bool,
    source: Option<&serde_json::Value>,
) -> Result<(), CommandError> {
    let db = app.state::<Db>();
    let mut conn = db.0.lock()?;
    write_sealed_with_source(&mut conn, key, None, roam, source)
}

fn keys_inner(app: &tauri::AppHandle, prefix: &str) -> Result<Vec<String>, CommandError> {
    let db = app.state::<Db>();
    let conn = db.0.lock()?;
    let mut stmt = conn.prepare("SELECT key FROM app_kv WHERE key LIKE ?1 ORDER BY key")?;
    let like = format!("{KV_PREFIX}{prefix}%");
    let keys = stmt
        .query_map(params![like], |row| row.get::<_, String>(0))?
        .filter_map(|row| row.ok())
        .filter_map(|key| key.strip_prefix(KV_PREFIX).map(str::to_string))
        .collect();
    Ok(keys)
}
