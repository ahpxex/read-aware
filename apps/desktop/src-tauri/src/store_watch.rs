//! Tell the webview when another process committed to the library.
//!
//! The `ra` CLI writes the same SQLite store while the app runs. Nothing in
//! this process sees those commits: the frontend learns about changes only
//! from its own writes and sync pulls. SQLite's `PRAGMA data_version` changes
//! exactly when a *different* connection committed, so polling it on the
//! app's own connection reports CLI writes and never the app's own.
use crate::storage::Db;
use std::time::Duration;
use tauri::{Emitter, Manager};

pub const EVENT: &str = "store-changed-externally";
const INTERVAL: Duration = Duration::from_secs(1);

pub fn start(app: tauri::AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("store-watch".into())
        .spawn(move || {
            let mut seen: Option<i64> = None;
            loop {
                std::thread::sleep(INTERVAL);
                let version = {
                    let db = app.state::<Db>();
                    let conn = match db.0.lock() {
                        Ok(conn) => conn,
                        Err(error) => {
                            log::warn!("store watch could not lock the database: {error}");
                            continue;
                        }
                    };
                    conn.query_row("PRAGMA data_version", [], |row| row.get::<_, i64>(0))
                };
                let version = match version {
                    Ok(version) => version,
                    Err(error) => {
                        log::warn!("store watch could not read data_version: {error}");
                        continue;
                    }
                };
                if seen.is_some_and(|previous| previous != version) {
                    if let Err(error) = app.emit(EVENT, ()) {
                        log::warn!("store watch could not notify the webview: {error}");
                    }
                }
                seen = Some(version);
            }
        });
    if let Err(error) = spawned {
        log::error!(
            "store watch thread failed to start; CLI writes will show after a reload: {error}"
        );
    }
}
