//! Desktop update commands with channel support. The updater plugin's JS API
//! cannot change endpoints at runtime (they are baked into tauri.conf.json),
//! so the check runs through Rust's UpdaterBuilder instead: the webview
//! resolves WHICH release manifest to use (stable = the config default,
//! beta = the semver-largest release found via the GitHub API) and hands the
//! manifest URL here. The URL is allow-listed to our own GitHub release
//! assets, and integrity never rests on it anyway — every manifest and
//! artifact is verified against the minisign pubkey baked into the config.
//!
//! The updater plugin is a DESKTOP-ONLY dependency (Android updates through
//! its own APK path, iOS through the store), so like android_update.rs this
//! module compiles everywhere and swaps the bodies: mobile gets stubs the
//! frontend never calls.

use serde::Serialize;

#[derive(Default)]
pub struct DesktopUpdateState(
    #[cfg(desktop)] std::sync::Mutex<Option<tauri_plugin_updater::Update>>,
);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableDesktopUpdate {
    current_version: String,
    version: String,
}

/// Payload of the `ra-desktop-update-progress` event stream during install.
#[cfg(desktop)]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdateProgress {
    downloaded: u64,
    total: Option<u64>,
    finished: bool,
}

/// Only manifests that live under our own repo's release assets are accepted
/// as endpoint overrides: https://github.com/ahpxex/read-aware/releases/download/v…/latest.json
#[cfg(desktop)]
fn validate_manifest_url(raw: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(raw).map_err(|err| format!("Invalid manifest URL: {err}"))?;
    let path_ok = url
        .path()
        .strip_prefix("/ahpxex/read-aware/releases/download/v")
        .is_some_and(|rest| rest.ends_with("/latest.json"));
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !path_ok
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Manifest URL does not match the expected GitHub release asset".into());
    }
    Ok(url)
}

/// `endpoint: None` checks the config default (the newest STABLE release —
/// GitHub's `releases/latest` never includes pre-releases). A found update is
/// parked in state for `desktop_update_install`.
#[cfg(desktop)]
#[tauri::command]
pub async fn desktop_update_check(
    app: tauri::AppHandle,
    endpoint: Option<String>,
) -> Result<Option<AvailableDesktopUpdate>, String> {
    use tauri::Manager;
    use tauri_plugin_updater::UpdaterExt;

    let mut builder = app.updater_builder();
    if let Some(raw) = endpoint {
        let url = validate_manifest_url(&raw)?;
        builder = builder
            .endpoints(vec![url])
            .map_err(|err| format!("Could not set the update endpoint: {err}"))?;
    }
    let updater = builder
        .build()
        .map_err(|err| format!("Could not start the update check: {err}"))?;
    let update = updater
        .check()
        .await
        .map_err(|err| format!("Update check failed: {err}"))?;

    let state: tauri::State<'_, DesktopUpdateState> = app.state();
    let info = update.as_ref().map(|u| AvailableDesktopUpdate {
        current_version: u.current_version.clone(),
        version: u.version.clone(),
    });
    *state.0.lock().expect("desktop update state poisoned") = update;
    Ok(info)
}

/// Downloads and installs the parked update, streaming progress to the
/// webview as `ra-desktop-update-progress` events. The caller relaunches.
#[cfg(desktop)]
#[tauri::command]
pub async fn desktop_update_install(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{Emitter, Manager};

    let update = {
        let state: tauri::State<'_, DesktopUpdateState> = app.state();
        let taken = state.0.lock().expect("desktop update state poisoned").take();
        taken.ok_or_else(|| "No software update is ready to install.".to_string())?
    };

    let progress_app = app.clone();
    let finish_app = app.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit(
                    "ra-desktop-update-progress",
                    DesktopUpdateProgress { downloaded, total, finished: false },
                );
            },
            move || {
                let _ = finish_app.emit(
                    "ra-desktop-update-progress",
                    DesktopUpdateProgress { downloaded: 0, total: None, finished: true },
                );
            },
        )
        .await
        .map_err(|err| format!("Update install failed: {err}"))
}

// ── Mobile stubs: registered but never called (Android has android_update). ──

#[cfg(not(desktop))]
#[tauri::command]
pub async fn desktop_update_check(
    _endpoint: Option<String>,
) -> Result<Option<AvailableDesktopUpdate>, String> {
    Ok(None)
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn desktop_update_install() -> Result<(), String> {
    Err("Desktop updates are not available on this platform.".into())
}
