use crate::error::CommandError;
use rusqlite::{params, Transaction};
use serde_json::Value;

pub(super) fn publish(
    tx: &Transaction<'_>,
    payload: &Value,
    at: &str,
    event_id: &str,
) -> Result<bool, CommandError> {
    let bundle = super::super::context_bundle::validate(payload)?;
    let (scope, scope_id) = bundle.content.scope.parts();
    let inserted = tx.execute("INSERT OR IGNORE INTO context_bundles
        (version,kind,scope_kind,scope_id,content_json,created_at,created_event_id) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![bundle.version, bundle.content.kind, scope, scope_id, serde_json::to_string(&bundle.content)?, at, event_id])?;
    if inserted == 0 {
        return Ok(false);
    }
    for (rank, item) in bundle.content.items.iter().enumerate() {
        tx.execute(
            "INSERT INTO context_bundle_items
            (bundle_version,rank,source_kind,source_id,source_revision) VALUES (?1,?2,?3,?4,?5)",
            params![
                bundle.version,
                rank as i64,
                item.kind,
                item.id,
                item.revision
            ],
        )?;
    }
    Ok(true)
}
