//! Finding and opening the library the CLI works on.
use read_aware_store::error::CommandError;
use read_aware_store::storage::{init_db, Db, ImportSession, StoreLock, Wait};
use std::path::{Path, PathBuf};

/// The desktop app's bundle identifiers (tauri.conf.json / tauri.dev.conf.json).
const APP_IDENTIFIER: &str = "com.readaware.app";
const DEV_APP_IDENTIFIER: &str = "com.readaware.app.dev";
const DATA_DIR_ENV: &str = "READAWARE_DATA_DIR";
const DATABASE_FILE: &str = "read-aware.db";

/// The library directory: `--data-dir`, else `$READAWARE_DATA_DIR`, else the
/// desktop app's own (Tauri's `app_data_dir`: the OS data dir plus the bundle
/// identifier).
pub fn resolve_dir(explicit: Option<&Path>, dev: bool) -> Result<PathBuf, CommandError> {
    if let Some(dir) = explicit {
        return Ok(dir.to_path_buf());
    }
    if !dev {
        if let Some(dir) = std::env::var_os(DATA_DIR_ENV).filter(|value| !value.is_empty()) {
            return Ok(PathBuf::from(dir));
        }
    }
    let base = dirs::data_dir().ok_or_else(|| {
        CommandError::new(
            "fs/not-found",
            "This system has no data directory; pass --data-dir",
        )
    })?;
    Ok(base.join(if dev {
        DEV_APP_IDENTIFIER
    } else {
        APP_IDENTIFIER
    }))
}

/// An open library: the connection, the shared lock that tells other
/// ReadAware processes it is in use, and this process's identity on the
/// import intents it records.
pub struct Library {
    pub dir: PathBuf,
    pub db: Db,
    pub session: ImportSession,
    _lock: StoreLock,
}

/// Open an existing library. A directory without one is an error, so a mistyped
/// path never conjures an empty library; `ra init` creates one on purpose.
pub fn open(dir: &Path) -> Result<Library, CommandError> {
    if !dir.join(DATABASE_FILE).is_file() {
        return Err(CommandError::new(
            "fs/not-found",
            format!(
                "No ReadAware library at {}. Open the ReadAware app once, pass --data-dir, or run `ra init` to create one.",
                dir.display()
            ),
        ));
    }
    open_or_create(dir)
}

/// Open the library in `dir`, creating it if it does not exist yet.
pub fn open_or_create(dir: &Path) -> Result<Library, CommandError> {
    // Never wait: a CLI command reports another process's maintenance
    // instead of hanging on it.
    let lock = StoreLock::acquire(dir, Wait::Fail)?;
    let db = Db::new(init_db(dir, &lock, Wait::Fail)?);
    let session = ImportSession::claim(dir)?;
    Ok(Library {
        dir: dir.to_path_buf(),
        db,
        session,
        _lock: lock,
    })
}

pub fn exists(dir: &Path) -> bool {
    dir.join(DATABASE_FILE).is_file()
}
