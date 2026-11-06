//! Device-local provider bindings join virtual book creation atomically.
//! Bindings are private source metadata, not a new synchronized domain event.
use super::*;
use rusqlite::OptionalExtension;
use std::collections::BTreeMap;

const KEY: &str = "read-aware-virtual-books";
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VirtualBinding {
    plugin_id: String,
    provider_id: String,
    key: String,
}
type Registry = BTreeMap<String, VirtualBinding>;
fn invalid() -> CommandError {
    CommandError::new(
        "plugin/invalid-argument",
        "Invalid virtual book binding commit",
    )
}
fn conflict() -> CommandError {
    CommandError::new(
        "library/content-unavailable",
        "Virtual book registry changed; reload before retrying",
    )
}
fn registry(raw: Option<&str>) -> Result<Registry, CommandError> {
    let value: Registry = match raw {
        None => BTreeMap::new(),
        Some(raw) => serde_json::from_str(raw)
            .map_err(|_| CommandError::new("db/error", "Virtual book registry is invalid"))?,
    };
    if value.iter().any(|(id, binding)| {
        id.is_empty()
            || !crate::plugins::valid_plugin_id(&binding.plugin_id)
            || binding.provider_id.trim().is_empty()
            || binding.provider_id.len() > 1024
            || binding.key.is_empty()
            || binding.key.len() > 32768
    }) {
        return Err(CommandError::new(
            "db/error",
            "Virtual book registry has invalid bindings",
        ));
    }
    Ok(value)
}
fn current(conn: &Connection) -> Result<Option<String>, CommandError> {
    Ok(conn
        .query_row("SELECT value_json FROM app_kv WHERE key=?1", [KEY], |row| {
            row.get(0)
        })
        .optional()?)
}
fn save(tx: &Transaction<'_>, raw: &str) -> Result<(), CommandError> {
    tx.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES (?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", params![KEY,raw])?;
    Ok(())
}
fn create_inner(
    conn: &mut Connection,
    events: &[EventRow],
    book_id: &str,
    binding: &VirtualBinding,
    expected: Option<&str>,
    replacement: &str,
) -> Result<CommitReport, CommandError> {
    let origin = format!("plugin:{}", binding.plugin_id);
    if events.len() != 2
        || book_id.is_empty()
        || book_id.len() > 256
        || events.iter().any(|event| {
            event.origin.as_deref() != Some(&origin)
                || event.aggregate_type.as_deref() != Some("book")
                || event.aggregate_id.as_deref() != Some(book_id)
                || event.payload.get("bookId").and_then(Value::as_str) != Some(book_id)
        })
        || events[0].event_type != "book.imported"
        || events[0].payload.get("format").and_then(Value::as_str) != Some("virtual")
        || events[0]
            .payload
            .get("sourceBlobKey")
            .and_then(Value::as_str)
            != Some("")
        || events[0].payload.get("fileName").and_then(Value::as_str) != Some("")
        || events[0].payload.get("fileSize").and_then(Value::as_u64) != Some(0)
        || events[1].event_type != "book.coverExtracted"
        || events[1].payload.get("status").and_then(Value::as_str) != Some("none")
    {
        return Err(invalid());
    }
    let mut before = registry(expected)?;
    if before.contains_key(book_id) || before.values().any(|value| value == binding) {
        return Err(conflict());
    }
    before.insert(book_id.to_owned(), binding.clone());
    if registry(Some(replacement))? != before {
        return Err(invalid());
    }
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if current(&tx)?.as_deref() != expected {
        return Err(conflict());
    }
    let used: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM books WHERE id=?1) OR EXISTS(SELECT 1 FROM domain_events WHERE aggregate_id=?1)", [book_id], |row| row.get(0))?;
    if used {
        return Err(conflict());
    }
    let report = commit_events_in_transaction(&tx, events)?;
    let created: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM books WHERE id=?1 AND format='virtual')",
        [book_id],
        |row| row.get(0),
    )?;
    if report.appended != 2 || !created {
        return Err(conflict());
    }
    save(&tx, replacement)?;
    tx.commit()?;
    Ok(report)
}
fn prune_inner(
    conn: &mut Connection,
    ids: &[String],
    expected: Option<&str>,
    replacement: &str,
) -> Result<(), CommandError> {
    let mut before = registry(expected)?;
    if ids.is_empty() || ids.len() > before.len() {
        return Err(invalid());
    }
    for id in ids {
        if before.remove(id).is_none() {
            return Err(invalid());
        }
    }
    if registry(Some(replacement))? != before {
        return Err(invalid());
    }
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if current(&tx)?.as_deref() != expected {
        return Err(conflict());
    }
    for id in ids {
        let live: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM books WHERE id=?1 AND format='virtual')",
            [id],
            |row| row.get(0),
        )?;
        if live {
            return Err(conflict());
        }
    }
    save(&tx, replacement)?;
    tx.commit()?;
    Ok(())
}
#[tauri::command]
pub async fn virtual_book_create(
    events: Vec<EventRow>,
    book_id: String,
    binding: VirtualBinding,
    expected_registry: Option<String>,
    replacement_registry: String,
    app: tauri::AppHandle,
) -> Result<CommitReport, CommandError> {
    blocking("virtual_book_create", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        create_inner(
            &mut conn,
            &events,
            &book_id,
            &binding,
            expected_registry.as_deref(),
            &replacement_registry,
        )
    })
    .await
}
#[tauri::command]
pub async fn virtual_book_prune(
    book_ids: Vec<String>,
    expected_registry: Option<String>,
    replacement_registry: String,
    app: tauri::AppHandle,
) -> Result<(), CommandError> {
    blocking("virtual_book_prune", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        prune_inner(
            &mut conn,
            &book_ids,
            expected_registry.as_deref(),
            &replacement_registry,
        )
    })
    .await
}

#[cfg(test)]
#[path = "virtual_books_tests.rs"]
mod tests;
