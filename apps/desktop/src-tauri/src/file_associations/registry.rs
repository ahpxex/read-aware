//! Platform-independent Windows registry plan and compensation contract.
use crate::error::CommandError;

pub(super) fn unavailable(message: impl Into<String>) -> CommandError {
    CommandError::new("settings/unavailable", message)
}

pub(super) trait Registry {
    fn read(&self, key: &str, name: &str) -> Result<Option<String>, CommandError>;
    fn write(&self, key: &str, name: &str, value: Option<&str>) -> Result<(), CommandError>;
    fn notify(&self) -> Result<(), CommandError>;
}

pub(super) struct Identity {
    pub id: String,
    pub name: String,
    pub executable: String,
}

impl Identity {
    pub fn new(id: &str, name: &str, executable: &str) -> Result<Self, CommandError> {
        if id.is_empty()
            || !id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b".-".contains(&c))
            || name.is_empty()
            || name.chars().any(char::is_control)
            || executable.is_empty()
            || executable.contains(['"', '\0', '\n', '\r'])
        {
            return Err(unavailable(
                "Invalid file association identity or executable",
            ));
        }
        Ok(Self {
            id: id.into(),
            name: name.into(),
            executable: executable.into(),
        })
    }

    pub fn prog_id(&self) -> String {
        format!("{}.Book", self.id)
    }
    fn command(&self) -> String {
        format!("\"{}\" \"%1\"", self.executable)
    }
    fn icon(&self) -> String {
        format!("\"{}\",0", self.executable)
    }
}

pub(super) struct BookType {
    pub extensions: Vec<String>,
    pub legacy_class: String,
}

pub(super) fn book_types() -> Vec<BookType> {
    let config: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
        .expect("compile-time Tauri configuration");
    config["bundle"]["fileAssociations"]
        .as_array()
        .expect("book associations")
        .iter()
        .map(|entry| BookType {
            extensions: entry["ext"]
                .as_array()
                .expect("extensions")
                .iter()
                .map(|ext| ext.as_str().expect("extension").to_owned())
                .collect(),
            legacy_class: entry["name"].as_str().expect("legacy class").into(),
        })
        .collect()
}

pub(super) fn owns_legacy(
    registry: &impl Registry,
    identity: &Identity,
    class: &str,
) -> Result<bool, CommandError> {
    let command = registry.read(&format!("{class}\\shell\\open\\command"), "")?;
    if command.as_deref() != Some(&format!("{} \"%1\"", identity.executable))
        && command.as_deref() != Some(&identity.command())
    {
        return Ok(false);
    }
    let icon = registry.read(&format!("{class}\\DefaultIcon"), "")?;
    let label = registry.read(&format!("{class}\\shell\\open"), "")?;
    Ok(
        (command.as_deref() == Some(&format!("{} \"%1\"", identity.executable))
            || command.as_deref() == Some(&identity.command()))
            && (icon.as_deref() == Some(&format!("{},0", identity.executable))
                || icon.as_deref() == Some(&identity.icon()))
            && label.as_deref() == Some(&format!("Open with {}", identity.name)),
    )
}

#[derive(Debug)]
pub(super) struct Change {
    key: String,
    name: String,
    before: Option<String>,
    after: Option<String>,
}

fn change(
    registry: &impl Registry,
    changes: &mut Vec<Change>,
    key: String,
    name: String,
    after: Option<String>,
) -> Result<(), CommandError> {
    let before = registry.read(&key, &name)?;
    if before != after {
        changes.push(Change {
            key,
            name,
            before,
            after,
        });
    }
    Ok(())
}

pub(super) fn prepare(
    registry: &impl Registry,
    identity: &Identity,
    enabled: bool,
) -> Result<Vec<Change>, CommandError> {
    let prog_id = identity.prog_id();
    let owner = registry.read(&prog_id, "ReadAwareOwner")?;
    let existing = registry.read(&format!("{prog_id}\\shell\\open\\command"), "")?;
    if owner.as_deref().is_some_and(|owner| owner != identity.id)
        || (owner.is_none() && existing.is_some())
    {
        return Err(unavailable(
            "File association ProgID is not owned by this application",
        ));
    }
    if owner.is_none() {
        for suffix in ["", "\\DefaultIcon", "\\shell", "\\shell\\open"] {
            if registry.read(&format!("{prog_id}{suffix}"), "")?.is_some() {
                return Err(unavailable(
                    "Unmarked file association values cannot be overwritten",
                ));
            }
        }
    }
    let mut changes = Vec::new();
    // Keep a non-handler ownership marker while disabled. It lets a later
    // enable safely recognize the same namespace without relying on a path.
    change(
        registry,
        &mut changes,
        prog_id.clone(),
        "ReadAwareOwner".into(),
        Some(identity.id.clone()),
    )?;
    for (suffix, value) in [
        ("", format!("{} book", identity.name)),
        ("\\DefaultIcon", identity.icon()),
        ("\\shell", "open".into()),
        ("\\shell\\open", format!("Open with {}", identity.name)),
        ("\\shell\\open\\command", identity.command()),
    ] {
        change(
            registry,
            &mut changes,
            format!("{prog_id}{suffix}"),
            String::new(),
            enabled.then_some(value),
        )?;
    }
    for book_type in book_types() {
        let legacy = owns_legacy(registry, identity, &book_type.legacy_class)?;
        for ext in &book_type.extensions {
            change(
                registry,
                &mut changes,
                format!(".{ext}\\OpenWithProgids"),
                prog_id.clone(),
                enabled.then(String::new),
            )?;
            if legacy {
                let key = format!(".{ext}");
                let backup_name = format!("{}_backup", book_type.legacy_class);
                let backup = registry.read(&key, &backup_name)?;
                if registry.read(&key, "")?.as_deref() == Some(&book_type.legacy_class) {
                    let restored = backup
                        .clone()
                        .filter(|value| !value.is_empty() && value != &book_type.legacy_class);
                    change(registry, &mut changes, key.clone(), String::new(), restored)?;
                }
                change(registry, &mut changes, key, backup_name, None)?;
            }
        }
        if legacy {
            for suffix in [
                "\\shell\\open\\command",
                "\\shell\\open",
                "\\shell",
                "\\DefaultIcon",
                "",
            ] {
                change(
                    registry,
                    &mut changes,
                    format!("{}{suffix}", book_type.legacy_class),
                    String::new(),
                    None,
                )?;
            }
        }
    }
    Ok(changes)
}

fn verify(
    registry: &impl Registry,
    change: &Change,
    expected: &Option<String>,
) -> Result<(), CommandError> {
    if &registry.read(&change.key, &change.name)? != expected {
        return Err(unavailable(format!(
            "File association changed unexpectedly: {} / {}",
            change.key, change.name
        )));
    }
    Ok(())
}

pub(super) fn commit<T>(
    registry: &impl Registry,
    changes: &[Change],
    persist: impl FnOnce() -> Result<T, CommandError>,
) -> Result<T, CommandError> {
    let mut attempted = 0;
    let result = (|| {
        for change in changes {
            verify(registry, change, &change.before)?;
            attempted += 1;
            registry.write(&change.key, &change.name, change.after.as_deref())?;
            verify(registry, change, &change.after)?;
        }
        if !changes.is_empty() {
            registry.notify()?;
        }
        persist()
    })();
    if let Err(original) = &result {
        let mut failures = Vec::new();
        for change in changes[..attempted].iter().rev() {
            let restored = (|| {
                let current = registry.read(&change.key, &change.name)?;
                if current == change.before {
                    return Ok(());
                }
                if current != change.after {
                    return Err(unavailable("External registry edit prevents compensation"));
                }
                registry.write(&change.key, &change.name, change.before.as_deref())?;
                verify(registry, change, &change.before)
            })();
            if let Err(error) = restored {
                failures.push(error.to_string());
            }
        }
        if attempted > 0 {
            if let Err(error) = registry.notify() {
                failures.push(error.to_string());
            }
        }
        if !failures.is_empty() {
            let error = unavailable(format!(
                "File association update failed ({original}); compensation failed: {}",
                failures.join("; ")
            ));
            log::error!("{error}");
            return Err(error);
        }
    }
    result
}

#[cfg(test)]
mod tests;
