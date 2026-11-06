//! IPC monitoring commands.

use crate::monitor::{current_timestamp, IPCEvent, IPCMonitorState};
use tauri::{command, Runtime, State, WebviewWindow};

/// Starts IPC monitoring to capture Tauri command calls.
///
/// Enables the IPC monitor which will begin capturing all subsequent Tauri
/// command invocations with their arguments, results, and timing information.
/// Previous events are cleared when monitoring starts.
///
/// # Arguments
///
/// * `monitor` - Shared state for the IPC monitor
///
/// # Returns
///
/// * `Ok(String)` - Success message
/// * `Err(String)` - Error message if the monitor lock fails
///
/// # Examples
///
/// ```typescript
/// import { invoke } from '@tauri-apps/api/core';
///
/// await invoke('plugin:mcp-bridge|start_ipc_monitor');
/// // Now all IPC calls will be captured
/// ```
///
/// # See Also
///
/// * [`stop_ipc_monitor`] - Stop monitoring
/// * [`get_ipc_events`] - Retrieve captured events
#[command]
pub async fn start_ipc_monitor<R: Runtime>(
    window: WebviewWindow<R>,
    monitor: State<'_, IPCMonitorState>,
) -> Result<String, String> {
    let mut mon = monitor.lock().map_err(|e| format!("Lock error: {e}"))?;
    mon.start();

    // Trigger JS-side IPC interception
    let _ = window.eval("window.__MCP_START_IPC_MONITOR__ && window.__MCP_START_IPC_MONITOR__();");

    Ok("IPC monitoring started".to_string())
}

/// Stops IPC monitoring.
///
/// Disables the IPC monitor, stopping the capture of new events. Previously
/// captured events remain available until monitoring is restarted.
///
/// # Arguments
///
/// * `monitor` - Shared state for the IPC monitor
///
/// # Returns
///
/// * `Ok(String)` - Success message
/// * `Err(String)` - Error message if the monitor lock fails
///
/// # Examples
///
/// ```typescript
/// import { invoke } from '@tauri-apps/api/core';
///
/// await invoke('plugin:mcp-bridge|stop_ipc_monitor');
/// const events = await invoke('plugin:mcp-bridge|get_ipc_events');
/// console.log(`Captured ${events.length} events`);
/// ```
///
/// # See Also
///
/// * [`start_ipc_monitor`] - Start monitoring
/// * [`get_ipc_events`] - Retrieve captured events
#[command]
pub async fn stop_ipc_monitor<R: Runtime>(
    window: WebviewWindow<R>,
    monitor: State<'_, IPCMonitorState>,
) -> Result<String, String> {
    // Trigger JS-side IPC interception stop first
    let _ = window.eval("window.__MCP_STOP_IPC_MONITOR__ && window.__MCP_STOP_IPC_MONITOR__();");

    let mut mon = monitor.lock().map_err(|e| format!("Lock error: {e}"))?;
    mon.stop();
    Ok("IPC monitoring stopped".to_string())
}

/// Retrieves all captured IPC events.
///
/// Returns a list of all IPC events captured since monitoring was started.
/// Each event includes the command name, arguments, result, errors, and
/// execution timing.
///
/// # Arguments
///
/// * `monitor` - Shared state for the IPC monitor
///
/// # Returns
///
/// * `Ok(Vec<IPCEvent>)` - List of captured IPC events
/// * `Err(String)` - Error message if the monitor lock fails
///
/// # Examples
///
/// ```typescript
/// import { invoke } from '@tauri-apps/api/core';
///
/// await invoke('plugin:mcp-bridge|start_ipc_monitor');
/// // ... perform some IPC calls ...
/// const events = await invoke('plugin:mcp-bridge|get_ipc_events');
///
/// events.forEach(event => {
///   console.log(`${event.command} took ${event.duration_ms}ms`);
/// });
/// ```
///
/// # See Also
///
/// * [`IPCEvent`](crate::monitor::IPCEvent) - Event structure details
/// * [`start_ipc_monitor`] - Start monitoring
/// * [`stop_ipc_monitor`] - Stop monitoring
#[command]
pub async fn get_ipc_events(monitor: State<'_, IPCMonitorState>) -> Result<Vec<IPCEvent>, String> {
    let mon = monitor.lock().map_err(|e| format!("Lock error: {e}"))?;
    Ok(mon.get_events())
}

/// Reports an IPC event from JavaScript.
///
/// This command is called by the bridge.js IPC interceptor to report captured
/// IPC calls. It adds the event to the monitor if monitoring is enabled.
///
/// # Arguments
///
/// * `monitor` - Shared state for the IPC monitor
/// * `params` - The IPC event details from JavaScript
///
/// # Returns
///
/// * `Ok(())` - Event recorded (or ignored if monitoring is disabled)
/// * `Err(String)` - Error message if the monitor lock fails
#[command]
pub async fn report_ipc_event(
    monitor: State<'_, IPCMonitorState>,
    command: String,
    args: serde_json::Value,
    result: Option<serde_json::Value>,
    error: Option<String>,
    duration_ms: Option<f64>,
) -> Result<(), String> {
    // Skip reporting our own monitoring commands to avoid infinite loops
    if command.contains("report_ipc_event")
        || command.contains("start_ipc_monitor")
        || command.contains("stop_ipc_monitor")
        || command.contains("get_ipc_events")
    {
        return Ok(());
    }

    let mut mon = monitor.lock().map_err(|e| format!("Lock error: {e}"))?;

    let event = IPCEvent {
        timestamp: current_timestamp(),
        command,
        args,
        result,
        error,
        duration_ms,
    };

    mon.add_event(event);
    Ok(())
}
