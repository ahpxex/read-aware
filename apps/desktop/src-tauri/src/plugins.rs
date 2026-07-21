//! Plugin file management + the `raplugin://` protocol.
//!
//! Plugins live under `<app_data>/plugins/<id>/` (docs/plugin-system.md §3).
//! This module is deliberately dumb: it moves folders and serves bytes. All
//! manifest semantics (permissions, activation) live web-side; the only
//! validation here is what filesystem safety requires (id shape, path
//! containment, no symlink following on install).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize, Clone)]
pub struct PluginEntry {
    /// Folder name under plugins/ — must equal manifest.id (web checks too).
    pub id: String,
    /// Raw manifest.json text; the frontend owns parsing + validation.
    pub manifest: String,
}

fn plugins_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Same shape the web-side manifest validator enforces: lowercase ASCII,
/// digits, hyphens; no leading hyphen; max 64 chars.
fn valid_plugin_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && !id.starts_with('-')
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[tauri::command]
pub fn plugins_list(app: tauri::AppHandle) -> Result<Vec<PluginEntry>, String> {
    let dir = plugins_dir(&app)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let Ok(file_type) = entry.file_type() else { continue };
        if !file_type.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if !valid_plugin_id(&id) {
            continue;
        }
        // A folder without a readable manifest is ignored, not an error — a
        // half-copied plugin must not break enumeration for the others.
        let Ok(manifest) = fs::read_to_string(entry.path().join("manifest.json")) else {
            continue;
        };
        entries.push(PluginEntry { id, manifest });
    }
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entries)
}

#[tauri::command]
pub fn plugins_install(app: tauri::AppHandle, src_dir: String) -> Result<PluginEntry, String> {
    let src = PathBuf::from(&src_dir);
    if !src.is_dir() {
        return Err("the selected path is not a folder".into());
    }
    let manifest = fs::read_to_string(src.join("manifest.json"))
        .map_err(|_| "manifest.json not found in the selected folder".to_string())?;
    // Extract the id only; full manifest validation is the frontend's job.
    let parsed: serde_json::Value =
        serde_json::from_str(&manifest).map_err(|e| format!("manifest.json is not valid JSON: {e}"))?;
    let id = parsed
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "manifest.id is missing".to_string())?
        .to_string();
    if !valid_plugin_id(&id) {
        return Err("manifest.id must be lowercase letters, digits, and hyphens".into());
    }

    let dest = plugins_dir(&app)?.join(&id);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    copy_dir(&src, &dest)?;
    Ok(PluginEntry { id, manifest })
}

/// Recursive copy of regular files and directories. Hidden entries (.git,
/// .DS_Store) and symlinks are skipped — a plugin is plain files only.
fn copy_dir(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dest.join(&name);
        if file_type.is_dir() {
            copy_dir(&from, &to)?;
        } else if file_type.is_file() {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn plugins_uninstall(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !valid_plugin_id(&id) {
        return Err("invalid plugin id".into());
    }
    let dir = plugins_dir(&app)?.join(&id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Serves `<app_data>/plugins/<path>` for `raplugin://localhost/<path>` (and
/// Windows' `http://raplugin.localhost/<path>`). Module scripts import
/// cross-origin, so responses carry a permissive CORS header; the CSP's
/// `script-src` is what actually scopes which origins may execute them.
pub fn serve_plugin_asset(
    app: &tauri::AppHandle,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    fn not_found() -> tauri::http::Response<Vec<u8>> {
        tauri::http::Response::builder()
            .status(404)
            .header("access-control-allow-origin", "*")
            .body(Vec::new())
            .unwrap()
    }

    let rel = request.uri().path().trim_start_matches('/').to_string();
    // Plain ASCII paths only — plugin folders are machine-named; rejecting
    // percent-escapes and dot segments outright beats decoding them.
    if rel.is_empty() || rel.contains("..") || rel.contains('%') || rel.contains('\\') {
        return not_found();
    }
    let Ok(base) = plugins_dir(app) else {
        return not_found();
    };
    let full = base.join(&rel);
    // Canonicalize both ends so the containment check holds through symlinks.
    let (Ok(canonical), Ok(canonical_base)) = (full.canonicalize(), base.canonicalize()) else {
        return not_found();
    };
    if !canonical.starts_with(&canonical_base) {
        return not_found();
    }
    let Ok(bytes) = fs::read(&canonical) else {
        return not_found();
    };

    let mime = match canonical.extension().and_then(|e| e.to_str()) {
        Some("js") | Some("mjs") => "text/javascript",
        Some("json") => "application/json",
        Some("css") => "text/css",
        Some("wasm") => "application/wasm",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        _ => "application/octet-stream",
    };
    tauri::http::Response::builder()
        .status(200)
        .header("content-type", mime)
        .header("access-control-allow-origin", "*")
        .body(bytes)
        .unwrap()
}
