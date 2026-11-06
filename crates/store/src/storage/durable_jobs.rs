//! Host-owned immutable plans and revision-checked checkpoints. No plugin/Agent
//! receives this raw state interface; public ports authorize the whole plan.
use super::*;
use rusqlite::OptionalExtension;

fn invalid(message: &str) -> CommandError {
    CommandError::new("jobs/invalid-plan", message)
}
fn identity(owner: &str, id: &str) -> Result<(), CommandError> {
    if owner.is_empty() || owner.len() > 512 || id.is_empty() || id.len() > 128 {
        return Err(invalid("Invalid job identity"));
    }
    Ok(())
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DurableJobRecord {
    owner: String,
    id: String,
    plan: Value,
    state: Value,
    revision: String,
    created_at: String,
    updated_at: String,
}
pub(crate) fn durable_job_get_inner(
    conn: &Connection,
    owner: &str,
    id: &str,
) -> Result<Option<DurableJobRecord>, CommandError> {
    identity(owner, id)?;
    let row: Option<(String,String,String,String,String)> = conn.query_row(
        "SELECT plan_json,state_json,revision,created_at,updated_at FROM durable_jobs WHERE owner=?1 AND id=?2",
        params![owner,id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?)),
    ).optional()?;
    row.map(|(plan, state, revision, created_at, updated_at)| {
        Ok(DurableJobRecord {
            owner: owner.into(),
            id: id.into(),
            plan: serde_json::from_str(&plan)?,
            state: serde_json::from_str(&state)?,
            revision,
            created_at,
            updated_at,
        })
    })
    .transpose()
}
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

pub(crate) fn validate_source(source: &Value) -> Result<(), CommandError> {
    let text = |value: &Value, max: usize| {
        value.as_str().is_some_and(|s| {
            !s.is_empty() && s.encode_utf16().count() <= max && !s.chars().any(char::is_control)
        })
    };
    let object = source
        .as_object()
        .ok_or_else(|| invalid("Invalid job source"))?;
    let paths = source["paths"]
        .as_array()
        .ok_or_else(|| invalid("Invalid job source paths"))?;
    if object
        .keys()
        .any(|key| !["version", "root", "paths"].contains(&key.as_str()))
        || source["version"] != 1
        || !text(&source["root"], 128)
        || paths.is_empty()
        || paths.len() > 32
        || source.to_string().len() > 1024 * 1024
    {
        return Err(invalid("Invalid job source"));
    }
    let mut roots = std::collections::HashSet::new();
    for path in paths {
        let object = path
            .as_object()
            .ok_or_else(|| invalid("Invalid job source branch"))?;
        let steps = path["steps"]
            .as_array()
            .ok_or_else(|| invalid("Invalid job source steps"))?;
        let root = path["root"]
            .as_str()
            .filter(|_| text(&path["root"], 128))
            .ok_or_else(|| invalid("Invalid job source branch"))?;
        if object
            .keys()
            .any(|key| !["root", "steps"].contains(&key.as_str()))
            || !roots.insert(root)
            || steps.len() > 32
            || steps.iter().any(|step| !text(step, 512))
        {
            return Err(invalid("Invalid job source branch"));
        }
    }
    Ok(())
}
pub(crate) fn durable_job_create_with_source_inner(
    conn: &mut Connection,
    owner: &str,
    id: &str,
    plan: Value,
    source: Option<Value>,
) -> Result<DurableJobRecord, CommandError> {
    identity(owner, id)?;
    if let Some(value) = &source {
        validate_source(value)?;
    }
    let steps = plan
        .get("steps")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Missing job steps"))?;
    if steps.is_empty()
        || steps.len() > 32
        || plan
            .get("title")
            .and_then(Value::as_str)
            .is_none_or(|title| title.is_empty() || title.len() > 640)
    {
        return Err(invalid("Invalid job plan"));
    }
    let json = plan.to_string();
    if json.len() > 1024 * 1024 {
        return Err(invalid("Job plan exceeds 1 MiB"));
    }
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(previous) = durable_job_get_inner(&tx, owner, id)? {
        if previous.plan != plan || previous.state.get("source") != source.as_ref() {
            return Err(invalid("Job identity was used for another plan or source"));
        }
        return Ok(previous);
    }
    let (count, bytes): (i64,i64) = tx.query_row("SELECT count(*),COALESCE(sum(length(plan_json)+length(state_json)),0) FROM durable_jobs WHERE owner=?1", [owner], |row| Ok((row.get(0)?,row.get(1)?)))?;
    let mut initial = serde_json::json!({"status":"queued","nextStep":0,"attempt":null,"results":[],"errorCode":null});
    if let Some(value) = source {
        initial["source"] = value;
    }
    let state_json = initial.to_string();
    if count >= 256 || bytes + json.len() as i64 + state_json.len() as i64 > 64 * 1024 * 1024 {
        return Err(CommandError::new(
            "jobs/quota-exceeded",
            "Job storage is full",
        ));
    }
    tx.execute("INSERT INTO durable_jobs(owner,id,plan_json,state_json,revision,created_at,updated_at)
        VALUES (?1,?2,?3,?4,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        params![owner,id,json,state_json])?;
    let record = durable_job_get_inner(&tx, owner, id)?
        .ok_or_else(|| invalid("Job creation lost its row"))?;
    tx.commit()?;
    Ok(record)
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

pub(crate) fn durable_job_checkpoint_inner(
    conn: &mut Connection,
    owner: &str,
    id: &str,
    expected: &str,
    state: Value,
) -> Result<DurableJobRecord, CommandError> {
    identity(owner, id)?;
    let json = state.to_string();
    if json.len() > 4 * 1024 * 1024 {
        return Err(invalid("Job checkpoint exceeds 4 MiB"));
    }
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let before = durable_job_get_inner(&tx, owner, id)?
        .ok_or_else(|| CommandError::new("jobs/not-found", "Job not found"))?;
    if before.revision != expected {
        return Err(CommandError::new("jobs/conflict", "Job checkpoint changed"));
    }
    if state.get("source") != before.state.get("source") {
        return Err(invalid("Job source is immutable"));
    }
    let count = before.plan["steps"]
        .as_array()
        .ok_or_else(|| invalid("Stored job plan has no steps"))?
        .len();
    let next = state
        .get("nextStep")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid("Missing next step"))? as usize;
    let previous = before.state["nextStep"].as_u64().unwrap_or(0) as usize;
    let results = state
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Missing step receipts"))?;
    let status = state
        .get("status")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("Missing job status"))?;
    if next < previous
        || next > previous + 1
        || next > count
        || results.len() != next
        || results.get(..previous)
            != before.state["results"]
                .as_array()
                .map(|items| items.as_slice())
        || ![
            "queued",
            "running",
            "paused",
            "needs-attention",
            "completed",
            "failed",
            "cancelled",
        ]
        .contains(&status)
        || (status == "completed" && next != count)
        || ["completed", "cancelled"].contains(&before.state["status"].as_str().unwrap_or(""))
    {
        return Err(invalid("Invalid job checkpoint transition"));
    }
    let action = state.get("requestedAction").unwrap_or(&Value::Null);
    if !action.is_null() && !matches!(action.as_str(), Some("pause" | "cancel")) {
        return Err(invalid("Invalid job control request"));
    }
    if before.state["requestedAction"] == "cancel" && action != "cancel" {
        return Err(invalid("Cancellation cannot be cleared"));
    }
    let attempt = state
        .get("attempt")
        .ok_or_else(|| invalid("Missing attempt"))?;
    if !attempt.is_null()
        && (next >= count
            || attempt["stepIndex"].as_u64() != Some(next as u64)
            || attempt["dispatchId"]
                .as_str()
                .is_none_or(|id| id.is_empty() || id.len() > 128)
            || !matches!(
                attempt["phase"].as_str(),
                Some("prepared" | "dispatching" | "unknown" | "settled")
            ))
    {
        return Err(invalid("Invalid dispatch checkpoint"));
    }
    if status == "cancelled"
        && !attempt.is_null()
        && !matches!(attempt["phase"].as_str(), Some("prepared" | "settled"))
    {
        return Err(invalid("Unknown dispatch cannot be marked cancelled"));
    }
    if next > previous
        && (!attempt.is_null()
            || before.state["attempt"].is_null()
            || before.state["attempt"]["phase"] == "prepared")
    {
        return Err(invalid("Completion requires a dispatched attempt"));
    }
    for (index, result) in results.iter().enumerate() {
        if result["stepId"] != before.plan["steps"][index]["id"] || result.get("receipt").is_none()
        {
            return Err(invalid("Receipt does not match plan step"));
        }
    }
    let used: i64 = tx.query_row("SELECT COALESCE(sum(length(plan_json)+length(state_json)),0) FROM durable_jobs WHERE owner=?1 AND id<>?2", params![owner,id], |row| row.get(0))?;
    if used + json.len() as i64 + before.plan.to_string().len() as i64 > 64 * 1024 * 1024 {
        return Err(CommandError::new(
            "jobs/quota-exceeded",
            "Job storage is full",
        ));
    }
    tx.execute("UPDATE durable_jobs SET state_json=?3,revision=lower(hex(randomblob(16))),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner=?1 AND id=?2", params![owner,id,json])?;
    let record =
        durable_job_get_inner(&tx, owner, id)?.ok_or_else(|| invalid("Checkpoint lost its row"))?;
    tx.commit()?;
    Ok(record)
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
    identity(&owner, "list")?;
    if limit == 0 || limit > 50 || offset > 256 {
        return Err(invalid("Invalid job page"));
    }
    crate::storage::blocking("durable_job_list", move || {
        let db = tauri::Manager::state::<Db>(&app); let mut conn = db.0.lock()?; let tx = conn.transaction()?;
        let ids = { let mut stmt = tx.prepare("SELECT id FROM durable_jobs WHERE owner=?1 ORDER BY created_at DESC,id DESC LIMIT ?2 OFFSET ?3")?;
            let rows = stmt.query_map(params![owner,limit,offset], |row| row.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?; rows };
        ids.iter().map(|id| durable_job_get_inner(&tx, &owner, id)?.ok_or_else(|| invalid("Job page lost its row"))).collect()
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn durable_job_checkpoints_survive_reopen_and_fence_stale_workers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jobs.sqlite");
        let mut conn = Connection::open(&path).unwrap();
        apply_connection_pragmas(&conn).unwrap();
        register_sql_functions(&conn).unwrap();
        run_migrations(&mut conn).unwrap();
        let plan = serde_json::json!({"title":"Prepare","steps":[{"id":"text","kind":"library.text.prepare","bookId":"book"}]});
        let source = serde_json::json!({"version":1,"root":"root","paths":[{"root":"root","steps":["rule:plugin:sample:prepare"]}]});
        let first = durable_job_create_with_source_inner(
            &mut conn,
            "plugin:sample",
            "job",
            plan.clone(),
            Some(source.clone()),
        )
        .unwrap();
        let mut forged = first.state.clone();
        forged.as_object_mut().unwrap().remove("source");
        assert!(durable_job_checkpoint_inner(
            &mut conn,
            "plugin:sample",
            "job",
            &first.revision,
            forged
        )
        .is_err());
        let dispatch = serde_json::json!({"source":source,"status":"running","nextStep":0,"attempt":{"stepIndex":0,"dispatchId":"request","phase":"dispatching","data":{"taskId":"task"}},"results":[],"errorCode":null});
        let running = durable_job_checkpoint_inner(
            &mut conn,
            "plugin:sample",
            "job",
            &first.revision,
            dispatch.clone(),
        )
        .unwrap();
        drop(conn);
        let mut conn = Connection::open(&path).unwrap();
        apply_connection_pragmas(&conn).unwrap();
        register_sql_functions(&conn).unwrap();
        let reopened = durable_job_get_inner(&conn, "plugin:sample", "job")
            .unwrap()
            .unwrap();
        assert_eq!(reopened.state, dispatch);
        assert_eq!(reopened.plan, plan);
        assert!(durable_job_get_inner(&conn, "plugin:other", "job")
            .unwrap()
            .is_none());
        assert_eq!(
            durable_job_checkpoint_inner(
                &mut conn,
                "plugin:sample",
                "job",
                &first.revision,
                dispatch
            )
            .unwrap_err()
            .code,
            "jobs/conflict"
        );
        let completed = serde_json::json!({"source":source,"status":"completed","nextStep":1,"attempt":null,"results":[{"stepId":"text","receipt":{"taskId":"task"}}],"errorCode":null});
        let done = durable_job_checkpoint_inner(
            &mut conn,
            "plugin:sample",
            "job",
            &running.revision,
            completed.clone(),
        )
        .unwrap();
        assert_eq!(
            durable_job_create_with_source_inner(
                &mut conn,
                "plugin:sample",
                "job",
                plan,
                Some(source)
            )
            .unwrap()
            .revision,
            done.revision
        );
        assert!(durable_job_checkpoint_inner(
            &mut conn,
            "plugin:sample",
            "job",
            &done.revision,
            completed
        )
        .is_err());
    }
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
