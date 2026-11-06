//! Window resize functionality.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

#[cfg(desktop)]
use tauri::{LogicalSize, PhysicalSize};

#[cfg(desktop)]
use super::list_windows::resolve_window;

/// Parameters for resizing a window.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeWindowParams {
    /// Width in pixels
    pub width: u32,
    /// Height in pixels
    pub height: u32,
    /// Optional window label (defaults to "main")
    pub window_id: Option<String>,
    /// Whether to use logical (true) or physical (false) pixels. Defaults to logical.
    #[serde(default = "default_logical")]
    pub logical: bool,
}

fn default_logical() -> bool {
    true
}

/// Result of a window resize operation.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeWindowResult {
    /// Whether the resize was successful
    pub success: bool,
    /// The window that was resized
    pub window_label: String,
    /// The new width
    pub width: u32,
    /// The new height
    pub height: u32,
    /// Whether logical pixels were used
    pub logical: bool,
    /// Error message if resize failed
    pub error: Option<String>,
}

/// Resizes a window to the specified dimensions.
///
/// # Arguments
///
/// * `app` - The Tauri application handle
/// * `params` - Resize parameters including width, height, and optional window label
///
/// # Returns
///
/// * `Ok(ResizeWindowResult)` - Result of the resize operation
/// * `Err(String)` - Error message if the operation fails
///
/// # Notes
///
/// - Uses logical pixels by default (respects display scaling)
/// - Set `logical: false` to use physical pixels
/// - The resize may fail if the window has fixed size constraints
/// - On mobile platforms (Android/iOS), this operation is not supported and returns an error
#[cfg(desktop)]
pub async fn resize_window<R: Runtime>(
    app: AppHandle<R>,
    params: ResizeWindowParams,
) -> Result<ResizeWindowResult, String> {
    let window_label = params
        .window_id
        .clone()
        .unwrap_or_else(|| "main".to_string());
    let window = resolve_window(&app, params.window_id)?;

    // Check if window is resizable
    let is_resizable = window.is_resizable().unwrap_or(true);
    if !is_resizable {
        return Ok(ResizeWindowResult {
            success: false,
            window_label,
            width: params.width,
            height: params.height,
            logical: params.logical,
            error: Some("Window is not resizable".to_string()),
        });
    }

    // Perform the resize
    let result = if params.logical {
        window.set_size(LogicalSize::new(params.width, params.height))
    } else {
        window.set_size(PhysicalSize::new(params.width, params.height))
    };

    match result {
        Ok(()) => Ok(ResizeWindowResult {
            success: true,
            window_label,
            width: params.width,
            height: params.height,
            logical: params.logical,
            error: None,
        }),
        Err(e) => Ok(ResizeWindowResult {
            success: false,
            window_label,
            width: params.width,
            height: params.height,
            logical: params.logical,
            error: Some(format!("Failed to resize window: {e}")),
        }),
    }
}

/// Mobile implementation - returns unsupported error with clear explanation for the agent.
#[cfg(mobile)]
pub async fn resize_window<R: Runtime>(
    _app: AppHandle<R>,
    params: ResizeWindowParams,
) -> Result<ResizeWindowResult, String> {
    let window_label = params
        .window_id
        .clone()
        .unwrap_or_else(|| "main".to_string());

    Ok(ResizeWindowResult {
        success: false,
        window_label,
        width: params.width,
        height: params.height,
        logical: params.logical,
        error: Some(
            "Window resizing is not supported on mobile platforms (Android/iOS). \
             The window size is controlled by the operating system."
                .to_string(),
        ),
    })
}
