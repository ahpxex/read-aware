mod android_update;
mod book_metadata;
mod desktop_update;
mod comic_metadata;
mod diagnostics;
mod external_open;
mod fb2_metadata;
mod metadata;
mod mobi_metadata;
mod native_path;
mod pdf_metadata;
mod plugins;
mod secrets;
mod storage;

use std::sync::Mutex;

use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_plugin_decorum::WebviewWindowExt;

/// Cheap descriptor for a picker result. The webview needs the size for
/// duplicate detection and shelf metadata, but must not read the file to learn
/// it. Routes through the fs plugin so Android `content://` picks resolve too
/// (fstat on the provider's descriptor; pipe-backed providers report 0, which
/// the shelf tolerates — Android normally supplies sizes from the picker).
#[tauri::command]
async fn book_file_size(app: tauri::AppHandle, path: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_fs::{FsExt, OpenOptions};
        let file_path = path
            .parse::<tauri_plugin_fs::FilePath>()
            .map_err(|err| format!("Invalid file path {path}: {err}"))?;
        let mut options = OpenOptions::new();
        options.read(true);
        let file = app
            .fs()
            .open(file_path, options)
            .map_err(|err| format!("Failed to open {path}: {err}"))?;
        file.metadata()
            .map(|metadata| metadata.len())
            .map_err(|err| format!("Failed to inspect selected book {path}: {err}"))
    })
    .await
    .map_err(|err| format!("book_file_size task failed: {err}"))?
}

/// Maximum head window `read_book_head` serves — plenty for format sniffing.
const BOOK_HEAD_MAX_BYTES: usize = 1024 * 1024;

/// First `length` bytes of a picked book, for content sniffing when the file
/// name carries no usable extension. Streams through the fs plugin (no Seek),
/// so pipe-backed content providers work too.
#[tauri::command]
fn read_book_head(
    app: tauri::AppHandle,
    path: String,
    length: usize,
) -> Result<tauri::ipc::Response, String> {
    use std::io::Read;
    use tauri_plugin_fs::{FsExt, OpenOptions};

    let file_path = path
        .parse::<tauri_plugin_fs::FilePath>()
        .map_err(|err| format!("Invalid file path {path}: {err}"))?;
    let mut options = OpenOptions::new();
    options.read(true);
    let file = app
        .fs()
        .open(file_path, options)
        .map_err(|err| format!("Failed to open {path}: {err}"))?;
    let capped = length.min(BOOK_HEAD_MAX_BYTES);
    let mut bytes = Vec::with_capacity(capped);
    file.take(capped as u64)
        .read_to_end(&mut bytes)
        .map_err(|err| format!("Failed to read {path}: {err}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Write exported content to a path chosen by the user in the native save
/// dialog. `base64: true` marks binary content that crossed the IPC encoded.
#[tauri::command]
async fn write_export_file(
    path: String,
    content: String,
    base64: Option<bool>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes: Vec<u8> = if base64.unwrap_or(false) {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD
                .decode(content.as_bytes())
                .map_err(|err| format!("invalid base64 export payload: {err}"))?
        } else {
            content.into_bytes()
        };
        std::fs::write(&path, bytes)
            .map_err(|err| format!("Failed to write exported file {path}: {err}"))
    })
    .await
    .map_err(|err| format!("write_export_file task failed: {err}"))?
}

#[cfg(target_os = "macos")]
fn inherit_system_proxy() {
    if std::env::var_os("HTTP_PROXY").is_some()
        || std::env::var_os("HTTPS_PROXY").is_some()
        || std::env::var_os("http_proxy").is_some()
        || std::env::var_os("https_proxy").is_some()
    {
        return;
    }
    let Ok(output) = std::process::Command::new("scutil").arg("--proxy").output() else {
        return;
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let get = |key: &str| -> Option<String> {
        text.lines()
            .find(|line| line.trim_start().starts_with(key))
            .and_then(|line| line.split(':').nth(1))
            .map(|value| value.trim().to_string())
    };
    let enabled = |key: &str| get(key).as_deref() == Some("1");
    if enabled("HTTPSEnable") {
        if let (Some(host), Some(port)) = (get("HTTPSProxy"), get("HTTPSPort")) {
            std::env::set_var("HTTPS_PROXY", format!("http://{host}:{port}"));
        }
    }
    if enabled("HTTPEnable") {
        if let (Some(host), Some(port)) = (get("HTTPProxy"), get("HTTPPort")) {
            std::env::set_var("HTTP_PROXY", format!("http://{host}:{port}"));
        }
    }
    std::env::set_var("NO_PROXY", "localhost,127.0.0.1,::1");
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
            log::warn!("setStatusBarHidden: no android context yet");
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
            log::error!("setStatusBarHidden JNI call failed: {err}");
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
            log::warn!("syncSafeArea: no android context yet");
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
            log::error!("syncSafeArea JNI call failed: {err}");
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
            log::warn!("setVolumeKeyCapture: no android context yet");
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
            log::error!("setVolumeKeyCapture JNI call failed: {err}");
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
            log::warn!("moveTaskToBack: no android context yet");
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
            log::error!("sendToBackground JNI call failed: {err}");
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
            log::warn!("bookPickStart: no android context yet");
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
            log::error!("startBookPick JNI call failed: {err}");
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
                    log::error!("takeBookPickResult JNI call failed: {err}");
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
        log::error!("set_status_bar_hidden: StatusBarBridge symbol not found");
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

/// Feed the webview ground-truth trackpad gesture phases.
///
/// A trackpad swipe reaches the DOM as an anonymous stream of wheel deltas:
/// the drag and its momentum tail are indistinguishable there, and the one bit
/// that separates "the same swipe still coasting" from "a new swipe" — whether
/// fingers are on the pad — is never exposed to JS. AppKit knows it exactly,
/// so a local NSEvent monitor watches every scroll-wheel event before dispatch
/// and emits just the transitions the reader's wheel-gesture logic needs:
///
/// - `"touch"`    — fingers landed on the pad (phase MayBegin/Began); this
///                  contact also cancels any running momentum
/// - `"momentum"` — fingers lifted and the momentum tail began
/// - `"end"`      — the momentum tail finished (or was cancelled)
///
/// A drag's own Ended phase is deliberately silent: momentum may still follow
/// it, and treating it as "gesture over" would free the gesture latch against
/// the swipe's leftover momentum. Legacy mouse wheels report no phases and
/// emit nothing — the JS side treats a phase-less stream as discrete notches.
///
/// The monitor runs in the app process, so these signals stay accurate even
/// while the webview's main thread is busy animating a page turn — the jank
/// that defeats any timing heuristic applied to the DOM delta stream.
#[cfg(target_os = "macos")]
fn install_scroll_phase_monitor(app: tauri::AppHandle) {
    use block::ConcreteBlock;
    use cocoa::base::id;
    use objc::{class, msg_send, sel, sel_impl};
    use tauri::Emitter;

    // NSEventMask bit for scroll-wheel events (1 << NSEventTypeScrollWheel).
    const SCROLL_WHEEL_MASK: u64 = 1 << 22;
    // NSEventPhase bits.
    const PHASE_BEGAN: u64 = 1 << 0;
    const PHASE_ENDED: u64 = 1 << 3;
    const PHASE_CANCELLED: u64 = 1 << 4;
    const PHASE_MAY_BEGIN: u64 = 1 << 5;

    let handler = ConcreteBlock::new(move |event: id| -> id {
        let phase: u64 = unsafe { msg_send![event, phase] };
        let momentum: u64 = unsafe { msg_send![event, momentumPhase] };
        let edge = if phase & (PHASE_MAY_BEGIN | PHASE_BEGAN) != 0 {
            Some("touch")
        } else if momentum & PHASE_BEGAN != 0 {
            Some("momentum")
        } else if momentum & (PHASE_ENDED | PHASE_CANCELLED) != 0 {
            Some("end")
        } else {
            None
        };
        if let Some(edge) = edge {
            let _ = app.emit("ra-wheel-phase", edge);
        }
        event
    })
    .copy();
    let monitor: id = unsafe {
        msg_send![
            class!(NSEvent),
            addLocalMonitorForEventsMatchingMask: SCROLL_WHEEL_MASK
            handler: &*handler
        ]
    };
    // Monitor and handler live for the whole app. The returned monitor object
    // is autoreleased, so retain it; there is no teardown path where
    // removeMonitor: would run before exit.
    let _: id = unsafe { msg_send![monitor, retain] };
    std::mem::forget(handler);
}

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

/// The rotating file log in the OS log dir — the only trace a user's machine
/// keeps of a production run (no console on Windows, no DevTools in release).
/// The webview's logger feeds the same file through the plugin's IPC command.
/// Info-level in release so the file stays quiet; ~5 MB × 4 files bounds disk.
fn build_log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
    tauri_plugin_log::Builder::default()
        .targets([
            Target::new(TargetKind::LogDir {
                file_name: Some("readaware".into()),
            }),
            Target::new(TargetKind::Stdout),
        ])
        .level(if cfg!(debug_assertions) {
            log::LevelFilter::Debug
        } else {
            log::LevelFilter::Info
        })
        // Transport crates narrate every connection at info; only their
        // problems belong in the file.
        .level_for("hyper", log::LevelFilter::Warn)
        .level_for("reqwest", log::LevelFilter::Warn)
        .level_for("rustls", log::LevelFilter::Warn)
        .level_for("tao", log::LevelFilter::Warn)
        .level_for("tracing", log::LevelFilter::Warn)
        // Dev-build noise: the updater dumps the whole release manifest at
        // debug, tungstenite narrates every MCP-bridge handshake.
        .level_for("tauri_plugin_updater", log::LevelFilter::Info)
        .level_for("tungstenite", log::LevelFilter::Warn)
        .rotation_strategy(RotationStrategy::KeepSome(4))
        .max_file_size(5_000_000)
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .build()
}

/// Route panics through the file logger before the default hook aborts. A
/// release panic is otherwise invisible: Windows builds drop the console
/// (`windows_subsystem = "windows"`) and the process dies before the webview
/// could show anything.
fn install_panic_log_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "non-string panic payload".into());
        let location = info
            .location()
            .map(|l| l.to_string())
            .unwrap_or_else(|| "unknown location".into());
        log::error!(target: "panic", "panic at {location}: {payload}");
        let backtrace = std::backtrace::Backtrace::force_capture();
        if backtrace.status() == std::backtrace::BacktraceStatus::Captured {
            log::error!(target: "panic", "backtrace:\n{backtrace}");
        }
        default_hook(info);
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before the builder: a panic anywhere past logger init must reach the
    // file. (Panics before the log plugin initializes still hit the chained
    // default hook and print to stderr, exactly as today.)
    install_panic_log_hook();
    // Our reqwest `rustls-no-provider` feature choice unifies onto every other
    // reqwest build in the tree — including wry's Android dev-server proxy
    // (RustWebViewClient.shouldInterceptRequest), which constructs a plain
    // `reqwest::Client`. Without a process-wide crypto provider that
    // construction is an abort (a panic in a nounwind JNI frame), killing the
    // app on its first intercepted request. Install ring once, up front — the
    // same provider android_update.rs configures explicitly for the updater.
    #[cfg(target_os = "android")]
    let _ = rustls::crypto::ring::default_provider().install_default();

    // Inherit the macOS system proxy (Clash & co.): reqwest only reads env
    // vars, so mirror scutil's settings into the process env before any HTTP
    // client is built. Explicit env from the launcher always wins.
    #[cfg(target_os = "macos")]
    inherit_system_proxy();

    // Cold-start file association (Windows/Linux): the OS hands the document
    // path over as a plain launch argument. macOS delivers documents through
    // RunEvent::Opened instead — see the run-loop callback at the bottom.
    #[cfg(desktop)]
    let launch_open_paths = external_open::collect_book_paths(
        std::env::args().skip(1),
        std::env::current_dir().ok().as_deref(),
    );
    #[cfg(not(desktop))]
    let launch_open_paths: Vec<String> = Vec::new();

    let builder = tauri::Builder::default();
    // Single-instance must be the FIRST plugin: a second launch (double-click
    // on an associated book while the app runs) must short-circuit here and
    // relay its argv before any other plugin initializes — two full instances
    // would race the SQLite database.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        external_open::park(
            app,
            external_open::collect_book_paths(
                args.iter().skip(1).map(String::as_str),
                Some(std::path::Path::new(&cwd)),
            ),
        );
    }));
    // Log plugin as early as the ordering constraints allow (single-instance
    // must stay first on desktop): every later plugin's init logs land in the
    // file from the first run.
    let builder = builder.plugin(build_log_plugin());
    // Desktop-only window chrome (macOS traffic-light repositioning); the
    // crate is not compiled for Android/iOS, where the webview is fullscreen.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_decorum::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    // `mut` is only exercised by the desktop-only MCP-bridge block below.
    #[cfg_attr(mobile, allow(unused_mut))]
    let mut builder = builder
        .plugin(tauri_plugin_dialog::init())
        // readaware:// links (sync sign-in hand-off). The frontend consumes
        // the URLs via the plugin's JS API — getCurrent() covers cold starts,
        // onOpenUrl the running app; the setup hook below only surfaces the
        // window when a link lands.
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Plugin ctx.fetch routes through Rust (no webview CORS constraints);
        // scope below is ACL-gated in capabilities/default.json.
        .plugin(tauri_plugin_http::init())
        // User plugins: serve <app_data>/plugins/ as same-scheme ES modules
        // (CSP script-src allowlists this scheme; see docs/plugin-system.md §9).
        .register_uri_scheme_protocol("raplugin", |ctx, request| {
            plugins::serve_plugin_asset(ctx.app_handle(), request)
        })
        .manage(android_update::AndroidUpdateState::default())
        .manage(desktop_update::DesktopUpdateState::default())
        .manage(external_open::ExternalOpenQueue(Mutex::new(launch_open_paths)))
        .manage(storage::BlobReadSessions::default())
        .manage(storage::BlobWriteSessions::default())
        .setup(|app| {
            // A deep link landing while the app runs should bring the window
            // forward — the user just clicked a sign-in link in their browser
            // or mail client. The URLs themselves are consumed by the
            // frontend through the plugin's JS API, not here.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |_event| {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                });
            }
            // Linux and dev-mode Windows only register schemes at install
            // time; force-register so `tauri dev` and AppImage runs get
            // working readaware:// links too. (macOS registration comes from
            // the app bundle's Info.plist; there is nothing to do at runtime.)
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            // A failed migration or unreadable database is the most likely
            // real-world "app dies at launch" cause — make sure it is the
            // first thing the log file explains before the process goes down.
            let (conn, data_dir) = storage::init_db(app.handle()).map_err(|error| {
                log::error!("database initialization failed: {error}");
                error
            })?;
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
            // Windows/Linux: no native frame — the web layer draws its own
            // caption controls in the header's top-right (WindowCaptionControls)
            // and, on Linux, edge resize zones (WindowResizeEdges). Windows
            // keeps native edge resizing through the window shadow. macOS stays
            // on the overlay title bar + traffic lights path below.
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                builder = builder.decorations(false);
            }
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

            // macOS: real trackpad gesture phases for the reader's wheel
            // gestures (one page turn per physical swipe).
            #[cfg(target_os = "macos")]
            install_scroll_phase_monitor(app.handle().clone());

            // No forced preference: the config painted light paper, so swap in
            // dark paper when the OS scheme is dark and a dark boot never
            // flashes light.
            if boot_theme.is_none() && matches!(window.theme(), Ok(tauri::Theme::Dark)) {
                let _ = window.set_background_color(Some(paper_color(true)));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            book_metadata::extract_epub_metadata,
            comic_metadata::extract_comic_metadata,
            fb2_metadata::extract_fb2_metadata,
            mobi_metadata::extract_mobi_metadata,
            pdf_metadata::extract_pdf_metadata,
            storage::append_events,
            storage::commit_events,
            storage::apply_remote_events,
            storage::rebuild_projections,
            storage::verify_projections,
            storage::read_events_since,
            storage::list_event_aggregate_ids,
            storage::local_device_get,
            storage::sync_profile_get,
            storage::sync_profile_set,
            storage::sync_profile_touch,
            storage::sync_adopt_account,
            storage::sync_outbox_counts,
            storage::sync_book_backlog,
            storage::preferences_load_all,
            storage::wipe_all_data,
            storage::sync_cursor_get,
            storage::sync_cursor_set,
            storage::sync_outbox_events,
            storage::sync_mark_events_pushed,
            storage::sync_mark_events_failed,
            storage::sync_outbox_blobs,
            storage::sync_mark_blobs_pushed,
            storage::sync_mark_blobs_failed,
            storage::sync_mark_blobs_rejected,
            storage::put_blob,
            storage::put_blob_from_file,
            storage::get_blob,
            storage::get_blob_info,
            storage::blob_manifest_exists,
            storage::get_blob_range,
            storage::delete_blob,
            storage::blob_read_open,
            storage::blob_read_chunk,
            storage::blob_read_close,
            storage::blob_write_open,
            storage::blob_write_chunk,
            storage::blob_write_chunk_raw,
            storage::blob_write_commit,
            storage::blob_write_abort,
            secrets::secret_get,
            secrets::secret_keys,
            secrets::secret_set,
            secrets::secret_delete,
            storage::load_kv_all,
            storage::set_kv,
            storage::delete_kv,
            storage::library_load,
            storage::library_get_book,
            storage::library_put_book,
            storage::library_set_book_cover,
            storage::library_release_book_files,
            storage::library_list_collections,
            storage::library_put_collection,
            storage::library_find_book_by_sha,
            storage::library_duplicate_book_groups,
            storage::annotations_list,
            storage::annotations_search,
            storage::annotation_get,
            storage::annotation_put,
            storage::annotation_delete,
            storage::memories_list_all,
            storage::chapter_digests_list,
            storage::memory_get,
            storage::memory_put,
            storage::ai_chat_load,
            storage::ai_chat_load_all,
            storage::ai_chat_list,
            storage::ai_chat_replace,
            storage::ai_chat_clear,
            storage::plugin_docs_put,
            storage::plugin_docs_get,
            storage::plugin_docs_delete,
            storage::plugin_docs_list,
            storage::plugin_docs_clear,
            storage::vocabulary_migrate_to_plugin_documents,
            storage::reading_time_genesis,
            storage::reading_time_load,
            storage::reading_time_record,
            storage::reading_time_import,
            external_open::external_open_take,
            diagnostics::diagnostics_read_logs,
            diagnostics::diagnostics_log_dir,
            book_file_size,
            read_book_head,
            write_export_file,
            android_update::android_update_check,
            android_update::android_update_install,
            desktop_update::desktop_update_check,
            desktop_update::desktop_update_install,
            set_status_bar_hidden,
            sync_safe_area,
            set_volume_key_capture,
            move_task_to_back,
            book_pick_start,
            book_pick_poll,
            set_traffic_lights_visible,
            list_system_fonts,
            plugins::plugins_list,
            plugins::plugins_read_manifest,
            plugins::plugins_install,
            plugins::plugins_install_zip,
            plugins::plugins_read_zip_manifest,
            plugins::plugins_install_files,
            plugins::plugins_uninstall,
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

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building ReadAware desktop application");
    app.run(|_app_handle, _event| {
        // macOS file associations deliver documents as Apple Events (cold and
        // warm start alike), never as argv — park them like every other path.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            external_open::park(
                _app_handle,
                urls.iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter(|path| external_open::is_book_path(path))
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect(),
            );
        }
    });
}
