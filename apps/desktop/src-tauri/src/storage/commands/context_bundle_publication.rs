//! IPC commands over `read_aware_store::storage::context_bundle_publication`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{Db, EventRow};

#[tauri::command]
pub async fn context_bundle_source_revision(app: tauri::AppHandle) -> Result<String, CommandError> {
    crate::storage::blocking("context_bundle_source_revision", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        context_bundle_source_revision_inner(&mut conn)
    })
    .await
}

#[tauri::command]
pub async fn context_bundle_publish(
    app: tauri::AppHandle,
    event: EventRow,
    expected_read_revision: String,
) -> Result<BundlePublicationReceipt, CommandError> {
    crate::storage::blocking("context_bundle_publish", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        context_bundle_publish_inner(&mut conn, &event, &expected_read_revision)
    })
    .await
}
