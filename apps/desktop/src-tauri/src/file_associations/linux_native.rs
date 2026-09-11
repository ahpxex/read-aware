//! Fixed xdg command and filesystem adapters, never exposed as plugin path APIs.
use super::{linux::System, linux_entry::error};
use crate::error::CommandError;
use std::os::unix::process::CommandExt;
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

pub(super) struct NativeSystem {
    data_home: PathBuf,
    config_home: PathBuf,
    data_dirs: Vec<PathBuf>,
}

impl NativeSystem {
    pub fn new(data_home: PathBuf, config_home: PathBuf) -> Result<Self, CommandError> {
        let data_dirs = std::env::var_os("XDG_DATA_DIRS")
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "/usr/local/share:/usr/share".into());
        let data_dirs: Vec<_> = std::env::split_paths(&data_dirs).collect();
        if !data_home.is_absolute()
            || !config_home.is_absolute()
            || data_dirs.iter().any(|dir| !dir.is_absolute())
        {
            return Err(error("XDG directories must be absolute"));
        }
        Ok(Self {
            data_home,
            config_home,
            data_dirs,
        })
    }

    fn run(&self, program: &str, args: &[&std::ffi::OsStr]) -> Result<(), CommandError> {
        let mut output = tempfile::tempfile()?;
        let mut child = Command::new(program)
            .args(args)
            .env("XDG_DATA_HOME", &self.data_home)
            .env("XDG_CONFIG_HOME", &self.config_home)
            .env("XDG_UTILS_INSTALL_MODE", "user")
            .stdin(Stdio::null())
            .stdout(output.try_clone()?)
            .stderr(output.try_clone()?)
            .process_group(0)
            .spawn()
            .map_err(|e| error(format!("Starting {program}: {e}")))?;
        let deadline = Instant::now() + Duration::from_secs(15);
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20))
                }
                result => {
                    // Kill the tool and its children before compensation can
                    // rebuild a database that a timed-out child might still edit.
                    unsafe {
                        libc::kill(-(child.id() as i32), libc::SIGKILL);
                    }
                    let reaped = child.wait();
                    return Err(error(format!(
                        "{program} timed out or wait failed ({result:?}); reap: {reaped:?}"
                    )));
                }
            }
        };
        if !status.success() {
            use std::io::{Seek, SeekFrom};
            output.seek(SeekFrom::Start(0))?;
            let mut bytes = Vec::new();
            output.take(4096).read_to_end(&mut bytes)?;
            return Err(error(format!(
                "{program} failed ({status}): {}",
                String::from_utf8_lossy(&bytes)
            )));
        }
        Ok(())
    }
}

impl System for NativeSystem {
    fn data_home(&self) -> &Path {
        &self.data_home
    }
    fn config_home(&self) -> &Path {
        &self.config_home
    }
    fn data_dirs(&self) -> &[PathBuf] {
        &self.data_dirs
    }
    fn read(&self, path: &Path) -> Result<Option<Vec<u8>>, CommandError> {
        match fs::symlink_metadata(path) {
            Ok(metadata) if !metadata.is_file() || metadata.len() > 1024 * 1024 => {
                Err(error("Invalid association file kind or size"))
            }
            Ok(_) => Ok(Some(fs::read(path)?)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(error(format!(
                "Reading association file {}: {e}",
                path.display()
            ))),
        }
    }
    fn write(&self, path: &Path, bytes: Option<&[u8]>) -> Result<(), CommandError> {
        self.read(path)?;
        if let Some(bytes) = bytes {
            let parent = path
                .parent()
                .ok_or_else(|| error("Invalid association path"))?;
            fs::create_dir_all(parent)?;
            let mut file = tempfile::NamedTempFile::new_in(parent)?;
            file.write_all(bytes)?;
            file.as_file().sync_all()?;
            // Launcher/config entries must be readable by desktop services.
            use std::os::unix::fs::PermissionsExt;
            let mode = match fs::metadata(path) {
                Ok(meta) => meta.permissions().mode(),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    if path.file_name().is_some_and(|name| name == "mimeapps.list") {
                        0o600
                    } else {
                        0o644
                    }
                }
                Err(e) => return Err(e.into()),
            };
            file.as_file()
                .set_permissions(fs::Permissions::from_mode(mode))?;
            file.persist(path)
                .map_err(|e| error(format!("Publishing association file: {e}")))?;
        } else if let Err(e) = fs::remove_file(path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(e.into());
            }
        }
        Ok(())
    }
    fn mime(&self, package: &Path, bytes: &[u8], install: bool) -> Result<(), CommandError> {
        self.read(package)?;
        let temp = tempfile::tempdir()?;
        let input = temp.path().join(
            package
                .file_name()
                .ok_or_else(|| error("Invalid MIME package name"))?,
        );
        fs::write(&input, bytes)?;
        self.run(
            "xdg-mime",
            &[
                if install {
                    "install".as_ref()
                } else {
                    "uninstall".as_ref()
                },
                "--mode".as_ref(),
                "user".as_ref(),
                input.as_os_str(),
            ],
        )
    }
    fn refresh(&self) -> Result<(), CommandError> {
        // xdg-mime can leave an interrupted derived database even when the
        // package bytes already match. Rebuild both caches during compensation.
        let mime_home = self.data_home.join("mime");
        fs::create_dir_all(&mime_home)?;
        self.run("update-mime-database", &[mime_home.as_os_str()])?;
        self.run(
            "update-desktop-database",
            &[self.data_home.join("applications").as_os_str()],
        )
    }
}

#[cfg(test)]
mod tests;
