//! Plugin file management + the `raplugin://` protocol.
//!
//! Plugins live under `<app_data>/plugins/<id>/` (docs/plugins/plugin-system.md §3).
//! This module is deliberately dumb: it moves folders and serves bytes. All
//! manifest semantics (permissions, activation) live web-side; the only
//! validation here is what filesystem safety requires (id shape, path
//! containment, no symlink following on install).

use crate::tauri_error::tauri_error;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

use crate::error::{
    CommandError, CODE_PLUGIN_BUILT_IN, CODE_PLUGIN_CANDIDATE_STALE, CODE_PLUGIN_INVALID_ARGUMENT,
    CODE_PLUGIN_INVALID_PACKAGE, CODE_PLUGIN_NO_PREVIOUS_VERSION,
};
use crate::storage::blocking;

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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginCandidate {
    pub token: String,
    pub id: String,
    pub manifest: String,
}

fn invalid_package(message: impl Into<String>) -> CommandError {
    CommandError::new(CODE_PLUGIN_INVALID_PACKAGE, message)
}

fn invalid_id() -> CommandError {
    CommandError::new(CODE_PLUGIN_INVALID_ARGUMENT, "invalid plugin id")
}

fn retired(id: &str) -> CommandError {
    CommandError::new(
        CODE_PLUGIN_BUILT_IN,
        format!("\"{id}\" belonged to a retired built-in plugin and cannot be installed"),
    )
}

fn built_in(id: &str, action: &str) -> CommandError {
    CommandError::new(
        CODE_PLUGIN_BUILT_IN,
        format!("\"{id}\" is a built-in plugin and cannot be {action}"),
    )
}

pub(crate) fn plugins_dir(app: &tauri::AppHandle) -> Result<PathBuf, CommandError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(tauri_error)?
        .join("plugins");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn candidates_dir(plugins: &Path) -> PathBuf {
    plugins.join(".candidates")
}

fn rollback_dir(plugins: &Path) -> PathBuf {
    plugins.join(".rollback")
}

fn valid_candidate_token(token: &str) -> bool {
    uuid::Uuid::parse_str(token).is_ok()
}

fn manifest_id(manifest: &str) -> Result<String, CommandError> {
    let parsed: serde_json::Value = serde_json::from_str(manifest)
        .map_err(|e| invalid_package(format!("manifest.json is not valid JSON: {e}")))?;
    let id = parsed
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| invalid_package("manifest.id is missing"))?
        .to_string();
    if !valid_plugin_id(&id) {
        return Err(invalid_package(
            "manifest.id must be lowercase letters, digits, and hyphens",
        ));
    }
    if retired_plugin_id(&id) {
        return Err(retired(&id));
    }
    Ok(id)
}

pub(crate) fn candidate_at(
    plugins: &Path,
    token: &str,
) -> Result<(PathBuf, PluginCandidate), CommandError> {
    if !valid_candidate_token(token) {
        return Err(CommandError::new(
            CODE_PLUGIN_CANDIDATE_STALE,
            "invalid plugin candidate token",
        ));
    }
    let path = candidates_dir(plugins).join(token);
    let manifest = fs::read_to_string(path.join("manifest.json")).map_err(|error| {
        CommandError::context_coded(
            CODE_PLUGIN_CANDIDATE_STALE,
            "plugin candidate is missing manifest.json",
            error,
        )
    })?;
    let id = manifest_id(&manifest)?;
    Ok((
        path,
        PluginCandidate {
            token: token.to_string(),
            id,
            manifest,
        },
    ))
}

fn fresh_candidate_paths(plugins: &Path) -> Result<(String, PathBuf, PathBuf), CommandError> {
    let root = candidates_dir(plugins);
    fs::create_dir_all(&root)?;
    let token = uuid::Uuid::new_v4().to_string();
    let staged = root.join(&token);
    let temp = root.join(format!(".staging-{token}"));
    Ok((token, temp, staged))
}

/// Build a candidate in `temp`, then publish it under its token in one
/// rename. A failed build never leaves a half-written candidate behind.
fn finalize_candidate(
    temp: &Path,
    staged: &Path,
    build: impl FnOnce() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    let result = build().and_then(|()| {
        fs::rename(temp, staged)
            .map_err(|e| CommandError::context("could not finalize plugin candidate", e))
    });
    if result.is_err() {
        if let Err(error) = fs::remove_dir_all(temp) {
            log::warn!("abandoned plugin candidate cleanup deferred: {error}");
        }
    }
    result
}

fn recover_interrupted_commits(plugins: &Path) -> Result<(), CommandError> {
    let rollback = rollback_dir(plugins);
    if let Ok(entries) = fs::read_dir(&rollback) {
        for entry in entries.flatten() {
            let id = entry.file_name().to_string_lossy().to_string();
            let backup = entry.path();
            let active = plugins.join(&id);
            if valid_plugin_id(&id) && !active.exists() && backup.join("manifest.json").is_file() {
                fs::rename(&backup, &active).map_err(|e| {
                    CommandError::context("could not recover interrupted plugin update", e)
                })?;
            }
        }
    }
    if let Ok(entries) = fs::read_dir(plugins) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(".installing-") || name.starts_with(".failed-") {
                // Leftovers are retried on the next enumeration.
                if let Err(error) = fs::remove_dir_all(entry.path()) {
                    log::warn!("plugin install leftover {name} cleanup deferred: {error}");
                }
            }
        }
    }
    Ok(())
}

#[path = "plugin_bundled.rs"]
mod bundled;
use bundled::bundled_root;
pub(crate) use bundled::{backup_programs, BundledPrograms};

fn list_plugin_dirs(dir: &Path, builtin: bool, entries: &mut Vec<PluginEntry>) {
    let Ok(read) = fs::read_dir(dir) else { return };
    for entry in read {
        let Ok(entry) = entry else { continue };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        // A folder copied in under a retired id never loads (see RETIRED_PLUGIN_IDS).
        if !valid_plugin_id(&id) || retired_plugin_id(&id) || entries.iter().any(|e| e.id == id) {
            continue;
        }
        let Ok(manifest) = fs::read_to_string(entry.path().join("manifest.json")) else {
            continue;
        };
        entries.push(PluginEntry {
            id,
            manifest,
            builtin,
        });
    }
}

use read_aware_store::plugin_id::retired_plugin_id;
pub(crate) use read_aware_store::plugin_id::valid_plugin_id;

fn is_bundled(app: &tauri::AppHandle, id: &str) -> bool {
    bundled_root(app).is_some_and(|root| root.plugin_dir(id).join("manifest.json").is_file())
}

#[tauri::command]
pub async fn plugins_list(app: tauri::AppHandle) -> Result<Vec<PluginEntry>, CommandError> {
    blocking("plugins_list", move || {
        let mut entries: Vec<PluginEntry> = Vec::new();
        let user_plugins = plugins_dir(&app)?;
        recover_interrupted_commits(&user_plugins)?;
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
                entries.push(PluginEntry {
                    id,
                    manifest,
                    builtin: true,
                });
            }
        }
        list_plugin_dirs(&user_plugins, false, &mut entries);
        entries.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(entries)
    })
    .await
}

/// Copy a selected folder into an inert, versioned candidate directory. Nothing
/// under the active `<plugins>/<id>` path is touched here.
#[tauri::command]
pub async fn plugins_stage_dir(
    app: tauri::AppHandle,
    src_dir: String,
) -> Result<PluginCandidate, CommandError> {
    blocking("plugins_stage_dir", move || {
        let src = PathBuf::from(&src_dir);
        if !src.is_dir() {
            return Err(invalid_package("the selected path is not a folder"));
        }
        let manifest = fs::read_to_string(src.join("manifest.json")).map_err(|error| {
            CommandError::context_coded(
                CODE_PLUGIN_INVALID_PACKAGE,
                "manifest.json not found in the selected folder",
                error,
            )
        })?;
        let id = manifest_id(&manifest)?;
        let plugins = plugins_dir(&app)?;
        let (token, temp, staged) = fresh_candidate_paths(&plugins)?;
        finalize_candidate(&temp, &staged, || copy_dir(&src, &temp))?;
        Ok(PluginCandidate {
            token,
            id,
            manifest,
        })
    })
    .await
}

/// Recursive copy of regular files and directories. Hidden entries (.git,
/// .DS_Store) and symlinks are skipped — a plugin is plain files only.
pub(crate) fn copy_dir(src: &Path, dest: &Path) -> Result<(), CommandError> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let file_type = entry.file_type()?;
        let from = entry.path();
        let to = dest.join(&name);
        if file_type.is_dir() {
            copy_dir(&from, &to)?;
        } else if file_type.is_file() {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct PluginFile {
    pub path: String,
    pub content: String,
    /// `"base64"` for binary payloads (fonts, images); absent/other = UTF-8.
    pub encoding: Option<String>,
}

/// Strict positive validation: forward-slash-separated components of
/// [A-Za-z0-9._-] only, never starting with a dot. This excludes absolute
/// paths, `..`, backslashes, and Windows drive-relative forms (`C:x`) by
/// construction rather than by enumerating bad shapes.
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

/// Marketplace staging: the webview fetches files (CSP owns network policy)
/// and Rust writes them to an inert candidate directory.
#[tauri::command]
pub async fn plugins_stage_files(
    app: tauri::AppHandle,
    id: String,
    files: Vec<PluginFile>,
) -> Result<PluginCandidate, CommandError> {
    blocking("plugins_stage_files", move || {
        if !valid_plugin_id(&id) {
            return Err(invalid_id());
        }
        let manifest = files
            .iter()
            .find(|file| file.path == "manifest.json")
            .ok_or_else(|| invalid_package("manifest.json missing"))?
            .content
            .clone();
        if manifest_id(&manifest)? != id {
            return Err(invalid_package(
                "manifest.id does not match the requested plugin id",
            ));
        }
        if let Some(file) = files.iter().find(|file| !valid_payload_path(&file.path)) {
            return Err(invalid_package(format!(
                "invalid file path in plugin payload: {}",
                file.path
            )));
        }

        let plugins = plugins_dir(&app)?;
        let (token, temp, staged) = fresh_candidate_paths(&plugins)?;
        finalize_candidate(&temp, &staged, || {
            for file in &files {
                let target = temp.join(&file.path);
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)?;
                }
                let bytes: Vec<u8> = if file.encoding.as_deref() == Some("base64") {
                    use base64::Engine as _;
                    base64::engine::general_purpose::STANDARD
                        .decode(&file.content)
                        .map_err(|e| {
                            invalid_package(format!(
                                "invalid base64 payload for {}: {e}",
                                file.path
                            ))
                        })?
                } else {
                    file.content.clone().into_bytes()
                };
                fs::write(&target, bytes)?;
            }
            Ok(())
        })?;
        Ok(PluginCandidate {
            token,
            id,
            manifest,
        })
    })
    .await
}

pub(crate) fn commit_candidate_at(
    plugins: &Path,
    token: &str,
) -> Result<PluginEntry, CommandError> {
    let (candidate_path, candidate) = candidate_at(plugins, token)?;
    let active_path = plugins.join(&candidate.id);
    let rollback_root = rollback_dir(plugins);
    let rollback_path = rollback_root.join(&candidate.id);
    let installing_path = plugins.join(format!(".installing-{}", uuid::Uuid::new_v4()));

    fs::create_dir_all(&rollback_root)?;
    if let Err(error) = copy_dir(&candidate_path, &installing_path) {
        if let Err(cleanup) = fs::remove_dir_all(&installing_path) {
            log::warn!("partial plugin install cleanup deferred to next launch: {cleanup}");
        }
        return Err(error);
    }
    if rollback_path.exists() {
        fs::remove_dir_all(&rollback_path)?;
    }
    let had_active = active_path.exists();
    if had_active {
        fs::rename(&active_path, &rollback_path)
            .map_err(|e| CommandError::context("could not retain previous plugin version", e))?;
    }
    if let Err(error) = fs::rename(&installing_path, &active_path) {
        if let Err(cleanup) = fs::remove_dir_all(&installing_path) {
            log::warn!("partial plugin install cleanup deferred to next launch: {cleanup}");
        }
        // Leaving it in .rollback is still recoverable at the next launch.
        if had_active {
            if let Err(restore) = fs::rename(&rollback_path, &active_path) {
                log::error!("previous plugin version restore deferred to next launch: {restore}");
            }
        }
        return Err(CommandError::context(
            "could not switch to plugin candidate",
            error,
        ));
    }
    Ok(PluginEntry {
        id: candidate.id,
        manifest: candidate.manifest,
        builtin: false,
    })
}

/// Commit a health-checked candidate. The candidate directory stays until its
/// live Worker stops, so lazy module imports keep resolving for that instance.
#[tauri::command]
pub async fn plugins_commit_candidate(
    app: tauri::AppHandle,
    token: String,
    update_id: String,
) -> Result<PluginEntry, CommandError> {
    blocking("plugins_commit_candidate", move || {
        let plugins = plugins_dir(&app)?;
        let (_, candidate) = candidate_at(&plugins, &token)?;
        if is_bundled(&app, &candidate.id) {
            return Err(built_in(&candidate.id, "replaced"));
        }
        // A candidate staged before its id was retired must not commit either.
        if retired_plugin_id(&candidate.id) {
            return Err(retired(&candidate.id));
        }
        let db = app.state::<crate::storage::Db>();
        let conn = db.0.lock()?;
        let journal = crate::storage::read_plugin_update(&conn, &update_id)?.ok_or_else(|| {
            CommandError::new(
                CODE_PLUGIN_CANDIDATE_STALE,
                "plugin update baseline is missing",
            )
        })?;
        if journal.phase != "prepared"
            || journal.plugin_id != candidate.id
            || journal.candidate_token.as_deref() != Some(&token)
        {
            return Err(CommandError::new(
                CODE_PLUGIN_CANDIDATE_STALE,
                "plugin candidate does not match its durable update baseline",
            ));
        }
        commit_candidate_at(&plugins, &token)
    })
    .await
}

#[tauri::command]
pub async fn plugins_discard_candidate(
    app: tauri::AppHandle,
    token: String,
) -> Result<(), CommandError> {
    blocking("plugins_discard_candidate", move || {
        let plugins = plugins_dir(&app)?;
        let (candidate, _) = candidate_at(&plugins, &token)?;
        Ok(fs::remove_dir_all(candidate)?)
    })
    .await
}

fn rollback_plugin_at(plugins: &Path, id: &str) -> Result<PluginEntry, CommandError> {
    if !valid_plugin_id(id) {
        return Err(invalid_id());
    }
    let active_path = plugins.join(id);
    let rollback_path = rollback_dir(plugins).join(id);
    if !rollback_path.join("manifest.json").is_file() {
        return Err(CommandError::new(
            CODE_PLUGIN_NO_PREVIOUS_VERSION,
            format!("no previous version retained for \"{id}\""),
        ));
    }
    let failed_path = plugins.join(format!(".failed-{id}-{}", uuid::Uuid::new_v4()));
    let had_active = active_path.exists();
    if had_active {
        fs::rename(&active_path, &failed_path)
            .map_err(|e| CommandError::context("could not move failed plugin version aside", e))?;
    }
    if let Err(error) = fs::rename(&rollback_path, &active_path) {
        if had_active {
            if let Err(restore) = fs::rename(&failed_path, &active_path) {
                log::error!("plugin version restore after a failed rollback failed: {restore}");
            }
        }
        return Err(CommandError::context(
            "could not restore previous plugin version",
            error,
        ));
    }
    // `.failed-*` leftovers are swept again at the next enumeration.
    if let Err(error) = fs::remove_dir_all(&failed_path) {
        log::warn!("failed plugin version cleanup deferred: {error}");
    }
    let manifest = fs::read_to_string(active_path.join("manifest.json"))
        .map_err(|e| CommandError::context("restored plugin manifest is unreadable", e))?;
    Ok(PluginEntry {
        id: id.to_string(),
        manifest,
        builtin: false,
    })
}

#[tauri::command]
pub async fn plugins_rollback(
    app: tauri::AppHandle,
    id: String,
) -> Result<PluginEntry, CommandError> {
    blocking("plugins_rollback", move || {
        rollback_plugin_at(&plugins_dir(&app)?, &id)
    })
    .await
}

#[tauri::command]
pub async fn plugins_uninstall(app: tauri::AppHandle, id: String) -> Result<(), CommandError> {
    blocking("plugins_uninstall", move || {
        let plugins = plugins_dir(&app)?;
        let db = app.state::<crate::storage::Db>();
        let conn = db.0.lock()?;
        for journal in crate::storage::list_plugin_updates(&conn)?
            .into_iter()
            .filter(|journal| journal.plugin_id == id)
        {
            if journal.phase != "accepted" {
                return Err(CommandError::new(
                    "plugin/recovery-required",
                    "Resolve the durable plugin update before removing its files",
                ));
            }
            crate::plugin_updates::finish_at(&conn, &plugins, &journal.update_id)?;
        }
        uninstall_files_unchecked(&app, &plugins, &id)
    })
    .await
}

fn uninstall_files_unchecked(
    app: &tauri::AppHandle,
    plugins: &Path,
    id: &str,
) -> Result<(), CommandError> {
    if is_bundled(app, id) {
        return Err(built_in(id, "uninstalled"));
    }
    if !valid_plugin_id(id) {
        return Err(invalid_id());
    }
    let dir = plugins.join(id);
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
    let rollback = rollback_dir(plugins).join(id);
    if rollback.exists() {
        fs::remove_dir_all(rollback)?;
    }
    if let Ok(entries) = fs::read_dir(candidates_dir(plugins)) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(manifest) = fs::read_to_string(path.join("manifest.json")) else {
                continue;
            };
            if manifest_id(&manifest).ok().as_deref() == Some(id) {
                // A stale candidate is inert; the next uninstall retries it.
                if let Err(error) = fs::remove_dir_all(&path) {
                    log::warn!("candidate cleanup for uninstalled \"{id}\" deferred: {error}");
                }
            }
        }
    }
    Ok(())
}

/// Every place a `raplugin://` path may resolve, in lookup order, as
/// (containment base, requested file). Each base is exactly one plugin's own
/// folder — or one staged candidate's — so a plugin can never reach another
/// plugin's files, nor the `.rollback`/`.candidates` bookkeeping trees.
///
/// Paths are `<plugin id>/<file path>` or `__candidate/<token>/<file path>`.
/// Plain ASCII only: plugin folders are machine-named, and rejecting
/// percent-escapes, backslashes and dot-prefixed segments outright beats
/// decoding them. (Installed plugin files never start with a dot: every
/// staging path skips or rejects hidden entries.)
fn asset_lookups(
    rel: &str,
    bundled: Option<&bundled::BundledRoot>,
    user: Option<&Path>,
) -> Vec<(PathBuf, PathBuf)> {
    let plain_file = |path: &str| {
        !path.is_empty()
            && !path.contains(['%', '\\'])
            && path
                .split('/')
                .all(|part| !part.is_empty() && !part.starts_with('.'))
    };
    let mut lookups = Vec::new();
    // A separately staged candidate gets an explicit protocol namespace. It
    // is executable for health checking but is never discovered as installed.
    if let Some(candidate_rel) = rel.strip_prefix("__candidate/") {
        if let (Some(user), Some((token, rest))) = (user, candidate_rel.split_once('/')) {
            if valid_candidate_token(token) && plain_file(rest) {
                let base = candidates_dir(user).join(token);
                lookups.push((base.clone(), base.join(rest)));
            }
        }
        return lookups;
    }
    let Some((id, rest)) = rel.split_once('/') else {
        return lookups;
    };
    if !valid_plugin_id(id) || !plain_file(rest) {
        return lookups;
    }
    // Bundled root first: a bundled id shadows a user-dir copy, matching
    // plugins_list.
    if let Some(root) = bundled {
        let base = root.plugin_dir(id);
        lookups.push((base.clone(), base.join(rest)));
    }
    if let Some(user) = user {
        let base = user.join(id);
        lookups.push((base.clone(), base.join(rest)));
    }
    lookups
}

/// The first lookup naming a regular file inside its own base. Both ends are
/// canonicalized so containment also holds through symlinks.
fn resolve_asset(lookups: Vec<(PathBuf, PathBuf)>) -> Option<PathBuf> {
    lookups.into_iter().find_map(|(base, full)| {
        let canonical = full.canonicalize().ok()?;
        let canonical_base = base.canonicalize().ok()?;
        (canonical.starts_with(&canonical_base) && canonical.is_file()).then_some(canonical)
    })
}

/// Serves one plugin's files for `raplugin://localhost/<id>/<path>` (and
/// Windows' `http://raplugin.localhost/<id>/<path>`). Module scripts import
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

    let rel = request.uri().path().trim_start_matches('/');
    let user = plugins_dir(app).ok();
    let lookups = asset_lookups(rel, bundled_root(app), user.as_deref());
    let Some(canonical) = resolve_asset(lookups) else {
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

/// A zip failure is the package's fault unless the file itself was unreadable.
fn zip_error(context: &str, error: zip::result::ZipError) -> CommandError {
    match error {
        zip::result::ZipError::Io(error) => CommandError::context(context, error),
        other => invalid_package(format!("{context}: {other}")),
    }
}

/// Find the archive's manifest: at the root, or exactly one folder deep
/// (GitHub-style archives wrap everything in a single top directory). Returns
/// the manifest text plus the entry-name prefix to strip when extracting.
fn zip_manifest(path: &Path) -> Result<(String, String), CommandError> {
    use std::io::Read as _;
    let file = fs::File::open(path).map_err(|e| CommandError::context("cannot open zip", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| zip_error("not a valid zip archive", e))?;

    let mut found: Option<String> = None;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|e| zip_error("unreadable zip entry", e))?;
        let name = entry.name().replace('\\', "/");
        if name == "manifest.json" {
            found = Some(name);
            break;
        }
        if name.ends_with("/manifest.json") && name.matches('/').count() == 1 {
            if found.is_some() {
                return Err(invalid_package(
                    "the zip contains more than one plugin folder",
                ));
            }
            found = Some(name);
        }
    }
    let entry_name = found.ok_or_else(|| invalid_package("manifest.json not found in the zip"))?;
    let prefix = entry_name.trim_end_matches("manifest.json").to_string();

    let mut manifest = String::new();
    archive
        .by_name(&entry_name)
        .map_err(|e| zip_error("unreadable zip manifest", e))?
        .read_to_string(&mut manifest)
        .map_err(|e| {
            CommandError::context_coded(CODE_PLUGIN_INVALID_PACKAGE, "unreadable zip manifest", e)
        })?;
    Ok((manifest, prefix))
}

/// Extract a zip into an inert candidate. Plain files only: hidden entries,
/// __MACOSX, symlinks, and path-traversing names are skipped.
#[tauri::command]
pub async fn plugins_stage_zip(
    app: tauri::AppHandle,
    zip_path: String,
) -> Result<PluginCandidate, CommandError> {
    blocking("plugins_stage_zip", move || {
        let path = PathBuf::from(&zip_path);
        let (manifest, prefix) = zip_manifest(&path)?;
        let id = manifest_id(&manifest)?;
        let plugins = plugins_dir(&app)?;
        let (token, temp, staged) = fresh_candidate_paths(&plugins)?;
        finalize_candidate(&temp, &staged, || {
            fs::create_dir_all(&temp)?;
            let file = fs::File::open(&path)?;
            let mut archive =
                zip::ZipArchive::new(file).map_err(|e| zip_error("not a valid zip archive", e))?;
            for index in 0..archive.len() {
                let mut entry = archive
                    .by_index(index)
                    .map_err(|e| zip_error("unreadable zip entry", e))?;
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
                let target = temp.join(relative);
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)?;
                }
                let mut out = fs::File::create(&target)?;
                std::io::copy(&mut entry, &mut out).map_err(|e| match e.kind() {
                    // A corrupt stream is the package; a full disk is not.
                    std::io::ErrorKind::InvalidData | std::io::ErrorKind::UnexpectedEof => {
                        invalid_package(format!("zip entry could not be extracted: {e}"))
                    }
                    _ => CommandError::context("zip entry could not be extracted", e),
                })?;
            }
            Ok(())
        })?;
        Ok(PluginCandidate {
            token,
            id,
            manifest,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_plugin(path: &Path, id: &str, version: &str) {
        fs::create_dir_all(path).unwrap();
        fs::write(
            path.join("manifest.json"),
            serde_json::json!({ "id": id, "name": "Test", "version": version }).to_string(),
        )
        .unwrap();
        fs::write(path.join("main.js"), format!("// {version}")).unwrap();
    }

    fn version(path: &Path) -> String {
        let manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path.join("manifest.json")).unwrap()).unwrap();
        manifest["version"].as_str().unwrap().to_string()
    }

    #[test]
    fn retired_ids_never_install_or_load() {
        let temp = tempfile::tempdir().unwrap();
        let plugins = temp.path();
        let manifest =
            serde_json::json!({ "id": "jumper", "name": "Impostor", "version": "9.0.0" })
                .to_string();
        assert_eq!(
            manifest_id(&manifest).unwrap_err().code,
            CODE_PLUGIN_BUILT_IN
        );
        // A candidate staged before the id was retired is refused too.
        let token = uuid::Uuid::new_v4().to_string();
        write_plugin(&candidates_dir(plugins).join(&token), "jumper", "9.0.0");
        assert!(matches!(
            candidate_at(plugins, &token),
            Err(error) if error.code == CODE_PLUGIN_BUILT_IN
        ));
        // A folder copied in by hand is not listed (so it never runs).
        write_plugin(&plugins.join("jumper"), "jumper", "9.0.0");
        write_plugin(&plugins.join("sample"), "sample", "1.0.0");
        let mut entries = Vec::new();
        list_plugin_dirs(plugins, false, &mut entries);
        assert_eq!(
            entries.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["sample"]
        );
    }

    #[test]
    fn candidate_commit_retains_the_running_version_and_can_roll_back() {
        let temp = tempfile::tempdir().unwrap();
        let plugins = temp.path();
        let token = uuid::Uuid::new_v4().to_string();
        write_plugin(&plugins.join("sample"), "sample", "1.0.0");
        write_plugin(&candidates_dir(plugins).join(&token), "sample", "2.0.0");

        let installed = commit_candidate_at(plugins, &token).unwrap();

        assert_eq!(installed.id, "sample");
        assert_eq!(version(&plugins.join("sample")), "2.0.0");
        assert_eq!(version(&rollback_dir(plugins).join("sample")), "1.0.0");
        assert!(candidates_dir(plugins).join(&token).exists());

        rollback_plugin_at(plugins, "sample").unwrap();
        assert_eq!(version(&plugins.join("sample")), "1.0.0");
        assert!(!rollback_dir(plugins).join("sample").exists());
    }

    #[test]
    fn first_install_commits_without_inventing_a_previous_version() {
        let temp = tempfile::tempdir().unwrap();
        let plugins = temp.path();
        let token = uuid::Uuid::new_v4().to_string();
        write_plugin(&candidates_dir(plugins).join(&token), "sample", "1.0.0");

        commit_candidate_at(plugins, &token).unwrap();

        assert_eq!(version(&plugins.join("sample")), "1.0.0");
        assert!(!rollback_dir(plugins).join("sample").exists());
    }

    /// Two user plugins, a bundled one, retained/candidate bookkeeping, and
    /// the bundled root, laid out as the app lays them out.
    fn asset_fixture() -> (tempfile::TempDir, PathBuf, bundled::BundledRoot, String) {
        let temp = tempfile::tempdir().unwrap();
        let plugins = temp.path().join("plugins");
        let token = uuid::Uuid::new_v4().to_string();
        write_plugin(&plugins.join("alpha"), "alpha", "1.0.0");
        fs::create_dir_all(plugins.join("alpha/lib")).unwrap();
        fs::write(plugins.join("alpha/lib/chunk.js"), "// chunk").unwrap();
        write_plugin(&plugins.join("beta"), "beta", "1.0.0");
        fs::write(plugins.join("beta/secret.js"), "// beta only").unwrap();
        write_plugin(&rollback_dir(&plugins).join("alpha"), "alpha", "0.9.0");
        write_plugin(&candidates_dir(&plugins).join(&token), "alpha", "2.0.0");
        let bundled_dir = temp.path().join("bundled-plugins");
        write_plugin(&bundled_dir.join("gamma"), "gamma", "1.0.0");
        write_plugin(&plugins.join("gamma"), "gamma", "0.1.0");
        let root = bundled::BundledRoot::Extracted(bundled_dir);
        (temp, plugins, root, token)
    }

    fn serve(rel: &str, root: &bundled::BundledRoot, plugins: &Path) -> Option<String> {
        resolve_asset(asset_lookups(rel, Some(root), Some(plugins)))
            .map(|path| fs::read_to_string(path).unwrap())
    }

    #[test]
    fn plugin_assets_resolve_only_inside_the_requested_plugin() {
        let (_temp, plugins, root, token) = asset_fixture();
        assert_eq!(serve("alpha/main.js", &root, &plugins).unwrap(), "// 1.0.0");
        assert_eq!(
            serve("alpha/lib/chunk.js", &root, &plugins).unwrap(),
            "// chunk"
        );
        assert_eq!(
            serve("beta/secret.js", &root, &plugins).unwrap(),
            "// beta only"
        );
        // A bundled id shadows a user-dir copy.
        assert_eq!(serve("gamma/main.js", &root, &plugins).unwrap(), "// 1.0.0");
        // The candidate namespace serves the staged tree by token.
        assert_eq!(
            serve(&format!("__candidate/{token}/main.js"), &root, &plugins).unwrap(),
            "// 2.0.0"
        );
        for rel in [
            // Another plugin through traversal, escapes or backslashes.
            "alpha/../beta/secret.js",
            "alpha/%2e%2e/beta/secret.js",
            "alpha\\..\\beta\\secret.js",
            "alpha/./main.js",
            // Bookkeeping trees are not plugins.
            ".rollback/alpha/main.js",
            ".candidates/alpha/main.js",
            &format!(".candidates/{token}/main.js"),
            // The candidate namespace needs a real token and a file.
            "__candidate/not-a-token/main.js",
            &format!("__candidate/{token}"),
            &format!("__candidate/{token}/"),
            &format!("__candidate/{token}/../../beta/secret.js"),
            // Malformed ids, bare roots and folders.
            "Alpha/main.js",
            "-alpha/main.js",
            "alpha",
            "alpha/",
            "alpha//main.js",
            "alpha/lib",
            "manifest.json",
            "",
        ] {
            assert_eq!(serve(rel, &root, &plugins), None, "{rel} must not resolve");
        }
    }

    #[cfg(unix)]
    #[test]
    fn plugin_asset_symlinks_cannot_leave_their_plugin() {
        let (_temp, plugins, root, _) = asset_fixture();
        std::os::unix::fs::symlink(
            plugins.join("beta/secret.js"),
            plugins.join("alpha/escape.js"),
        )
        .unwrap();
        std::os::unix::fs::symlink(plugins.join("alpha/lib"), plugins.join("alpha/linked"))
            .unwrap();
        assert_eq!(serve("alpha/escape.js", &root, &plugins), None);
        // A link that stays inside the plugin still resolves.
        assert_eq!(
            serve("alpha/linked/chunk.js", &root, &plugins).unwrap(),
            "// chunk"
        );
    }

    #[test]
    fn boot_recovers_a_previous_version_if_commit_was_interrupted() {
        let temp = tempfile::tempdir().unwrap();
        let plugins = temp.path();
        write_plugin(&rollback_dir(plugins).join("sample"), "sample", "1.0.0");
        fs::create_dir_all(plugins.join(".installing-abandoned")).unwrap();

        recover_interrupted_commits(plugins).unwrap();

        assert_eq!(version(&plugins.join("sample")), "1.0.0");
        assert!(!plugins.join(".installing-abandoned").exists());
    }
}
