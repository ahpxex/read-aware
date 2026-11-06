//! Plugin-owned local binary assets. Immutable bytes use the existing blob
//! registry; metadata joins the existing private namespace snapshot/rollback.
//! The reserved collection cannot be opened through the public documents API.
use super::*;
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{Read, Write},
};

pub(crate) const COLLECTION: &str = "_host_assets";
pub(crate) const MAX_BYTES: u64 = 64 * 1024 * 1024;
const TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const MAX_COUNT: usize = 256;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AssetData {
    name: String,
    mime_type: String,
    size: u64,
    sha256: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAsset {
    pub key: String,
    pub revision: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub updated_at: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAssetReceipt {
    pub asset: PluginAsset,
    pub cleanup_pending: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAssetPage {
    pub items: Vec<PluginAsset>,
    pub next_after: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAssetPolicy {
    storage: &'static str,
    backup: &'static str,
    uninstall: &'static str,
    max_assets: usize,
    max_bytes: u64,
    max_asset_bytes: u64,
    used_assets: usize,
    used_bytes: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAssetDeletion {
    pub deleted: bool,
    pub cleanup_pending: bool,
}
fn invalid(message: &str) -> CommandError {
    CommandError::new("plugin/invalid-argument", message)
}
fn conflict() -> CommandError {
    CommandError::new(
        "plugin/asset-conflict",
        "Asset changed; reread before modifying or opening it",
    )
}
fn owner(id: &str) -> Result<(), CommandError> {
    if crate::plugins::valid_plugin_id(id) {
        Ok(())
    } else {
        Err(invalid("Invalid asset owner"))
    }
}
fn key(value: &str) -> Result<(), CommandError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c))
    {
        return Err(invalid("Invalid asset key"));
    }
    Ok(())
}
fn blob_key(owner: &str, hash: &str) -> String {
    format!("pluginasset:{owner}:{hash}")
}
fn metadata(row: &PluginDocumentRow) -> Result<AssetData, CommandError> {
    key(&row.id)?;
    let value: AssetData = serde_json::from_str(&row.json)?;
    if value.size > MAX_BYTES
        || value.sha256.len() != 64
        || !value
            .sha256
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err(invalid("Invalid persisted asset metadata"));
    }
    labels(&value.name, &value.mime_type)?;
    Ok(value)
}
fn labels(name: &str, mime: &str) -> Result<(), CommandError> {
    if name.trim().is_empty()
        || name.len() > 1024
        || name.chars().any(char::is_control)
        || name.contains(['/', '\\'])
        || name == "."
        || name == ".."
        || mime.is_empty()
        || mime.len() > 256
        || !mime.is_ascii()
        || mime.chars().any(char::is_control)
        || mime.split('/').count() != 2
    {
        return Err(invalid("Invalid asset name or media type"));
    }
    Ok(())
}
fn info(row: PluginDocumentRow) -> Result<PluginAsset, CommandError> {
    let data = metadata(&row)?;
    Ok(PluginAsset {
        key: row.id,
        revision: row.revision,
        name: data.name,
        mime_type: data.mime_type,
        size: data.size,
        updated_at: row.updated_at,
    })
}
fn rows(conn: &Connection, id: &str) -> Result<Vec<PluginDocumentRow>, CommandError> {
    owner(id)?;
    plugin_docs::plugin_docs_list_inner(
        conn,
        id,
        COLLECTION,
        None,
        Some((MAX_COUNT + 1) as i64),
        Some(true),
    )
}
pub(crate) fn totals(conn: &Connection, id: &str) -> Result<(usize, u64), CommandError> {
    let rows = rows(conn, id)?;
    let bytes = rows
        .iter()
        .try_fold(0u64, |sum, row| metadata(row).map(|m| sum + m.size))?;
    if rows.len() > MAX_COUNT {
        return Err(CommandError::new(
            "plugin/quota-exceeded",
            "Asset namespace exceeds count quota",
        ));
    }
    Ok((rows.len(), bytes))
}
pub(crate) fn assert_mutable(conn: &Connection, id: &str) -> Result<(), CommandError> {
    owner(id)?;
    let updating: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM plugin_update_journal WHERE plugin_id=?1)",
        [id],
        |r| r.get(0),
    )?;
    if updating {
        Err(CommandError::new(
            "plugin/data-busy",
            "Asset namespace is undergoing an update",
        ))
    } else {
        Ok(())
    }
}
fn expected(
    conn: &Connection,
    id: &str,
    name: &str,
    revision: Option<&str>,
) -> Result<Option<PluginDocumentRow>, CommandError> {
    owner(id)?;
    key(name)?;
    let current = plugin_docs::plugin_docs_get_inner(conn, id, COLLECTION, name)?;
    if current.as_ref().map(|row| row.revision.as_str()) != revision {
        return Err(conflict());
    }
    if let Some(row) = &current {
        metadata(row)?;
    }
    Ok(current)
}
pub(crate) fn get_inner(
    conn: &Connection,
    id: &str,
    name: &str,
) -> Result<Option<PluginAsset>, CommandError> {
    owner(id)?;
    key(name)?;
    plugin_docs::plugin_docs_get_inner(conn, id, COLLECTION, name)?
        .map(info)
        .transpose()
}

/// Called only while the native DB mutex is held. Incomplete update journals
/// retain all old asset files until their namespace decision is recovered.
pub(crate) fn reclaim(conn: &Connection, dir: &Path, id: &str) -> Result<(), CommandError> {
    assert_mutable(conn, id)?;
    let metadata_rows = rows(conn, id)?;
    if metadata_rows.len() > MAX_COUNT {
        return Err(CommandError::new(
            "plugin/quota-exceeded",
            "Asset namespace exceeds count quota",
        ));
    }
    let live: BTreeSet<String> = metadata_rows
        .iter()
        .map(|row| metadata(row).map(|m| blob_key(id, &m.sha256)))
        .collect::<Result<_, _>>()?;
    let prefix = format!("pluginasset:{id}:");
    let mut stmt = conn.prepare(
        "SELECT key,storage_uri FROM blob_objects WHERE substr(key,1,length(?1))=?1 AND deleted_at IS NULL",
    )?;
    let registered = stmt
        .query_map([&prefix], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    // Validate the whole set before deleting anything: registry corruption must
    // never turn private cleanup into deletion of another owner's file.
    for (key, uri) in &registered {
        if uri
            .as_ref()
            .is_some_and(|uri| *uri != format!("blobs/{}", blob_file_name(key)))
        {
            return Err(invalid(
                "Private asset registry points outside its owned file",
            ));
        }
    }
    for (key, _) in registered {
        if !live.contains(&key) {
            delete_blob_inner(conn, dir, &key)?;
        }
    }
    let files = match fs::read_dir(dir.join("blobs")) {
        Ok(files) => files,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    let encoded_prefix = blob_file_name(&prefix);
    let live_files: BTreeSet<String> = live.iter().map(|key| blob_file_name(key)).collect();
    for file in files {
        let file = file?;
        let name = file.file_name();
        let name = name.to_string_lossy();
        // A crash before the registry transaction can leave a complete immutable
        // file or an unpublished temp file. Both remain discoverable by owner.
        if (name.starts_with(&encoded_prefix) && !live_files.contains(name.as_ref()))
            || name.starts_with(&format!(".pluginasset-{}-{id}-", id.len()))
        {
            fs::remove_file(file.path())?;
        }
    }
    Ok(())
}
fn cleanup_pending(conn: &Connection, dir: &Path, id: &str) -> bool {
    match reclaim(conn, dir, id) {
        Ok(()) => false,
        Err(e) => {
            log::warn!("Plugin asset cleanup deferred: {e}");
            true
        }
    }
}

/// The bytes to store and the labels they are served with.
pub(crate) struct AssetInput<'a> {
    pub filename: &'a str,
    pub mime: &'a str,
    pub source: File,
}

pub(crate) fn store_inner(
    conn: &mut Connection,
    dir: &Path,
    id: &str,
    name: &str,
    revision: Option<&str>,
    input: AssetInput<'_>,
) -> Result<PluginAssetReceipt, CommandError> {
    let AssetInput {
        filename,
        mime,
        mut source,
    } = input;
    assert_mutable(conn, id)?;
    labels(filename, mime)?;
    let previous = expected(conn, id, name, revision)?;
    let (count, used) = totals(conn, id)?;
    let size = source.metadata()?.len();
    let old_size = previous
        .as_ref()
        .map(metadata)
        .transpose()?
        .map_or(0, |m| m.size);
    if size > MAX_BYTES
        || used - old_size + size > TOTAL_BYTES
        || previous.is_none() && count >= MAX_COUNT
    {
        return Err(CommandError::new(
            "plugin/quota-exceeded",
            "Plugin asset quota exceeded",
        ));
    }
    // Do not accumulate new immutable bytes while earlier cleanup is failing.
    reclaim(conn, dir, id)?;
    let blobs = dir.join("blobs");
    fs::create_dir_all(&blobs)?;
    let mut temp = tempfile::Builder::new()
        .prefix(&format!(".pluginasset-{}-{id}-", id.len()))
        .tempfile_in(&blobs)?;
    let mut hash = Sha256::new();
    let mut copied = 0u64;
    let mut buffer = [0u8; 65536];
    loop {
        let n = source.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        copied += n as u64;
        if copied > size || copied > MAX_BYTES {
            return Err(invalid("Asset input size changed"));
        }
        temp.write_all(&buffer[..n])?;
        hash.update(&buffer[..n]);
    }
    if copied != size {
        return Err(invalid("Asset input size changed"));
    }
    temp.as_file().sync_all()?;
    let sha256 = format!("{:x}", hash.finalize());
    let blob = blob_key(id, &sha256);
    let file = blob_file_name(&blob);
    let path = blobs.join(&file);
    match temp.persist_noclobber(&path) {
        Ok(_) => {}
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
            if !fs::symlink_metadata(&path)?.file_type().is_file() {
                return Err(invalid("Existing immutable asset is not a regular file"));
            }
            let (actual, length) = crate::import::hash_file(&path)?;
            if actual != sha256 || length != size as i64 {
                return Err(invalid("Existing immutable asset contents are damaged"));
            }
        }
        Err(error) => return Err(error.error.into()),
    }
    #[cfg(unix)]
    File::open(&blobs)?.sync_all()?;
    let data = AssetData {
        name: filename.into(),
        mime_type: mime.into(),
        size,
        sha256: sha256.clone(),
    };
    let decision = (|| {
        let tx = conn.transaction()?;
        register_blob_inner(&tx, &blob, Some(mime), size as i64, sha256, file)?;
        plugin_docs::plugin_docs_put_inner(
            &tx,
            id,
            COLLECTION,
            name,
            &serde_json::to_string(&data)?,
            None,
            None,
        )?;
        let asset = get_inner(&tx, id, name)?.ok_or_else(|| invalid("Stored asset disappeared"))?;
        tx.commit()?;
        Ok::<_, CommandError>(asset)
    })();
    match decision {
        Ok(asset) => Ok(PluginAssetReceipt {
            asset,
            cleanup_pending: cleanup_pending(conn, dir, id),
        }),
        Err(error) => {
            cleanup_pending(conn, dir, id);
            Err(error)
        }
    }
}

pub(crate) fn open_inner(
    conn: &Connection,
    dir: &Path,
    id: &str,
    name: &str,
    revision: &str,
) -> Result<(File, PluginAsset), CommandError> {
    let row = expected(conn, id, name, Some(revision))?.ok_or_else(conflict)?;
    let data = metadata(&row)?;
    let blob = blob_key(id, &data.sha256);
    let (path, _) = get_blob_record_inner(conn, dir, &blob)?
        .ok_or_else(|| CommandError::new("fs/not-found", "Private asset bytes are unavailable"))?;
    if path != dir.join("blobs").join(blob_file_name(&blob))
        || !fs::symlink_metadata(&path)?.file_type().is_file()
    {
        return Err(invalid(
            "Private asset registry points outside its owned file",
        ));
    }
    let (hash, size) = crate::import::hash_file(&path)?;
    if hash != data.sha256 || size != data.size as i64 {
        return Err(invalid("Private asset bytes do not match their metadata"));
    }
    Ok((File::open(path)?, info(row)?))
}

pub(crate) fn delete_inner(
    conn: &mut Connection,
    dir: &Path,
    id: &str,
    name: &str,
    revision: &str,
) -> Result<PluginAssetDeletion, CommandError> {
    assert_mutable(conn, id)?;
    expected(conn, id, name, Some(revision))?;
    let tx = conn.transaction()?;
    plugin_docs::plugin_docs_delete_inner(&tx, id, COLLECTION, name)?;
    tx.commit()?;
    Ok(PluginAssetDeletion {
        deleted: true,
        cleanup_pending: cleanup_pending(conn, dir, id),
    })
}

#[tauri::command]
pub async fn plugin_asset_get(
    app: AppHandle,
    plugin_id: String,
    key: String,
) -> Result<Option<PluginAsset>, CommandError> {
    blocking("plugin_asset_get", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        get_inner(&conn, &plugin_id, &key)
    })
    .await
}
#[tauri::command]
pub async fn plugin_asset_list(
    app: AppHandle,
    plugin_id: String,
    after: Option<String>,
    limit: Option<usize>,
) -> Result<PluginAssetPage, CommandError> {
    blocking("plugin_asset_list", move || {
        owner(&plugin_id)?;
        if let Some(after) = &after {
            key(after)?;
        }
        let limit = limit.unwrap_or(50);
        if !(1..=100).contains(&limit) {
            return Err(invalid("Asset page limit must be 1..100"));
        }
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        let mut rows = rows(&conn, &plugin_id)?;
        if rows.len() > MAX_COUNT {
            return Err(invalid("Asset namespace exceeds count quota"));
        }
        rows.sort_by(|a, b| a.id.cmp(&b.id));
        let mut items = rows
            .into_iter()
            .filter(|r| after.as_ref().is_none_or(|after| r.id > *after))
            .take(limit + 1)
            .map(info)
            .collect::<Result<Vec<_>, _>>()?;
        let more = items.len() > limit;
        items.truncate(limit);
        Ok(PluginAssetPage {
            next_after: if more {
                items.last().map(|r| r.key.clone())
            } else {
                None
            },
            items,
        })
    })
    .await
}
#[tauri::command]
pub async fn plugin_asset_policy(
    app: AppHandle,
    plugin_id: String,
) -> Result<PluginAssetPolicy, CommandError> {
    blocking("plugin_asset_policy", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        let (used_assets, used_bytes) = totals(&conn, &plugin_id)?;
        Ok(PluginAssetPolicy {
            storage: "local",
            backup: "complete",
            uninstall: "delete",
            max_assets: MAX_COUNT,
            max_bytes: TOTAL_BYTES,
            max_asset_bytes: MAX_BYTES,
            used_assets,
            used_bytes,
        })
    })
    .await
}
#[tauri::command]
pub async fn plugin_asset_delete(
    app: AppHandle,
    plugin_id: String,
    key: String,
    expected_revision: String,
) -> Result<PluginAssetDeletion, CommandError> {
    blocking("plugin_asset_delete", move || {
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        let dir = app.state::<DataDir>();
        delete_inner(&mut conn, &dir.0, &plugin_id, &key, &expected_revision)
    })
    .await
}

/// Startup recovery also sees immutable files whose publishing transaction did
/// not commit. Each owner is recovered independently; a damaged namespace must
/// not cause another owner's live files to be removed or block healthy startup.
pub(crate) fn recover_all(conn: &Connection, dir: &Path) {
    let entries = match fs::read_dir(dir.join("blobs")) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            log::warn!("Cannot enumerate plugin asset recovery files: {error}");
            return;
        }
    };
    let mut owners = BTreeSet::new();
    for entry in entries {
        let file = match entry {
            Ok(file) => file,
            Err(error) => {
                log::warn!("Cannot inspect plugin asset recovery entry: {error}");
                continue;
            }
        };
        let name = file.file_name();
        let name = name.to_string_lossy();
        if let Some((id, _)) = name
            .strip_prefix("pluginasset%3A")
            .and_then(|s| s.split_once("%3A"))
        {
            if crate::plugins::valid_plugin_id(id) {
                owners.insert(id.to_owned());
            }
        } else if let Some((length, rest)) = name
            .strip_prefix(".pluginasset-")
            .and_then(|s| s.split_once('-'))
        {
            if let Ok(length) = length.parse::<usize>() {
                if let Some(id) = rest.get(..length) {
                    if rest.as_bytes().get(length) == Some(&b'-')
                        && crate::plugins::valid_plugin_id(id)
                    {
                        owners.insert(id.to_owned());
                    }
                }
            }
        }
    }
    for id in owners {
        cleanup_pending(conn, dir, &id);
    }
}

pub(crate) fn validate_namespaces(conn: &Connection) -> Result<(), CommandError> {
    let mut stmt =
        conn.prepare("SELECT DISTINCT plugin_id FROM plugin_documents WHERE collection=?1")?;
    let owners = stmt
        .query_map([COLLECTION], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for id in owners {
        let (_, size) = totals(conn, &id)?;
        if size > TOTAL_BYTES {
            return Err(CommandError::new(
                "plugin/quota-exceeded",
                "Asset namespace exceeds byte quota",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "plugin_assets_tests.rs"]
mod tests;
