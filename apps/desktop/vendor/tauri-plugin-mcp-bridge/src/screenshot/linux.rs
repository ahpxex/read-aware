use super::{Screenshot, ScreenshotError};
use tauri::{Runtime, WebviewWindow};

/// Linux-specific screenshot implementation using WebKitGTK's snapshot API.
///
/// WebKit renders only the visible region directly into a Cairo surface. This
/// avoids traversing or rasterizing offscreen DOM content in JavaScript.
pub fn capture_viewport<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<Screenshot, ScreenshotError> {
    #[cfg(target_os = "linux")]
    {
        use std::sync::mpsc;
        use std::time::Duration;
        use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

        let (tx, rx) = mpsc::channel::<Result<Screenshot, ScreenshotError>>();

        window
            .with_webview(move |platform_webview| {
                let webview = platform_webview.inner();

                webview.snapshot(
                    SnapshotRegion::Visible,
                    SnapshotOptions::NONE,
                    None::<&gio::Cancellable>,
                    move |result| {
                        let screenshot = result
                            .map_err(|error| {
                                ScreenshotError::CaptureFailed(format!(
                                    "WebKitGTK snapshot failed: {error}"
                                ))
                            })
                            .and_then(|surface| {
                                let mut data = Vec::new();

                                surface.write_to_png(&mut data).map_err(|error| {
                                    ScreenshotError::EncodeFailed(format!(
                                        "Failed to encode WebKitGTK snapshot as PNG: {error}"
                                    ))
                                })?;

                                Ok(Screenshot { data })
                            });

                        let _ = tx.send(screenshot);
                    },
                );
            })
            .map_err(|error| {
                ScreenshotError::CaptureFailed(format!("Failed to access webview: {error}"))
            })?;

        rx.recv_timeout(Duration::from_secs(10))
            .map_err(|_| ScreenshotError::Timeout)?
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
        Err(ScreenshotError::PlatformUnsupported)
    }
}
