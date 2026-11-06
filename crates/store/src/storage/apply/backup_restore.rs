//! Version 1 of the full-backup restore fact. Only domain rows can be applied;
//! SQL, local settings, executable files and credentials are never accepted.
use super::{DiffSpec, DIFF_SPECS};
use crate::{error::CommandError, storage::EventRow};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{
    params, params_from_iter,
    types::{ToSqlOutput, ValueRef},
    Connection, ToSql, Transaction,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub(crate) const CHUNK_BYTES: usize = 16 * 1024;
// Preflight bounds a SQLite row to 64 MiB; base64 plus the typed row envelope.
const MAX_ROW_BYTES: usize = 96 * 1024 * 1024;
fn invalid() -> CommandError {
    CommandError::new("backup/invalid-archive", "Invalid full-backup restore fact")
}
pub(crate) fn quoted(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

#[derive(Serialize, Deserialize)]
#[serde(
    tag = "type",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Cell {
    Null,
    Integer(String),
    Real(String),
    Text(String),
    Blob(String),
}
impl Cell {
    pub(crate) fn from_ref(value: ValueRef<'_>) -> Self {
        match value {
            ValueRef::Null => Self::Null,
            ValueRef::Integer(v) => Self::Integer(v.to_string()),
            ValueRef::Real(v) => Self::Real(format!("{:016x}", v.to_bits())),
            ValueRef::Text(v) => Self::Text(STANDARD.encode(v)),
            ValueRef::Blob(v) => Self::Blob(STANDARD.encode(v)),
        }
    }
    fn decode(&self) -> Result<Bound, CommandError> {
        Ok(match self {
            Self::Null => Bound::Null,
            Self::Integer(v) => Bound::Integer(v.parse().map_err(|_| invalid())?),
            Self::Real(v) => {
                let v = f64::from_bits(u64::from_str_radix(v, 16).map_err(|_| invalid())?);
                if v.is_nan() {
                    return Err(invalid());
                }
                Bound::Real(v)
            }
            Self::Text(v) => Bound::Text(STANDARD.decode(v).map_err(|_| invalid())?),
            Self::Blob(v) => Bound::Blob(STANDARD.decode(v).map_err(|_| invalid())?),
        })
    }
}
enum Bound {
    Null,
    Integer(i64),
    Real(f64),
    Text(Vec<u8>),
    Blob(Vec<u8>),
}
impl ToSql for Bound {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::Borrowed(match self {
            Self::Null => ValueRef::Null,
            Self::Integer(v) => ValueRef::Integer(*v),
            Self::Real(v) => ValueRef::Real(*v),
            Self::Text(v) => ValueRef::Text(v),
            Self::Blob(v) => ValueRef::Blob(v),
        }))
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RowPatch {
    pub table: String,
    pub columns: Vec<String>,
    pub values: Vec<Cell>,
    pub delete: bool,
}
pub(crate) fn columns(
    conn: &Connection,
    spec: &DiffSpec,
    keys: bool,
) -> Result<Vec<String>, CommandError> {
    let mut query = conn.prepare(&format!("PRAGMA table_info({})", quoted(spec.table)))?;
    let mut columns = query
        .query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, i64>(5)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    columns.retain(|(name, primary)| {
        !spec.local_columns.contains(&name.as_str()) && (!keys || *primary > 0)
    });
    if keys {
        columns.sort_by_key(|(_, primary)| *primary);
    }
    Ok(columns.into_iter().map(|(name, _)| name).collect())
}
fn apply_row(tx: &Transaction<'_>, patch: RowPatch) -> Result<(), CommandError> {
    let spec = DIFF_SPECS
        .iter()
        .find(|s| s.table == patch.table)
        .ok_or_else(invalid)?;
    let allowed = columns(tx, spec, patch.delete)?;
    if patch.columns.is_empty()
        || patch.columns.len() != patch.values.len()
        || patch.columns.iter().any(|c| !allowed.contains(c))
        || patch
            .columns
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != patch.columns.len()
        || columns(tx, spec, true)?
            .iter()
            .any(|k| !patch.columns.contains(k))
    {
        return Err(invalid());
    }
    let values = patch
        .values
        .iter()
        .map(Cell::decode)
        .collect::<Result<Vec<_>, _>>()?;
    let primary = columns(tx, spec, true)?;
    if primary.iter().any(|key| {
        patch
            .columns
            .iter()
            .position(|c| c == key)
            .is_none_or(|i| matches!(values[i], Bound::Null))
    }) {
        return Err(invalid());
    }
    let table = quoted(spec.table);
    let names = patch.columns.iter().map(|c| quoted(c)).collect::<Vec<_>>();
    if patch.delete {
        let predicate = names
            .iter()
            .enumerate()
            .map(|(i, n)| format!("{n} IS ?{}", i + 1))
            .collect::<Vec<_>>()
            .join(" AND ");
        tx.execute(
            &format!("DELETE FROM {table} WHERE {predicate}"),
            params_from_iter(&values),
        )?;
    } else {
        let mut names = names;
        let mut slots = (1..=values.len())
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>();
        // Local presentation fields have no fact in the restore stream. Supply
        // deterministic insert defaults; the local importer restores them later.
        if spec.table == "ai_messages" {
            names.push("seq".into());
            slots.push("0".into());
        }
        if spec.table == "ai_conversations" {
            let created = patch
                .columns
                .iter()
                .position(|c| c == "created_at")
                .ok_or_else(invalid)?;
            names.push("updated_at".into());
            slots.push(format!("?{}", created + 1));
        }
        let updates = patch
            .columns
            .iter()
            .map(|c| format!("{0}=excluded.{0}", quoted(c)))
            .collect::<Vec<_>>()
            .join(",");
        let conflict = primary
            .iter()
            .map(|c| quoted(c))
            .collect::<Vec<_>>()
            .join(",");
        tx.execute(&format!("INSERT INTO {table} ({}) VALUES ({}) ON CONFLICT ({conflict}) DO UPDATE SET {updates}", names.join(","), slots.join(",")), params_from_iter(&values))?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Chunk {
    restore_id: String,
    index: u64,
    data: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    restore_id: String,
    format: u8,
    chunks: u64,
    sha256: String,
}
fn identity(ev: &EventRow, id: &str) -> Result<(), CommandError> {
    if ev.schema_version.unwrap_or(1) != 1
        || uuid::Uuid::parse_str(id).is_err()
        || ev.aggregate_type.as_deref() != Some("backup")
        || ev.aggregate_id.as_deref() != Some(id)
    {
        return Err(invalid());
    }
    Ok(())
}
pub(crate) fn chunk(ev: &EventRow) -> Result<(), CommandError> {
    let c: Chunk = serde_json::from_value(ev.payload.clone()).map_err(|_| invalid())?;
    identity(ev, &c.restore_id)?;
    if c.data.len() > CHUNK_BYTES.div_ceil(3) * 4 {
        return Err(invalid());
    }
    let bytes = STANDARD.decode(&c.data).map_err(|_| invalid())?;
    if bytes.is_empty() || bytes.len() > CHUNK_BYTES {
        return Err(invalid());
    }
    Ok(())
}
pub(crate) fn apply(tx: &Transaction<'_>, ev: &EventRow) -> Result<(), CommandError> {
    let manifest: Manifest = serde_json::from_value(ev.payload.clone()).map_err(|_| invalid())?;
    identity(ev, &manifest.restore_id)?;
    if manifest.format != 1 {
        return Err(invalid());
    }
    tx.execute_batch("PRAGMA defer_foreign_keys=ON;")?;
    // Only preceding chunks of this restoration participate. The log has an
    // aggregate index, and at most one bounded row is buffered while applying.
    let mut statement = tx.prepare("SELECT * FROM domain_events WHERE aggregate_type='backup' AND aggregate_id=?1 AND type='backup.restoreChunk' AND (hlc_wall_ms,hlc_counter,hlc_device)<(?2,?3,?4) ORDER BY hlc_wall_ms,hlc_counter,hlc_device")?;
    let mut rows = statement.query(params![
        manifest.restore_id,
        ev.hlc.wall_ms,
        ev.hlc.counter,
        ev.hlc.device_id
    ])?;
    let mut index = 0;
    let mut hash = Sha256::new();
    let mut pending = Vec::new();
    while let Some(row) = rows.next()? {
        let event = crate::storage::events::row_to_event(row)?;
        chunk(&event)?;
        let c: Chunk = serde_json::from_value(event.payload).map_err(|_| invalid())?;
        if c.index != index || index >= manifest.chunks {
            return Err(invalid());
        }
        index += 1;
        let bytes = STANDARD.decode(c.data).map_err(|_| invalid())?;
        hash.update(&bytes);
        for part in bytes.split_inclusive(|b| *b == b'\n') {
            if pending.len() + part.len() > MAX_ROW_BYTES {
                return Err(invalid());
            }
            pending.extend_from_slice(part);
            if part.last() == Some(&b'\n') {
                let patch = serde_json::from_slice(&pending).map_err(|_| invalid())?;
                apply_row(tx, patch)?;
                pending.clear();
            }
        }
    }
    if index != manifest.chunks
        || !pending.is_empty()
        || format!("{:x}", hash.finalize()) != manifest.sha256
    {
        return Err(invalid());
    }
    Ok(())
}
