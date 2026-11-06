//! IPC commands over `read_aware_store::storage::onboarding`.
use crate::error::CommandError;
use crate::storage::*;
use crate::storage::{Db, EventRow};

#[tauri::command]
pub async fn onboarding_commit(
    event: EventRow,
    app: tauri::AppHandle,
) -> Result<OnboardingReceipt, CommandError> {
    crate::storage::blocking("onboarding_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        onboarding_commit_inner(&mut conn, &event)
    })
    .await
}
