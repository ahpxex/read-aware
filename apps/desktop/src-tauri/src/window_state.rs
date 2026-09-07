//! Desktop window placement is device-local, not a roaming preference. Keep
//! normal bounds separate from display mode so maximization/fullscreen never
//! overwrite the rectangle to which the user can restore the window.

use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, RunEvent, WebviewWindow, WindowEvent,
};

use crate::{error::CommandError, storage::Db};

const STORAGE_KEY: &str = "device:main-window-placement";
const SETTLE_TIME: Duration = Duration::from_millis(400);

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
struct Bounds {
    x: i32,
    y: i32,
    // Logical dimensions survive a change of monitor DPI.
    width: f64,
    height: f64,
}

impl Bounds {
    fn valid(self) -> bool {
        self.width.is_finite() && self.height.is_finite() && self.width > 0.0 && self.height > 0.0
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
struct Placement {
    normal: Bounds,
    maximized: bool,
    fullscreen: bool,
}

struct Observation {
    normal: Option<Bounds>,
    maximized: bool,
    fullscreen: bool,
}

impl Placement {
    fn update(&mut self, observation: Observation) {
        if let Some(bounds) = observation.normal.filter(|bounds| bounds.valid()) {
            self.normal = bounds;
        }
        // Fullscreen can temporarily report not-maximized. Preserve the mode
        // underneath it, as well as the normal rectangle.
        if !observation.fullscreen {
            self.maximized = observation.maximized;
        }
        self.fullscreen = observation.fullscreen;
    }
}

struct Tracker {
    placement: Mutex<Placement>,
    revision: AtomicU64,
    scheduled: AtomicBool,
    closing: AtomicBool,
}

struct WindowPlacement(Arc<Tracker>);

fn read(conn: &Connection) -> Result<Option<Placement>, CommandError> {
    let json: Option<String> = conn
        .query_row(
            "SELECT value_json FROM app_kv WHERE key = ?1",
            [STORAGE_KEY],
            |row| row.get(0),
        )
        .optional()?;
    json.map(|json| {
        let placement: Placement = serde_json::from_str(&json)?;
        if !placement.normal.valid() {
            return Err(CommandError::from(
                "invalid saved window dimensions".to_string(),
            ));
        }
        Ok(placement)
    })
    .transpose()
}

fn write(conn: &Connection, placement: &Placement) -> Result<(), CommandError> {
    conn.execute(
        "INSERT INTO app_kv (key, value_json, updated_at)
         VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        params![STORAGE_KEY, serde_json::to_string(placement)?],
    )?;
    Ok(())
}

fn normal_bounds(window: &WebviewWindow) -> tauri::Result<Bounds> {
    let position = window.outer_position()?;
    let size = window
        .inner_size()?
        .to_logical::<f64>(window.scale_factor()?);
    Ok(Bounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn observe(window: &WebviewWindow) -> tauri::Result<Option<Observation>> {
    // Minimized windows can report sentinel coordinates or lose their
    // maximized flag. Reopening uses the pre-minimize state, visibly.
    if window.is_minimized()? {
        return Ok(None);
    }
    let maximized = window.is_maximized()?;
    let fullscreen = window.is_fullscreen()?;
    Ok(Some(Observation {
        normal: if maximized || fullscreen {
            None
        } else {
            Some(normal_bounds(window)?)
        },
        maximized,
        fullscreen,
    }))
}

fn save(window: &WebviewWindow, tracker: &Tracker, revision: u64) -> Result<(), CommandError> {
    let observation = observe(window)?;
    let mut placement = tracker.placement.lock()?;
    if tracker.revision.load(Ordering::SeqCst) != revision {
        return Ok(());
    }
    if let Some(observation) = observation {
        placement.update(observation);
    }
    let db = window.state::<Db>();
    let conn = db.0.lock()?;
    write(&conn, &placement)
}

fn schedule(window: &WebviewWindow, tracker: &Arc<Tracker>) {
    if tracker.closing.load(Ordering::SeqCst) {
        return;
    }
    tracker.revision.fetch_add(1, Ordering::SeqCst);
    if tracker.scheduled.swap(true, Ordering::SeqCst) {
        return;
    }
    let window = window.clone();
    let tracker = tracker.clone();
    // One worker per resize/move burst. Native maximize animations can emit
    // intermediate bounds before the OS reports the new display mode.
    std::thread::spawn(move || loop {
        let revision = tracker.revision.load(Ordering::SeqCst);
        std::thread::sleep(SETTLE_TIME);
        if tracker.closing.load(Ordering::SeqCst) {
            break;
        }
        if tracker.revision.load(Ordering::SeqCst) != revision {
            continue;
        }
        if let Err(error) = save(&window, &tracker, revision) {
            log::warn!("could not save window placement: {error}");
        }
        tracker.scheduled.store(false, Ordering::SeqCst);
        if tracker.revision.load(Ordering::SeqCst) == revision
            || tracker.scheduled.swap(true, Ordering::SeqCst)
        {
            break;
        }
    });
}

#[derive(Clone, Copy)]
struct Screen {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
}

fn fit(bounds: Bounds, screens: &[Screen], minimum: (f64, f64)) -> Bounds {
    let screen = screens
        .iter()
        .find(|screen| {
            let x = f64::from(bounds.x) - f64::from(screen.x);
            let y = f64::from(bounds.y) - f64::from(screen.y);
            x >= 0.0 && y >= 0.0 && x < f64::from(screen.width) && y < f64::from(screen.height)
        })
        .or_else(|| screens.first());
    let Some(screen) = screen else { return bounds };
    let width = bounds.width.clamp(
        minimum.0,
        (f64::from(screen.width) / screen.scale).max(minimum.0),
    );
    let height = bounds.height.clamp(
        minimum.1,
        (f64::from(screen.height) / screen.scale).max(minimum.1),
    );
    let right = f64::from(screen.x) + (f64::from(screen.width) - width * screen.scale).max(0.0);
    let bottom = f64::from(screen.y) + (f64::from(screen.height) - height * screen.scale).max(0.0);
    Bounds {
        x: f64::from(bounds.x).clamp(f64::from(screen.x), right) as i32,
        y: f64::from(bounds.y).clamp(f64::from(screen.y), bottom) as i32,
        width,
        height,
    }
}

fn restore(window: &WebviewWindow, placement: &mut Placement) -> tauri::Result<()> {
    let screens: Vec<_> = window
        .available_monitors()?
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            Screen {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
                scale: monitor.scale_factor(),
            }
        })
        .collect();
    let config = window.app_handle().config();
    let config = config
        .app
        .windows
        .iter()
        .find(|config| config.label == window.label());
    let minimum = config
        .map(|config| {
            (
                config.min_width.unwrap_or(1.0),
                config.min_height.unwrap_or(1.0),
            )
        })
        .unwrap_or((1.0, 1.0));
    placement.normal = fit(placement.normal, &screens, minimum);
    let bounds = placement.normal;
    window.set_size(LogicalSize::new(bounds.width, bounds.height))?;
    // Some window managers (notably Wayland) do not allow applications to
    // position windows. That must not prevent restoring their display mode.
    if let Err(error) = window.set_position(PhysicalPosition::new(bounds.x, bounds.y)) {
        log::warn!("could not restore window position: {error}");
    }
    if placement.maximized {
        window.maximize()?;
    }
    if placement.fullscreen {
        window.set_fullscreen(true)?;
    }
    Ok(())
}

pub fn restore_and_track(window: &WebviewWindow) -> tauri::Result<()> {
    let normal = normal_bounds(window).unwrap_or_else(|error| {
        log::warn!("could not read initial window bounds: {error}");
        let config = window.app_handle().config();
        let config = config
            .app
            .windows
            .iter()
            .find(|config| config.label == window.label());
        Bounds {
            x: 0,
            y: 0,
            width: config.map_or(1200.0, |config| config.width),
            height: config.map_or(800.0, |config| config.height),
        }
    });
    let fallback = Placement {
        normal,
        maximized: false,
        fullscreen: false,
    };
    let saved = (|| -> Result<_, CommandError> {
        let db = window.state::<Db>();
        let conn = db.0.lock()?;
        read(&conn)
    })();
    let mut placement = match saved {
        Ok(Some(placement)) => placement,
        Ok(None) => fallback,
        Err(error) => {
            log::warn!("could not read window placement: {error}");
            fallback
        }
    };
    if let Err(error) = restore(window, &mut placement) {
        log::warn!("could not restore window placement: {error}");
    }
    let tracker = Arc::new(Tracker {
        placement: Mutex::new(placement),
        revision: AtomicU64::new(0),
        scheduled: AtomicBool::new(false),
        closing: AtomicBool::new(false),
    });
    window.manage(WindowPlacement(tracker.clone()));
    let tracked_window = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_)
        | WindowEvent::Resized(_)
        | WindowEvent::ScaleFactorChanged { .. }
        | WindowEvent::Focused(_) => schedule(&tracked_window, &tracker),
        WindowEvent::CloseRequested { .. } => flush(&tracked_window, &tracker),
        _ => {}
    });
    window.show()?;
    if let Err(error) = window.set_focus() {
        log::warn!("could not focus restored window: {error}");
    }
    Ok(())
}

fn flush(window: &WebviewWindow, tracker: &Tracker) {
    tracker.closing.store(true, Ordering::SeqCst);
    let revision = tracker.revision.fetch_add(1, Ordering::SeqCst) + 1;
    if let Err(error) = save(window, tracker, revision) {
        log::warn!("could not save window placement on exit: {error}");
    }
}

pub fn on_app_event(app: &AppHandle, event: &RunEvent) {
    if matches!(event, RunEvent::ExitRequested { .. }) {
        if let (Some(window), Some(tracker)) = (
            app.get_webview_window("main"),
            app.try_state::<WindowPlacement>(),
        ) {
            flush(&window, &tracker.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn placement() -> Placement {
        Placement {
            normal: Bounds {
                x: 100,
                y: 120,
                width: 1030.0,
                height: 690.0,
            },
            maximized: false,
            fullscreen: false,
        }
    }

    #[test]
    fn display_modes_never_overwrite_normal_bounds() {
        let mut state = placement();
        state.update(Observation {
            normal: None,
            maximized: true,
            fullscreen: false,
        });
        assert!(state.maximized);
        state.update(Observation {
            normal: None,
            maximized: false,
            fullscreen: true,
        });
        assert!(state.maximized && state.fullscreen);
        assert_eq!(state.normal, placement().normal);
        state.update(Observation {
            normal: Some(placement().normal),
            maximized: false,
            fullscreen: false,
        });
        assert_eq!(state, placement());
    }

    #[test]
    fn empty_resize_events_do_not_replace_normal_bounds() {
        let mut state = placement();
        state.update(Observation {
            normal: Some(Bounds {
                width: 0.0,
                ..state.normal
            }),
            maximized: false,
            fullscreen: false,
        });
        assert_eq!(state, placement());
    }

    #[test]
    fn sqlite_round_trip_and_corrupt_state() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE app_kv (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)").unwrap();
        assert_eq!(read(&conn).unwrap(), None);
        let mut state = placement();
        state.fullscreen = true;
        write(&conn, &state).unwrap();
        assert_eq!(read(&conn).unwrap(), Some(state));
        write(&conn, &placement()).unwrap();
        assert_eq!(read(&conn).unwrap(), Some(placement()));
        conn.execute("UPDATE app_kv SET value_json = 'broken'", [])
            .unwrap();
        assert!(read(&conn).is_err());
        state.normal.width = -1.0;
        write(&conn, &state).unwrap();
        assert!(read(&conn).is_err());
    }

    #[test]
    fn disconnected_monitors_and_dpi_changes_leave_window_reachable() {
        let screen = Screen {
            x: 0,
            y: 50,
            width: 1920,
            height: 1030,
            scale: 1.0,
        };
        let bounds = Bounds {
            x: 4000,
            y: -1500,
            width: 2400.0,
            height: 1600.0,
        };
        assert_eq!(
            fit(bounds, &[screen], (900.0, 600.0)),
            Bounds {
                x: 0,
                y: 50,
                width: 1920.0,
                height: 1030.0
            }
        );
        let retina = Screen {
            width: 3840,
            height: 2160,
            scale: 2.0,
            ..screen
        };
        assert_eq!(
            fit(placement().normal, &[retina], (900.0, 600.0)),
            placement().normal
        );
    }

    #[test]
    fn secondary_monitor_negative_coordinates_and_minimum_size_are_supported() {
        let screen = Screen {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
            scale: 1.0,
        };
        let bounds = Bounds {
            x: -1800,
            y: 40,
            width: 500.0,
            height: 300.0,
        };
        assert_eq!(
            fit(bounds, &[screen], (900.0, 600.0)),
            Bounds {
                width: 900.0,
                height: 600.0,
                ..bounds
            }
        );
        assert_eq!(
            fit(placement().normal, &[], (900.0, 600.0)),
            placement().normal
        );
    }
}
