//! Conditional local decisions must be later than the state they inspected.
use super::{checkpoints, EventRow};
use crate::error::CommandError;
use rusqlite::{Connection, OptionalExtension};

fn invalid() -> CommandError {
    CommandError::new("memory/invalid-input", "Invalid local decision envelope")
}

pub(super) fn validate_envelope(event: &EventRow) -> Result<(), CommandError> {
    let valid_origin = event.origin.as_deref().is_some_and(|origin| {
        matches!(origin, "user" | "agent" | "system")
            || origin
                .strip_prefix("plugin:")
                .is_some_and(|id| !id.trim().is_empty())
    });
    if event.id.trim().is_empty()
        || event.id.encode_utf16().count() > 256
        || event.schema_version.is_some_and(|version| version != 1)
        || event
            .actor_id
            .as_deref()
            .is_some_and(|actor| actor != "local")
        || !valid_origin
        || !(0..=9_007_199_254_740_991).contains(&event.hlc.wall_ms)
        || !(0..=9_007_199_254_740_991).contains(&event.hlc.counter)
        || event.hlc.device_id.trim().is_empty()
    {
        return Err(invalid());
    }
    Ok(())
}

pub(super) fn validate_new_event(conn: &Connection, event: &EventRow) -> Result<(), CommandError> {
    validate_envelope(event)?;
    let device: Option<String> = conn
        .query_row("SELECT device_id FROM local_device WHERE id=1", [], |row| {
            row.get(0)
        })
        .optional()?;
    if device.as_deref() != Some(event.hlc.device_id.as_str()) {
        return Err(invalid());
    }
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM domain_events WHERE id=?1)",
        [&event.id],
        |row| row.get(0),
    )?;
    if exists {
        return Err(invalid());
    }
    let frontier: Option<checkpoints::HlcKey> = conn
        .query_row(
            "SELECT hlc_wall_ms,hlc_counter,hlc_device FROM (
            SELECT hlc_wall_ms,hlc_counter,hlc_device FROM domain_events
            UNION ALL SELECT hlc_wall_ms,hlc_counter,hlc_device FROM projection_checkpoints
         ) ORDER BY hlc_wall_ms DESC,hlc_counter DESC,hlc_device DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    if frontier.is_some_and(|key| checkpoints::hlc_key_of(&event.hlc) <= key) {
        return Err(CommandError::new(
            "memory/conflict",
            "Decision clock must follow the current log and checkpoint",
        ));
    }
    Ok(())
}
