mod storage;

use std::sync::Mutex;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let conn = storage::init_db(app.handle()).expect("failed to initialize database");
            app.manage(storage::Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            storage::append_events,
            storage::read_events_since,
            storage::put_blob,
            storage::get_blob,
            storage::delete_blob,
            storage::upsert_vectors,
            storage::query_vectors,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ReadAware desktop application");
}
