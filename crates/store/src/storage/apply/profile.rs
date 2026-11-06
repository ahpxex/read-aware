use crate::error::CommandError;
use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::{Map, Value};

fn nullable_text(payload: &Map<String, Value>, key: &str) -> Result<(), CommandError> {
    if payload
        .get(key)
        .is_some_and(|v| !v.is_null() && !v.is_string())
    {
        return Err(CommandError::new(
            "memory/invalid-input",
            format!("Invalid profile {key}"),
        ));
    }
    Ok(())
}

pub(super) fn apply(
    tx: &Transaction<'_>,
    payload: &Value,
    at: &str,
    event_id: &str,
) -> Result<bool, CommandError> {
    let p = payload
        .as_object()
        .ok_or_else(|| CommandError::new("memory/invalid-input", "Invalid profile payload"))?;
    nullable_text(p, "displayName")?;
    nullable_text(p, "summary")?;
    if p.get("traits").is_some_and(|value| !value.is_object()) {
        return Err(CommandError::new(
            "memory/invalid-input",
            "Profile traits must be an object",
        ));
    }
    if !["displayName", "summary", "traits"]
        .iter()
        .any(|key| p.contains_key(*key))
    {
        return Ok(false);
    }
    let previous: Option<(Option<String>, Option<String>, String)> = tx
        .query_row(
            "SELECT display_name, summary, traits_json FROM user_profile WHERE id='local'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let (mut name, mut summary, traits) = previous.unwrap_or((None, None, "{}".into()));
    let mut traits: Map<String, Value> = serde_json::from_str(&traits)?;
    if let Some(value) = p.get("displayName") {
        name = value.as_str().map(str::to_owned);
    }
    if let Some(value) = p.get("summary") {
        summary = value.as_str().map(str::to_owned);
    }
    if let Some(patch) = p.get("traits").and_then(Value::as_object) {
        for (key, value) in patch {
            if value.is_null() {
                traits.remove(key);
            } else {
                traits.insert(key.clone(), value.clone());
            }
        }
    }
    tx.execute("INSERT INTO user_profile (id,display_name,summary,traits_json,created_at,updated_at,updated_event_id)
        VALUES ('local',?1,?2,?3,?4,?4,?5)
        ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, summary=excluded.summary,
        traits_json=excluded.traits_json, updated_at=excluded.updated_at, updated_event_id=excluded.updated_event_id",
        params![name, summary, serde_json::to_string(&traits)?, at, event_id])?;
    Ok(true)
}
