//! Plugin file management + the `raplugin://` protocol.
//!
//! Plugins live under `<app_data>/plugins/<id>/` (docs/plugin-system.md §3).
//! This module is deliberately dumb: it moves folders and serves bytes. All
//! manifest semantics (permissions, activation) live web-side; the only
//! validation here is what filesystem safety requires (id shape, path
//! containment, no symlink following on install).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use include_dir::{include_dir, Dir};
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize, Clone)]
pub struct PluginEntry {
    /// Folder name under plugins/ — must equal manifest.id (web checks too).
    pub id: String,
    /// Raw manifest.json text; the frontend owns parsing + validation.
    pub manifest: String,
    /// Shipped inside the app bundle (bundled-plugins/): not uninstallable,
    /// enabled by default, updated with the app.
    pub builtin: bool,
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

// ─── Built-in plugins ────────────────────────────────────────────────────────
//
// Embedded at compile time and extracted to `<app_data>/bundled-plugins/`
// once per app version. They used to ship as `bundle.resources`, which only
// exists as a readable directory on DESKTOP — Android's `resource_dir()` is
// the literal URI `asset://localhost/` (APK assets are not a filesystem), so
// resource-based built-ins simply vanished there. Embedding gives every
// platform the same real-filesystem root, which `plugins_list` and the
// `raplugin://` protocol already know how to serve.
//
// Adding a first-party plugin means one static + one table row here (this
// replaced the tauri.conf resources list).

static BUNDLED_DICTIONARY: Dir =
    include_dir!("$CARGO_MANIFEST_DIR/../../../plugins/dictionary/dist");
static BUNDLED_EDITORIAL_THEMES: Dir =
    include_dir!("$CARGO_MANIFEST_DIR/../../../plugins/editorial-themes/dist");
static BUNDLED_RSS_READER: Dir =
    include_dir!("$CARGO_MANIFEST_DIR/../../../plugins/rss-reader/dist");
static BUNDLED_SENTENCE_READER: Dir =
    include_dir!("$CARGO_MANIFEST_DIR/../../../plugins/sentence-reader/dist");
static BUNDLED_TTS: Dir = include_dir!("$CARGO_MANIFEST_DIR/../../../plugins/tts/dist");

static BUNDLED: &[(&str, &Dir)] = &[
    ("dictionary", &BUNDLED_DICTIONARY),
    ("editorial-themes", &BUNDLED_EDITORIAL_THEMES),
    ("rss-reader", &BUNDLED_RSS_READER),
    ("sentence-reader", &BUNDLED_SENTENCE_READER),
    ("tts", &BUNDLED_TTS),
];

/// Where the built-in set lives at runtime.
enum BundledRoot {
    /// `<dir>/<id>/…` — extracted from the embedded set.
    Extracted(PathBuf),
    /// Dev checkout: `<plugins>/<id>/dist/…`, served live so a rebuilt
    /// plugin is picked up on the next request without restarting the app.
    #[cfg(debug_assertions)]
    RepoDist(PathBuf),
}

impl BundledRoot {
    /// The directory holding one bundled plugin's files.
    fn plugin_dir(&self, id: &str) -> PathBuf {
        match self {
            BundledRoot::Extracted(dir) => dir.join(id),
            #[cfg(debug_assertions)]
            BundledRoot::RepoDist(plugins) => plugins.join(id).join("dist"),
        }
    }

    /// Bundled plugin ids present at this root.
    fn ids(&self) -> Vec<String> {
        let base = match self {
            BundledRoot::Extracted(dir) => dir.clone(),
            #[cfg(debug_assertions)]
            BundledRoot::RepoDist(plugins) => plugins.clone(),
        };
        let Ok(read) = fs::read_dir(&base) else {
            return Vec::new();
        };
        read.filter_map(|entry| {
            let entry = entry.ok()?;
            let id = entry.file_name().to_string_lossy().to_string();
            self.plugin_dir(&id)
                .join("manifest.json")
                .is_file()
                .then_some(id)
        })
        .collect()
    }
}

/// Extract the embedded set (once per app version) and return its root.
fn extract_bundled(app: &tauri::AppHandle) -> Option<PathBuf> {
    let base = app.path().app_data_dir().ok()?.join("bundled-plugins");
    let stamp_path = base.join(".version");
    let version = app.package_info().version.to_string();
    if fs::read_to_string(&stamp_path).ok().as_deref() == Some(version.as_str()) {
        return Some(base);
    }
    let _ = fs::remove_dir_all(&base);
    let extract = || -> std::io::Result<()> {
        for (id, dir) in BUNDLED {
            extract_tree(dir, &base.join(id))?;
        }
        fs::write(&stamp_path, &version)
    };
    if let Err(error) = extract() {
        eprintln!("[plugins] extracting bundled plugins failed: {error}");
        return None;
    }
    Some(base)
}

/// Write an embedded tree to disk. `File::path()` is relative to the
/// include_dir! root at every depth, so one target base serves all levels.
fn extract_tree(dir: &Dir, target: &Path) -> std::io::Result<()> {
    for file in dir.files() {
        let dest = target.join(file.path());
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(dest, file.contents())?;
    }
    for sub in dir.dirs() {
        extract_tree(sub, target)?;
    }
    Ok(())
}

/// Resolved once per process — the version cannot change mid-run.
fn bundled_root(app: &tauri::AppHandle) -> Option<&'static BundledRoot> {
    static ROOT: OnceLock<Option<BundledRoot>> = OnceLock::new();
    ROOT.get_or_init(|| {
        #[cfg(debug_assertions)]
        {
            let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../plugins");
            if repo.is_dir() {
                return Some(BundledRoot::RepoDist(repo));
            }
        }
        extract_bundled(app).map(BundledRoot::Extracted)
    })
    .as_ref()
}

fn list_plugin_dirs(dir: &Path, builtin: bool, entries: &mut Vec<PluginEntry>) {
    let Ok(read) = fs::read_dir(dir) else { return };
    for entry in read {
        let Ok(entry) = entry else { continue };
        let Ok(file_type) = entry.file_type() else { continue };
        if !file_type.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if !valid_plugin_id(&id) || entries.iter().any(|e| e.id == id) {
            continue;
        }
        let Ok(manifest) = fs::read_to_string(entry.path().join("manifest.json")) else {
            continue;
        };
        entries.push(PluginEntry { id, manifest, builtin });
    }
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
    let mut entries: Vec<PluginEntry> = Vec::new();
    // Bundled first — a bundled id shadows any user-dir copy of the same id.
    // A folder without a readable manifest is ignored, not an error — a
    // half-copied plugin must not break enumeration for the others.
    if let Some(root) = bundled_root(&app) {
        for id in root.ids() {
            if !valid_plugin_id(&id) || entries.iter().any(|e| e.id == id) {
                continue;
            }
            let Ok(manifest) = fs::read_to_string(root.plugin_dir(&id).join("manifest.json"))
            else {
                continue;
            };
            entries.push(PluginEntry { id, manifest, builtin: true });
        }
    }
    list_plugin_dirs(&plugins_dir(&app)?, false, &mut entries);
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
    Ok(PluginEntry { id, manifest, builtin: false })
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

/// Read a candidate folder's manifest WITHOUT installing — the consent dialog
/// must show permissions before any files are copied.
#[tauri::command]
pub fn plugins_read_manifest(src_dir: String) -> Result<String, String> {
    let src = PathBuf::from(&src_dir);
    if !src.is_dir() {
        return Err("the selected path is not a folder".into());
    }
    fs::read_to_string(src.join("manifest.json"))
        .map_err(|_| "manifest.json not found in the selected folder".to_string())
}

#[derive(serde::Deserialize)]
pub struct PluginFile {
    pub path: String,
    pub content: String,
    /// `"base64"` for binary payloads (fonts, images); absent/other = UTF-8.
    pub encoding: Option<String>,
}

/// Marketplace install: the webview fetches the plugin's files (CSP owns
/// the network policy) and hands them here to be written under plugins/<id>.
#[tauri::command]
pub fn plugins_install_files(
    app: tauri::AppHandle,
    id: String,
    files: Vec<PluginFile>,
) -> Result<PluginEntry, String> {
    if !valid_plugin_id(&id) {
        return Err("invalid plugin id".into());
    }
    let manifest = files
        .iter()
        .find(|file| file.path == "manifest.json")
        .ok_or_else(|| "manifest.json missing".to_string())?
        .content
        .clone();
    let parsed: serde_json::Value =
        serde_json::from_str(&manifest).map_err(|e| format!("manifest.json is not valid JSON: {e}"))?;
    if parsed.get("id").and_then(|v| v.as_str()) != Some(id.as_str()) {
        return Err("manifest.id does not match the requested plugin id".into());
    }

    // Strict positive validation: forward-slash-separated components of
    // [A-Za-z0-9._-] only, never starting with a dot. This excludes absolute
    // paths, `..`, backslashes, and Windows drive-relative forms (`C:x`) by
    // construction rather than by enumerating bad shapes.
    fn valid_payload_path(path: &str) -> bool {
        !path.is_empty()
            && path.len() <= 256
            && path.split('/').all(|part| {
                !part.is_empty()
                    && !part.starts_with('.')
                    && part
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
            })
    }
    for file in &files {
        if !valid_payload_path(&file.path) {
            return Err(format!("invalid file path in plugin payload: {}", file.path));
        }
    }

    let dest = plugins_dir(&app)?.join(&id);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    for file in &files {
        let target = dest.join(&file.path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let bytes: Vec<u8> = if file.encoding.as_deref() == Some("base64") {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD
                .decode(&file.content)
                .map_err(|e| format!("invalid base64 payload for {}: {e}", file.path))?
        } else {
            file.content.clone().into_bytes()
        };
        fs::write(&target, bytes).map_err(|e| e.to_string())?;
    }
    Ok(PluginEntry { id, manifest, builtin: false })
}

#[tauri::command]
pub fn plugins_uninstall(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(root) = bundled_root(&app) {
        if root.plugin_dir(&id).join("manifest.json").is_file() {
            return Err(format!("\"{id}\" is a built-in plugin and cannot be uninstalled"));
        }
    }
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
    // Bundled root first (a bundled id shadows a user-dir copy, matching
    // plugins_list), then the user dir; containment is canonicalized per
    // candidate. `rel` is `<plugin id>/<file path>`.
    let mut candidates: Vec<(PathBuf, PathBuf)> = Vec::new();
    if let Some((id, rest)) = rel.split_once('/') {
        if let Some(root) = bundled_root(app) {
            let base = root.plugin_dir(id);
            let full = base.join(rest);
            candidates.push((base, full));
        }
    }
    if let Ok(user) = plugins_dir(app) {
        let full = user.join(&rel);
        candidates.push((user, full));
    }
    let mut resolved: Option<PathBuf> = None;
    for (base, full) in candidates {
        // Canonicalize both ends so the containment check holds through symlinks.
        let (Ok(canonical), Ok(canonical_base)) = (full.canonicalize(), base.canonicalize())
        else {
            continue;
        };
        if canonical.starts_with(&canonical_base) && canonical.is_file() {
            resolved = Some(canonical);
            break;
        }
    }
    let Some(canonical) = resolved else {
        return not_found();
    };
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
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        _ => "application/octet-stream",
    };
    tauri::http::Response::builder()
        .status(200)
        .header("content-type", mime)
        .header("access-control-allow-origin", "*")
        .body(bytes)
        .unwrap()
}

// ─── Zip install ─────────────────────────────────────────────────────────────

/// Find the archive's manifest: at the root, or exactly one folder deep
/// (GitHub-style archives wrap everything in a single top directory). Returns
/// the manifest text plus the entry-name prefix to strip when extracting.
fn zip_manifest(path: &Path) -> Result<(String, String), String> {
    use std::io::Read as _;
    let file = fs::File::open(path).map_err(|e| format!("cannot open zip: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("not a valid zip archive: {e}"))?;

    let mut found: Option<String> = None;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().replace('\\', "/");
        if name == "manifest.json" {
            found = Some(name);
            break;
        }
        if name.ends_with("/manifest.json") && name.matches('/').count() == 1 {
            if found.is_some() {
                return Err("the zip contains more than one plugin folder".into());
            }
            found = Some(name);
        }
    }
    let entry_name = found.ok_or_else(|| "manifest.json not found in the zip".to_string())?;
    let prefix = entry_name.trim_end_matches("manifest.json").to_string();

    let mut manifest = String::new();
    archive
        .by_name(&entry_name)
        .map_err(|e| e.to_string())?
        .read_to_string(&mut manifest)
        .map_err(|e| e.to_string())?;
    Ok((manifest, prefix))
}

/// Read a candidate zip's manifest WITHOUT extracting — consent first.
#[tauri::command]
pub fn plugins_read_zip_manifest(zip_path: String) -> Result<String, String> {
    Ok(zip_manifest(&PathBuf::from(&zip_path))?.0)
}

/// Install a plugin from a zip archive. Same contract as `plugins_install`:
/// id from the manifest, replace-in-place, plain files only (hidden entries,
/// __MACOSX, and anything path-traversing is skipped).
#[tauri::command]
pub fn plugins_install_zip(app: tauri::AppHandle, zip_path: String) -> Result<PluginEntry, String> {
    let path = PathBuf::from(&zip_path);
    let (manifest, prefix) = zip_manifest(&path)?;
    let parsed: serde_json::Value = serde_json::from_str(&manifest)
        .map_err(|e| format!("manifest.json is not valid JSON: {e}"))?;
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
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        if entry.is_dir() || entry.enclosed_name().is_none() {
            continue;
        }
        let name = entry.name().replace('\\', "/");
        let Some(relative) = name.strip_prefix(prefix.as_str()) else {
            continue;
        };
        if relative.is_empty()
            || relative
                .split('/')
                .any(|part| part.is_empty() || part.starts_with('.') || part == "__MACOSX")
        {
            continue;
        }
        let target = dest.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = fs::File::create(&target).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(PluginEntry { id, manifest, builtin: false })
}
