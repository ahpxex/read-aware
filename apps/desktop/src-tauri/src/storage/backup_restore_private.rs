use super::super::super::scan::{self, BoundCell};
use super::*;
use rusqlite::{params, params_from_iter, OptionalExtension, Transaction};
use std::collections::BTreeSet;

pub(super) fn blobs(
    plan: &FilePlan,
    tx: &Transaction<'_>,
    selected: &BTreeSet<String>,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    let source = plan.rows.events().source().connection();
    let mut statement=source.prepare("SELECT key,mime_type,byte_size,sha256,storage_uri,created_at,last_accessed_at FROM blob_objects WHERE deleted_at IS NULL ORDER BY key")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        let path: String = row.get(4)?;
        if !selected.contains(&path) {
            continue;
        }
        let key: String = row.get(0)?;
        let mime: Option<String> = row.get(1)?;
        let file = plan.matches[&path].source.as_ref().ok_or_else(|| {
            CommandError::new("backup/incomplete", "Selected blob bytes are missing")
        })?;
        storage::register_blob_inner(
            tx,
            &key,
            mime.as_deref(),
            file.byte_size as i64,
            file.sha256.clone(),
            storage::blob_file_name(&key),
        )?;
        tx.execute(
            "UPDATE blob_objects SET created_at=?2,last_accessed_at=?3,mime_type=?4 WHERE key=?1",
            params![
                key,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                mime
            ],
        )?;
    }
    Ok(())
}
pub(super) fn credentials(
    prepared: &super::super::PreparedCredentials,
    tx: &Transaction<'_>,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    for operation in &prepared.operations {
        check()?;
        let key = format!("read-aware-secret:{}", operation.slot);
        if let Some(sealed) = &operation.local_sealed {
            tx.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES (?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",params![key,sealed])?;
        } else {
            tx.execute("DELETE FROM app_kv WHERE key=?1", [key])?;
        }
    }
    prepared.enqueue_publications(tx)
}
pub(super) fn programs(
    plan: &FilePlan,
    tx: &Transaction<'_>,
    programs: &[super::super::ProgramDecision],
    results: &BTreeMap<String, ProgramResult>,
    versions: &BTreeMap<String, i64>,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    let source = plan.rows.events().source().connection();
    for program in programs {
        check()?;
        let prefix = format!("read-aware-plugin.{}.", program.id);
        let schema = format!("read-aware-plugin-host.schema.{}", program.id);
        // Runtime queues belong to the target process, not the selected private
        // namespace. Preserve both current and historical scheduler keys.
        let runtime = [
            format!("{prefix}schedule-state"),
            format!("{prefix}schedule-runs"),
        ];
        let migrated = results.get(&program.id).and_then(|r| r.migrated.as_ref());
        if migrated.is_some() || program.data == Side::Source {
            tx.execute("DELETE FROM app_kv WHERE (substr(key,1,length(?1))=?1 OR key=?2) AND key NOT IN (?3,?4)",params![prefix,schema,runtime[0],runtime[1]])?;
            tx.execute(
                "DELETE FROM plugin_documents WHERE plugin_id=?1",
                [&program.id],
            )?;
            if let Some(snapshot) = migrated {
                for (suffix, value) in &snapshot.kv {
                    check()?;
                    if matches!(suffix.as_str(), "schedule-state" | "schedule-runs") {
                        continue;
                    }
                    tx.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES (?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",params![format!("{prefix}{suffix}"),value])?;
                }
                storage::plugin_docs::replace_plugin_documents(
                    tx,
                    &program.id,
                    snapshot.documents.clone(),
                )?;
            } else {
                let mut stmt=source.prepare("SELECT key,value_json,updated_at FROM app_kv WHERE (substr(key,1,length(?1))=?1 OR key=?2) AND key NOT IN (?3,?4)")?;
                let mut rows = stmt.query(params![prefix, schema, runtime[0], runtime[1]])?;
                while let Some(row) = rows.next()? {
                    check()?;
                    tx.execute(
                        "INSERT INTO app_kv(key,value_json,updated_at) VALUES (?1,?2,?3)",
                        params_from_iter(
                            (0..3)
                                .map(|i| row.get_ref(i).map(BoundCell))
                                .collect::<Result<Vec<_>, _>>()?,
                        ),
                    )?;
                }
                let columns = scan::columns(source, "plugin_documents")?;
                let names = columns
                    .iter()
                    .map(|c| scan::quoted(&c.name))
                    .collect::<Vec<_>>()
                    .join(",");
                let slots = (1..=columns.len())
                    .map(|i| format!("?{i}"))
                    .collect::<Vec<_>>()
                    .join(",");
                let mut stmt =
                    source.prepare("SELECT * FROM plugin_documents WHERE plugin_id=?1")?;
                let mut rows = stmt.query([&program.id])?;
                while let Some(row) = rows.next()? {
                    check()?;
                    tx.execute(
                        &format!("INSERT INTO plugin_documents ({names}) VALUES ({slots})"),
                        params_from_iter(
                            (0..columns.len())
                                .map(|i| row.get_ref(i).map(BoundCell))
                                .collect::<Result<Vec<_>, _>>()?,
                        ),
                    )?;
                }
            }
        }
        if program.program.is_none() {
            // Data-only restoration must not boot retained code against a
            // namespace for which the user approved no executable migration.
            let key = "read-aware-plugins-enabled";
            let raw = storage::get_kv_inner(tx, key)?;
            let mut enabled: serde_json::Map<String, serde_json::Value> = match raw {
                Some(raw) => serde_json::from_str(&raw).map_err(|_| {
                    CommandError::new(
                        "backup/incomplete",
                        "Invalid restored plugin activation settings",
                    )
                })?,
                None => serde_json::Map::new(),
            };
            enabled.insert(program.id.clone(), serde_json::Value::Bool(false));
            tx.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES (?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",params![key,serde_json::to_string(&enabled)?])?;
        }
        if let Some(book_access) = results
            .get(&program.id)
            .and_then(|result| result.book_access.as_ref())
        {
            // The source archive's copy of this host-owned key is excluded by
            // RowPolicy::PreserveDevice. Apply only the grant just selected in
            // the consent dialog, in the same transaction as the restore.
            let key = "read-aware-plugins-book-access";
            let mut grants = match storage::get_kv_inner(tx, key)? {
                Some(raw) => {
                    serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&raw)
                        .map_err(|_| {
                            CommandError::new("backup/incomplete", "Invalid plugin book grants")
                        })?
                }
                None => serde_json::Map::new(),
            };
            grants.insert(program.id.clone(), serde_json::to_value(book_access)?);
            tx.execute(
                "INSERT INTO app_kv(key,value_json,updated_at) VALUES (?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
                params![key, serde_json::to_string(&grants)?],
            )?;
        }
        if let Some(version) = versions.get(&program.id) {
            tx.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES (?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",params![schema,version.to_string()])?;
        }
    }
    Ok(())
}
pub(super) fn require_book_files(
    tx: &Transaction<'_>,
    plan: &FilePlan,
    selected: &BTreeSet<String>,
) -> Result<(), CommandError> {
    let mut statement=tx.prepare("SELECT 'bookfile:'||id FROM books WHERE format!='virtual' UNION SELECT cover_blob_key FROM books WHERE cover_status='ready'")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let key: Option<String> = row.get(0)?;
        let key = key.ok_or_else(|| {
            CommandError::new(
                "backup/incomplete",
                "Restored book cover has no blob identity",
            )
        })?;
        let binding: Option<(Option<String>, Option<i64>, Option<String>)> = tx
            .query_row(
                "SELECT storage_uri,byte_size,sha256 FROM blob_objects WHERE key=?1 AND deleted_at IS NULL",
                [&key],
                |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
            )
            .optional()?;
        let (path, bytes, sha256) = binding.ok_or_else(|| {
            CommandError::new(
                "backup/incomplete",
                "Restored book requires unavailable local bytes",
            )
        })?;
        let path = path.ok_or_else(|| {
            CommandError::new("backup/incomplete", "Restored book bytes are not local")
        })?;
        let file = if selected.contains(&path) {
            plan.matches.get(&path).and_then(|f| f.source.as_ref())
        } else {
            plan.target.files.get(&path)
        };
        if path != format!("blobs/{}", storage::blob_file_name(&key))
            || !file.is_some_and(|f| {
                bytes == Some(f.byte_size as i64) && sha256.as_deref() == Some(f.sha256.as_str())
            })
        {
            return Err(CommandError::new(
                "backup/incomplete",
                "Restored book file was skipped or is unavailable",
            ));
        }
    }
    Ok(())
}
