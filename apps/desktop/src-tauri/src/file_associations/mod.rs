//! File-handler registration is separate from external-open intake policy.
#[cfg(any(target_os = "windows", target_os = "linux", test))]
mod catalog;
#[cfg(any(target_os = "linux", test))]
mod linux;
#[cfg(any(target_os = "linux", test))]
mod linux_entry;
#[cfg(target_os = "linux")]
mod linux_native;
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
    #[cfg(target_os = "linux")]
    {
        use tauri::Manager;
        let executable = app
            .env()
            .appimage
            .map(std::path::PathBuf::from)
            .unwrap_or(std::env::current_exe()?);
        let binary = std::env::current_exe()?;
        let identity = linux_entry::Identity::new(
            &app.config().identifier,
            app.config().product_name.as_deref().unwrap_or("ReadAware"),
            executable
                .to_str()
                .ok_or_else(|| linux_entry::error("Executable path is not Unicode"))?,
            binary
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| linux_entry::error("Invalid binary name"))?,
        )?;
        let system =
            linux_native::NativeSystem::new(app.path().data_dir()?, app.path().config_dir()?)?;
        let plan = linux::prepare(&system, &identity, enabled)?;
        linux::commit(&system, &plan, persist)
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        // macOS uses immutable bundle declarations and gates delivered files.
        let _ = (app, enabled);
        persist()
    }
}
