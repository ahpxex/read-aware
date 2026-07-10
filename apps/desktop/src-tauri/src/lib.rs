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

/// Ask `MainActivity` to re-dispatch the window insets, pushing the Android
/// system-bar/cutout values into the web layer's `--ra-safe-*` CSS variables
/// (Android's WebView never exposes them via `env(safe-area-inset-*)`; see
/// `MainActivity.applySafeAreaToWebView`). The frontend calls this once at
/// boot — a fresh document starts back at the CSS defaults, and the native
/// insets listener only re-fires when the insets themselves change. Off
/// Android it is a no-op so the command still resolves for `generate_handler!`.
#[cfg(target_os = "android")]
#[tauri::command]
fn sync_safe_area(app: tauri::AppHandle) -> Result<(), String> {
    app.run_on_main_thread(move || {
        use tao::platform::android::prelude::main_android_context;
        let Some(ctx) = main_android_context() else {
            eprintln!("syncSafeArea: no android context yet");
            return;
        };
        let Ok(vm) = (unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }) else {
            return;
        };
        let Ok(mut env) = vm.attach_current_thread() else {
            return;
        };
        let activity = unsafe { jni::objects::JObject::from_raw(ctx.context_jobject.cast()) };
        if let Err(err) = env.call_method(&activity, "syncSafeArea", "()V", &[]) {
            eprintln!("syncSafeArea JNI call failed: {err}");
            let _ = env.exception_clear();
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn sync_safe_area() {}

/// While the reader's sentence navigator is on, Android's volume keys step
/// between sentences instead of changing the volume (see
/// `MainActivity.dispatchKeyEvent`). The frontend toggles the capture as the
/// mode starts/stops. Off Android it is a no-op so the command still resolves
/// for `generate_handler!` — iOS offers no public API for volume-key capture.
#[cfg(target_os = "android")]
#[tauri::command]
fn set_volume_key_capture(app: tauri::AppHandle, captured: bool) -> Result<(), String> {
    app.run_on_main_thread(move || {
        use tao::platform::android::prelude::main_android_context;
        let Some(ctx) = main_android_context() else {
            eprintln!("setVolumeKeyCapture: no android context yet");
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
            "setVolumeKeyCapture",
            "(Z)V",
            &[jni::objects::JValue::Bool(captured as u8)],
        ) {
            eprintln!("setVolumeKeyCapture JNI call failed: {err}");
            let _ = env.exception_clear();
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn set_volume_key_capture(_captured: bool) {}

/// Move the Android task to the background (like pressing Home), keeping the
/// process — and the loaded book — warm for an instant return. The web layer
/// calls this when the back button unwinds past the shelf root; letting the
/// system finish() the activity instead would tear down the whole Tauri
/// process and turn every return into a cold start. No-op off Android.
#[cfg(target_os = "android")]
#[tauri::command]
fn move_task_to_back(app: tauri::AppHandle) -> Result<(), String> {
    app.run_on_main_thread(move || {
        use tao::platform::android::prelude::main_android_context;
        let Some(ctx) = main_android_context() else {
            eprintln!("moveTaskToBack: no android context yet");
            return;
        };
        let Ok(vm) = (unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }) else {
            return;
        };
        let Ok(mut env) = vm.attach_current_thread() else {
            return;
        };
        let activity = unsafe { jni::objects::JObject::from_raw(ctx.context_jobject.cast()) };
        if let Err(err) = env.call_method(&activity, "sendToBackground", "()V", &[]) {
            eprintln!("sendToBackground JNI call failed: {err}");
            let _ = env.exception_clear();
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn move_task_to_back() {}

/// Launch the Android system document picker for book files (see
/// `MainActivity.startBookPick`). The result is NOT pushed back over the
/// plugin activity-result channel — that path drops responses across the
/// picker round-trip (a cancel almost always, a pick intermittently), which
/// is why this exists instead of tauri-plugin-dialog on Android. The webview
/// collects the outcome by polling `book_pick_poll`. No-op off Android.
#[cfg(target_os = "android")]
#[tauri::command]
fn book_pick_start(app: tauri::AppHandle, generation: i32) -> Result<(), String> {
    app.run_on_main_thread(move || {
        use tao::platform::android::prelude::main_android_context;
        let Some(ctx) = main_android_context() else {
            eprintln!("bookPickStart: no android context yet");
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
            "startBookPick",
            "(I)V",
            &[jni::objects::JValue::Int(generation)],
        ) {
            eprintln!("startBookPick JNI call failed: {err}");
            let _ = env.exception_clear();
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn book_pick_start(_generation: i32) {}

/// Collect (and clear) the parked book-pick result. `None` while the picker
/// is still open; `Some("<generation>")` = cancelled; otherwise
/// `Some("<generation>\n<uri>…")`. Plain request/response IPC — the reliable
/// channel — so the result cannot be lost the way pushed responses are.
#[cfg(target_os = "android")]
#[tauri::command]
fn book_pick_poll(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    app.run_on_main_thread(move || {
        let result = (|| -> Option<String> {
            use tao::platform::android::prelude::main_android_context;
            let ctx = main_android_context()?;
            let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }.ok()?;
            let mut env = vm.attach_current_thread().ok()?;
            let activity = unsafe { jni::objects::JObject::from_raw(ctx.context_jobject.cast()) };
            let value = env
                .call_method(&activity, "takeBookPickResult", "()Ljava/lang/String;", &[])
                .map_err(|err| {
                    eprintln!("takeBookPickResult JNI call failed: {err}");
                    let _ = env.exception_clear();
                })
                .ok()?;
            let obj = value.l().ok()?;
            if obj.is_null() {
                return None;
            }
            let jstr = jni::objects::JString::from(obj);
            let text = env.get_string(&jstr).ok()?;
            Some(text.into())
        })();
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(2))
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn book_pick_poll() -> Option<String> {
    None
}

/// iOS counterpart: a small ObjC bridge in the Xcode project (see
/// gen/apple/Sources/read-aware-desktop/StatusBarBridge.m) installs a
/// `prefersStatusBarHidden` override on wry's root view controller and hops
/// to the main queue itself. The bridge lives in the app binary, which links
/// AFTER cargo builds this crate's cdylib — so the symbol is resolved at
/// runtime via dlsym instead of at link time.
#[cfg(target_os = "ios")]
#[tauri::command]
fn set_status_bar_hidden(hidden: bool) {
    use std::os::raw::{c_char, c_void};
    unsafe extern "C" {
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }
    // Apple's RTLD_DEFAULT: search every image in the process.
    const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;
    let ptr = unsafe { dlsym(RTLD_DEFAULT, c"ra_set_status_bar_hidden".as_ptr()) };
    if ptr.is_null() {
        eprintln!("set_status_bar_hidden: StatusBarBridge symbol not found");
        return;
    }
    let bridge: extern "C" fn(bool) = unsafe { std::mem::transmute(ptr) };
    bridge(hidden);
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
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
/// excluded. Windows walks DirectWrite's system font collection; Linux asks
/// fontconfig via `fc-list`. Anywhere else returns an empty list and the picker
/// falls back to the built-in presets. The frontend dedupes and sorts.
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

/// Windows: DirectWrite's system font collection. Family names prefer the
/// user's locale (a zh-CN system shows 中文 names, matching every native font
/// menu), then "en-us", then the first localized name DirectWrite has.
#[cfg(target_os = "windows")]
#[tauri::command]
fn list_system_fonts() -> Vec<String> {
    use windows::core::{w, BOOL};
    use windows::Win32::Globalization::GetUserDefaultLocaleName;
    use windows::Win32::Graphics::DirectWrite::{
        DWriteCreateFactory, IDWriteFactory, DWRITE_FACTORY_TYPE_SHARED,
    };

    let mut families: Vec<String> = Vec::new();
    unsafe {
        let Ok(factory) = DWriteCreateFactory::<IDWriteFactory>(DWRITE_FACTORY_TYPE_SHARED) else {
            return families;
        };
        let mut collection = None;
        if factory.GetSystemFontCollection(&mut collection, false).is_err() {
            return families;
        }
        let Some(collection) = collection else {
            return families;
        };

        // LOCALE_NAME_MAX_LENGTH buffer; > 1 means a real locale came back
        // (the count includes the NUL terminator).
        let mut locale_buf = [0u16; 85];
        let locale_len = GetUserDefaultLocaleName(&mut locale_buf);
        let user_locale =
            (locale_len > 1).then(|| windows::core::PCWSTR(locale_buf.as_ptr()));

        let count = collection.GetFontFamilyCount();
        families.reserve(count as usize);
        for index in 0..count {
            let Ok(family) = collection.GetFontFamily(index) else {
                continue;
            };
            let Ok(names) = family.GetFamilyNames() else {
                continue;
            };
            let mut name_index = 0u32;
            let mut exists = BOOL::default();
            if let Some(locale) = user_locale {
                let _ = names.FindLocaleName(locale, &mut name_index, &mut exists);
            }
            if !exists.as_bool() {
                let _ = names.FindLocaleName(w!("en-us"), &mut name_index, &mut exists);
            }
            if !exists.as_bool() {
                name_index = 0;
            }
            let Ok(len) = names.GetStringLength(name_index) else {
                continue;
            };
            let mut buf = vec![0u16; len as usize + 1];
            if names.GetString(name_index, &mut buf).is_ok() {
                buf.truncate(len as usize);
                families.push(String::from_utf16_lossy(&buf));
            }
        }
    }
    families
}

/// Linux: fontconfig owns the installed set; `fc-list` ships with it. A
/// missing binary (headless container) degrades to the built-in presets.
#[cfg(target_os = "linux")]
#[tauri::command]
fn list_system_fonts() -> Vec<String> {
    let Ok(output) = std::process::Command::new("fc-list")
        .args(["--format", "%{family[0]}\n"])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect()
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
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
        .manage(storage::BlobReadSessions::default())
        .manage(storage::BlobWriteSessions::default())
        .setup(|app| {
            let (conn, data_dir) =
                storage::init_db(app.handle()).expect("failed to initialize database");
            // Read the persisted theme preference BEFORE the main window exists
            // so the very first frame — window background and boot splash —
            // honors the in-app setting, not just the OS scheme. `None` means
            // "system" (or nothing stored): follow the OS.
            let boot_theme = storage::read_boot_theme(&conn);
            app.manage(storage::Db(Mutex::new(conn)));
            app.manage(storage::DataDir(data_dir));

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
            storage::list_event_aggregate_ids,
            storage::local_device_get,
            storage::put_blob,
            storage::get_blob,
            storage::delete_blob,
            storage::blob_read_open,
            storage::blob_read_chunk,
            storage::blob_read_close,
            storage::blob_write_open,
            storage::blob_write_chunk,
            storage::blob_write_commit,
            storage::blob_write_abort,
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
            storage::annotations_search,
            storage::annotation_get,
            storage::annotation_put,
            storage::annotation_delete,
            storage::memories_list_all,
            storage::memory_get,
            storage::memory_put,
            storage::ai_chat_load,
            storage::ai_chat_load_all,
            storage::ai_chat_list,
            storage::ai_chat_replace,
            storage::ai_chat_clear,
            read_book_file,
            book_read_open,
            book_read_chunk,
            book_read_close,
            set_status_bar_hidden,
            sync_safe_area,
            set_volume_key_capture,
            move_task_to_back,
            book_pick_start,
            book_pick_poll,
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
