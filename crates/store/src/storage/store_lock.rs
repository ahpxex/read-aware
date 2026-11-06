//! Cross-process ownership of a library directory.
//!
//! The desktop app and the `ra` CLI open the same SQLite store, and either may
//! run while the other does. Two OS advisory locks coordinate them; the OS
//! releases both when a process exits or crashes, so a dead process never
//! leaves the library locked.
//!
//! - `store.lock`: every process holds it SHARED while it has the store open.
//!   Work that must not run beside another process (schema migration and
//!   startup maintenance, full restore, wipe, backup capture) holds it
//!   EXCLUSIVELY for its duration.
//! - `locks/<process-id>.lock`: held exclusively by the process it names for
//!   its whole life. Records a process leaves behind (an import intent) carry
//!   that id, and recovery reclaims them only once the lock is free.
use crate::error::{CommandError, CODE_STORE_IN_USE};
use std::fs::{self, File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

pub const STORE_LOCK_FILE: &str = "store.lock";
const PRESENCE_DIRECTORY: &str = "locks";

/// Whether acquiring a lock another process holds waits for it or fails with
/// `store/in-use`. The app waits (other holders are short CLI commands); the
/// CLI fails fast and says why.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wait {
    Block,
    Fail,
}

pub fn in_use(message: &str) -> CommandError {
    CommandError::new(CODE_STORE_IN_USE, message)
}

fn open_lock_file(path: &Path) -> Result<File, CommandError> {
    Ok(OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?)
}

/// This process's hold on a library directory: shared for as long as it
/// lives, exclusive for the sections that need the library alone.
pub struct StoreLock {
    file: File,
    /// Serializes exclusive sections within this process; the file lock alone
    /// has one mode per handle.
    mode: Mutex<()>,
}

impl StoreLock {
    /// Open `<dir>/store.lock` (creating the directory and file) and take it
    /// shared. Another process's exclusive section either delays this
    /// (`Wait::Block`) or fails it with `store/in-use` (`Wait::Fail`).
    pub fn acquire(dir: &Path, wait: Wait) -> Result<Self, CommandError> {
        fs::create_dir_all(dir)?;
        let file = open_lock_file(&dir.join(STORE_LOCK_FILE))?;
        match file.try_lock_shared() {
            Ok(()) => {}
            Err(TryLockError::WouldBlock) if wait == Wait::Block => {
                log::warn!("waiting for another ReadAware process to finish library maintenance");
                file.lock_shared()?;
            }
            Err(TryLockError::WouldBlock) => {
                return Err(in_use(
                    "The library is busy with maintenance in another ReadAware process",
                ))
            }
            Err(TryLockError::Error(error)) => return Err(error.into()),
        }
        Ok(Self {
            file,
            mode: Mutex::new(()),
        })
    }

    /// Hold the library alone until the guard drops, then return to shared.
    /// With `Wait::Fail`, `Ok(None)` means another process has it open.
    pub fn exclusive(&self, wait: Wait) -> Result<Option<ExclusiveGuard<'_>>, CommandError> {
        let mode = self.mode.lock()?;
        // A handle has one lock mode; release shared before asking for
        // exclusive, and restore shared on every path that does not keep it.
        self.file.unlock()?;
        let taken = match wait {
            Wait::Block => self.file.lock().map(|()| true),
            Wait::Fail => match self.file.try_lock() {
                Ok(()) => Ok(true),
                Err(TryLockError::WouldBlock) => Ok(false),
                Err(TryLockError::Error(error)) => Err(error),
            },
        };
        match taken {
            Ok(true) => Ok(Some(ExclusiveGuard {
                lock: self,
                _mode: mode,
            })),
            Ok(false) => {
                self.file.lock_shared()?;
                Ok(None)
            }
            Err(error) => {
                self.file.lock_shared()?;
                Err(error.into())
            }
        }
    }

    /// Run `work` with the library to this process alone, or fail with
    /// `store/in-use` when another process has it open.
    pub fn with_exclusive<T>(
        &self,
        work: impl FnOnce() -> Result<T, CommandError>,
    ) -> Result<T, CommandError> {
        let _alone = self.exclusive(Wait::Fail)?.ok_or_else(|| {
            in_use("The library is open in another ReadAware process, such as the ra command line")
        })?;
        work()
    }
}

/// Exclusive hold on the library; dropping it returns to the shared lock.
pub struct ExclusiveGuard<'a> {
    lock: &'a StoreLock,
    _mode: MutexGuard<'a, ()>,
}

impl Drop for ExclusiveGuard<'_> {
    fn drop(&mut self) {
        // Downgrading cannot fail in practice (an fd that held a lock a moment
        // ago); if it does, the process keeps no lock and only loses the
        // protection, which the log records.
        if let Err(error) = self.lock.file.unlock() {
            log::error!("releasing the exclusive library lock failed: {error}");
        }
        if let Err(error) = self.lock.file.lock_shared() {
            log::error!("returning to the shared library lock failed: {error}");
        }
    }
}

/// This process's presence lock. Records a process leaves behind name it by
/// `id`; recovery treats them as abandoned only once this lock is free.
pub struct ProcessPresence {
    pub id: String,
    path: PathBuf,
    _file: File,
}

impl ProcessPresence {
    pub fn claim(dir: &Path) -> Result<Self, CommandError> {
        let directory = dir.join(PRESENCE_DIRECTORY);
        fs::create_dir_all(&directory)?;
        let id = uuid::Uuid::new_v4().to_string();
        let path = directory.join(format!("{id}.lock"));
        let file = open_lock_file(&path)?;
        file.try_lock().map_err(|error| match error {
            // A fresh random id cannot be held by anyone else.
            TryLockError::WouldBlock => CommandError::internal("process presence id collided"),
            TryLockError::Error(error) => error.into(),
        })?;
        Ok(Self {
            id,
            path,
            _file: file,
        })
    }
}

impl Drop for ProcessPresence {
    fn drop(&mut self) {
        // The OS lock goes with the handle; the file is only bookkeeping.
        if let Err(error) = fs::remove_file(&self.path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!("removing the process presence lock failed: {error}");
            }
        }
    }
}

/// Whether the process that recorded `owner` still runs. An owner without a
/// presence file predates presence locks or already cleaned up after itself;
/// either way nothing holds it.
pub fn process_alive(dir: &Path, owner: &str) -> Result<bool, CommandError> {
    if uuid::Uuid::parse_str(owner).is_err() {
        return Ok(false);
    }
    let path = dir.join(PRESENCE_DIRECTORY).join(format!("{owner}.lock"));
    let file = match OpenOptions::new().read(true).write(true).open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    match file.try_lock() {
        Ok(()) => {
            // The owner died without removing its file; it is ours to clear.
            drop(file);
            if let Err(error) = fs::remove_file(&path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    log::warn!("removing a dead process presence lock failed: {error}");
                }
            }
            Ok(false)
        }
        Err(TryLockError::WouldBlock) => Ok(true),
        Err(TryLockError::Error(error)) => Err(error.into()),
    }
}

#[cfg(test)]
#[path = "store_lock_tests.rs"]
mod tests;
