//! Coordinated app quit. A system-initiated exit (Cmd+Q, last window) is deferred once so the
//! webview can flush reading traces, plugin writes and queued KV; the webview confirms through
//! `app_exit_confirm`, and a fallback timer exits regardless so a stalled webview cannot pin the process.
use crate::error::CommandError;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct ExitCoordination {
    requested: AtomicBool,
    confirmed: AtomicBool,
}

pub const FALLBACK: Duration = Duration::from_secs(10);

/// Returns whether the exit may proceed now. `code` is `Some` only for programmatic `app.exit`,
/// which is how the confirmed (or timed-out) coordination re-enters this hook.
pub fn on_exit_requested(app: &AppHandle, code: Option<i32>) -> bool {
    let Some(state) = app.try_state::<ExitCoordination>() else { return true };
    if code.is_some() || state.confirmed.load(Ordering::SeqCst) {
        return true;
    }
    if state.requested.swap(true, Ordering::SeqCst) {
        return false;
    }
    if app.get_webview_window("main").is_none() {
        state.confirmed.store(true, Ordering::SeqCst);
        return true;
    }
    if let Err(error) = app.emit("app-exit-requested", ()) {
        log::warn!("could not ask the webview to prepare for exit: {error}");
        state.confirmed.store(true, Ordering::SeqCst);
        return true;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FALLBACK);
        if let Some(state) = handle.try_state::<ExitCoordination>() {
            if !state.confirmed.swap(true, Ordering::SeqCst) {
                log::warn!("exit coordination timed out; exiting without the webview's confirmation");
                handle.exit(0);
            }
        }
    });
    false
}

#[tauri::command]
pub fn app_exit_confirm(app: AppHandle) -> Result<(), CommandError> {
    let state = app.state::<ExitCoordination>();
    if !state.requested.load(Ordering::SeqCst) {
        return Err(CommandError::new("ui/invalid-target", "No exit is being coordinated"));
    }
    if !state.confirmed.swap(true, Ordering::SeqCst) {
        app.exit(0);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coordination_flags_are_single_shot() {
        let state = ExitCoordination::default();
        assert!(!state.requested.swap(true, Ordering::SeqCst));
        assert!(state.requested.swap(true, Ordering::SeqCst));
        assert!(!state.confirmed.swap(true, Ordering::SeqCst));
        assert!(state.confirmed.load(Ordering::SeqCst));
    }
}
