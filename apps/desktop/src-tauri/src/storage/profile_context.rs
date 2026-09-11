//! Prompt-only read set: no entity registry scan and no evidence text over IPC.
use super::{identity_consolidation as identity, user_profile, Db};
use crate::error::CommandError;
use rusqlite::Connection;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileContextSnapshot {
    pub profile: user_profile::ProfileSnapshot,
    pub derived: Option<serde_json::Value>,
    pub source_conditions: Vec<identity::IdentitySource>,
}

pub(crate) fn profile_context_inner(
    conn: &mut Connection,
) -> Result<ProfileContextSnapshot, CommandError> {
    let tx = conn.transaction()?;
    user_profile::require_initialized(&tx)?;
    let profile = user_profile::read_snapshot(&tx)?;
    let derived = identity::read_derived(&tx)?;
    let source_conditions = if derived.is_some() {
        identity::source_conditions(&identity::read_sources(&tx)?)
    } else {
        Vec::new()
    };
    tx.commit()?;
    Ok(ProfileContextSnapshot {
        profile,
        derived,
        source_conditions,
    })
}

#[tauri::command]
pub async fn profile_context(
    app: tauri::AppHandle,
) -> Result<ProfileContextSnapshot, CommandError> {
    super::blocking("profile_context", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        profile_context_inner(&mut conn)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::super::{apply_connection_pragmas, register_sql_functions, run_migrations};
    use super::*;

    #[test]
    fn context_skips_memory_when_absent_and_never_reads_the_entity_registry() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_connection_pragmas(&conn).unwrap();
        register_sql_functions(&conn).unwrap();
        run_migrations(&mut conn).unwrap();
        // A schema fault makes accidental scans observable, without a fake query engine.
        conn.execute_batch("ALTER TABLE memories RENAME TO hidden_memories; ALTER TABLE entities RENAME TO hidden_entities;").unwrap();
        let absent = profile_context_inner(&mut conn).unwrap();
        assert!(absent.derived.is_none());
        assert!(absent.source_conditions.is_empty());
        conn.execute("INSERT INTO user_profile(id,traits_json,created_at,updated_at,updated_event_id) VALUES('local','{\"consolidated\":{\"version\":999}}','old','old','event')", []).unwrap();
        assert!(profile_context_inner(&mut conn).is_err());
        conn.execute_batch("ALTER TABLE hidden_memories RENAME TO memories;")
            .unwrap();
        let invalid = profile_context_inner(&mut conn).unwrap();
        assert_eq!(invalid.derived.unwrap()["version"], 999);
        assert!(invalid.source_conditions.is_empty());
    }
}
