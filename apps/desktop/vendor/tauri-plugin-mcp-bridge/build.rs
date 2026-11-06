fn main() {
    tauri_plugin::Builder::new(&[
        "capture_native_screenshot",
        "emit_event",
        "execute_command",
        "execute_js",
        "get_backend_state",
        "get_ipc_events",
        "get_window_info",
        "list_windows",
        "report_ipc_event",
        "request_script_injection",
        "script_result",
        "start_ipc_monitor",
        "stop_ipc_monitor",
    ])
    .build();
}
