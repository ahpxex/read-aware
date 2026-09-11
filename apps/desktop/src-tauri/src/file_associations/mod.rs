//! File-handler registration is separate from external-open intake policy.
#[cfg(any(target_os = "windows", test))]
mod registry;
#[cfg(target_os = "windows")]
mod windows;

use crate::error::CommandError;

pub(crate) fn commit<T>(
    app: &tauri::AppHandle,
    enabled: bool,
    persist: impl FnOnce() -> Result<T, CommandError>,
) -> Result<T, CommandError> {
    #[cfg(target_os = "windows")]
    {
        let registry = windows::UserRegistry;
        let identity = registry::Identity::new(
            &app.config().identifier,
            app.config().product_name.as_deref().unwrap_or("ReadAware"),
            std::env::current_exe()?.to_str().ok_or_else(|| {
                CommandError::new("settings/unavailable", "Executable path is not Unicode")
            })?,
        )?;
        windows::check_machine_legacy(&identity)?;
        let changes = registry::prepare(&registry, &identity, enabled)?;
        registry::commit(&registry, &changes, persist)
    }
    #[cfg(not(target_os = "windows"))]
    {
        // macOS uses immutable bundle declarations. Linux registration is still
        // pending; neither branch pretends that intake alone unregisters a type.
        let _ = (app, enabled);
        persist()
    }
}
