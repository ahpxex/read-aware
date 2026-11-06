use objc2::sel;
use objc2_foundation::NSObjectProtocol;
use objc2_web_kit::{WKInactiveSchedulingPolicy, WKWebView};
use tauri::{Runtime, Webview};

/// Keep automation available when a macOS webview is hidden or minimized.
/// This preference is shared with the live webview and does not activate its window.
pub(crate) fn configure<R: Runtime>(webview: Webview<R>) {
    if let Err(error) = webview.with_webview(|platform_webview| unsafe {
        let webview = &*(platform_webview.inner() as *const WKWebView);
        let preferences = webview.configuration().preferences();

        // The public scheduling API is available starting with macOS 14.
        // Older systems still support background evaluation, but control scheduling themselves.
        if preferences.respondsToSelector(sel!(setInactiveSchedulingPolicy:)) {
            preferences.setInactiveSchedulingPolicy(WKInactiveSchedulingPolicy::None);
        }
    }) {
        crate::logging::mcp_log_error(
            "BACKGROUND",
            &format!("Failed to configure background execution: {error}"),
        );
    }
}
