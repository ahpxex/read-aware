//! Final native restore transaction. The host must stop producers and complete
//! program consent/probing/migration before supplying their bound results.
use super::{
    programs::{ProgramRef, Side},
    CredentialChoice, FilePlan, FilePolicy, ProgramChoice,
};
use crate::{
    error::CommandError,
    storage::{
        self,
        backup_restore_files::{self, FileRestore},
    },
};
use rusqlite::{Connection, TransactionBehavior};
use std::{collections::BTreeMap, path::Path};
#[path = "backup_restore_private.rs"]
mod private;
#[path = "backup_restore_selection.rs"]
mod selection;

/// Host-only result of the selected program's real staged probe/migration. A
/// data-only namespace has no program/result. This is not plugin-facing IPC.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(tag = "mode", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum PluginBookAccess {
    All,
    Current,
    Book {
        #[serde(rename = "bookId")]
        book_id: String,
    },
}

impl PluginBookAccess {
    fn validate(&self) -> Result<(), CommandError> {
        if let Self::Book { book_id } = self {
            if book_id.trim().is_empty() || book_id.len() > 512 {
                return Err(CommandError::new(
                    "backup/incomplete",
                    "Selected plugin book grant is invalid",
                ));
            }
        }
        Ok(())
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProgramResult {
    pub program: ProgramRef,
    pub consented: bool,
    #[serde(default)]
    pub book_access: Option<PluginBookAccess>,
    pub has_migration: bool,
    pub migrated: Option<storage::PluginDataSnapshot>,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RestoreRequest {
    /// Exactly the source-present blob file differences. Same bytes need no
    /// file decision, but source registry identities are still recovered.
    pub files: BTreeMap<String, Side>,
    pub programs: BTreeMap<String, ProgramChoice>,
    pub program_results: BTreeMap<String, ProgramResult>,
    pub credentials: BTreeMap<String, CredentialChoice>,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreReceipt {
    pub restore_id: String,
    pub domain_rows: u64,
    pub files: usize,
    pub plugins: usize,
    pub credentials: usize,
    pub cleanup_pending: bool,
}
impl FilePlan {
    pub(crate) fn restore(
        self,
        conn: &mut Connection,
        root: &Path,
        request: RestoreRequest,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<RestoreReceipt, CommandError> {
        // Recovery may change a previous commit marker; revision verification
        // below will reject an obsolete review instead of applying it anyway.
        backup_restore_files::recover(conn, root)?;
        let result = (|| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            self.verify_target(&tx, root, &mut check)?;
            self.verify_source(&mut check)?;
            let programs = self.prepare_programs(&tx, root, &request.programs, &mut check)?;
            let program_versions = selection::validate_program_results(
                &self,
                &tx,
                root,
                &programs,
                &request.program_results,
                &mut check,
            )?;
            let selected_blobs = selection::blobs(&self, &request.files)?;
            let mut changes =
                selection::files(&self, root, &selected_blobs, &programs, &mut check)?;
            let mut credentials =
                self.prepare_credentials(&tx, root, &request.credentials, &mut check)?;
            if let Some(key) = credentials.new_key.take() {
                changes.push(backup_restore_files::FileChange {
                    path: "secret.key".into(),
                    before: None,
                    after: Some(backup_restore_files::FileSource::Key(key)),
                });
            }
            let files_count = changes.len();
            let files = FileRestore::prepare(&tx, root, changes, &mut check)?;
            // No live DB/file mutation precedes the fully prepared file baseline.
            let facts = credentials.plan.rows.restore_rows(&tx, &mut check)?;
            private::blobs(&credentials.plan, &tx, &selected_blobs, &mut check)?;
            private::programs(
                &credentials.plan,
                &tx,
                &programs,
                &request.program_results,
                &program_versions,
                &mut check,
            )?;
            private::credentials(&credentials, &tx, &mut check)?;
            private::require_book_files(&tx, &credentials.plan, &selected_blobs)?;
            check()?;
            files.install(&mut check)?;
            check()?;
            files.accept(&tx)?;
            tx.commit()?;
            // A late cancellation cannot undo this durable commit.
            Ok(RestoreReceipt {
                restore_id: facts.restore_id,
                domain_rows: facts.rows,
                files: files_count,
                plugins: programs.len(),
                credentials: credentials.operations.len(),
                cleanup_pending: false,
            })
        })();
        match result {
            Ok(mut receipt) => {
                if let Err(error) = backup_restore_files::recover(conn, root) {
                    log::warn!("Committed backup restore cleanup deferred: {error}");
                    receipt.cleanup_pending = true;
                }
                Ok(receipt)
            }
            Err(error) => {
                // The closure's transaction has already rolled back. File
                // recovery is physical and is deliberately not cancellable.
                if let Err(recovery) = backup_restore_files::recover(conn, root) {
                    log::error!(
                        "Backup restore failed: {error}; file recovery pending: {recovery}"
                    );
                    return Err(CommandError::new(
                        "backup/recovery-required",
                        "Backup file rollback must finish before normal app writes resume",
                    ));
                }
                Err(error)
            }
        }
    }
}

#[cfg(test)]
#[path = "backup_restore_apply_tests.rs"]
mod tests;
