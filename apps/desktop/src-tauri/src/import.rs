//! Desktop host of the book import. The pipeline itself — dedupe, format,
//! intent, staging, metadata, cover, and the event commit — is
//! `read_aware_store::import::import_book`, shared with the `ra` CLI. This
//! module only turns what the webview names into a local file first: a picked
//! native path (an Android content URI is drained to a temp file exactly
//! once), an imported resource, or bytes the webview already staged under
//! `bookfile:<bookId>` (drag-and-drop files, plugin imports).
pub use read_aware_store::import::*;

use crate::error::CommandError;
use crate::storage::{DataDir, Db, ImportSession};
use serde::Deserialize;
use tauri::{AppHandle, Manager};

/// Where the bytes are.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ImportSource {
    Path {
        path: String,
    },
    Resource {
        id: String,
    },
    /// Already written under `bookfile:<bookId>` after the webview recorded
    /// the import intent itself.
    Blob,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryImportRequest {
    #[serde(flatten)]
    pub book: ImportBookRequest,
    pub source: ImportSource,
    /// The external-open batch this pick came from; admitted before any read.
    #[serde(default)]
    pub external_open_epoch: Option<String>,
}

/// Import one book natively on every platform; on the blocking pool so hashing
/// and copying a large book never stall the async runtime or the window thread.
#[tauri::command]
pub async fn library_import(
    app: AppHandle,
    request: LibraryImportRequest,
) -> Result<ImportBookOutcome, CommandError> {
    crate::storage::blocking("library_import", move || {
        if let Some(epoch) = &request.external_open_epoch {
            app.state::<crate::external_open::ExternalOpenQueue>()
                .admit(epoch)?;
        }
        let data_dir = app.state::<DataDir>().0.clone();
        let db = app.state::<Db>();
        let owner = app.state::<ImportSession>().owner().to_owned();
        // The materialized copy (and its temp-file guard) lives until the
        // import returns.
        let local = match &request.source {
            ImportSource::Path { path } => Some(crate::native_path::materialize(&app, path)?),
            ImportSource::Resource { id } => Some(crate::native_path::materialize_reader(
                &app,
                crate::resources::reader(&app, id)?,
            )?),
            ImportSource::Blob => None,
        };
        let (from, intent) = match &local {
            Some(local) => (StageFrom::File(&local.path), ImportIntent::Record),
            None => (StageFrom::Staged, ImportIntent::AlreadyRecorded),
        };
        import_book(&db, &data_dir, &owner, &request.book, from, intent)
    })
    .await
}
