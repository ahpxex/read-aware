//! Standard age passphrase encryption around a streaming tar. Only a fully
//! finalized ciphertext replaces the selected destination. Decrypted files stay
//! private until the COMPLETE authenticated stream and manifest have been checked.
//! This codec does not apply data or trust an imported database's schema.
use super::backup_snapshot::{BackupManifest, BackupSnapshot, CapturedFile, FORMAT};
use crate::error::CommandError;
use age::secrecy::{ExposeSecret, SecretString};
use sha2::{Digest, Sha256};
use std::{
    cell::Cell,
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{self, Read, Write},
    path::Path,
    rc::Rc,
};

#[path = "backup_archive_read.rs"]
mod reader;
pub(crate) use reader::read_archive;
#[path = "backup_preflight.rs"]
mod preflight;
pub(crate) use preflight::{preflight, PreflightedBackup};
#[path = "backup_event_plan.rs"]
mod event_plan;
pub(crate) use event_plan::plan_events;
pub(crate) use event_plan::{
    FileMatchKind, FilePlan, ReviewPage, ReviewQuery, RowChoiceReceipt, RowChoiceRequest,
    RowStructureReceipt,
};
pub(crate) use event_plan::{RestoreReceipt, RestoreRequest};
const MAX_FILES: usize = 100_000;
const MAX_BYTES: u64 = 512 * 1024 * 1024 * 1024;
const MAX_MANIFEST: u64 = 32 * 1024 * 1024;
const MAX_ARCHIVE: u64 = MAX_BYTES + 2 * 1024 * 1024 * 1024;
const CHUNK: usize = 1024 * 1024;
const WORK_FACTOR: u8 = 18;
pub(crate) use read_aware_store::storage::archive_member::{
    member_path, CODE_INVALID, MAX_MEMBER_PATH as MAX_PATH,
};
pub(crate) const CODE_UNLOCK: &str = "backup/unlock-failed";
pub(crate) const CODE_PASSWORD: &str = "backup/password-policy";
/// The source is a retired v1 JSON library backup. That format can no longer
/// be restored; only complete encrypted archives are accepted.
pub(crate) const CODE_LEGACY_FORMAT: &str = "backup/legacy-format";
fn invalid(message: &str) -> CommandError {
    CommandError::new(CODE_INVALID, message)
}
fn unlock(error: impl std::fmt::Debug) -> CommandError {
    CommandError::new(
        CODE_UNLOCK,
        format!("archive authentication failed: {error:?}"),
    )
}

fn input_error(error: io::Error) -> CommandError {
    if let Some(code) = error
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<CommandError>())
    {
        return code.clone();
    }
    match error.kind() {
        io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof => unlock(error),
        io::ErrorKind::Other => invalid(&format!("invalid archive structure: {error:?}")),
        _ => CommandError::from(error),
    }
}
fn decrypt_error(error: age::DecryptError) -> CommandError {
    match error {
        // age 0.12.1's Display assumes required >= its machine-calibrated target.
        // Our stricter resource ceiling can be lower. Match the typed error and
        // never invoke its duration formatter (which can underflow in debug).
        age::DecryptError::ExcessiveWork { required, .. } => invalid(&format!(
            "scrypt work factor {required} exceeds the supported ceiling {WORK_FACTOR}"
        )),
        age::DecryptError::Io(error) => input_error(error),
        other => unlock(other),
    }
}

fn password_policy(password: &SecretString) -> Result<(), CommandError> {
    let value = password.expose_secret();
    if value.chars().count() < 12 || value.len() > 1024 {
        return Err(CommandError::new(
            CODE_PASSWORD,
            "backup passphrase must contain at least 12 characters and at most 1024 UTF-8 bytes",
        ));
    }
    Ok(())
}

fn manifest_members(
    manifest: &BackupManifest,
) -> Result<BTreeMap<String, CapturedFile>, CommandError> {
    if manifest.format != FORMAT
        || manifest.schema_version <= 0
        || manifest.files.is_empty()
        || manifest.files.len() > MAX_FILES
        || manifest.tables.len() > 4096
    {
        return Err(invalid("unsupported backup manifest"));
    }
    let mut total = 0u64;
    let mut names = BTreeSet::new();
    let mut members = BTreeMap::new();
    for entry in &manifest.files {
        member_path(&entry.path)?;
        if entry.sha256.len() != 64
            || !entry
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || !names.insert(entry.path.to_lowercase())
        {
            return Err(invalid("duplicate member or invalid content digest"));
        }
        total = total
            .checked_add(entry.byte_size)
            .filter(|total| *total <= MAX_BYTES)
            .ok_or_else(|| invalid("backup is too large"))?;
        members.insert(entry.path.clone(), entry.clone());
    }
    if !members.contains_key("database.sqlite")
        || members
            .get("secret.key")
            .is_some_and(|file| file.byte_size != 32)
    {
        return Err(invalid(
            "backup is missing its database or has an invalid credential key",
        ));
    }
    // Reject a file used as another member's parent, independently of platform.
    for name in members.keys() {
        let mut parent = name.as_str();
        while let Some((head, _)) = parent.rsplit_once('/') {
            if names.contains(&head.to_lowercase()) {
                return Err(invalid("archive member path overlaps a file"));
            }
            parent = head;
        }
    }
    Ok(members)
}
fn encode_manifest(manifest: &BackupManifest) -> Result<Vec<u8>, CommandError> {
    struct BoundedVec(Vec<u8>);
    impl Write for BoundedVec {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            if bytes.len() as u64 > MAX_MANIFEST.saturating_sub(self.0.len() as u64) {
                return Err(io::Error::other("manifest exceeds limit"));
            }
            self.0.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let mut output = BoundedVec(Vec::new());
    serde_json::to_writer(&mut output, manifest)
        .map_err(|_| invalid("backup manifest exceeds 32 MiB"))?;
    Ok(output.0)
}

fn header(size: u64) -> tar::Header {
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(tar::EntryType::Regular);
    header.set_size(size);
    header.set_mode(0o600);
    header.set_uid(0);
    header.set_gid(0);
    header.set_mtime(0);
    header.set_cksum();
    header
}

struct CheckedReader<'a, F> {
    file: File,
    check: &'a mut F,
    hash: Sha256,
    bytes: u64,
    limit: u64,
    failure: Option<CommandError>,
}
impl<F: FnMut() -> Result<(), CommandError>> Read for CheckedReader<'_, F> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if let Err(error) = (self.check)() {
            self.failure = Some(error);
            return Err(io::Error::other("backup operation cancelled"));
        }
        let max = buffer
            .len()
            .min(CHUNK)
            .min((self.limit.saturating_sub(self.bytes) + 1) as usize);
        let length = self.file.read(&mut buffer[..max])?;
        self.bytes += length as u64;
        if self.bytes > self.limit {
            self.failure = Some(CommandError::new(
                "backup/changed",
                "snapshot member grew during encryption",
            ));
            return Err(io::Error::other("snapshot size changed"));
        }
        self.hash.update(&buffer[..length]);
        Ok(length)
    }
}

/// Archive fixture for tests: atomically replaces a plain path. The export
/// command publishes `encrypt_archive` through its dialog-issued save target.
#[cfg(test)]
pub(crate) fn write_archive(
    snapshot: &BackupSnapshot,
    password: SecretString,
    destination: &Path,
    check: impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    crate::save_targets::replace_path(
        destination,
        Box::new(|out| encrypt_archive(snapshot, password, out, check)),
    )
}

/// Streams the finalized ciphertext into `out` (a private staging file) and
/// syncs it. The caller publishes it only after this returns successfully.
/// Password remains a zeroizing SecretString. Archive work factor is fixed and
/// capped at 18; age also calibrates its machine default on first construction.
/// Neither that calibration nor one KDF invocation is interruptible mid-call.
pub(crate) fn encrypt_archive(
    snapshot: &BackupSnapshot,
    password: SecretString,
    out: &mut File,
    mut check: impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    password_policy(&password)?;
    check()?;
    let members = manifest_members(&snapshot.manifest)?;
    let manifest = encode_manifest(&snapshot.manifest)?;
    if manifest.len() as u64 > MAX_MANIFEST {
        return Err(invalid("backup manifest exceeds 32 MiB"));
    }
    if fs::metadata(snapshot.directory().join("manifest.json"))?.len() > MAX_MANIFEST {
        return Err(invalid("snapshot manifest exceeds limit"));
    }
    let disk = fs::read(snapshot.directory().join("manifest.json"))?;
    if disk != manifest {
        return Err(CommandError::new(
            "backup/changed",
            "snapshot manifest changed",
        ));
    }
    let mut recipient = age::scrypt::Recipient::new(password);
    recipient.set_work_factor(WORK_FACTOR);
    let encryptor =
        age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
            .map_err(|error| {
                CommandError::internal(format!("archive encryption setup failed: {error:?}"))
            })?;
    check()?;
    {
        let encrypted = encryptor.wrap_output(&mut *out)?;
        let mut archive = tar::Builder::new(encrypted);
        archive.append_data(
            &mut header(manifest.len() as u64),
            "manifest.json",
            manifest.as_slice(),
        )?;
        for entry in members.values() {
            check()?;
            let path = snapshot.directory().join(&entry.path);
            // Host-created staging has no symlinks; recheck each component before
            // opening so later tampering does not export an unrelated path.
            let mut at = snapshot.directory().to_path_buf();
            for part in entry.path.split('/') {
                at.push(part);
                if fs::symlink_metadata(&at)?.file_type().is_symlink() {
                    return Err(invalid("snapshot symlink"));
                }
            }
            let file = File::open(path)?;
            if !file.metadata()?.is_file() || file.metadata()?.len() != entry.byte_size {
                return Err(CommandError::new(
                    "backup/changed",
                    "snapshot member size changed",
                ));
            }
            let mut reader = CheckedReader {
                file,
                check: &mut check,
                hash: Sha256::new(),
                bytes: 0,
                limit: entry.byte_size,
                failure: None,
            };
            let appended =
                archive.append_data(&mut header(entry.byte_size), &entry.path, &mut reader);
            if let Some(error) = reader.failure {
                return Err(error);
            }
            appended?;
            if reader.bytes != entry.byte_size
                || format!("{:x}", reader.hash.finalize()) != entry.sha256
            {
                return Err(CommandError::new(
                    "backup/changed",
                    "snapshot member digest changed",
                ));
            }
        }
        check()?;
        archive.into_inner()?.finish()?;
    }
    out.flush()?;
    out.sync_all()?;
    check()
}

/// Authentication and physical-member integrity only. The merge preflight must
/// validate SQLite schema, event identities and data references before applying.
#[derive(Debug)]
pub(crate) struct AuthenticatedBackup {
    directory: super::backup_staging::BackupDirectory,
    pub manifest: BackupManifest,
}
impl AuthenticatedBackup {
    pub fn directory(&self) -> &Path {
        self.directory.path()
    }
}

/// Header parsing cannot allocate an unbounded recipient/stanza list. The age
/// parser does not overread; the body limit is raised only after header parsing.
struct BoundedReader<R> {
    input: R,
    limit: Rc<Cell<u64>>,
    read: u64,
}
impl<R: Read> Read for BoundedReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let remaining = self.limit.get().saturating_sub(self.read);
        if remaining == 0 {
            return Err(io::Error::other(invalid("encrypted backup exceeds limit")));
        }
        let length = buffer.len().min(remaining as usize);
        let count = self.input.read(&mut buffer[..length])?;
        self.read += count as u64;
        Ok(count)
    }
}

#[cfg(test)]
#[path = "backup_archive_tests.rs"]
mod tests;

#[cfg(all(test, debug_assertions))]
#[path = "backup_runtime_programs_tests.rs"]
mod runtime_programs_tests;

#[cfg(test)]
pub(crate) fn plan_events_fixture(
    source: PreflightedBackup,
    target: &mut rusqlite::Connection,
    staging_root: &Path,
    check: impl FnMut() -> Result<(), CommandError>,
) -> Result<event_plan::EventPlan, CommandError> {
    plan_events(
        source,
        target,
        &super::backup_staging::BackupStaging::fixture(staging_root),
        check,
    )
}

pub(crate) use event_plan::{ProgramStageQuery, ProgramStageReceipt, ProgramStageRequest};
