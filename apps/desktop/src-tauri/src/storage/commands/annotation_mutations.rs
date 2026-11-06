//! IPC commands over `read_aware_store::storage::annotation_mutations`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{Db, EventRow};

#[tauri::command]
pub async fn annotation_inspect(
    id: String,
    bounded: Option<bool>,
    app: tauri::AppHandle,
) -> Result<Option<AnnotationSnapshot>, CommandError> {
    crate::storage::blocking("annotation_inspect", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        if bounded.unwrap_or(false) {
            annotation_inspect_with_budget(&mut conn, &id, true)
        } else {
            annotation_inspect_inner(&mut conn, &id)
        }
    })
    .await
}

#[tauri::command]
pub async fn annotations_commit(
    events: Vec<EventRow>,
    conditions: Vec<AnnotationCondition>,
    app: tauri::AppHandle,
) -> Result<AnnotationCommitResult, CommandError> {
    crate::storage::blocking("annotations_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        annotations_commit_inner(&mut conn, &events, &conditions)
    })
    .await
}
