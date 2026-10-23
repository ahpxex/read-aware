//! Mobile convenience exports: the user picks a destination in the native
//! save dialog, then the webview hands over the bytes.
//!
//! `export_choose_target` opens the save dialog natively and returns an
//! opaque, single-use token for whatever the user picked; `write_export_file`
//! accepts only such a token (see `save_targets`). Desktop exports stream
//! through `resource_save`, which takes the same token.

use std::io::Write;
use std::time::Instant;

use tauri::Manager;

use crate::error::CommandError;
use crate::save_targets::{self, Delivery, SaveIo, SaveTargets};
use crate::storage::blocking;

/// Open the native save dialog. `None` when the user cancels.
#[tauri::command]
pub async fn export_choose_target(
    app: tauri::AppHandle,
    filename: String,
    extension: Option<String>,
) -> Result<Option<String>, CommandError> {
    let filter = extension
        .filter(|ext| !ext.is_empty())
        .map(|ext| (format!("{} file", ext.to_uppercase()), ext));
    let picked = save_targets::choose(&app, filename, filter).await?;
    picked
        .map(|target| app.state::<SaveTargets>().issue(target, Instant::now()))
        .transpose()
}

/// Write exported content to the target the user chose in
/// `export_choose_target`. `base64: true` marks binary content that crossed
/// the IPC encoded. `false` when the user cancelled at the iOS export picker
/// (where the real destination choice happens).
#[tauri::command]
pub async fn write_export_file(
    app: tauri::AppHandle,
    token: String,
    content: String,
    base64: Option<bool>,
) -> Result<bool, CommandError> {
    blocking("write_export_file", move || {
        let target = app.state::<SaveTargets>().redeem(&token, Instant::now())?;
        let bytes: Vec<u8> = if base64.unwrap_or(false) {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD
                .decode(content.as_bytes())
                .map_err(|err| {
                    CommandError::internal(format!("invalid base64 export payload: {err}"))
                })?
        } else {
            content.into_bytes()
        };
        match app.publish(target, Box::new(|file| Ok(file.write_all(&bytes)?)))? {
            Delivery::Done => Ok(true),
            // iOS: hand the staged file to the export picker; false = cancelled.
            Delivery::Export(staged) => staged.present(&app),
        }
    })
    .await
}
