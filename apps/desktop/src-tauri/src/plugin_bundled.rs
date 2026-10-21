//! Runtime authority for bundled program locations, shared with full backup.
use crate::error::CommandError;
use include_dir::{include_dir, Dir};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tauri::Manager;

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
static BUNDLED_IMAGE_BACKGROUND: Dir =
    include_dir!("$CARGO_MANIFEST_DIR/../../../plugins/image-background/dist");
static BUNDLED_JUMPER: Dir = include_dir!("$CARGO_MANIFEST_DIR/../../../plugins/jumper/dist");

static BUNDLED: &[(&str, &Dir)] = &[
    ("dictionary", &BUNDLED_DICTIONARY),
    ("editorial-themes", &BUNDLED_EDITORIAL_THEMES),
    ("rss-reader", &BUNDLED_RSS_READER),
    ("sentence-reader", &BUNDLED_SENTENCE_READER),
    ("tts", &BUNDLED_TTS),
    ("jumper", &BUNDLED_JUMPER),
    ("image-background", &BUNDLED_IMAGE_BACKGROUND),
];

/// Where the built-in set lives at runtime.
#[derive(Debug, Clone)]
pub(super) enum BundledRoot {
    /// `<dir>/<id>/…` — extracted from the embedded set.
    Extracted(PathBuf),
    /// Dev checkout: `<plugins>/<id>/dist/…`, served live so a rebuilt
    /// plugin is picked up on the next request without restarting the app.
    #[cfg(debug_assertions)]
    RepoDist(PathBuf),
}

impl BundledRoot {
    /// The directory holding one bundled plugin's files.
    pub(super) fn plugin_dir(&self, id: &str) -> PathBuf {
        match self {
            BundledRoot::Extracted(dir) => dir.join(id),
            #[cfg(debug_assertions)]
            BundledRoot::RepoDist(plugins) => plugins.join(id).join("dist"),
        }
    }

    /// Bundled plugin ids present at this root.
    pub(super) fn ids(&self) -> Vec<String> {
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
        log::error!("[plugins] extracting bundled plugins failed: {error}");
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
pub(super) fn bundled_root(app: &tauri::AppHandle) -> Option<&'static BundledRoot> {
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

/// Native-only location authority. Not deserializable from a backup or IPC.
/// Keep the layout, not a frozen file list: revalidation must see new/deleted
/// dev dist trees as well as modifications inside existing programs.
#[derive(Debug, Clone)]
pub(crate) struct BundledPrograms {
    root: BundledRoot,
    require_shipped: bool,
}
fn incomplete(message: &str) -> CommandError {
    CommandError::new("backup/incomplete", message)
}
pub(crate) fn backup_programs(app: &tauri::AppHandle) -> Result<BundledPrograms, CommandError> {
    let root =
        bundled_root(app).ok_or_else(|| incomplete("runtime bundled programs are unavailable"))?;
    Ok(BundledPrograms {
        root: root.clone(),
        require_shipped: true,
    })
}
impl BundledPrograms {
    pub(crate) fn plugin_dir(&self, id: &str) -> Result<PathBuf, CommandError> {
        if !super::valid_plugin_id(id) {
            return Err(incomplete("invalid bundled program identity"));
        }
        let path = self.root.plugin_dir(id);
        // The per-ID directory and its dist child must not redirect the native
        // runtime location via a link; platform ancestors remain OS-owned.
        let base = match &self.root {
            BundledRoot::Extracted(root) => root,
            #[cfg(debug_assertions)]
            BundledRoot::RepoDist(root) => root,
        };
        let owner = base.join(id);
        for directory in [base, &owner, &path] {
            if !fs::symlink_metadata(directory)?.file_type().is_dir() {
                return Err(incomplete("bundled program directory is not owned"));
            }
        }
        Ok(path)
    }
    pub(crate) fn ids(
        &self,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<Vec<String>, CommandError> {
        check()?;
        let base = match &self.root {
            BundledRoot::Extracted(root) => root,
            #[cfg(debug_assertions)]
            BundledRoot::RepoDist(root) => root,
        };
        match fs::symlink_metadata(base) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && !self.require_shipped => {
                return Ok(vec![])
            }
            Err(error) => return Err(error.into()),
            Ok(meta) if !meta.file_type().is_dir() => {
                return Err(incomplete("bundled program root is not owned"))
            }
            Ok(_) => {}
        }
        let mut ids = Vec::new();
        for (index, entry) in fs::read_dir(base)?.enumerate() {
            check()?;
            if index >= 100000 {
                return Err(incomplete("too many bundled directory entries"));
            }
            let entry = entry?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| incomplete("non-UTF8 bundled directory"))?;
            if name.starts_with('.') {
                continue;
            }
            let kind = entry.file_type()?;
            if kind.is_symlink() {
                return Err(incomplete("bundled source contains a directory link"));
            }
            if !kind.is_dir() {
                continue;
            }
            if !super::valid_plugin_id(&name) {
                return Err(incomplete("invalid bundled program directory"));
            }
            #[cfg(debug_assertions)]
            if matches!(self.root, BundledRoot::RepoDist(_))
                && !entry.path().join("dist").try_exists()?
            {
                continue;
            }
            let directory = self.plugin_dir(&name)?;
            if !fs::symlink_metadata(directory.join("manifest.json"))?
                .file_type()
                .is_file()
            {
                return Err(incomplete("bundled program manifest is not a regular file"));
            }
            if ids.len() >= 10000 {
                return Err(incomplete("too many bundled programs"));
            }
            ids.push(name);
        }
        ids.sort();
        if self.require_shipped
            && BUNDLED
                .iter()
                .any(|(id, _)| !ids.iter().any(|found| found == id))
        {
            return Err(incomplete("a shipped runtime plugin is missing"));
        }
        Ok(ids)
    }
    #[cfg(test)]
    pub(crate) fn fixture(data_dir: &Path) -> Self {
        Self {
            root: BundledRoot::Extracted(data_dir.join("bundled-plugins")),
            require_shipped: false,
        }
    }
    #[cfg(all(test, debug_assertions))]
    pub(crate) fn repo_fixture(root: &Path) -> Self {
        Self {
            root: BundledRoot::RepoDist(root.to_owned()),
            require_shipped: false,
        }
    }
}

#[cfg(all(test, debug_assertions))]
mod tests {
    use super::*;
    #[test]
    fn backup_runtime_programs_share_runtime_layout_and_require_shipped_members() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("extra/dist")).unwrap();
        fs::write(root.path().join("extra/dist/manifest.json"), "{}").unwrap();
        fs::create_dir_all(root.path().join("not-built-yet")).unwrap();
        let source = BundledPrograms::repo_fixture(root.path());
        assert_eq!(source.ids(|| Ok(())).unwrap(), source.root.ids());
        assert_eq!(
            source.plugin_dir("extra").unwrap(),
            source.root.plugin_dir("extra")
        );
        let strict = BundledPrograms {
            root: source.root.clone(),
            require_shipped: true,
        };
        assert_eq!(strict.ids(|| Ok(())).unwrap_err().code, "backup/incomplete");
        // The runtime's extracted layout is also used without a repo/dist suffix.
        let extracted = tempfile::tempdir().unwrap();
        fs::create_dir_all(extracted.path().join("bundled-plugins/extra")).unwrap();
        fs::write(
            extracted.path().join("bundled-plugins/extra/manifest.json"),
            "{}",
        )
        .unwrap();
        let source = BundledPrograms::fixture(extracted.path());
        assert_eq!(source.ids(|| Ok(())).unwrap(), source.root.ids());
        assert_eq!(
            source.plugin_dir("extra").unwrap(),
            source.root.plugin_dir("extra")
        );
    }
}
