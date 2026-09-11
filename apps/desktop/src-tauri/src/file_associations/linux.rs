//! Linux registration transaction. All OS effects finish before durable policy.
use super::linux_entry::{self as entry, error, Identity};
use crate::error::CommandError;
use std::path::{Path, PathBuf};

pub(super) trait System {
    fn data_home(&self) -> &Path;
    fn config_home(&self) -> &Path;
    fn data_dirs(&self) -> &[PathBuf];
    fn read(&self, path: &Path) -> Result<Option<Vec<u8>>, CommandError>;
    fn write(&self, path: &Path, bytes: Option<&[u8]>) -> Result<(), CommandError>;
    fn mime(&self, package: &Path, bytes: &[u8], install: bool) -> Result<(), CommandError>;
    fn refresh(&self) -> Result<(), CommandError>;
}

pub(super) struct Change {
    pub path: PathBuf,
    pub before: Option<Vec<u8>>,
    pub after: Option<Vec<u8>>,
}
pub(super) struct Plan {
    files: Vec<Change>,
    package: Change,
    package_template: Vec<u8>,
}

pub(super) fn prepare(
    system: &impl System,
    identity: &Identity,
    enabled: bool,
) -> Result<Plan, CommandError> {
    let desktop = system
        .data_home()
        .join("applications")
        .join(identity.desktop_id());
    let desktop_before = system.read(&desktop)?;
    let mut base = desktop_before.clone();
    if base.is_none() {
        for dir in system.data_dirs() {
            base = system.read(&dir.join("applications").join(identity.desktop_id()))?;
            if base.is_some() {
                break;
            }
        }
    }
    let associations = system.config_home().join("mimeapps.list");
    let associations_before = system.read(&associations)?;
    let package = system
        .data_home()
        .join("mime/packages")
        .join(identity.package_name());
    let package_before = system.read(&package)?;
    if let Some(bytes) = &package_before {
        entry::check_package(identity, bytes)?;
    }
    let template = entry::mime_package(identity)?;
    Ok(Plan {
        files: vec![
            Change {
                path: desktop,
                before: desktop_before,
                after: Some(entry::desktop(identity, base.as_deref(), enabled)?),
            },
            Change {
                path: associations,
                before: associations_before.clone(),
                after: Some(entry::associations(
                    identity,
                    associations_before.as_deref(),
                    enabled,
                )?),
            },
        ],
        package: Change {
            path: package,
            before: package_before,
            after: enabled.then(|| template.clone()),
        },
        package_template: template,
    })
}

fn verify(
    system: &impl System,
    change: &Change,
    expected: &Option<Vec<u8>>,
) -> Result<(), CommandError> {
    if &system.read(&change.path)? != expected {
        return Err(error(format!(
            "Linux association changed unexpectedly: {}",
            change.path.display()
        )));
    }
    Ok(())
}

fn restore_file(system: &impl System, change: &Change) -> Result<(), CommandError> {
    let current = system.read(&change.path)?;
    if current == change.before {
        return Ok(());
    }
    if current != change.after {
        return Err(error(
            "External or partial file change prevents compensation",
        ));
    }
    system.write(&change.path, change.before.as_deref())?;
    verify(system, change, &change.before)
}

pub(super) fn commit<T>(
    system: &impl System,
    plan: &Plan,
    persist: impl FnOnce() -> Result<T, CommandError>,
) -> Result<T, CommandError> {
    let mut attempted = Vec::new();
    let mut mime_attempted = false;
    let result = (|| {
        for change in &plan.files {
            verify(system, change, &change.before)?;
            if change.before != change.after {
                attempted.push(change);
                system.write(&change.path, change.after.as_deref())?;
                verify(system, change, &change.after)?;
            }
        }
        verify(system, &plan.package, &plan.package.before)?;
        if plan.package.before != plan.package.after {
            mime_attempted = true;
            system.mime(
                &plan.package.path,
                &plan.package_template,
                plan.package.after.is_some(),
            )?;
            verify(system, &plan.package, &plan.package.after)?;
        }
        if mime_attempted || !attempted.is_empty() {
            system.refresh()?;
        }
        for change in &plan.files {
            verify(system, change, &change.after)?;
        }
        verify(system, &plan.package, &plan.package.after)?;
        persist()
    })();
    if let Err(original) = &result {
        let mut failures = Vec::new();
        if mime_attempted {
            let restored = (|| {
                let current = system.read(&plan.package.path)?;
                if current == plan.package.before {
                    return Ok(());
                }
                if current != plan.package.after {
                    return Err(error(
                        "Partial MIME install or external edit prevents compensation",
                    ));
                }
                system.mime(
                    &plan.package.path,
                    plan.package
                        .before
                        .as_deref()
                        .unwrap_or(&plan.package_template),
                    plan.package.before.is_some(),
                )?;
                verify(system, &plan.package, &plan.package.before)
            })();
            if let Err(e) = restored {
                failures.push(e.to_string());
            }
        }
        for change in attempted.iter().rev() {
            if let Err(e) = restore_file(system, change) {
                failures.push(e.to_string());
            }
        }
        if mime_attempted || !attempted.is_empty() {
            if let Err(e) = system.refresh() {
                failures.push(e.to_string());
            }
        }
        if !failures.is_empty() {
            let failure = error(format!(
                "Linux registration failed ({original}); compensation failed: {}",
                failures.join("; ")
            ));
            log::error!("{failure}");
            return Err(failure);
        }
    }
    result
}

#[cfg(test)]
mod tests;
