mod storage;

use std::sync::Mutex;

use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_plugin_decorum::WebviewWindowExt;

/// Read a user-selected book file from disk into raw bytes.
///
/// The path always originates from the native file dialog (an explicit user
/// pick), so we read it directly instead of routing through the fs plugin's
/// path scope. Returns an `ipc::Response` so large book files transfer to the
/// webview as a binary ArrayBuffer rather than a JSON number array.
#[tauri::command]
fn read_book_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|err| format!("Failed to read {path}: {err}"))
}

/// Show or hide the macOS traffic-light window buttons.
///
/// Gives the reader a clean immersive view: when the overlay header is dismissed
/// the buttons are hidden, and they reappear (aligned in the bar) when the header
/// is brought back up. The frontend only calls this on macOS desktop; off macOS
/// it is a no-op so the command still resolves for `generate_handler!`.
#[cfg(target_os = "macos")]
#[tauri::command]
fn set_traffic_lights_visible(window: tauri::WebviewWindow, visible: bool) {
    use cocoa::appkit::{NSWindow, NSWindowButton};
    use cocoa::base::{id, nil};
    use objc::runtime::{BOOL, NO, YES};
    use objc::{msg_send, sel, sel_impl};

    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    let ns_window = ns_window as id;
    let hidden: BOOL = if visible { NO } else { YES };
    unsafe {
        for button in [
            NSWindowButton::NSWindowCloseButton,
            NSWindowButton::NSWindowMiniaturizeButton,
            NSWindowButton::NSWindowZoomButton,
        ] {
            let btn: id = ns_window.standardWindowButton_(button);
            if btn != nil {
                let _: () = msg_send![btn, setHidden: hidden];
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn set_traffic_lights_visible(_visible: bool) {}

/// Enumerate the user-facing font families installed on this machine, for the
/// reader's font picker.
///
/// macOS asks `NSFontManager` for its menu-ready family names — the same list
/// apps show in a font menu, with the dot-prefixed hidden system faces already
/// excluded. Other platforms return an empty list for now, so the picker simply
/// falls back to the built-in presets until native enumeration is added.
#[cfg(target_os = "macos")]
#[tauri::command]
fn list_system_fonts() -> Vec<String> {
    use cocoa::base::{id, nil};
    use objc::{class, msg_send, sel, sel_impl};

    let mut families: Vec<String> = Vec::new();
    unsafe {
        let manager: id = msg_send![class!(NSFontManager), sharedFontManager];
        if manager == nil {
            return families;
        }
        // NSArray<NSString *> of available family names.
        let names: id = msg_send![manager, availableFontFamilies];
        if names == nil {
            return families;
        }
        let count: usize = msg_send![names, count];
        families.reserve(count);
        for index in 0..count {
            let name: id = msg_send![names, objectAtIndex: index];
            if name == nil {
                continue;
            }
            let utf8: *const std::os::raw::c_char = msg_send![name, UTF8String];
            if utf8.is_null() {
                continue;
            }
            if let Ok(text) = std::ffi::CStr::from_ptr(utf8).to_str() {
                families.push(text.to_owned());
            }
        }
    }
    families
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn list_system_fonts() -> Vec<String> {
    Vec::new()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_decorum::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let conn = storage::init_db(app.handle()).expect("failed to initialize database");
            app.manage(storage::Db(Mutex::new(conn)));

            // macOS: the native title bar is hidden (titleBarStyle "Overlay"), so
            // nudge the traffic lights down to sit centered in our custom top bar.
            // Decorum keeps the inset across window resizes.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_traffic_lights_inset(16.0, 23.5);
            }

            // The config paints the window light-paper before the webview's
            // first frame; on a dark-scheme OS swap that for dark paper so a
            // dark-theme boot never flashes light. (Values mirror
            // --color-paper in apps/web/src/index.css.)
            if let Some(window) = app.get_webview_window("main") {
                if matches!(window.theme(), Ok(tauri::Theme::Dark)) {
                    let _ = window
                        .set_background_color(Some(tauri::window::Color(0x1c, 0x19, 0x17, 0xff)));
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            storage::append_events,
            storage::read_events_since,
            storage::put_blob,
            storage::get_blob,
            storage::delete_blob,
            storage::load_kv_all,
            storage::set_kv,
            storage::delete_kv,
            storage::library_load,
            storage::library_get_book,
            storage::library_put_book,
            storage::library_delete_books,
            storage::library_list_collections,
            storage::library_put_collection,
            storage::library_delete_collection,
            storage::annotations_list,
            storage::annotation_get,
            storage::annotation_put,
            storage::annotation_delete,
            storage::upsert_vectors,
            storage::query_vectors,
            read_book_file,
            set_traffic_lights_visible,
            list_system_fonts,
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
