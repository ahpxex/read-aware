//! Secret storage for credentials the user brings (today: the LLM API key).
//!
//! AES-256-GCM, with the key in its own `0600` file next to the database rather
//! than inside it.
//!
//! ## Why not the OS keychain
//!
//! Because "the user approves once" depends on a STABLE CODE SIGNATURE, and
//! this app does not have one: `codesign` reports `adhoc` with no team
//! identifier for dev and release builds alike. macOS keys its keychain ACL to
//! the binary's signature, so every rebuild — and every shipped update — reads
//! as a different application and prompts again. A permission dialog on each
//! launch is not a security feature; it is training the user to click through
//! dialogs.
//!
//! The trade only makes sense because the threat model changed. What made the
//! old `localStorage` slot dangerous was that any installed plugin could read
//! it; plugins no longer run in a realm with storage access at all (see
//! plugin-sandbox.worker.ts). What remains is a local process running as the
//! user, and against that the keychain's edge is real but narrow — and paid for
//! on every single launch.
//!
//! ## What this does and does not buy
//!
//!   - **Does** keep the key out of readable plaintext, so it cannot leak
//!     through a backup, a synced folder, a screenshot of the database, or a
//!     careless `grep`. Taking `read-aware.db` alone yields ciphertext.
//!   - **Does not** stop a process already running as this user from reading
//!     both files. Only an OS keychain or a hardware-backed key does that.
//!
//! If the app ever ships with a Developer ID signature, revisit this: the
//! keychain becomes strictly better once its prompt fires once instead of
//! forever.
//!
//! Commands are `async` + `spawn_blocking` — they touch the filesystem and the
//! database, and Tauri runs synchronous commands on the main thread.

use std::io::Write;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, Nonce};
use base64::Engine;
use rusqlite::params;
use tauri::Manager;

use crate::storage::{DataDir, Db};

/// `app_kv` prefix for stored secrets. Values are sealed, never plaintext.
const KV_PREFIX: &str = "read-aware-secret:";

fn key_path(data_dir: &Path) -> PathBuf {
    data_dir.join("secret.key")
}

/// Load the local encryption key, creating it on first use.
///
/// Kept OUT of the database on purpose: an attacker who walks off with
/// `read-aware.db` (a backup, a synced folder) gets ciphertext and nothing to
/// open it with. Written `0600` so other accounts on the machine cannot read it.
fn load_or_create_key(data_dir: &Path) -> Result<Vec<u8>, String> {
    let path = key_path(data_dir);
    if let Ok(existing) = std::fs::read(&path) {
        if existing.len() == 32 {
            return Ok(existing);
        }
    }
    let key = Aes256Gcm::generate_key(OsRng);
    let mut file = std::fs::File::create(&path).map_err(|e| format!("key file: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = file
            .metadata()
            .map_err(|e| format!("key file metadata: {e}"))?
            .permissions();
        perms.set_mode(0o600);
        file.set_permissions(perms)
            .map_err(|e| format!("key file permissions: {e}"))?;
    }
    file.write_all(&key).map_err(|e| format!("key file: {e}"))?;
    Ok(key.to_vec())
}

fn cipher(data_dir: &Path) -> Result<Aes256Gcm, String> {
    let bytes = load_or_create_key(data_dir)?;
    Ok(Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&bytes)))
}

/// `base64(nonce ‖ ciphertext)` — a fresh random nonce per write, stored
/// alongside, which is how GCM expects to be used.
///
/// `pub(crate)` only so the storage tests can exercise the crypto directly; the
/// commands below are the supported entry points.
pub(crate) fn encrypt(data_dir: &Path, plaintext: &str) -> Result<String, String> {
    let cipher = cipher(data_dir)?;
    let nonce = Aes256Gcm::generate_nonce(OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|_| "failed to encrypt secret".to_string())?;
    let mut packed = nonce.to_vec();
    packed.extend_from_slice(&ciphertext);
    Ok(base64::engine::general_purpose::STANDARD.encode(packed))
}

pub(crate) fn decrypt(data_dir: &Path, packed: &str) -> Result<String, String> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(packed)
        .map_err(|_| "stored secret is not valid base64".to_string())?;
    if raw.len() < 12 {
        return Err("stored secret is truncated".to_string());
    }
    let (nonce, ciphertext) = raw.split_at(12);
    let plaintext = cipher(data_dir)?
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| "failed to decrypt secret (wrong or missing key file)".to_string())?;
    String::from_utf8(plaintext).map_err(|_| "decrypted secret is not UTF-8".to_string())
}

// ─── Commands ────────────────────────────────────────────────────────────────

fn set_inner(app: &tauri::AppHandle, key: &str, value: &str) -> Result<(), String> {
    let sealed = encrypt(&app.state::<DataDir>().0, value)?;
    let db = app.state::<Db>();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO app_kv (key, value_json, updated_at)
         VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json, updated_at = excluded.updated_at",
        params![format!("{KV_PREFIX}{key}"), sealed],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn get_inner(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
    let sealed: Option<String> = {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT value_json FROM app_kv WHERE key = ?1",
            params![format!("{KV_PREFIX}{key}")],
            |row| row.get(0),
        )
        .ok()
    };
    match sealed {
        Some(value) => decrypt(&app.state::<DataDir>().0, &value).map(Some),
        None => Ok(None),
    }
}

fn delete_inner(app: &tauri::AppHandle, key: &str) -> Result<(), String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM app_kv WHERE key = ?1",
        params![format!("{KV_PREFIX}{key}")],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn secret_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || set_inner(&app, &key, &value))
        .await
        .map_err(|e| format!("secret_set task failed: {e}"))?
}

#[tauri::command]
pub async fn secret_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || get_inner(&app, &key))
        .await
        .map_err(|e| format!("secret_get task failed: {e}"))?
}

#[tauri::command]
pub async fn secret_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_inner(&app, &key))
        .await
        .map_err(|e| format!("secret_delete task failed: {e}"))?
}
