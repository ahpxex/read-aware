mod storage;

use std::sync::Mutex;

use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_plugin_decorum::WebviewWindowExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_decorum::init())
        .setup(|app| {
            let conn = storage::init_db(app.handle()).expect("failed to initialize database");
            app.manage(storage::Db(Mutex::new(conn)));

            // macOS: the native title bar is hidden (titleBarStyle "Overlay"), so
            // nudge the traffic lights down to sit centered in our custom top bar.
            // Decorum keeps the inset across window resizes.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_traffic_lights_inset(16.0, 18.0);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            storage::append_events,
            storage::read_events_since,
            storage::put_blob,
            storage::get_blob,
            storage::delete_blob,
            storage::upsert_vectors,
            storage::query_vectors,
        ]);

    // Dev-only: expose the MCP bridge so the Tauri MCP server can drive the
    // webview. Bound to localhost only; never initialized in release builds.
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(
            tauri_plugin_mcp_bridge::Builder::new()
                .bind_address("127.0.0.1")
                .build(),
        );
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running ReadAware desktop application");
}
