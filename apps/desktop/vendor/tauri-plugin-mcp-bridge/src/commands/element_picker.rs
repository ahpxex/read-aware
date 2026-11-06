//! Element picker event forwarding.
//!
//! Listens for `__element_picked` and `__element_pointed` Tauri events emitted
//! by the webview JavaScript and forwards them as JSON broadcasts over the
//! WebSocket broadcast channel so the MCP server can receive them.

use crate::logging::mcp_log_info;
use serde_json;
use tauri::{AppHandle, Listener, Runtime};
use tokio::sync::broadcast;

/// Sets up listeners that forward element picker Tauri events to the WebSocket
/// broadcast channel.
///
/// The webview JavaScript emits these events via `window.__TAURI__.event.emit()`:
/// - `__element_picked`: When the user clicks an element in the picker overlay
/// - `__element_pointed`: When the user Alt+Shift+Clicks an element
///
/// Each event payload is wrapped into a JSON broadcast message of the form:
/// ```json
/// { "type": "element_picked", "payload": { ... } }
/// ```
pub fn setup_element_picker_listeners<R: Runtime>(
    app: &AppHandle<R>,
    event_tx: broadcast::Sender<String>,
) {
    // Forward __element_picked events
    let tx_picked = event_tx.clone();
    app.listen("__element_picked", move |event| {
        let payload_str = event.payload();
        let broadcast_msg = serde_json::json!({
            "type": "element_picked",
            "payload": serde_json::from_str::<serde_json::Value>(payload_str).unwrap_or(serde_json::Value::Null)
        });
        let _ = tx_picked.send(broadcast_msg.to_string());
        mcp_log_info("ELEMENT_PICKER", "Forwarded element_picked event");
    });

    // Forward __element_pointed events
    let tx_pointed = event_tx;
    app.listen("__element_pointed", move |event| {
        let payload_str = event.payload();
        let broadcast_msg = serde_json::json!({
            "type": "element_pointed",
            "payload": serde_json::from_str::<serde_json::Value>(payload_str).unwrap_or(serde_json::Value::Null)
        });
        let _ = tx_pointed.send(broadcast_msg.to_string());
        mcp_log_info("ELEMENT_PICKER", "Forwarded element_pointed event");
    });

    mcp_log_info(
        "ELEMENT_PICKER",
        "Element picker event listeners registered",
    );
}
