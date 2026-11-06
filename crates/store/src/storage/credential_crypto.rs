//! The production TS sync-envelope.ts secret v1 wire: XChaCha20-Poly1305,
//! [1][24-byte nonce][ciphertext+tag], slot-bound AAD. No new crypto format.
use crate::error::CommandError;
use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use base64::{engine::general_purpose::STANDARD, Engine};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rusqlite::{Connection, OptionalExtension};
use std::{fs, io::Read, path::Path};
use zeroize::Zeroizing;

pub(super) const MAX_VALUE: usize = 64 * 1024 * 1024;
pub(super) fn unavailable() -> CommandError {
    CommandError::new(
        "secrets/unavailable",
        "backup credential cannot be opened with its owning key",
    )
}
pub(super) fn read_key(root: &Path) -> Result<Option<Zeroizing<Vec<u8>>>, CommandError> {
    let path = root.join("secret.key");
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if !metadata.file_type().is_file() || metadata.len() != 32 {
        return Err(unavailable());
    }
    let mut key = Zeroizing::new(Vec::new());
    fs::File::open(path)?.take(33).read_to_end(&mut key)?;
    if key.len() != 32 {
        return Err(unavailable());
    }
    Ok(Some(key))
}
pub(super) fn generate_key() -> Zeroizing<Vec<u8>> {
    Zeroizing::new(aes_gcm::Aes256Gcm::generate_key(OsRng).to_vec())
}
pub(super) fn value(
    conn: &Connection,
    table: &str,
    key: &str,
) -> Result<Option<String>, CommandError> {
    let sql = match table {
        "app_kv" => "SELECT value_json FROM app_kv WHERE key=?1",
        "synced_preferences" => "SELECT value_json FROM synced_preferences WHERE key=?1",
        _ => return Err(CommandError::internal("invalid credential table")),
    };
    let value: Option<String> = conn.query_row(sql, [key], |row| row.get(0)).optional()?;
    if value.as_ref().is_some_and(|value| value.len() > MAX_VALUE) {
        return Err(unavailable());
    }
    Ok(value)
}
pub(super) fn local(
    conn: &Connection,
    root: &Path,
    slot: &str,
) -> Result<Option<Zeroizing<String>>, CommandError> {
    value(conn, "app_kv", &format!("read-aware-secret:{slot}"))?
        .map(|packed| crate::secrets::decrypt_existing(root, &packed).map(Zeroizing::new))
        .transpose()
}
pub(super) fn master(
    conn: &Connection,
    root: &Path,
) -> Result<Option<Zeroizing<Vec<u8>>>, CommandError> {
    local(conn, root, "sync.master-key")?
        .map(|text| {
            let bytes = Zeroizing::new(
                STANDARD
                    .decode(text.as_bytes())
                    .map_err(|_| unavailable())?,
            );
            if bytes.len() != 32 {
                return Err(unavailable());
            }
            Ok(bytes)
        })
        .transpose()
}
pub(super) fn open(
    key: &[u8],
    slot: &str,
    packed: &str,
) -> Result<Zeroizing<String>, CommandError> {
    if packed.len() > MAX_VALUE {
        return Err(unavailable());
    }
    let wire = STANDARD.decode(packed).map_err(|_| unavailable())?;
    if wire.len() < 41 || wire[0] != 1 {
        return Err(unavailable());
    }
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| unavailable())?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                XNonce::from_slice(&wire[1..25]),
                Payload {
                    msg: &wire[25..],
                    aad: format!("ra-secret:v1:{slot}").as_bytes(),
                },
            )
            .map_err(|_| unavailable())?,
    );
    // Use the current application's TextDecoder semantics, including replacement
    // of invalid UTF-8. The encrypted bytes have already passed authentication.
    let bytes = plaintext
        .strip_prefix(&[0xef, 0xbb, 0xbf])
        .unwrap_or(&plaintext);
    Ok(Zeroizing::new(String::from_utf8_lossy(bytes).into_owned()))
}
pub(super) fn seal(key: &[u8], slot: &str, plaintext: &str) -> Result<String, CommandError> {
    if plaintext.len() > MAX_VALUE {
        return Err(unavailable());
    }
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| unavailable())?;
    let nonce = XChaCha20Poly1305::generate_nonce(OsRng);
    let encrypted = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext.as_bytes(),
                aad: format!("ra-secret:v1:{slot}").as_bytes(),
            },
        )
        .map_err(|_| unavailable())?;
    let mut wire = Vec::with_capacity(25 + encrypted.len());
    wire.push(1);
    wire.extend_from_slice(&nonce);
    wire.extend(encrypted);
    Ok(STANDARD.encode(wire))
}
