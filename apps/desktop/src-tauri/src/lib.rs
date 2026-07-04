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

/// Paper-tone window background (mirrors `--color-paper` in
/// `apps/web/src/index.css`), painted before the webview's first frame.
fn paper_color(dark: bool) -> tauri::window::Color {
    if dark {
        tauri::window::Color(0x1c, 0x19, 0x17, 0xff)
    } else {
        tauri::window::Color(0xf5, 0xf1, 0xe8, 0xff)
    }
}

/// Initialization script stamping the forced theme on `<html>` before the
/// document parses. `documentElement` may not exist yet at injection time, so
/// fall back to observing the document until the parser creates it.
fn boot_theme_script(theme: &str) -> String {
    format!(
        r#"(function () {{
  var apply = function () {{
    var root = document.documentElement;
    if (!root) return false;
    root.setAttribute("data-theme", "{theme}");
    root.style.colorScheme = "{theme}";
    return true;
  }};
  if (!apply()) {{
    new MutationObserver(function (_, observer) {{
      if (apply()) observer.disconnect();
    }}).observe(document, {{ childList: true }});
  }}
}})();"#
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_decorum::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let conn = storage::init_db(app.handle()).expect("failed to initialize database");
            // Read the persisted theme preference BEFORE the main window exists
            // so the very first frame — window background and boot splash —
            // honors the in-app setting, not just the OS scheme. `None` means
            // "system" (or nothing stored): follow the OS.
            let boot_theme = storage::read_boot_theme(&conn);
            app.manage(storage::Db(Mutex::new(conn)));

            // The main window is declared in tauri.conf.json with `create:
            // false` and built here instead: an initialization script can only
            // be attached before creation, and it needs the stored theme.
            let window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .expect("main window missing from tauri.conf.json")
                .clone();
            let mut builder =
                tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?;
            if let Some(theme) = boot_theme {
                // Stamp <html data-theme> before the document parses so the
                // splash CSS (keyed on the attribute) applies the forced theme
                // from its first paint. For "system" nothing is stamped — the
                // splash's prefers-color-scheme fallback already follows the OS.
                builder = builder
                    .initialization_script(boot_theme_script(theme))
                    .background_color(paper_color(theme == "dark"));
            }
            let window = builder.build()?;

            // macOS: the native title bar is hidden (titleBarStyle "Overlay"), so
            // nudge the traffic lights down to sit centered in our custom top bar.
            // Decorum keeps the inset across window resizes.
            #[cfg(target_os = "macos")]
            let _ = window.set_traffic_lights_inset(16.0, 23.5);

            // No forced preference: the config painted light paper, so swap in
            // dark paper when the OS scheme is dark and a dark boot never
            // flashes light.
            if boot_theme.is_none() && matches!(window.theme(), Ok(tauri::Theme::Dark)) {
                let _ = window.set_background_color(Some(paper_color(true)));
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
