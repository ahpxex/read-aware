//! Managed-file evidence attached to the same row/event plan. No file is copied,
//! installed, removed or approved here. Whole plugin trees are comparison units.
use super::RowPlan;
use crate::{
    error::CommandError,
    storage::backup_snapshot::{
        files::{source_path, verify_file, verify_path},
        CapturedFile,
    },
};
use rusqlite::{Connection, Transaction};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};
#[path = "backup_programs.rs"]
mod programs;
pub(crate) use programs::{ProgramChoice, ProgramDecision, ProgramFacts};

#[path = "backup_credentials.rs"]
mod credentials;
#[path = "backup_restore_apply.rs"]
mod restore;
pub(crate) use restore::{RestoreReceipt, RestoreRequest};
#[path = "backup_program_stage.rs"]
mod program_stage;
pub(crate) use program_stage::{ProgramStageQuery, ProgramStageReceipt, ProgramStageRequest};
#[path = "backup_file_inventory.rs"]
mod inventory;
pub(crate) use credentials::{CredentialChoice, CredentialFacts, PreparedCredentials};
pub(crate) use inventory::BlobBinding;

#[path = "backup_review.rs"]
mod review;
pub(crate) use review::{ReviewPage, ReviewQuery};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FileMatchKind {
    SourceOnly,
    TargetOnly,
    Same,
    Different,
    Unavailable,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FilePolicy {
    Blob,
    ProgramTree,
    PreserveCredentialKey,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileMatch {
    pub path: String,
    pub policy: FilePolicy,
    pub kind: FileMatchKind,
    pub source: Option<CapturedFile>,
    pub target: Option<CapturedFile>,
    pub target_blob: Option<BlobBinding>,
}
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ProgramTree {
    pub sha256: String,
    pub files: usize,
    pub schema_version: i64,
}
#[derive(Debug)]
pub(crate) struct ProgramMatch {
    pub root: String,
    pub source: Option<ProgramTree>,
    pub target: Option<ProgramTree>,
}
#[derive(Debug)]
pub(crate) struct FilePage<'a> {
    pub entries: Vec<&'a FileMatch>,
    pub next_after: Option<String>,
}
#[derive(Debug)]
pub(crate) struct FilePlan {
    staged_programs: std::cell::RefCell<Vec<program_stage::OwnedStage>>,
    rows: RowPlan,
    target: inventory::Inventory,
    bundled: crate::plugins::BundledPrograms,
    matches: BTreeMap<String, FileMatch>,
    pub programs: Vec<ProgramMatch>,
}
impl FilePlan {
    pub(crate) fn program_facts(
        &self,
        tx: &Transaction<'_>,
        data_dir: &Path,
        check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<Vec<ProgramFacts>, CommandError> {
        programs::inspect(self, tx, data_dir, check)
    }
    pub(crate) fn prepare_programs(
        &self,
        tx: &Transaction<'_>,
        data_dir: &Path,
        choices: &BTreeMap<String, ProgramChoice>,
        check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<Vec<ProgramDecision>, CommandError> {
        programs::prepare(self, tx, data_dir, choices, check)
    }

    pub(crate) fn credential_facts(
        &self,
        tx: &Transaction<'_>,
        data_dir: &Path,
        check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<Vec<CredentialFacts>, CommandError> {
        credentials::inspect(self, tx, data_dir, check)
    }
    pub(crate) fn prepare_credentials(
        self,
        tx: &Transaction<'_>,
        data_dir: &Path,
        choices: &BTreeMap<String, CredentialChoice>,
        check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<PreparedCredentials, CommandError> {
        credentials::prepare(self, tx, data_dir, choices, check)
    }
    pub(crate) fn rows(&self) -> &RowPlan {
        &self.rows
    }
    pub(crate) fn page(&self, after: &str, limit: usize) -> Result<FilePage<'_>, CommandError> {
        if after.len() > 8192 || !(1..=100).contains(&limit) {
            return Err(CommandError::new(
                "backup/invalid-archive",
                "invalid internal file plan page",
            ));
        }
        use std::ops::Bound::{Excluded, Unbounded};
        let mut entries: Vec<_> = self
            .matches
            .range::<str, _>((Excluded(after), Unbounded))
            .take(limit + 1)
            .map(|(_, entry)| entry)
            .collect();
        let next_after = if entries.len() > limit {
            entries.truncate(limit);
            entries.last().map(|entry| entry.path.clone())
        } else {
            None
        };
        Ok(FilePage {
            entries,
            next_after,
        })
    }
    /// Caller holds the native DB mutex and the host's filesystem/runtime gate.
    /// Keep this transaction through the later atomic decision. Rechecking files
    /// does not itself lock the filesystem against external processes.
    pub(crate) fn verify_target(
        &self,
        tx: &Transaction<'_>,
        data_dir: &Path,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<(), CommandError> {
        self.rows.events().verify_target(tx, &mut check)?;
        if inventory::read(tx, data_dir, &self.bundled, &mut check)? != self.target {
            return Err(CommandError::new(
                "backup/changed",
                "target managed files changed after restore planning",
            ));
        }
        Ok(())
    }
    pub(crate) fn verify_source(
        &self,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<(), CommandError> {
        let archive = self.rows.events().source().archive();
        for entry in &archive.manifest.files {
            // SQLite's pinned source view is handled by preflight/row planning.
            if entry.path != "database.sqlite" {
                verify_file(archive.directory(), entry, &mut check)?;
            }
        }
        Ok(())
    }
}
fn kind<T: PartialEq>(a: Option<&T>, b: Option<&T>) -> FileMatchKind {
    match (a, b) {
        (Some(a), Some(b)) if a == b => FileMatchKind::Same,
        (Some(_), Some(_)) => FileMatchKind::Different,
        (Some(_), None) => FileMatchKind::SourceOnly,
        (None, Some(_)) => FileMatchKind::TargetOnly,
        (None, None) => FileMatchKind::Unavailable,
    }
}
fn read_manifest(
    root: &Path,
    bundled: Option<&crate::plugins::BundledPrograms>,
    manifest: &CapturedFile,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<String, CommandError> {
    if manifest.byte_size > 1024 * 1024 {
        return Err(CommandError::new(
            "backup/incomplete",
            "plugin manifest exceeds limit",
        ));
    }
    let path = source_path(root, bundled, &manifest.path)?;
    verify_path(&path, manifest, check)?;
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 != manifest.byte_size
        || format!("{:x}", Sha256::digest(&bytes)) != manifest.sha256
    {
        return Err(CommandError::new(
            "backup/changed",
            "plugin manifest changed during planning",
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| CommandError::new("backup/incomplete", "plugin manifest is not UTF-8"))
}
fn trees(
    root: &Path,
    files: &BTreeMap<String, CapturedFile>,
    bundled: Option<&crate::plugins::BundledPrograms>,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<BTreeMap<String, ProgramTree>, CommandError> {
    let mut groups: BTreeMap<String, Vec<&CapturedFile>> = BTreeMap::new();
    for (name, file) in files {
        check()?;
        let mut parts = name.split('/');
        if !matches!(parts.next(), Some("plugins" | "bundled-plugins")) {
            continue;
        }
        let id = parts.next().unwrap();
        let folder = name.split('/').next().unwrap();
        groups
            .entry(format!("{folder}/{id}"))
            .or_default()
            .push(file);
    }
    let mut result = BTreeMap::new();
    for (name, members) in groups {
        check()?;
        let path = format!("{name}/manifest.json");
        let manifest = files
            .get(&path)
            .filter(|file| file.byte_size <= 1024 * 1024)
            .ok_or_else(|| {
                CommandError::new("backup/incomplete", "invalid plugin tree manifest")
            })?;
        let text = read_manifest(root, bundled, manifest, check)?;
        let value: serde_json::Value = serde_json::from_str(&text)?;
        let schema_version = value
            .get("schemaVersion")
            .and_then(serde_json::Value::as_i64)
            .filter(|version| (1..=9_007_199_254_740_991).contains(version))
            .ok_or_else(|| {
                CommandError::new("backup/incomplete", "invalid plugin storage version")
            })?;
        if value.get("id").and_then(serde_json::Value::as_str) != name.rsplit('/').next() {
            return Err(CommandError::new(
                "backup/incomplete",
                "plugin tree identity mismatch",
            ));
        }
        let mut hash = Sha256::new();
        hash.update(b"readaware.backup.program-tree.v1\0");
        for file in &members {
            check()?;
            let relative = &file.path[name.len() + 1..];
            hash.update((relative.len() as u64).to_le_bytes());
            hash.update(relative.as_bytes());
            hash.update(file.byte_size.to_le_bytes());
            hash.update(file.sha256.as_bytes());
        }
        result.insert(
            name,
            ProgramTree {
                sha256: format!("{:x}", hash.finalize()),
                files: members.len(),
                schema_version,
            },
        );
    }
    Ok(result)
}
pub(super) fn plan(
    rows: RowPlan,
    target: &mut Connection,
    data_dir: &Path,
    bundled: crate::plugins::BundledPrograms,
    mut check: impl FnMut() -> Result<(), CommandError>,
) -> Result<FilePlan, CommandError> {
    let tx = target.transaction()?;
    rows.events().verify_target(&tx, &mut check)?;
    let target = inventory::read(&tx, data_dir, &bundled, &mut check)?;
    let archive = rows.events().source().archive();
    let source: BTreeMap<_, _> = archive
        .manifest
        .files
        .iter()
        .filter(|file| file.path != "database.sqlite")
        .map(|file| (file.path.clone(), file.clone()))
        .collect();
    for file in source.values() {
        verify_file(archive.directory(), file, &mut check)?;
    }
    let a = trees(archive.directory(), &source, None, &mut check)?;
    let b = trees(data_dir, &target.files, Some(&bundled), &mut check)?;
    let roots: BTreeSet<_> = a.keys().chain(b.keys()).cloned().collect();
    let mut programs = Vec::new();
    let mut a = a;
    let mut b = b;
    for root in roots {
        check()?;
        let source = a.remove(&root);
        let target = b.remove(&root);
        programs.push(ProgramMatch {
            root,
            source,
            target,
        });
    }
    // Include registered-but-absent targets as well as orphan physical files.
    let names: BTreeSet<_> = source
        .keys()
        .chain(target.files.keys())
        .chain(target.blobs.keys())
        .cloned()
        .collect();
    // Cross-side portable aliases must not become two actions on one pathname.
    let mut portable = BTreeMap::new();
    let mut matches = BTreeMap::new();
    for path in names {
        check()?;
        if portable.insert(path.to_lowercase(), path.clone()).is_some() {
            return Err(CommandError::new(
                "backup/incomplete",
                "source and target file paths alias on a portable filesystem",
            ));
        }
        let source = source.get(&path).cloned();
        let current = target.files.get(&path).cloned();
        let policy = if path == "secret.key" {
            FilePolicy::PreserveCredentialKey
        } else if path.starts_with("blobs/") {
            FilePolicy::Blob
        } else {
            FilePolicy::ProgramTree
        };
        matches.insert(
            path.clone(),
            FileMatch {
                kind: kind(source.as_ref(), current.as_ref()),
                target_blob: target.blobs.get(&path).cloned(),
                path,
                policy,
                source,
                target: current,
            },
        );
    }
    tx.commit()?;
    Ok(FilePlan {
        staged_programs: Default::default(),
        rows,
        target,
        bundled,
        matches,
        programs,
    })
}
#[cfg(test)]
#[path = "backup_file_plan_tests.rs"]
mod tests;
