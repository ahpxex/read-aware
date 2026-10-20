mod android_update;
mod app_environment;
mod book_folders;
mod book_metadata;
mod comic_metadata;
mod covers;
mod desktop_preferences;
mod desktop_startup;
mod desktop_update;
mod diagnostics;
mod error;
mod exit_coordination;
mod export_file;
mod external_open;
mod fb2_metadata;
mod file_associations;
mod fonts;
mod import;
mod local_api;
mod metadata;
mod mobi_metadata;
mod native_path;
mod pdf_metadata;
mod plugin_sandbox_policy;
mod plugin_updates;
mod plugins;
mod resource_images;
mod resources;
mod save_targets;
mod secrets;
mod storage;
mod storefront;
mod web_image_cache;
#[cfg(target_os = "macos")]
mod wheel_phase;
mod window_input;
#[cfg(desktop)]
mod window_state;

use tauri::Manager;

use error::CommandError;
use storage::blocking;
#[cfg(any(target_os = "macos", target_os = "android"))]
use storage::on_main_thread;

/// Open a picked book through the fs plugin (Android `content://` URIs too).
fn open_picked_book(app: &tauri::AppHandle, path: &str) -> Result<std::fs::File, CommandError> {
    use tauri_plugin_fs::{FsExt, OpenOptions};
    let file_path = path
        .parse::<tauri_plugin_fs::FilePath>()
        .map_err(|err| CommandError::internal(format!("Invalid file path {path}: {err}")))?;
    let mut options = OpenOptions::new();
    options.read(true);
    app.fs()
        .open(file_path, options)
        .map_err(|err| CommandError::context(&format!("Failed to open {path}"), err))
}

/// Cheap descriptor for a picker result. The webview needs the size for
/// duplicate detection and shelf metadata, but must not read the file to learn
/// it. Routes through the fs plugin so Android `content://` picks resolve too
/// (fstat on the provider's descriptor; pipe-backed providers report 0, which
/// the shelf tolerates — Android normally supplies sizes from the picker).
#[tauri::command]
async fn book_file_size(app: tauri::AppHandle, path: String) -> Result<u64, CommandError> {
    blocking("book_file_size", move || {
        let file = open_picked_book(&app, &path)?;
        file.metadata()
            .map(|metadata| metadata.len())
            .map_err(|err| {
                CommandError::context(&format!("Failed to inspect selected book {path}"), err)
            })
    })
    .await
}

/// Maximum head window `read_book_head` serves — plenty for format sniffing.
const BOOK_HEAD_MAX_BYTES: usize = 1024 * 1024;

/// First `length` bytes of a picked book, for content sniffing when the file
/// name carries no usable extension. Streams through the fs plugin (no Seek),
/// so pipe-backed content providers work too.
#[tauri::command]
async fn read_book_head(
    app: tauri::AppHandle,
    path: String,
    length: usize,
) -> Result<tauri::ipc::Response, CommandError> {
    use std::io::Read;
    blocking("read_book_head", move || {
        let file = open_picked_book(&app, &path)?;
        let capped = length.min(BOOK_HEAD_MAX_BYTES);
        let mut bytes = Vec::with_capacity(capped);
        file.take(capped as u64)
            .read_to_end(&mut bytes)
            .map_err(|err| CommandError::context(&format!("Failed to read {path}"), err))?;
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
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
async fn set_status_bar_hidden(app: tauri::AppHandle, hidden: bool) -> Result<(), CommandError> {
    on_main_thread(&app, move || {
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
    .await
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
async fn sync_safe_area(app: tauri::AppHandle) -> Result<(), CommandError> {
    on_main_thread(&app, move || {
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
    .await
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn sync_safe_area() {}

/// While captured, Android's volume keys navigate the reader — turning pages
/// or stepping a text-unit mode — instead of changing the volume (see
/// `MainActivity.dispatchKeyEvent`). The frontend captures while it holds a
/// claim on the keys. Off Android it is a no-op so the command still resolves
/// for `generate_handler!` — iOS offers no public API for volume-key capture.
#[cfg(target_os = "android")]
#[tauri::command]
async fn set_volume_key_capture(app: tauri::AppHandle, captured: bool) -> Result<(), CommandError> {
    on_main_thread(&app, move || {
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
    .await
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
async fn move_task_to_back(app: tauri::AppHandle) -> Result<(), CommandError> {
    on_main_thread(&app, move || {
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
    .await
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
async fn book_pick_start(app: tauri::AppHandle, generation: i32) -> Result<(), CommandError> {
    on_main_thread(&app, move || {
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
    .await
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
async fn book_pick_poll(app: tauri::AppHandle) -> Result<Option<String>, CommandError> {
    on_main_thread(&app, move || {
        (|| -> Option<String> {
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
        })()
    })
    .await
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn book_pick_poll() -> Option<String> {
    None
}

/// Same parked-result picker for font files (`MainActivity.startFontPick`).
/// Single-purpose twin of the book pick commands rather than a generalized
/// one, because the result lands in an activity field the request code owns.
#[cfg(target_os = "android")]
#[tauri::command]
async fn font_pick_start(app: tauri::AppHandle, generation: i32) -> Result<(), CommandError> {
    on_main_thread(&app, move || {
        use tao::platform::android::prelude::main_android_context;
        let Some(ctx) = main_android_context() else {
            log::warn!("fontPickStart: no android context yet");
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
            "startFontPick",
            "(I)V",
            &[jni::objects::JValue::Int(generation)],
        ) {
            log::error!("startFontPick JNI call failed: {err}");
            let _ = env.exception_clear();
        }
    })
    .await
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn font_pick_start(_generation: i32) {}

#[cfg(target_os = "android")]
#[tauri::command]
async fn font_pick_poll(app: tauri::AppHandle) -> Result<Option<String>, CommandError> {
    on_main_thread(&app, move || {
        (|| -> Option<String> {
            use tao::platform::android::prelude::main_android_context;
            let ctx = main_android_context()?;
            let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }.ok()?;
            let mut env = vm.attach_current_thread().ok()?;
            let activity = unsafe { jni::objects::JObject::from_raw(ctx.context_jobject.cast()) };
            let value = env
                .call_method(&activity, "takeFontPickResult", "()Ljava/lang/String;", &[])
                .map_err(|err| {
                    log::error!("takeFontPickResult JNI call failed: {err}");
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
        })()
    })
    .await
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn font_pick_poll() -> Option<String> {
    None
}

/// iOS counterpart: a small ObjC bridge in the Xcode project (see
/// gen/apple/Sources/read-aware-desktop/StatusBarBridge.m) installs a
/// `prefersStatusBarHidden` override on wry's root view controller and hops
/// to the main queue itself. The bridge is compiled into the app target, which
/// links AFTER cargo builds this crate, so this crate cannot name it. Looking
/// it up with dlsym failed in every release build (Xcode strips the
/// executable's export table), so the bridge hands its entry point over from a
/// load-time constructor instead — a link-time reference into this crate.
#[cfg(target_os = "ios")]
static STATUS_BAR_BRIDGE: std::sync::OnceLock<extern "C" fn(bool)> = std::sync::OnceLock::new();

#[cfg(target_os = "ios")]
#[no_mangle]
pub extern "C" fn ra_register_status_bar_bridge(bridge: extern "C" fn(bool)) {
    let _ = STATUS_BAR_BRIDGE.set(bridge);
}

#[cfg(target_os = "ios")]
#[tauri::command]
fn set_status_bar_hidden(hidden: bool) {
    match STATUS_BAR_BRIDGE.get() {
        Some(bridge) => bridge(hidden),
        None => log::error!("set_status_bar_hidden: StatusBarBridge was not registered"),
    }
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
async fn set_traffic_lights_visible(
    window: tauri::WebviewWindow,
    visible: bool,
) -> Result<(), CommandError> {
    let app = window.app_handle().clone();
    on_main_thread(&app, move || {
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
    })
    .await
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
#[tauri::command]
async fn list_system_fonts(app: tauri::AppHandle) -> Result<Vec<String>, CommandError> {
    // NSFontManager is AppKit: main thread only.
    #[cfg(target_os = "macos")]
    let fonts = on_main_thread(&app, system_fonts).await?;
    // DirectWrite enumeration and fc-list are blocking work.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let fonts = {
        let _ = app;
        blocking("list_system_fonts", || Ok(system_fonts())).await?
    };
    // Mobile: the picker offers its built-in presets.
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let fonts = {
        let _ = app;
        Vec::new()
    };
    Ok(fonts)
}

#[cfg(target_os = "macos")]
fn system_fonts() -> Vec<String> {
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
fn system_fonts() -> Vec<String> {
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
        if factory
            .GetSystemFontCollection(&mut collection, false)
            .is_err()
        {
            return families;
        }
        let Some(collection) = collection else {
            return families;
        };

        // LOCALE_NAME_MAX_LENGTH buffer; > 1 means a real locale came back
        // (the count includes the NUL terminator).
        let mut locale_buf = [0u16; 85];
        let locale_len = GetUserDefaultLocaleName(&mut locale_buf);
        let user_locale = (locale_len > 1).then(|| windows::core::PCWSTR(locale_buf.as_ptr()));

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
fn system_fonts() -> Vec<String> {
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
    let context = tauri::generate_context!();
    // This precedes even single-instance dispatch: a misconfigured local dev
    // launch must not forward events to the installed production application.
    // The mobile dev build is the generated Android/iOS project itself: it
    // carries the production package name by construction and has no
    // installed sibling to forward into, so only desktop dev must rename.
    app_environment::validate(context.config(), cfg!(all(dev, desktop)))
        .expect("unsafe ReadAware application identity");
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
    // Decorum supplies Windows' snap overlay. On macOS its resize delegate
    // resets traffic lights to hard-coded offsets, overriding our position.
    // Tauri owns their placement through trafficLightPosition instead.
    #[cfg(target_os = "windows")]
    let builder = builder.plugin(tauri_plugin_decorum::init());
    #[cfg(desktop)]
    let builder = builder
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
        // (CSP script-src allowlists this scheme; see docs/plugins/plugin-system.md §9).
        .register_uri_scheme_protocol("raplugin", |ctx, request| {
            plugins::serve_plugin_asset(ctx.app_handle(), request)
        })
        // Book covers: the shelf's <img src> reads straight from the blob
        // store (rablob://localhost/cover/<bookId>) — no base64 through IPC.
        .register_asynchronous_uri_scheme_protocol("rablob", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(covers::serve_blob(&app, request));
            });
        })
        .manage(android_update::AndroidUpdateState::default())
        .manage(desktop_update::DesktopUpdateState::default())
        .manage(exit_coordination::ExitCoordination::default())
        .manage(local_api::LocalApi::default())
        .manage(external_open::ExternalOpenQueue::new(launch_open_paths))
        .manage(save_targets::SaveTargets::default())
        .manage(storage::BlobReadSessions::default())
        .manage(storage::BlobWriteSessions::default())
        .manage(resources::ResourceFiles::default())
        .manage(resources::directories::DirectoryGrants::default())
        .manage(resources::external::ExternalPreviews::default())
        .setup(|app| {
            if let Err(error) = resources::external::initialize(app.handle()) {
                log::warn!("External resource startup cleanup pending: {error}");
            }
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_autostart::Builder::new()
                .app_name(app.config().identifier.clone())
                .build())?;
            // A deep link landing while the app runs should bring the window
            // forward — the user just clicked a sign-in link in their browser
            // or mail client. The URLs themselves are consumed by the
            // frontend through the plugin's JS API, not here.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    if !event.urls().iter().any(|url| external_open::is_app_link_scheme(url.scheme())) {
                        return;
                    }
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

            let backup_tasks = storage::backup_tasks::BackupTasks::default();
            backup_tasks.start_cleanup()?;
            app.manage(backup_tasks);

            // Disposable plaintext preparation is independent of DB recovery.
            // Cross-process leases protect live tasks; cleanup never blocks boot.
            let backup_staging = storage::backup_staging::BackupStaging::for_app(&app.path().app_data_dir()?);
            app.manage(backup_staging.clone());
            tauri::async_runtime::spawn_blocking(move || {
                match backup_staging.cleanup() {
                    Ok(report) if report.skipped > 0 || report.failed > 0 =>
                        log::warn!("backup staging cleanup incomplete: removed={}, active={}, skipped={}, failed={}", report.removed, report.active, report.skipped, report.failed),
                    Ok(report) if report.removed > 0 => log::info!("backup staging cleanup: removed={}, active={}", report.removed, report.active),
                    Ok(_) => {},
                    Err(error) => log::warn!("backup staging cleanup deferred: {error}"),
                }
            });

            // A failed migration or unreadable database is the most likely
            // real-world "app dies at launch" cause — make sure it is the
            // first thing the log file explains before the process goes down.
            let (mut conn, data_dir) = storage::init_db(app.handle()).map_err(|error| {
                log::error!("database initialization failed: {error}");
                error
            })?;
            // No IPC/Worker or background sync is running yet. Restore both
            // plugin files and private data before the webview can hydrate KV.
            plugin_updates::recover_at(&mut conn, &data_dir.join("plugins"))?;
            storage::plugin_assets::recover_all(&conn, &data_dir);
            // Read the persisted theme preference BEFORE the main window exists
            // so the very first frame — window background and boot splash —
            // honors the in-app setting, not just the OS scheme. `None` means
            // "system" (or nothing stored): follow the OS.
            let boot_theme = storage::read_boot_theme(&conn);
            desktop_preferences::initialize(app.handle(), &conn).map_err(|error| {
                log::error!("desktop preferences initialization failed: {error}");
                error
            })?;
            app.manage(storage::Db::new(conn));
            app.manage(storage::DataDir(data_dir));
            app.manage(storage::ImportSession::default());

            // A previous session may have died between staging pulled events
            // and the finishing replay (see `stage_remote_events`) — the
            // projections are then behind the log. Heal in the background;
            // reads racing it see the same staleness the crash left anyway,
            // and the replay is one transaction.
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let db = handle.state::<storage::Db>();
                    let data_dir = handle.state::<storage::DataDir>();
                    let result = db
                        .0
                        .lock()
                        .and_then(|mut conn| storage::finalize_staged_events_inner(&mut conn, &data_dir.0));
                    match result {
                        Ok(Some(report)) => log::info!(
                            "recovered staged sync events: replayed {} event(s)",
                            report.events_replayed
                        ),
                        Ok(None) => {}
                        Err(error) => {
                            log::error!("staged-event recovery failed: {error}");
                        }
                    }
                    let cleanup = storage::recover_book_removal_cleanup(&db, &data_dir.0);
                    if let Err(error) = cleanup {
                        log::warn!("book removal recovery deferred: {error}");
                    }
                    if let Err(error) = fonts::recover_user_font_removal_cleanup(&db, &data_dir.0) {
                        log::warn!("user font removal recovery deferred: {error}");
                    }
                    if let Err(error) = storage::recover_import_cleanup(&db, &data_dir.0, &handle.state::<storage::ImportSession>().0) {
                        log::warn!("interrupted import recovery deferred: {error}");
                    }
                });
            }

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
                tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?
                    .on_web_resource_request(plugin_sandbox_policy::apply);
            #[cfg(desktop)]
            {
                // Restore placement before the first visible frame.
                builder = builder.visible(false);
            }
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

            // macOS: real trackpad gesture phases for the reader's wheel
            // gestures (one page turn per physical swipe).
            #[cfg(target_os = "macos")]
            wheel_phase::install(app.handle().clone());
            #[cfg(target_os = "macos")]
            window_input::install();

            // No forced preference: the config painted light paper, so swap in
            // dark paper when the OS scheme is dark and a dark boot never
            // flashes light.
            if boot_theme.is_none() && matches!(window.theme(), Ok(tauri::Theme::Dark)) {
                let _ = window.set_background_color(Some(paper_color(true)));
            }

            #[cfg(desktop)]
            window_state::restore_and_track(&window)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(targets) = window.app_handle().try_state::<save_targets::SaveTargets>() {
                    targets.release_owner(window.label());
                }
                if let Some(tasks) = window.app_handle().try_state::<storage::backup_tasks::BackupTasks>() {
                    let tasks = tasks.inner().clone();
                    let owner = window.label().to_owned();
                    tauri::async_runtime::spawn_blocking(move || tasks.cancel_owner(&owner));
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            import::library_stage_import,
            storage::library_begin_import,
            storage::library_finish_import,
            web_image_cache::web_image_cache_get,
            web_image_cache::web_image_cache_put,
            covers::library_put_cover,
            covers::library_cover_backlog,
            covers::library_restore_local_cover,
            fonts::font_import_stage,
            fonts::user_fonts_list,
            fonts::user_font_blob_backlog,
            fonts::user_fonts_removal_backlog,
            fonts::user_fonts_release_files,
            font_pick_start,
            font_pick_poll,
            storage::append_events,
            storage::commit_events,
            storage::durable_agent_job_owners,
            storage::capability_changes_open,
            storage::capability_changes_read,
            storage::durable_job_create,
            storage::durable_job_get,
            storage::durable_job_list,
            storage::durable_job_checkpoint,
            storage::atomic_commit,
            storage::atomic_receipt_get,
            storage::atomic_aggregate_revisions,
            storage::virtual_books::virtual_book_create,
            storage::virtual_books::virtual_book_prune,
            storage::apply_remote_events,
            storage::stage_remote_events,
            storage::finalize_staged_events,
            storage::rebuild_projections,
            storage::verify_projections,
            storage::list_event_aggregate_ids,
            storage::local_device_get,
            storage::sync_profile_get,
            storage::sync_profile_set,
            storage::sync_profile_touch,
            storage::sync_adopt_account,
            storage::sync_outbox_counts,
            storage::sync_unverified_events,
            storage::sync_resolve_events,
            storage::sync_assume_events_missing,
            storage::sync_unverified_blobs,
            storage::sync_resolve_blobs,
            storage::sync_assume_blobs_missing,
            storage::checkpoint_schema_version,
            storage::checkpoint_maintain,
            storage::checkpoint_prepare_publish,
            storage::checkpoint_mark_published,
            storage::checkpoint_restore_bootstrap,
            storage::sync_backfill_status,
            storage::sync_backfill_events,
            storage::sync_backfill_settle,
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
            storage::sync_quota_rejected_blobs,
            storage::sync_requeue_blobs,
            storage::put_blob,
            storage::get_blob,
            storage::get_blob_info,
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
            local_api::local_api_attach,
            local_api::local_api_status,
            local_api::local_api_set_enabled,
            local_api::local_api_token,
            local_api::local_api_rotate_token,
            local_api::local_api_complete,
            storage::restored_credentials_pending,
            storage::restored_credentials_enqueue_current,
            storage::restored_credentials_publish,
            secrets::secret_keys,
            secrets::secret_set,
            secrets::secret_delete,
            storage::load_kv_all,
            storage::get_kv,
            storage::set_kv,
            storage::set_kv_batch,
            storage::delete_kv,
            storage::replace_kv_prefix,
            storage::library_load,
            storage::library_get_book,
            storage::library_put_book,
            storage::library_release_book_files,
            storage::library_list_removal_cleanup,
            storage::library_list_collections,
            storage::library_put_collection,
            storage::library_duplicate_groups,
            storage::library_merge_preview,
            storage::library_merge_commit,
            storage::library_resolve_book,
            storage::annotations_list,
            storage::annotations_search,
            storage::annotations_page,
            storage::annotation_inspect,
            storage::annotations_commit,
            storage::annotation_get,
            storage::annotation_put,
            storage::memories_list_all,
            storage::memories_page,
            storage::memory_inspect,
            storage::memory_commit,
            storage::profile_inspect,
            storage::profile_context,
            storage::context_bundle_source_revision,
            storage::context_bundle_publish,
            storage::conversation_insights_snapshot,
            storage::book_context_snapshot,
            storage::context_bundle_history,
            storage::context_bundle_read,
            storage::profile_initialize,
            storage::profile_commit,
            storage::onboarding_commit,
            storage::entity_query,
            storage::entity_commit,
            storage::identity_consolidation_snapshot,
            storage::identity_consolidation_commit,
            storage::identity_work_read,
            storage::identity_work_append,
            storage::identity_work_compact,
            storage::book_classification_inspect,
            storage::book_classification_commit,
            storage::book_digest_inspect,
            storage::book_digest_commit,
            storage::book_digest_receipt,
            storage::memory_create,
            storage::memories_snapshot,
            storage::memory_maintenance_commit,
            storage::chapter_digests_list,
            storage::memory_get,
            storage::memory_put,
            storage::ai_chat_load,
            storage::ai_chat_load_all,
            storage::ai_chat_list,
            storage::ai_chat_replace,
            storage::ai_chat_commit,
            storage::plugin_storage_usage::plugin_storage_usage,
            storage::plugin_docs_put,
            storage::plugin_docs_get,
            storage::plugin_docs_delete,
            storage::plugin_docs_list,
            storage::plugin_docs_page,
            storage::plugin_docs_apply,
            storage::plugin_docs_clear,
            storage::plugin_docs_snapshot,
            storage::plugin_docs_restore,
            storage::plugin_data_snapshot,
            storage::plugin_data_restore,
            storage::vocabulary_migrate_to_plugin_documents,
            storage::reading_time_genesis,
            storage::reading_time_load,
            storage::reading_time_snapshot,
            storage::reading_time_scope,
            storage::reading_session_accrue,
            storage::reading_session_position,
            storage::reading_sessions_pending,
            storage::reading_session_flush,
            storage::backup_close_reading_sessions,
            storage::backup_export::backup_export_sources,
            storage::backup_export::backup_export_capture,
            storage::backup_export::backup_export_choose_destination,
            storage::backup_export::backup_export_write,
            storage::backup_export::backup_export_cancel,
            storage::backup_import::backup_import_open,
            storage::backup_import::backup_import_plan,
            storage::backup_import::backup_import_cancel,
            storage::backup_import::backup_import_review,
            storage::backup_import::backup_import_choose_rows,
            storage::backup_import::backup_import_check_rows,
            storage::backup_import::backup_import_apply,
            storage::backup_import::backup_import_stage_program,
            storage::backup_import::backup_import_stage_storage,
            storage::reading_time_import,
            external_open::external_open_take,
            external_open::external_open_is_current,
            diagnostics::diagnostics_read_logs,
            diagnostics::diagnostics_log_dir,
            book_file_size,
            read_book_head,
            export_file::export_choose_target,
            export_file::write_export_file,
            resources::resource_open_file,
            resources::external::resource_open_associated,
            resources::directories::resource_open_directory,
            resources::directories::resource_list_directory,
            resources::directories::resource_open_directory_file,
            resources::directories::resource_release_directory,
            resources::resource_open_book,
            resources::resource_open_cover,
            resources::resource_store_plugin_asset,
            resources::resource_open_plugin_asset,
            storage::plugin_assets::plugin_asset_get,
            storage::plugin_assets::plugin_asset_list,
            storage::plugin_assets::plugin_asset_policy,
            storage::plugin_assets::plugin_asset_delete,
            resource_images::resource_copy_image,
            resource_images::resource_image_preview,
            resources::resource_create,
            resources::resource_append,
            resources::resource_commit,
            resources::resource_commit_context,
            resources::resource_read,
            resources::resource_save,
            resources::resource_release,
            android_update::android_update_check,
            android_update::android_update_install,
            desktop_update::desktop_update_check,
            desktop_startup::desktop_startup_enabled,
            exit_coordination::app_exit_confirm,
            desktop_update::desktop_update_install,
            set_status_bar_hidden,
            sync_safe_area,
            set_volume_key_capture,
            storefront::app_store_storefront,
            move_task_to_back,
            book_pick_start,
            book_pick_poll,
            book_folders::book_folder_pick,
            book_folders::book_folder_pick_start,
            book_folders::book_folder_pick_poll,
            book_folders::book_folder_release,
            set_traffic_lights_visible,
            window_input::window_input_revision,
            list_system_fonts,
            plugins::plugins_list,
            plugins::plugins_stage_dir,
            plugins::plugins_stage_zip,
            plugins::plugins_stage_files,
            plugins::plugins_commit_candidate,
            plugin_updates::plugins_update_begin,
            plugin_updates::plugins_update_get,
            plugin_updates::plugins_update_accept,
            plugin_updates::plugins_update_rollback,
            plugin_updates::plugins_update_finish,
            plugin_updates::plugins_recovery_status,
            plugins::plugins_discard_candidate,
            plugins::plugins_rollback,
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
        .build(context)
        .expect("error while building ReadAware desktop application");
    app.run(|_app_handle, _event| {
        // Preview expiry tasks retain AppHandles, so managed state may outlive
        // the event loop. Clean up at actual exit, after coordinated flushing.
        if matches!(&_event, tauri::RunEvent::Exit) {
            if let Err(error) = resources::external::shutdown(_app_handle) {
                log::warn!("External resource exit cleanup failed: {error}");
            }
        }

        #[cfg(desktop)]
        window_state::on_app_event(_app_handle, &_event);

        // A system exit request waits once for the webview's coordinated flush.
        if let tauri::RunEvent::ExitRequested { code, api, .. } = &_event {
            if !exit_coordination::on_exit_requested(_app_handle, *code) {
                api.prevent_exit();
            }
        }

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
