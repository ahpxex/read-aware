//! IPC commands over `read_aware_store::storage::durable_jobs`.
use crate::storage::*;

#[tauri::command]
pub async fn durable_job_get(
    owner: String,
    id: String,
    app: tauri::AppHandle,
) -> Result<Option<DurableJobRecord>, CommandError> {
    crate::storage::blocking("durable_job_get", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let conn = db.0.lock()?;
        durable_job_get_inner(&conn, &owner, &id)
    })
    .await
}

#[tauri::command]
pub async fn durable_job_create(
    owner: String,
    id: String,
    plan: Value,
    source: Option<Value>,
    app: tauri::AppHandle,
) -> Result<DurableJobRecord, CommandError> {
    crate::storage::blocking("durable_job_create", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        durable_job_create_with_source_inner(&mut conn, &owner, &id, plan, source)
    })
    .await
}

#[tauri::command]
pub async fn durable_job_checkpoint(
    owner: String,
    id: String,
    expected_revision: String,
    state: Value,
    app: tauri::AppHandle,
) -> Result<DurableJobRecord, CommandError> {
    crate::storage::blocking("durable_job_checkpoint", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        durable_job_checkpoint_inner(&mut conn, &owner, &id, &expected_revision, state)
    })
    .await
}

#[tauri::command]
pub async fn durable_job_list(
    owner: String,
    offset: usize,
    limit: usize,
    app: tauri::AppHandle,
) -> Result<Vec<DurableJobRecord>, CommandError> {
    crate::storage::blocking("durable_job_list", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        durable_job_list_inner(&mut conn, &owner, offset, limit)
    })
    .await
}

/// Startup discovery is host-only and reveals no plans or plugin owners.
#[tauri::command]
pub async fn durable_agent_job_owners(app: tauri::AppHandle) -> Result<Vec<String>, CommandError> {
    crate::storage::blocking("durable_agent_job_owners", move || {
        let db = tauri::Manager::state::<Db>(&app); let conn = db.0.lock()?;
        let mut stmt = conn.prepare("SELECT DISTINCT owner FROM durable_jobs WHERE owner LIKE 'agent:%' AND json_extract(state_json,'$.status') IN ('queued','running') ORDER BY owner LIMIT 256")?;
        let owners = stmt.query_map([], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>,_>>()?;
        Ok(owners)
    }).await
}
