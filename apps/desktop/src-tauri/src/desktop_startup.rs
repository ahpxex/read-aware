//! OS startup registration and preference commits share the storage mutex.
//! The OS and SQLite cannot commit atomically; a failed commit compensates the
//! OS change, and a failed compensation is reported instead of claiming rollback.
use crate::error::CommandError;

pub const GENERAL_KEY: &str = "read-aware-general-settings";

pub(crate) trait Startup {
    fn enabled(&self) -> Result<bool, CommandError>;
    fn set_enabled(&self, enabled: bool) -> Result<(), CommandError>;
}

pub(crate) struct NativeStartup<'a>(pub &'a tauri::AppHandle);

impl Startup for NativeStartup<'_> {
    fn enabled(&self) -> Result<bool, CommandError> {
        #[cfg(desktop)]
        {
            use tauri_plugin_autostart::ManagerExt;
            self.0.autolaunch().is_enabled().map_err(|error| {
                CommandError::new(
                    "settings/unavailable",
                    format!("Reading startup registration: {error}"),
                )
            })
        }
        #[cfg(not(desktop))]
        Err(CommandError::new(
            "ui/unavailable",
            "Startup registration requires desktop",
        ))
    }

    fn set_enabled(&self, enabled: bool) -> Result<(), CommandError> {
        #[cfg(desktop)]
        {
            use tauri_plugin_autostart::ManagerExt;
            let manager = self.0.autolaunch();
            (if enabled {
                manager.enable()
            } else {
                manager.disable()
            })
            .map_err(|error| {
                CommandError::new(
                    "settings/unavailable",
                    format!("Changing startup registration: {error}"),
                )
            })
        }
        #[cfg(not(desktop))]
        {
            let _ = enabled;
            Err(CommandError::new(
                "ui/unavailable",
                "Startup registration requires desktop",
            ))
        }
    }
}

pub(crate) fn preference(value: Option<&str>) -> Result<bool, CommandError> {
    let Some(value) = value else {
        return Ok(false);
    };
    let parsed: serde_json::Value = serde_json::from_str(value).map_err(|error| {
        CommandError::new(
            "plugin/invalid-argument",
            format!("Invalid general settings: {error}"),
        )
    })?;
    let fields = parsed.as_object().ok_or_else(|| {
        CommandError::new(
            "plugin/invalid-argument",
            "General settings must be an object",
        )
    })?;
    match fields.get("launchAtStartup") {
        None => Ok(false),
        Some(serde_json::Value::Bool(value)) => Ok(*value),
        _ => Err(CommandError::new(
            "plugin/invalid-argument",
            "launchAtStartup must be a boolean",
        )),
    }
}

fn apply(startup: &impl Startup, enabled: bool) -> Result<(), CommandError> {
    startup.set_enabled(enabled)?;
    if startup.enabled()? != enabled {
        return Err(CommandError::new(
            "settings/unavailable",
            "Startup registration did not retain the requested state",
        ));
    }
    Ok(())
}

pub(crate) fn commit<T>(
    startup: &impl Startup,
    desired: bool,
    persist: impl FnOnce() -> Result<T, CommandError>,
) -> Result<T, CommandError> {
    let before = startup.enabled()?;
    if before == desired {
        return persist();
    }
    // Even an unsuccessful OS write can have partially changed its file/registry.
    let result = apply(startup, desired).and_then(|()| persist());
    if let Err(error) = &result {
        if let Err(rollback) = apply(startup, before) {
            log::error!(
                "Startup registration compensation failed: {rollback}; original failure: {error}"
            );
            return Err(CommandError::new("settings/unavailable", format!(
                "Startup setting failed ({error}); OS rollback also failed ({rollback}); query actual state before retrying")));
        }
    }
    result
}

pub(crate) fn commit_entries<T>(
    app: &tauri::AppHandle,
    entries: &[(String, Option<String>)],
    persist: impl FnOnce() -> Result<T, CommandError>,
) -> Result<T, CommandError> {
    let Some((_, value)) = entries.iter().rev().find(|(key, _)| key == GENERAL_KEY) else {
        return persist();
    };
    let desired = preference(value.as_deref())?;
    #[cfg(desktop)]
    return commit(&NativeStartup(app), desired, persist);
    #[cfg(not(desktop))]
    {
        let _ = app;
        if desired {
            return Err(CommandError::new(
                "ui/unavailable",
                "Startup registration requires desktop",
            ));
        }
        persist()
    }
}

#[tauri::command]
pub async fn desktop_startup_enabled(app: tauri::AppHandle) -> Result<bool, CommandError> {
    crate::storage::blocking("desktop_startup_enabled", move || {
        let db = tauri::Manager::state::<crate::storage::Db>(&app);
        let _guard = db.0.lock()?;
        NativeStartup(&app).enabled()
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[derive(Default)]
    struct Fake {
        enabled: Cell<bool>,
        calls: RefCell<Vec<bool>>,
        fail_read: Cell<bool>,
        fail_write: Cell<bool>,
        ignore_write: Cell<bool>,
    }
    impl Startup for Fake {
        fn enabled(&self) -> Result<bool, CommandError> {
            if self.fail_read.get() {
                return Err(CommandError::new(
                    "settings/unavailable",
                    "injected read failure",
                ));
            }
            Ok(self.enabled.get())
        }
        fn set_enabled(&self, value: bool) -> Result<(), CommandError> {
            self.calls.borrow_mut().push(value);
            if !self.ignore_write.get() {
                self.enabled.set(value);
            }
            if self.fail_write.replace(false) {
                return Err(CommandError::new(
                    "settings/unavailable",
                    "injected partial write",
                ));
            }
            Ok(())
        }
    }

    #[test]
    fn parses_only_strict_boolean_or_default_and_preserves_unrelated_fields() {
        assert!(!preference(None).unwrap());
        assert!(!preference(Some(r#"{"language":"en"}"#)).unwrap());
        assert!(preference(Some(r#"{"launchAtStartup":true,"future":{}}"#)).unwrap());
        for raw in [
            "[]",
            "null",
            "broken",
            r#"{"launchAtStartup":1}"#,
            r#"{"launchAtStartup":"true"}"#,
        ] {
            assert_eq!(
                preference(Some(raw)).unwrap_err().code,
                "plugin/invalid-argument"
            );
        }
    }

    #[test]
    fn native_success_is_verified_before_database_commit_and_disable_is_real() {
        let os = Fake::default();
        commit(&os, true, || {
            assert!(os.enabled.get());
            Ok(())
        })
        .unwrap();
        commit(&os, false, || {
            assert!(!os.enabled.get());
            Ok(())
        })
        .unwrap();
        assert_eq!(*os.calls.borrow(), [true, false]);
        commit(&os, false, || Ok(())).unwrap();
        assert_eq!(os.calls.borrow().len(), 2);
    }

    #[test]
    fn sqlite_commit_failure_restores_original_os_state_and_stable_error() {
        let os = Fake::default();
        let error = commit(&os, true, || {
            Err::<(), _>(CommandError::new("db/locked", "injected commit failure"))
        })
        .unwrap_err();
        assert_eq!(error.code, "db/locked");
        assert!(!os.enabled.get());
        assert_eq!(*os.calls.borrow(), [true, false]);
    }

    #[test]
    fn read_failure_does_not_write_and_partial_os_failure_is_compensated() {
        let os = Fake::default();
        os.fail_read.set(true);
        assert!(commit::<()>(&os, true, || panic!("must not persist")).is_err());
        assert!(os.calls.borrow().is_empty());
        os.fail_read.set(false);
        os.fail_write.set(true);
        assert!(commit::<()>(&os, true, || panic!("must not persist")).is_err());
        assert!(!os.enabled.get());
        assert_eq!(*os.calls.borrow(), [true, false]);
    }

    #[test]
    fn unchanged_os_write_is_not_a_successful_settings_commit() {
        let os = Fake::default();
        os.ignore_write.set(true);
        assert!(commit::<()>(&os, true, || panic!("must not persist")).is_err());
    }

    #[test]
    fn failed_compensation_does_not_pretend_the_os_was_restored() {
        let os = Fake::default();
        let error = commit(&os, true, || {
            os.ignore_write.set(true);
            Err::<(), _>(CommandError::new("db/locked", "injected database failure"))
        })
        .unwrap_err();
        assert!(os.enabled.get());
        assert_eq!(error.code, "settings/unavailable");
        assert!(error.message.contains("rollback also failed"));
    }
}
