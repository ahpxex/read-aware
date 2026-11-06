//! Record the reviewed domain state as new facts after merging source history.
//! The caller owns one transaction across log import, replay, these facts and
//! local data restoration. No commit (or filesystem mutation) happens here.
use super::{
    apply::{
        self,
        backup_restore::{self as codec, Cell, RowPatch},
    },
    events, EventRow, Hlc,
};
use crate::error::CommandError;
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{Connection, Transaction};
use sha2::{Digest, Sha256};

struct Writer<'a, 'conn> {
    tx: &'a Transaction<'conn>,
    id: String,
    hlc: Hlc,
    chunks: u64,
    pending: Vec<u8>,
    hash: Sha256,
}
impl Writer<'_, '_> {
    fn event(&mut self, kind: &str, payload: serde_json::Value) -> Result<(), CommandError> {
        self.hlc.counter = self
            .hlc
            .counter
            .checked_add(1)
            .filter(|n| *n <= 9_007_199_254_740_991)
            .ok_or_else(|| {
                CommandError::new("backup/incomplete", "Restore HLC counter exhausted")
            })?;
        let event = EventRow {
            id: uuid::Uuid::new_v4().to_string(),
            event_type: kind.into(),
            hlc: self.hlc.clone(),
            schema_version: Some(1),
            aggregate_type: Some("backup".into()),
            aggregate_id: Some(self.id.clone()),
            actor_id: Some("local".into()),
            origin: Some("user".into()),
            created_at: None,
            payload,
        };
        if events::commit_events_in_transaction(self.tx, &[event])?.appended != 1 {
            return Err(CommandError::new(
                "backup/changed",
                "Restore fact identity collision",
            ));
        }
        Ok(())
    }
    fn flush(&mut self) -> Result<(), CommandError> {
        if self.pending.is_empty() {
            return Ok(());
        }
        self.hash.update(&self.pending);
        self.event("backup.restoreChunk", serde_json::json!({"restoreId": self.id, "index": self.chunks, "data": STANDARD.encode(&self.pending)}))?;
        self.chunks += 1;
        self.pending.clear();
        Ok(())
    }
    fn row(
        &mut self,
        patch: &RowPatch,
        check: &mut impl FnMut() -> Result<(), CommandError>,
    ) -> Result<(), CommandError> {
        let mut bytes =
            serde_json::to_vec(patch).map_err(|e| CommandError::internal(e.to_string()))?;
        bytes.push(b'\n');
        let mut offset = 0;
        while offset < bytes.len() {
            check()?;
            let take = (codec::CHUNK_BYTES - self.pending.len()).min(bytes.len() - offset);
            self.pending
                .extend_from_slice(&bytes[offset..offset + take]);
            offset += take;
            if self.pending.len() == codec::CHUNK_BYTES {
                self.flush()?;
            }
        }
        Ok(())
    }
}
pub(crate) struct RestoreFacts {
    pub restore_id: String,
    pub rows: u64,
}
pub(crate) fn reconcile(
    tx: &Transaction<'_>,
    desired: &Connection,
    mut check: impl FnMut() -> Result<(), CommandError>,
) -> Result<RestoreFacts, CommandError> {
    check()?;
    let device_id = super::ensure_local_device(tx)?;
    let (mut wall, mut counter) = super::events::log_frontier(tx)?.unwrap_or((0, 0));
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    if now > wall {
        wall = now;
        counter = 0;
    }
    let mut writer = Writer {
        tx,
        id: uuid::Uuid::new_v4().to_string(),
        hlc: Hlc {
            wall_ms: wall,
            counter,
            device_id,
        },
        chunks: 0,
        pending: Vec::with_capacity(codec::CHUNK_BYTES),
        hash: Sha256::new(),
    };
    let mut count = 0;
    // Clear only identities known by the merged history, never unknown remote
    // rows. All deletes precede inserts, allowing selected unique-value swaps.
    for deleting in [true, false] {
        for table in if deleting {
            apply::DERIVED_TABLES.to_vec()
        } else {
            apply::DERIVED_TABLES.iter().rev().copied().collect()
        } {
            let spec = apply::DIFF_SPECS
                .iter()
                .find(|s| s.table == table)
                .expect("derived table spec");
            let conn: &Connection = if deleting { tx } else { desired };
            let columns = codec::columns(conn, spec, deleting)?;
            let names = columns
                .iter()
                .map(|c| codec::quoted(c))
                .collect::<Vec<_>>()
                .join(",");
            let keys = codec::columns(conn, spec, true)?
                .iter()
                .map(|c| codec::quoted(c))
                .collect::<Vec<_>>()
                .join(",");
            let mut statement = conn.prepare(&format!(
                "SELECT {names} FROM {} WHERE {} ORDER BY {keys}",
                codec::quoted(table),
                spec.domain_rows.unwrap_or("1")
            ))?;
            let mut rows = statement.query([])?;
            while let Some(row) = rows.next()? {
                check()?;
                let values = (0..columns.len())
                    .map(|i| row.get_ref(i).map(Cell::from_ref))
                    .collect::<Result<Vec<_>, _>>()?;
                writer.row(
                    &RowPatch {
                        table: table.into(),
                        columns: columns.clone(),
                        values,
                        delete: deleting,
                    },
                    &mut check,
                )?;
                if !deleting {
                    count += 1;
                }
            }
        }
    }
    writer.flush()?;
    check()?;
    // Foreign keys are checked at the owner's commit, after the entire selected
    // graph and its local presentation have been restored.
    tx.execute_batch("PRAGMA defer_foreign_keys=ON;")?;
    writer.event("backup.restored", serde_json::json!({"restoreId": writer.id, "format": 1, "chunks": writer.chunks, "sha256": format!("{:x}", writer.hash.clone().finalize())}))?;
    check()?;
    Ok(RestoreFacts {
        restore_id: writer.id,
        rows: count,
    })
}
