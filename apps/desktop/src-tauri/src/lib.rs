mod storage;

use std::sync::Mutex;

use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_plugin_decorum::WebviewWindowExt;

/// Read a user-selected book file from disk into raw bytes.
///
/// The path always originates from the native file dialog (an explicit user
/// pick). It routes through the fs plugin's cross-platform `open` so Android
/// `content://` URIs resolve just like ordinary paths; desktop paths hit the
/// filesystem directly. Returns an `ipc::Response` so large book files transfer
/// to the webview as a binary ArrayBuffer rather than a JSON number array.
#[tauri::command]
fn read_book_file(app: tauri::AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    use std::io::Read;
    use tauri_plugin_fs::{FsExt, OpenOptions};

    let file_path = path
        .parse::<tauri_plugin_fs::FilePath>()
        .map_err(|err| format!("Invalid file path {path}: {err}"))?;
    let mut options = OpenOptions::new();
    options.read(true);
    let mut file = app
        .fs()
        .open(file_path, options)
        .map_err(|err| format!("Failed to open {path}: {err}"))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|err| format!("Failed to read {path}: {err}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Book files staged in memory for chunked transfer to the webview, keyed by
/// the picked path. Mobile only: Android's IPC injects responses via
/// `evaluateJavascript`, which chokes on multi-megabyte payloads (and Channel
/// messages don't arrive at all there), so the webview pulls the file in
/// small raw-response chunks instead. Entries are dropped by
/// `book_read_close` once the transfer finishes.
#[derive(Default)]
pub struct BookReadSessions(Mutex<std::collections::HashMap<String, Vec<u8>>>);

/// Read the whole book into a staging buffer and return its byte length.
/// `path` may be an ordinary filesystem path or an Android `content://` URI.
#[tauri::command]
fn book_read_open(
    app: tauri::AppHandle,
    sessions: tauri::State<'_, BookReadSessions>,
    path: String,
) -> Result<usize, String> {
    use std::io::Read;
    use tauri_plugin_fs::{FsExt, OpenOptions};

    let file_path = path
        .parse::<tauri_plugin_fs::FilePath>()
        .map_err(|err| format!("Invalid file path {path}: {err}"))?;
    let mut options = OpenOptions::new();
    options.read(true);
    let mut file = app
        .fs()
        .open(file_path, options)
        .map_err(|err| format!("Failed to open {path}: {err}"))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|err| format!("Failed to read {path}: {err}"))?;
    let len = bytes.len();
    sessions
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(path, bytes);
    Ok(len)
}

/// Return one chunk of a staged book as a raw binary response.
#[tauri::command]
fn book_read_chunk(
    sessions: tauri::State<'_, BookReadSessions>,
    path: String,
    offset: usize,
    length: usize,
) -> Result<tauri::ipc::Response, String> {
    let map = sessions.0.lock().map_err(|e| e.to_string())?;
    let bytes = map
        .get(&path)
        .ok_or_else(|| format!("book_read_chunk: no open session for {path}"))?;
    let start = offset.min(bytes.len());
    let end = offset.saturating_add(length).min(bytes.len());
    Ok(tauri::ipc::Response::new(bytes[start..end].to_vec()))
}

/// Drop a staged book once the webview has pulled every chunk.
#[tauri::command]
fn book_read_close(
    sessions: tauri::State<'_, BookReadSessions>,
    path: String,
) -> Result<(), String> {
    sessions.0.lock().map_err(|e| e.to_string())?.remove(&path);
    Ok(())
}

/// Show or hide the Android system status bar for the reader's immersive
/// view. Calls into `MainActivity.setStatusBarHidden` over JNI (which hops to
/// the UI thread itself); the webview's safe-area insets update automatically,
/// so the reader chrome reclaims the space. Off Android it is a no-op so the
/// command still resolves for `generate_handler!`.
#[cfg(target_os = "android")]
#[tauri::command]
fn set_status_bar_hidden(app: tauri::AppHandle, hidden: bool) -> Result<(), String> {
    app.run_on_main_thread(move || {
        use tao::platform::android::prelude::main_android_context;
        let Some(ctx) = main_android_context() else {
            eprintln!("setStatusBarHidden: no android context yet");
            return;
        };
        let Ok(vm) = (unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }) else {
            return;
        };
        let Ok(mut env) = vm.attach_current_thread() else {
            return;
        };
        let activity = unsafe { jni::objects::JObject::from_raw(ctx.context_jobject.cast()) };
        if let Err(err) = env.call_method(
            &activity,
            "setStatusBarHidden",
            "(Z)V",
            &[jni::objects::JValue::Bool(hidden as u8)],
        ) {
            eprintln!("setStatusBarHidden JNI call failed: {err}");
            let _ = env.exception_clear();
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn set_status_bar_hidden(_hidden: bool) {}

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
    let builder = tauri::Builder::default();
    // Desktop-only window chrome (macOS traffic-light repositioning); the
    // crate is not compiled for Android/iOS, where the webview is fullscreen.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_decorum::init());
    // `mut` is only exercised by the desktop-only MCP-bridge block below.
    #[cfg_attr(mobile, allow(unused_mut))]
    let mut builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(BookReadSessions::default())
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
            book_read_open,
            book_read_chunk,
            book_read_close,
            set_status_bar_hidden,
            set_traffic_lights_visible,
            list_system_fonts,
        ]);

    // Dev-only: expose the MCP bridge so the Tauri MCP server can drive the
    // webview. Bound to localhost only; never initialized in release builds.
    // Desktop-only: the crate is not part of the mobile dependency set.
    #[cfg(all(debug_assertions, desktop))]
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
