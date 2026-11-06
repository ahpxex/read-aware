//! Full restore's durable file half. SQLite owns the decision; immutable before
//! files survive until that decision has committed. Recovery takes the same DB
//! write lock, so a second process cannot roll back an active restore.
use crate::error::CommandError;
use rusqlite::{
    Connection, DatabaseName, OptionalExtension, Transaction, TransactionBehavior, TransactionState,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

const DIRECTORY: &str = "full-restore-v1";
const MARKER: &str = "read-aware-backup-restore-accepted:";
const MAX_MANIFEST: u64 = 96 * 1024 * 1024;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FileDigest {
    pub bytes: u64,
    pub sha256: String,
}
pub(crate) enum FileSource {
    File { path: PathBuf, digest: FileDigest },
    // Only a freshly generated local credential key uses in-memory bytes.
    Key(Zeroizing<Vec<u8>>),
}
pub(crate) struct FileChange {
    pub path: String,
    pub before: Option<FileDigest>,
    pub after: Option<FileSource>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    path: String,
    before: Option<FileDigest>,
    after: Option<FileDigest>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    version: u8,
    id: String,
    entries: Vec<Entry>,
}
pub(crate) struct FileRestore {
    root: PathBuf,
    directory: PathBuf,
    manifest: Manifest,
}
fn changed(message: &str) -> CommandError {
    CommandError::new("backup/changed", message)
}
fn invalid(message: &str) -> CommandError {
    CommandError::new("backup/incomplete", message)
}
fn sync_dir(path: &Path) -> Result<(), CommandError> {
    #[cfg(unix)]
    {
        fs::File::open(path)?.sync_all()?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}
fn regular(path: &Path) -> Result<bool, CommandError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_file() => Ok(true),
        Ok(_) => Err(changed("Restore path is not a regular file")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}
fn private_dir(path: &Path) -> Result<(), CommandError> {
    match fs::create_dir(path) {
        Ok(()) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
            }
            sync_dir(
                path.parent()
                    .ok_or_else(|| invalid("Missing restore parent"))?,
            )?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            if !fs::symlink_metadata(path)?.file_type().is_dir() {
                return Err(invalid("Restore directory is not owned"));
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
            }
        }
        Err(e) => return Err(e.into()),
    }
    Ok(())
}
fn valid_path(relative: &str) -> Result<(), CommandError> {
    super::backup_archive::member_path(relative)?;
    let parts: Vec<_> = relative.split('/').collect();
    let allowed = relative == "secret.key"
        || (parts.len() == 2 && parts[0] == "blobs")
        || (parts.len() >= 3 && parts[0] == "plugins" && crate::plugins::valid_plugin_id(parts[1]));
    if !allowed {
        return Err(invalid("Restore file is outside the managed restore scope"));
    }
    Ok(())
}
fn destination(root: &Path, relative: &str, create: bool) -> Result<PathBuf, CommandError> {
    valid_path(relative)?;
    if !fs::symlink_metadata(root)?.file_type().is_dir() {
        return Err(invalid("Restore root is not owned"));
    }
    let mut path = root.to_owned();
    let mut parts = relative.split('/').peekable();
    while let Some(part) = parts.next() {
        path.push(part);
        if parts.peek().is_some() {
            match fs::symlink_metadata(&path) {
                Ok(meta) if meta.file_type().is_dir() => {}
                Ok(_) => return Err(changed("Restore parent is not an owned directory")),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    if create {
                        private_dir(&path)?;
                    }
                }
                Err(e) => return Err(e.into()),
            }
        }
    }
    regular(&path)?;
    Ok(path)
}
pub(crate) fn copy_checked(
    source: &Path,
    target: &Path,
    expected: &FileDigest,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    if !regular(source)? {
        return Err(changed("Restore source file disappeared"));
    }
    let mut input = fs::File::open(source)?;
    if input.metadata()?.len() != expected.bytes {
        return Err(changed("Restore file size changed"));
    }
    let parent = target
        .parent()
        .ok_or_else(|| invalid("Missing restore destination parent"))?;
    let mut output = tempfile::NamedTempFile::new_in(parent)?;
    let mut hash = Sha256::new();
    let mut bytes = 0;
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        check()?;
        let size = input.read(&mut buffer)?;
        if size == 0 {
            break;
        }
        bytes += size as u64;
        if bytes > expected.bytes {
            return Err(changed("Restore source grew while copying"));
        }
        hash.update(&buffer[..size]);
        output.write_all(&buffer[..size])?;
    }
    if bytes != expected.bytes || format!("{:x}", hash.finalize()) != expected.sha256 {
        return Err(changed("Restore file content changed"));
    }
    output.as_file().sync_all()?;
    output
        .persist(target)
        .map_err(|e| CommandError::from(e.error))?;
    sync_dir(parent)?;
    Ok(())
}
impl FileRestore {
    /// Call within the IMMEDIATE transaction that will commit the restore.
    /// Preparation touches private files only; `install` requires a sealed plan.
    pub(crate) fn prepare(
        tx: &Transaction<'_>,
        root: &Path,
        changes: Vec<FileChange>,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<Self, CommandError> {
        check()?;
        // The caller must already hold the write lock that excludes recovery.
        // Even a zero-row app_kv UPDATE can initialize sqlite_sequence through
        // its triggers, invalidating the reviewed full-database revision.
        if tx.transaction_state(Some(DatabaseName::Main))? != TransactionState::Write {
            return Err(invalid(
                "Restore file preparation requires a database write transaction",
            ));
        }
        if changes.len() > 100_000 {
            return Err(invalid("Too many restore files"));
        }
        let parent = root.join(DIRECTORY);
        private_dir(&parent)?;
        for entry in fs::read_dir(&parent)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if uuid::Uuid::parse_str(&name).is_ok() && regular(&entry.path().join("ready.json"))? {
                let accepted = tx
                    .query_row(
                        "SELECT value_json FROM app_kv WHERE key=?1",
                        [format!("{MARKER}{name}")],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()?;
                if accepted.as_deref() != Some("true") {
                    return Err(invalid(
                        "An interrupted full restore must recover before another restore starts",
                    ));
                }
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        let directory = parent.join(&id);
        private_dir(&directory)?;
        let mut manifest = Manifest {
            version: 1,
            id,
            entries: Vec::new(),
        };
        let mut seen = BTreeSet::new();
        for (index, change) in changes.into_iter().enumerate() {
            check()?;
            if change.path == "secret.key"
                && (change.before.is_some() || !matches!(&change.after, Some(FileSource::Key(_))))
            {
                return Err(invalid(
                    "An existing credential key cannot be replaced by restore",
                ));
            }
            if !seen.insert(change.path.to_lowercase()) {
                return Err(invalid("Duplicate restore file destination"));
            }
            let current = destination(root, &change.path, false)?;
            if let Some(before) = &change.before {
                copy_checked(
                    &current,
                    &directory.join(format!("{index}.before")),
                    before,
                    &mut check,
                )?;
            } else if regular(&current)? {
                return Err(changed("Unexpected existing restore destination"));
            }
            let after = match change.after {
                None => None,
                Some(FileSource::File { path, digest }) => {
                    copy_checked(
                        &path,
                        &directory.join(format!("{index}.after")),
                        &digest,
                        &mut check,
                    )?;
                    Some(digest)
                }
                Some(FileSource::Key(bytes)) => {
                    if change.path != "secret.key" || bytes.len() != 32 {
                        return Err(invalid("Invalid restored credential key"));
                    }
                    let digest = FileDigest {
                        bytes: bytes.len() as u64,
                        sha256: format!("{:x}", Sha256::digest(&*bytes)),
                    };
                    let mut file = tempfile::NamedTempFile::new_in(&directory)?;
                    file.write_all(&bytes)?;
                    file.as_file().sync_all()?;
                    file.persist(directory.join(format!("{index}.after")))
                        .map_err(|e| CommandError::from(e.error))?;
                    Some(digest)
                }
            };
            manifest.entries.push(Entry {
                path: change.path,
                before: change.before,
                after,
            });
        }
        check()?;
        let bytes = serde_json::to_vec(&manifest).map_err(|e| invalid(&e.to_string()))?;
        if bytes.len() as u64 > MAX_MANIFEST {
            return Err(invalid("Restore manifest exceeds size limit"));
        }
        let mut file = tempfile::NamedTempFile::new_in(&directory)?;
        file.write_all(&bytes)?;
        file.as_file().sync_all()?;
        file.persist(directory.join("ready.json"))
            .map_err(|e| CommandError::from(e.error))?;
        sync_dir(&directory)?;
        Ok(Self {
            root: root.to_owned(),
            directory,
            manifest,
        })
    }
    pub(crate) fn install(
        &self,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<(), CommandError> {
        self.apply_files(false, &mut check)
    }
    fn apply_files(
        &self,
        before: bool,
        check: &mut impl FnMut() -> Result<(), CommandError>,
    ) -> Result<(), CommandError> {
        for (index, entry) in self.manifest.entries.iter().enumerate() {
            check()?;
            let selected = if before { &entry.before } else { &entry.after };
            let target = destination(&self.root, &entry.path, selected.is_some())?;
            if let Some(digest) = selected {
                let side = if before { "before" } else { "after" };
                copy_checked(
                    &self.directory.join(format!("{index}.{side}")),
                    &target,
                    digest,
                    check,
                )?;
            } else if regular(&target)? {
                fs::remove_file(&target)?;
                sync_dir(target.parent().unwrap())?;
            }
        }
        Ok(())
    }
    pub(crate) fn accept(&self, tx: &Transaction<'_>) -> Result<(), CommandError> {
        tx.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES (?1,'true',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",[format!("{MARKER}{}",self.manifest.id)])?;
        Ok(())
    }
    fn retire(&self, tx: &Transaction<'_>) -> Result<(), CommandError> {
        // Retire durably before removing the DB marker; a failed recursive
        // cleanup can never turn an accepted restore into a rollback next boot.
        let parent = self.directory.parent().unwrap();
        let retired = parent.join(format!("retired-{}", self.manifest.id));
        fs::rename(&self.directory, &retired)?;
        sync_dir(parent)?;
        tx.execute(
            "DELETE FROM app_kv WHERE key=?1",
            [format!("{MARKER}{}", self.manifest.id)],
        )?;
        if let Err(error) = fs::remove_dir_all(&retired) {
            log::warn!("Restored file baseline cleanup deferred: {error}");
        }
        Ok(())
    }
}

/// Called before hydration/IPC and after the owning restore transaction ends.
/// An error retains the journal and prevents normal startup over mixed files.
pub(crate) fn recover(conn: &mut Connection, root: &Path) -> Result<(), CommandError> {
    let parent = root.join(DIRECTORY);
    match fs::symlink_metadata(&parent) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
        Ok(meta) if !meta.file_type().is_dir() => {
            return Err(invalid("Invalid restore journal root"))
        }
        Ok(_) => {}
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    for entry in fs::read_dir(&parent)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !entry.file_type()?.is_dir() {
            return Err(invalid("Unknown file in restore journal root"));
        }
        if let Some(id) = name.strip_prefix("retired-") {
            if uuid::Uuid::parse_str(id).is_err() {
                return Err(invalid("Unknown retired restore journal"));
            }
            fs::remove_dir_all(entry.path())?;
            tx.execute("DELETE FROM app_kv WHERE key=?1", [format!("{MARKER}{id}")])?;
            continue;
        }
        if uuid::Uuid::parse_str(&name).is_err() {
            return Err(invalid("Unknown restore journal identity"));
        }
        let ready = entry.path().join("ready.json");
        if !regular(&ready)? {
            // No manifest means preparation never authorized live file writes.
            fs::remove_dir_all(entry.path())?;
            continue;
        }
        if fs::metadata(&ready)?.len() > MAX_MANIFEST {
            return Err(invalid("Restore recovery manifest exceeds limit"));
        }
        let manifest: Manifest =
            serde_json::from_slice(&fs::read(&ready)?).map_err(|e| invalid(&e.to_string()))?;
        if manifest.version != 1 || manifest.id != name || manifest.entries.len() > 100_000 {
            return Err(invalid("Invalid restore recovery manifest"));
        }
        let mut seen = BTreeSet::new();
        for entry in &manifest.entries {
            valid_path(&entry.path)?;
            if entry.path == "secret.key"
                && (entry.before.is_some() || entry.after.as_ref().is_none_or(|d| d.bytes != 32))
            {
                return Err(invalid("Invalid credential key recovery operation"));
            }
            if !seen.insert(entry.path.to_lowercase()) {
                return Err(invalid("Duplicate recovery destination"));
            }
        }
        let restore = FileRestore {
            root: root.to_owned(),
            directory: entry.path(),
            manifest,
        };
        let accepted = tx
            .query_row(
                "SELECT value_json FROM app_kv WHERE key=?1",
                [format!("{MARKER}{name}")],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        match accepted.as_deref() {
            None => restore.apply_files(true, &mut || Ok(()))?,
            Some("true") => {}
            Some(_) => return Err(invalid("Invalid restore commit marker")),
        }
        restore.retire(&tx)?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
#[path = "backup_restore_files_tests.rs"]
mod tests;
