//! WebSocket server for real-time event streaming.
//!
//! This module provides a WebSocket server that enables real-time communication
//! between the Tauri application and external MCP clients. It broadcasts events
//! to all connected clients and can receive commands from them.

use crate::commands::{self, resolve_window_with_context, ScriptExecutor, WindowContext};
use crate::logging::{mcp_log_error, mcp_log_info};
use crate::script_registry::{ScriptEntry, ScriptType, SharedScriptRegistry};
use futures_util::{SinkExt, StreamExt};
use serde_json::{self, Value};
use std::net::SocketAddr;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc};
use tokio_tungstenite::{accept_async, tungstenite::Message};

/// WebSocket server for real-time event streaming to MCP clients.
///
/// The server listens on a specified port and accepts multiple concurrent
/// WebSocket connections. It uses a broadcast channel to send events to all
/// connected clients simultaneously.
///
/// # Architecture
///
/// - Binds to 0.0.0.0 by default (all interfaces) for remote device support
/// - Runs on port 9223 by default (or next available in range 9223-9322)
/// - Supports multiple concurrent client connections
/// - Uses broadcast channels for event distribution
/// - Handles client disconnections gracefully
///
/// # Examples
///
/// ```rust,ignore
/// use tauri_plugin_mcp_bridge::websocket::WebSocketServer;
///
/// #[tokio::main]
/// async fn main() {
///     // Requires a Tauri AppHandle
///     let (event_tx, _event_rx) = tokio::sync::broadcast::channel(100);
///     let server = WebSocketServer::new(9223, "0.0.0.0", app_handle, event_tx);
///
///     tokio::spawn(async move {
///         if let Err(e) = server.start().await {
///             eprintln!("WebSocket error: {}", e);
///         }
///     });
/// }
/// ```
pub struct WebSocketServer<R: Runtime> {
    addr: SocketAddr,
    event_tx: broadcast::Sender<String>,
    app: AppHandle<R>,
}

impl<R: Runtime> WebSocketServer<R> {
    /// Creates a new WebSocket server on the specified port and bind address.
    ///
    /// # Arguments
    ///
    /// * `port` - The port number to bind the server to (typically 9223)
    /// * `bind_address` - The address to bind to (e.g., "0.0.0.0" or "127.0.0.1")
    /// * `app` - The Tauri application handle
    /// * `event_tx` - An external broadcast sender for distributing events
    ///
    /// # Returns
    ///
    /// The `WebSocketServer` instance
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// use tauri_plugin_mcp_bridge::websocket::WebSocketServer;
    ///
    /// let (event_tx, _event_rx) = tokio::sync::broadcast::channel(100);
    /// let server = WebSocketServer::new(9223, "0.0.0.0", app_handle, event_tx);
    /// ```
    pub fn new(
        port: u16,
        bind_address: &str,
        app: AppHandle<R>,
        event_tx: broadcast::Sender<String>,
    ) -> Self {
        let addr: SocketAddr = format!("{bind_address}:{port}").parse().unwrap();

        Self {
            addr,
            event_tx,
            app,
        }
    }

    /// Starts the WebSocket server and begins accepting connections.
    ///
    /// This method runs indefinitely, accepting new WebSocket connections and
    /// spawning a handler task for each client. It should be run in a background
    /// task using `tokio::spawn`.
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Never returns normally (runs until error)
    /// * `Err(Box<dyn std::error::Error>)` - If the server fails to bind or accept connections
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// use tauri_plugin_mcp_bridge::websocket::WebSocketServer;
    ///
    /// #[tokio::main]
    /// async fn main() {
    ///     // Requires a Tauri AppHandle
    ///     let (server, _rx) = WebSocketServer::new(9223, "0.0.0.0", app_handle);
    ///
    ///     tokio::spawn(async move {
    ///         if let Err(e) = server.start().await {
    ///             eprintln!("WebSocket server error: {}", e);
    ///         }
    ///     });
    /// }
    /// ```
    pub async fn start(self) -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind(&self.addr).await?;
        mcp_log_info(
            "WS_SERVER",
            &format!("WebSocket server listening on: {}", self.addr),
        );

        loop {
            let (stream, _) = listener.accept().await?;
            let event_tx = self.event_tx.clone();
            let app = self.app.clone();

            tokio::spawn(async move {
                if let Err(e) = handle_connection(stream, event_tx, app).await {
                    mcp_log_error("WS_SERVER", &format!("WebSocket connection error: {e}"));
                }
            });
        }
    }

    /// Broadcasts a message to all connected WebSocket clients.
    ///
    /// Sends the message through the broadcast channel to all active client
    /// connections. If no clients are connected, the message is dropped.
    ///
    /// # Arguments
    ///
    /// * `message` - The message string to broadcast
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// use tauri_plugin_mcp_bridge::websocket::WebSocketServer;
    ///
    /// // Requires a Tauri AppHandle
    /// let (server, _rx) = WebSocketServer::new(9223, "0.0.0.0", app_handle);
    /// server.broadcast("Hello, clients!");
    /// ```
    pub fn broadcast(&self, message: &str) {
        let _ = self.event_tx.send(message.to_string());
    }
}

/// Helper to create a success response JSON.
fn success_response(id: &str, data: impl serde::Serialize) -> Value {
    serde_json::json!({
        "id": id,
        "success": true,
        "data": data
    })
}

/// Helper to create an error response JSON.
fn error_response(id: &str, error: impl std::fmt::Display) -> Value {
    serde_json::json!({
        "id": id,
        "success": false,
        "error": error.to_string()
    })
}

/// Handles the invoke_tauri command which proxies Tauri IPC commands.
async fn handle_invoke_tauri<R: Runtime>(app: &AppHandle<R>, id: &str, args: &Value) -> Value {
    let Some(tauri_cmd) = args.get("command").and_then(|v| v.as_str()) else {
        return error_response(id, "Missing command in args");
    };

    let window_label = args
        .get("args")
        .and_then(|a| a.get("windowLabel"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    match tauri_cmd {
        "plugin:mcp-bridge|get_window_info" => match commands::resolve_window(app, window_label) {
            Ok(window) => match commands::get_window_info(window).await {
                Ok(data) => success_response(id, data),
                Err(e) => error_response(id, e),
            },
            Err(e) => error_response(id, e),
        },
        "plugin:mcp-bridge|get_backend_state" => {
            match commands::get_backend_state(app.clone()).await {
                Ok(data) => success_response(id, data),
                Err(e) => error_response(id, e),
            }
        }
        "plugin:mcp-bridge|start_ipc_monitor" => {
            let Some(window) = app.webview_windows().values().next().cloned() else {
                return error_response(id, "No window available");
            };
            match commands::start_ipc_monitor(window, app.state()).await {
                Ok(data) => success_response(id, data),
                Err(e) => error_response(id, e),
            }
        }
        "plugin:mcp-bridge|stop_ipc_monitor" => {
            let Some(window) = app.webview_windows().values().next().cloned() else {
                return error_response(id, "No window available");
            };
            match commands::stop_ipc_monitor(window, app.state()).await {
                Ok(data) => success_response(id, data),
                Err(e) => error_response(id, e),
            }
        }
        "plugin:mcp-bridge|get_ipc_events" => match commands::get_ipc_events(app.state()).await {
            Ok(data) => success_response(id, data),
            Err(e) => error_response(id, e),
        },
        "plugin:mcp-bridge|emit_event" => {
            let Some(event_name) = args
                .get("args")
                .and_then(|a| a.get("eventName"))
                .and_then(|v| v.as_str())
            else {
                return error_response(id, "Missing eventName in args");
            };
            let payload = args
                .get("args")
                .and_then(|a| a.get("payload"))
                .cloned()
                .unwrap_or(serde_json::json!(null));
            match commands::emit_event(app.clone(), event_name.to_string(), payload).await {
                Ok(data) => success_response(id, data),
                Err(e) => error_response(id, e),
            }
        }
        _ => error_response(id, format!("Unsupported Tauri command: {tauri_cmd}")),
    }
}

/// Handles desktop window focus, minimize, and maximize actions.
async fn handle_set_window_state<R: Runtime>(app: &AppHandle<R>, id: &str, args: &Value) -> Value {
    let window_label = args
        .get("windowId")
        .and_then(|value| value.as_str())
        .unwrap_or("main");
    let Some(action) = args.get("action").and_then(|value| value.as_str()) else {
        return error_response(id, "Missing action in args");
    };
    let Some(window) = app.get_webview_window(window_label) else {
        return error_response(id, format!("Window not found: {window_label}"));
    };

    let result = match action {
        "focus" => window.set_focus(),
        "minimize" => window.minimize(),
        "maximize" => window.maximize(),
        _ => return error_response(id, format!("Unknown window state action: {action}")),
    };

    match result {
        Ok(()) => success_response(
            id,
            serde_json::json!({ "action": action, "windowId": window_label }),
        ),
        Err(error) => error_response(id, error.to_string()),
    }
}

/// Handles the list_windows command.
async fn handle_list_windows<R: Runtime>(app: &AppHandle<R>, id: &str) -> Value {
    match commands::list_windows(app.clone()).await {
        Ok(data) => success_response(id, data),
        Err(e) => error_response(id, e),
    }
}

/// Handles the get_window_info command.
async fn handle_get_window_info<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    command: &Value,
) -> Value {
    let window_id = command
        .get("args")
        .and_then(|a| a.get("windowId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    match commands::resolve_window(app, window_id) {
        Ok(window) => match commands::get_window_info(window).await {
            Ok(data) => success_response(id, data),
            Err(e) => error_response(id, e),
        },
        Err(e) => error_response(id, e),
    }
}

/// Handles the execute_js command.
async fn handle_execute_js<R: Runtime>(app: &AppHandle<R>, id: &str, args: &Value) -> Value {
    let Some(script) = args.get("script").and_then(|v| v.as_str()) else {
        return error_response(id, "Missing script argument");
    };

    let window_label = args
        .get("windowLabel")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    match resolve_window_with_context(app, window_label) {
        Ok(resolved) => {
            let executor_state: tauri::State<'_, ScriptExecutor> = app.state();
            match commands::execute_js(
                resolved.window.clone(),
                script.to_string(),
                executor_state,
                args.get("timeout").and_then(Value::as_u64),
            )
            .await
            {
                Ok(result) => serde_json::json!({
                    "id": id,
                    "success": result.get("success").and_then(|v| v.as_bool()).unwrap_or(true),
                    "data": result.get("data").cloned(),
                    "error": result.get("error").and_then(|v| v.as_str()),
                    "windowContext": resolved.context
                }),
                Err(e) => serde_json::json!({
                    "id": id,
                    "success": false,
                    "error": e,
                    "windowContext": resolved.context
                }),
            }
        }
        Err(e) => error_response(id, e),
    }
}

/// Handles the capture_native_screenshot command.
async fn handle_capture_screenshot<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    args: Option<&Value>,
) -> Value {
    let format = args
        .and_then(|a| a.get("format"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let quality = args
        .and_then(|a| a.get("quality"))
        .and_then(|v| v.as_u64())
        .map(|q| q as u8);
    let max_width = args
        .and_then(|a| a.get("maxWidth"))
        .and_then(|v| v.as_u64())
        .map(|w| w as u32);
    let window_label = args
        .and_then(|a| a.get("windowLabel"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    match resolve_window_with_context(app, window_label) {
        Ok(resolved) => {
            match commands::capture_native_screenshot(resolved.window, format, quality, max_width)
                .await
            {
                Ok(data_url) => serde_json::json!({
                    "id": id,
                    "success": true,
                    "data": data_url,
                    "windowContext": resolved.context
                }),
                Err(e) => serde_json::json!({
                    "id": id,
                    "success": false,
                    "error": e,
                    "windowContext": resolved.context
                }),
            }
        }
        Err(e) => error_response(id, e),
    }
}

/// Handles the resize_window command.
async fn handle_resize_window<R: Runtime>(app: &AppHandle<R>, id: &str, args: &Value) -> Value {
    let width = args.get("width").and_then(|v| v.as_u64()).map(|w| w as u32);
    let height = args
        .get("height")
        .and_then(|v| v.as_u64())
        .map(|h| h as u32);
    let window_id = args
        .get("windowId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let logical = args
        .get("logical")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let (Some(w), Some(h)) = (width, height) else {
        return error_response(id, "Missing width or height argument");
    };

    let params = commands::ResizeWindowParams {
        width: w,
        height: h,
        window_id,
        logical,
    };

    match commands::resize_window(app.clone(), params).await {
        Ok(result) => serde_json::json!({
            "id": id,
            "success": result.success,
            "data": result,
            "error": result.error
        }),
        Err(e) => error_response(id, e),
    }
}

/// Handles the register_script command.
fn handle_register_script<R: Runtime>(app: &AppHandle<R>, id: &str, args: &Value) -> Value {
    let script_id = args.get("id").and_then(|v| v.as_str());
    let script_type_str = args.get("type").and_then(|v| v.as_str());
    let content = args.get("content").and_then(|v| v.as_str());

    let (Some(id_str), Some(type_str), Some(content_str)) = (script_id, script_type_str, content)
    else {
        return error_response(id, "Missing required args: id, type, content");
    };

    let script_type = match type_str {
        "url" => ScriptType::Url,
        _ => ScriptType::Inline,
    };

    let entry = ScriptEntry {
        id: id_str.to_string(),
        script_type,
        content: content_str.to_string(),
    };

    let registry: tauri::State<'_, SharedScriptRegistry> = app.state();
    {
        let mut reg = registry.lock().unwrap();
        reg.add(entry.clone());
    }

    let window_label = args
        .get("windowLabel")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    match inject_script_to_webview(app, &entry, window_label) {
        Ok(result) => serde_json::json!({
            "id": id,
            "success": true,
            "data": { "registered": true, "scriptId": id_str },
            "windowContext": {
                "windowLabel": result.window_context.window_label,
                "totalWindows": result.window_context.total_windows,
                "warning": result.window_context.warning
            }
        }),
        Err(e) => error_response(id, e),
    }
}

/// Handles the remove_script command.
fn handle_remove_script<R: Runtime>(app: &AppHandle<R>, id: &str, args: &Value) -> Value {
    let Some(script_id) = args.get("id").and_then(|v| v.as_str()) else {
        return error_response(id, "Missing script id");
    };

    let registry: tauri::State<'_, SharedScriptRegistry> = app.state();
    let removed = {
        let mut reg = registry.lock().unwrap();
        reg.remove(script_id).is_some()
    };

    let window_label = args
        .get("windowLabel")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    match remove_script_from_webview(app, script_id, window_label) {
        Ok(result) => serde_json::json!({
            "id": id,
            "success": true,
            "data": { "removed": removed, "scriptId": script_id },
            "windowContext": {
                "windowLabel": result.window_context.window_label,
                "totalWindows": result.window_context.total_windows,
                "warning": result.window_context.warning
            }
        }),
        Err(e) => {
            eprintln!("Failed to remove script from DOM: {e}");
            serde_json::json!({
                "id": id,
                "success": true,
                "data": { "removed": removed, "scriptId": script_id },
                "error": format!("Script removed from registry but DOM removal failed: {e}")
            })
        }
    }
}

/// Handles the clear_scripts command.
fn handle_clear_scripts<R: Runtime>(app: &AppHandle<R>, id: &str, command: &Value) -> Value {
    let registry: tauri::State<'_, SharedScriptRegistry> = app.state();
    let count = {
        let mut reg = registry.lock().unwrap();
        let count = reg.len();
        reg.clear();
        count
    };

    let window_label = command
        .get("args")
        .and_then(|a| a.get("windowLabel"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    match clear_scripts_from_webview(app, window_label) {
        Ok(result) => serde_json::json!({
            "id": id,
            "success": true,
            "data": { "cleared": count },
            "windowContext": {
                "windowLabel": result.window_context.window_label,
                "totalWindows": result.window_context.total_windows,
                "warning": result.window_context.warning
            }
        }),
        Err(e) => {
            eprintln!("Failed to clear scripts from DOM: {e}");
            serde_json::json!({
                "id": id,
                "success": true,
                "data": { "cleared": count },
                "error": format!("Scripts cleared from registry but DOM clear failed: {e}")
            })
        }
    }
}

/// Handles the get_scripts command.
fn handle_get_scripts<R: Runtime>(app: &AppHandle<R>, id: &str) -> Value {
    let registry: tauri::State<'_, SharedScriptRegistry> = app.state();
    let scripts: Vec<Value> = {
        let reg = registry.lock().unwrap();
        reg.get_all()
            .iter()
            .map(|entry| {
                serde_json::json!({
                    "id": entry.id,
                    "type": match entry.script_type {
                        ScriptType::Inline => "inline",
                        ScriptType::Url => "url",
                    },
                    "content": entry.content
                })
            })
            .collect()
    };

    serde_json::json!({
        "id": id,
        "success": true,
        "data": { "scripts": scripts }
    })
}

/// Dispatches a WebSocket command to the appropriate handler.
async fn dispatch_command<R: Runtime>(app: &AppHandle<R>, command: &Value) -> Value {
    let id = command.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let cmd_name = command
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let args = command.get("args");

    match cmd_name {
        "invoke_tauri" => {
            if let Some(args) = args {
                handle_invoke_tauri(app, id, args).await
            } else {
                error_response(id, "Missing args for invoke_tauri")
            }
        }
        "list_windows" => handle_list_windows(app, id).await,
        "get_window_info" => handle_get_window_info(app, id, command).await,
        "execute_js" => {
            if let Some(args) = args {
                handle_execute_js(app, id, args).await
            } else {
                error_response(id, "Missing args")
            }
        }
        "capture_native_screenshot" => handle_capture_screenshot(app, id, args).await,
        "resize_window" => {
            if let Some(args) = args {
                handle_resize_window(app, id, args).await
            } else {
                error_response(id, "Missing args for resize_window")
            }
        }
        "set_window_state" => {
            if let Some(args) = args {
                handle_set_window_state(app, id, args).await
            } else {
                error_response(id, "Missing args for set_window_state")
            }
        }
        "register_script" => {
            if let Some(args) = args {
                handle_register_script(app, id, args)
            } else {
                error_response(id, "Missing args for register_script")
            }
        }
        "remove_script" => {
            if let Some(args) = args {
                handle_remove_script(app, id, args)
            } else {
                error_response(id, "Missing args for remove_script")
            }
        }
        "clear_scripts" => handle_clear_scripts(app, id, command),
        "get_scripts" => handle_get_scripts(app, id),
        _ => error_response(id, format!("Unknown command: {cmd_name}")),
    }
}

/// True for the benign "client went away mid-handshake" errors: a TCP connection that never
/// completes the WebSocket upgrade. These are routine (port scanners, health checks, reconnecting
/// clients) and not worth surfacing as connection errors.
fn is_benign_handshake_error(err: &tokio_tungstenite::tungstenite::Error) -> bool {
    use std::io::ErrorKind;
    use tokio_tungstenite::tungstenite::{error::ProtocolError, Error};

    match err {
        Error::ConnectionClosed | Error::AlreadyClosed => true,
        Error::Protocol(ProtocolError::HandshakeIncomplete) => true,
        Error::Io(io_err) => matches!(
            io_err.kind(),
            ErrorKind::ConnectionReset | ErrorKind::UnexpectedEof | ErrorKind::BrokenPipe
        ),
        _ => false,
    }
}

/// Handles a single WebSocket client connection.
///
/// This function manages the lifecycle of a WebSocket connection, including:
/// - Upgrading the TCP stream to WebSocket
/// - Forwarding broadcast events to the client
/// - Receiving and processing messages from the client (request/response)
/// - Handling disconnections and errors
///
/// # Arguments
///
/// * `stream` - The TCP stream for the client connection
/// * `event_tx` - Broadcast sender for distributing events
///
/// # Returns
///
/// * `Ok(())` - When the connection closes normally
/// * `Err(Box<dyn std::error::Error>)` - If an error occurs during communication
async fn handle_connection<R: Runtime>(
    stream: TcpStream,
    event_tx: broadcast::Sender<String>,
    app: AppHandle<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    let ws_stream = match accept_async(stream).await {
        Ok(ws_stream) => ws_stream,
        // A client that opens the TCP connection but drops before completing the WebSocket
        // upgrade (port probes, health checks, browsers/agents reconnecting) surfaces here as a
        // benign handshake/connection error, e.g. "Handshake not finished". Swallow those so
        // they don't spam the connection-error log; propagate anything genuinely unexpected.
        Err(e) if is_benign_handshake_error(&e) => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let mut event_rx = event_tx.subscribe();

    let (response_tx, mut response_rx) = mpsc::unbounded_channel::<String>();

    let send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                Ok(msg) = event_rx.recv() => {
                    if let Err(e) = ws_sender.send(Message::Text(msg.into())).await {
                        eprintln!("Failed to send broadcast: {e}");
                        break;
                    }
                }
                Some(response) = response_rx.recv() => {
                    if let Err(e) = ws_sender.send(Message::Text(response.into())).await {
                        eprintln!("Failed to send response: {e}");
                        break;
                    }
                }
                else => break,
            }
        }
    });

    while let Some(msg) = ws_receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                if let Ok(command) = serde_json::from_str::<Value>(&text) {
                    let response = dispatch_command(&app, &command).await;
                    let _ = response_tx.send(response.to_string());
                } else {
                    eprintln!("Failed to parse command: {text}");
                }
            }
            Ok(Message::Close(_)) => {
                println!("Client disconnected");
                break;
            }
            Err(e) => {
                eprintln!("WebSocket error: {e}");
                break;
            }
            _ => {}
        }
    }

    send_task.abort();
    Ok(())
}

/// Result of a script operation with window context.
struct ScriptOperationResult {
    window_context: WindowContext,
}

/// Injects a script into a specific webview window.
fn inject_script_to_window<R: Runtime>(
    window: &WebviewWindow<R>,
    entry: &ScriptEntry,
) -> Result<(), String> {
    let script = match entry.script_type {
        ScriptType::Inline => format!(
            r#"
            (function() {{
                var existing = document.querySelector('script[data-mcp-script-id="{}"]');
                if (existing) {{
                    existing.remove();
                }}
                var script = document.createElement('script');
                script.setAttribute('data-mcp-script-id', '{}');
                script.textContent = {};
                document.head.appendChild(script);
            }})();
            "#,
            entry.id,
            entry.id,
            serde_json::to_string(&entry.content).unwrap_or_else(|_| "''".to_string())
        ),
        ScriptType::Url => format!(
            r#"
            (function() {{
                var existing = document.querySelector('script[data-mcp-script-id="{}"]');
                if (existing) {{
                    existing.remove();
                }}
                var script = document.createElement('script');
                script.setAttribute('data-mcp-script-id', '{}');
                script.src = {};
                script.async = true;
                document.head.appendChild(script);
            }})();
            "#,
            entry.id,
            entry.id,
            serde_json::to_string(&entry.content).unwrap_or_else(|_| "''".to_string())
        ),
    };

    window
        .eval(&script)
        .map_err(|e| format!("Failed to inject script: {e}"))
}

/// Injects a script into the webview DOM.
/// If a script with the same ID already exists, it is removed first.
/// Returns window context for the response.
fn inject_script_to_webview<R: Runtime>(
    app: &AppHandle<R>,
    entry: &ScriptEntry,
    window_label: Option<String>,
) -> Result<ScriptOperationResult, String> {
    let resolved = resolve_window_with_context(app, window_label)?;

    inject_script_to_window(&resolved.window, entry)?;

    Ok(ScriptOperationResult {
        window_context: resolved.context,
    })
}

/// Removes a script from a specific window's DOM.
fn remove_script_from_window<R: Runtime>(
    window: &WebviewWindow<R>,
    script_id: &str,
) -> Result<(), String> {
    let script = format!(
        r#"
        (function() {{
            var script = document.querySelector('script[data-mcp-script-id="{script_id}"]');
            if (script) {{
                script.remove();
            }}
        }})();
        "#
    );

    window
        .eval(&script)
        .map_err(|e| format!("Failed to remove script: {e}"))
}

/// Removes a script from the webview DOM by ID.
/// Returns window context for the response.
fn remove_script_from_webview<R: Runtime>(
    app: &AppHandle<R>,
    script_id: &str,
    window_label: Option<String>,
) -> Result<ScriptOperationResult, String> {
    let resolved = resolve_window_with_context(app, window_label)?;

    remove_script_from_window(&resolved.window, script_id)?;

    Ok(ScriptOperationResult {
        window_context: resolved.context,
    })
}

/// Clears all MCP-managed scripts from a specific window's DOM.
fn clear_scripts_from_window<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    let script = r#"
        (function() {
            var scripts = document.querySelectorAll('script[data-mcp-script-id]');
            scripts.forEach(function(s) { s.remove(); });
        })();
    "#;

    window
        .eval(script)
        .map_err(|e| format!("Failed to clear scripts: {e}"))
}

/// Clears all MCP-managed scripts from the webview DOM.
/// Returns window context for the response.
fn clear_scripts_from_webview<R: Runtime>(
    app: &AppHandle<R>,
    window_label: Option<String>,
) -> Result<ScriptOperationResult, String> {
    let resolved = resolve_window_with_context(app, window_label)?;

    clear_scripts_from_window(&resolved.window)?;

    Ok(ScriptOperationResult {
        window_context: resolved.context,
    })
}

/// Injects all registered scripts into the webview.
/// Called when a page loads to re-inject persistent scripts.
pub fn inject_all_scripts<R: Runtime>(
    app: &AppHandle<R>,
    window_label: Option<String>,
) -> Result<usize, String> {
    let registry: tauri::State<'_, SharedScriptRegistry> = app.state();
    let scripts: Vec<ScriptEntry> = {
        let reg = registry.lock().unwrap();
        reg.get_all().iter().map(|e| (*e).clone()).collect()
    };

    let resolved = resolve_window_with_context(app, window_label)?;

    for entry in &scripts {
        inject_script_to_window(&resolved.window, entry)?;
    }

    Ok(scripts.len())
}
