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

/// OS calls only the main (UI) thread may make — AppKit windows and fonts,
/// JNI into the Android activity — hop there, and the command awaits the
/// result without blocking any thread. The task runs on the UI thread, so it
/// must stay brief and never wait on I/O or locks.
#[cfg(any(target_os = "macos", target_os = "android"))]
pub(crate) async fn on_main_thread<T: Send + 'static>(
    app: &tauri::AppHandle,
    task: impl FnOnce() -> T + Send + 'static,
) -> Result<T, CommandError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        // The waiter may have gone away; the task still ran to completion.
        let _ = sender.send(task());
    })
    .map_err(crate::tauri_error::tauri_error)?;
    receiver
        .await
        .map_err(|_| CommandError::internal("main-thread task was dropped before it ran"))
}
