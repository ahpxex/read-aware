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

use crate::error::CommandError;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, Nonce};
use base64::Engine;
use rusqlite::params;

/// `app_kv` prefix for stored secrets. Values are sealed, never plaintext.
pub const KV_PREFIX: &str = "read-aware-secret:";

fn key_path(data_dir: &Path) -> PathBuf {
    data_dir.join("secret.key")
}

/// Serializes first-use key creation. Without it, two concurrent `secret_set`
/// calls on a FRESH install (no key file yet — exactly what connecting sync
/// does: session + master key back to back) both see "no key", both mint one,
/// and whichever loses the file write leaves its secret sealed under a key
/// that no longer exists — permanently unreadable. Caught live on the first
/// Android connect; the desktop only dodged it because an earlier AI-key write
/// had already created the file.
static KEY_FILE_LOCK: Mutex<()> = Mutex::new(());

/// Load the local encryption key, creating it on first use.
///
/// Kept OUT of the database on purpose: an attacker who walks off with
/// `read-aware.db` (a backup, a synced folder) gets ciphertext and nothing to
/// open it with. Written `0600` so other accounts on the machine cannot read
/// it, and written to a temp file then renamed so a crash mid-write can never
/// leave a truncated key that a later boot would silently replace.
fn load_or_create_key(data_dir: &Path) -> Result<Vec<u8>, CommandError> {
    let _guard = KEY_FILE_LOCK
        .lock()
        .map_err(|_| "secret key lock poisoned".to_string())?;
    let path = key_path(data_dir);
    if let Ok(existing) = std::fs::read(&path) {
        if existing.len() == 32 {
            return Ok(existing);
        }
    }
    let key = Aes256Gcm::generate_key(OsRng);
    let tmp = path.with_extension("key.tmp");
    {
        let mut file =
            std::fs::File::create(&tmp).map_err(|e| CommandError::context("key file", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = file
                .metadata()
                .map_err(|e| CommandError::context("key file metadata", e))?
                .permissions();
            perms.set_mode(0o600);
            file.set_permissions(perms)
                .map_err(|e| CommandError::context("key file permissions", e))?;
        }
        file.write_all(&key)
            .map_err(|e| CommandError::context("key file", e))?;
        file.sync_all()
            .map_err(|e| CommandError::context("key file sync", e))?;
    }
    std::fs::rename(&tmp, &path).map_err(|e| CommandError::context("key file rename", e))?;
    Ok(key.to_vec())
}

fn cipher(data_dir: &Path) -> Result<Aes256Gcm, CommandError> {
    // Whatever made the key file unreadable/unwritable, from the caller's view
    // the secret store as a whole is unusable — surface the dedicated code so
    // the UI can say "credentials can't be stored" instead of a raw fs error.
    let bytes = load_or_create_key(data_dir).map_err(|e| {
        CommandError::context_coded(crate::error::CODE_SECRETS_UNAVAILABLE, "secret store", e)
    })?;
    Ok(Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&bytes)))
}

/// `base64(nonce ‖ ciphertext)` — a fresh random nonce per write, stored
/// alongside, which is how GCM expects to be used.
///
/// `pub` only so the storage tests can exercise the crypto directly; the
/// commands below are the supported entry points.
pub fn encrypt(data_dir: &Path, plaintext: &str) -> Result<String, CommandError> {
    encrypt_with_cipher(cipher(data_dir)?, plaintext)
}

/// Pure preparation for atomic restore: never create or replace a live key.
pub fn encrypt_with_key(key: &[u8], plaintext: &str) -> Result<String, CommandError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| {
        CommandError::new(
            crate::error::CODE_SECRETS_UNAVAILABLE,
            "invalid prepared credential key",
        )
    })?;
    encrypt_with_cipher(cipher, plaintext)
}

fn encrypt_with_cipher(cipher: Aes256Gcm, plaintext: &str) -> Result<String, CommandError> {
    let nonce = Aes256Gcm::generate_nonce(OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|_| "failed to encrypt secret".to_string())?;
    let mut packed = nonce.to_vec();
    packed.extend_from_slice(&ciphertext);
    Ok(base64::engine::general_purpose::STANDARD.encode(packed))
}

pub fn decrypt(data_dir: &Path, packed: &str) -> Result<String, CommandError> {
    decrypt_with_cipher(packed, || cipher(data_dir))
}

/// Read-only verification of a backup's credential store. Never create or repair
/// a key in an imported directory, including when its key is missing or invalid.
pub fn decrypt_existing(data_dir: &Path, packed: &str) -> Result<String, CommandError> {
    let bytes = std::fs::read(key_path(data_dir)).map_err(|error| {
        CommandError::context_coded(
            crate::error::CODE_SECRETS_UNAVAILABLE,
            "existing secret key",
            error,
        )
    })?;
    let cipher = Aes256Gcm::new_from_slice(&bytes).map_err(|_| {
        CommandError::new(
            crate::error::CODE_SECRETS_UNAVAILABLE,
            "existing secret key has invalid length",
        )
    })?;
    decrypt_with_cipher(packed, || Ok(cipher))
}

fn decrypt_with_cipher(
    packed: &str,
    cipher: impl FnOnce() -> Result<Aes256Gcm, CommandError>,
) -> Result<String, CommandError> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(packed)
        .map_err(|_| "stored secret is not valid base64".to_string())?;
    if raw.len() < 12 {
        return Err(CommandError::internal("stored secret is truncated"));
    }
    let (nonce, ciphertext) = raw.split_at(12);
    let plaintext = cipher()?
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| {
            CommandError::new(
                crate::error::CODE_SECRETS_UNAVAILABLE,
                "failed to decrypt secret (wrong or missing key file)",
            )
        })?;
    String::from_utf8(plaintext)
        .map_err(|_| CommandError::internal("decrypted secret is not UTF-8"))
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// The encrypted value/deletion and publication obligation commit together.
/// Remote projection overlays cannot replace a newer unpublished local choice.
pub fn write_sealed_with_source(
    conn: &mut rusqlite::Connection,
    key: &str,
    sealed: Option<&str>,
    roam: bool,
    source: Option<&serde_json::Value>,
) -> Result<(), CommandError> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if !roam && crate::storage::restored_credentials::contains(&tx, key)? {
        return Err(CommandError::new(
            "ui/superseded",
            "Credential has a pending local publication",
        ));
    }
    if let Some(sealed) = sealed {
        tx.execute(
            "INSERT INTO app_kv (key, value_json, updated_at)
         VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json, updated_at = excluded.updated_at",
            params![format!("{KV_PREFIX}{key}"), sealed],
        )?;
    } else {
        tx.execute(
            "DELETE FROM app_kv WHERE key=?1",
            [format!("{KV_PREFIX}{key}")],
        )?;
    }
    if roam && key.starts_with("ai-api-key") {
        crate::storage::restored_credentials::enqueue_with_source(&tx, key, source)?;
    }
    tx.commit()?;
    Ok(())
}
