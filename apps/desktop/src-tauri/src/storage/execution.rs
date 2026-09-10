use crate::error::CommandError;

#[cfg(test)]
#[path = "execution_tests.rs"]
mod tests;

/// SQLite/FS work and mutex acquisition both belong off the UI and async
/// executor threads. Dropping the waiter does not roll back an accepted task.
pub(crate) async fn blocking<T: Send + 'static>(
    operation: &'static str,
    task: impl FnOnce() -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| {
            log::error!("{operation} storage task failed: {error}");
            CommandError::internal(format!("{operation} storage task failed"))
        })?
}
