//! Durable general preferences and native consumers have one publication point.
use crate::error::CommandError;
use rusqlite::{Connection, OptionalExtension};
use tauri::Manager;

pub const GENERAL_KEY: &str = "read-aware-general-settings";

#[derive(serde::Deserialize, Debug)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct DesktopPreferences {
    pub launch_at_startup: bool,
    pub file_associations: bool,
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            launch_at_startup: false,
            file_associations: true,
        }
    }
}

pub(crate) fn parse(value: Option<&str>) -> Result<DesktopPreferences, CommandError> {
    value.map_or_else(
        || Ok(DesktopPreferences::default()),
        |value| {
            let parsed: serde_json::Value = serde_json::from_str(value).map_err(|error| {
                CommandError::new(
                    "plugin/invalid-argument",
                    format!("Invalid general settings: {error}"),
                )
            })?;
            if !parsed.is_object() {
                return Err(CommandError::new(
                    "plugin/invalid-argument",
                    "General settings must be an object",
                ));
            }
            serde_json::from_value(parsed).map_err(|error| {
                CommandError::new(
                    "plugin/invalid-argument",
                    format!("Invalid desktop preferences: {error}"),
                )
            })
        },
    )
}

/// Boot-time read degrades a malformed persisted blob to defaults — the
/// frontend parser does the same for its own copy — instead of refusing to
/// start over a settings value.
fn stored_file_associations(value: Option<&str>) -> bool {
    match parse(value) {
        Ok(preferences) => preferences.file_associations,
        Err(error) => {
            log::warn!("Stored desktop preferences are invalid, using defaults: {error}");
            DesktopPreferences::default().file_associations
        }
    }
}

pub(crate) fn initialize(app: &tauri::AppHandle, conn: &Connection) -> Result<(), CommandError> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value_json FROM app_kv WHERE key = ?1",
            [GENERAL_KEY],
            |row| row.get(0),
        )
        .optional()?;
    let enabled = stored_file_associations(stored.as_deref());
    let queue = app.state::<crate::external_open::ExternalOpenQueue>();
    // OS registration must not hold boot hostage: a registry/conflict failure
    // leaves our ProgID unwritten, but external opens can still arrive through
    // associations the user created themselves — publish the intake policy.
    if let Err(error) = crate::file_associations::commit(app, enabled, || queue.publish(enabled)) {
        log::error!("File association registration failed: {error}");
        if let Err(error) = queue.publish(enabled) {
            log::error!("External file intake policy could not be published: {error}");
        }
    }
    Ok(())
}

/// Caller holds Db. The queue is locked only around SQLite persistence, never
/// around a potentially slow OS operation. A failed commit publishes nothing.
pub(crate) fn commit_entries<T>(
    app: &tauri::AppHandle,
    entries: &[(String, Option<String>)],
    persist: impl FnOnce() -> Result<T, CommandError>,
) -> Result<T, CommandError> {
    let Some((_, value)) = entries.iter().rev().find(|(key, _)| key == GENERAL_KEY) else {
        return persist();
    };
    let desired = parse(value.as_deref())?;
    let publish = || {
        app.state::<crate::external_open::ExternalOpenQueue>()
            .commit(desired.file_associations, value.is_none(), persist)
    };
    #[cfg(desktop)]
    return crate::desktop_startup::commit(
        &crate::desktop_startup::NativeStartup(app),
        desired.launch_at_startup,
        || crate::file_associations::commit(app, desired.file_associations, publish),
    );
    #[cfg(not(desktop))]
    {
        if desired.launch_at_startup {
            return Err(CommandError::new(
                "ui/unavailable",
                "Startup registration requires desktop",
            ));
        }
        publish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_flags_have_explicit_defaults_and_reject_non_booleans() {
        let defaults = parse(None).unwrap();
        assert!(!defaults.launch_at_startup);
        assert!(defaults.file_associations);
        let flags = parse(Some(
            r#"{"launchAtStartup":true,"fileAssociations":false,"language":"en"}"#,
        ))
        .unwrap();
        assert!(flags.launch_at_startup);
        assert!(!flags.file_associations);
        for value in [
            "null",
            "[]",
            "false",
            r#"{"fileAssociations":1}"#,
            r#"{"launchAtStartup":"true"}"#,
        ] {
            assert_eq!(
                parse(Some(value)).unwrap_err().code,
                "plugin/invalid-argument"
            );
        }
    }

    #[test]
    fn malformed_stored_preferences_fall_back_to_defaults_at_boot() {
        assert!(stored_file_associations(None));
        assert!(stored_file_associations(Some("{not json")));
        assert!(stored_file_associations(Some(r#"{"fileAssociations":1}"#)));
        assert!(!stored_file_associations(Some(
            r#"{"fileAssociations":false}"#
        )));
    }
}
