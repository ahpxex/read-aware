//! User-owned restore evidence, never an actor data API. SQL identifiers and
//! typed keys come from the plan/catalog; requests cannot supply SQL or row keys.
use super::identity::{decode_key, BoundCell};
use super::{scan, RowPlan, RowPolicy};
use crate::error::CommandError;
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, params_from_iter, types::ValueRef, Connection};
use serde::{Deserialize, Serialize};

const CHUNK_BYTES: usize = 4096;
// Values crossing the IPC boundary must stay below JS's safe-integer ceiling;
// the bound is about JSON, not pointer width, so it is u64 not usize.
const MAX_SAFE: u64 = 9_007_199_254_740_991;
fn invalid() -> CommandError {
    CommandError::new("backup/invalid-archive", "Invalid backup record review")
}
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RowSide {
    Source,
    Target,
}
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum Cell {
    Null,
    Integer {
        decimal: String,
    },
    Real {
        decimal: String,
        bits: String,
    },
    #[serde(rename_all = "camelCase")]
    Text {
        base64: String,
        text: Option<String>,
        byte_length: usize,
        offset: usize,
        next_offset: Option<usize>,
    },
    #[serde(rename_all = "camelCase")]
    Blob {
        base64: String,
        byte_length: usize,
        offset: usize,
        next_offset: Option<usize>,
    },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Field {
    name: String,
    primary: i64,
    // None is an absent row. Cell::Null is a present SQL NULL.
    source: Option<Cell>,
    target: Option<Cell>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RowFieldsPage {
    table: String,
    entry_id: i64,
    policy: RowPolicy,
    restricted: bool,
    entries: Vec<Field>,
    next_after: Option<usize>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RowFieldPage {
    table: String,
    entry_id: i64,
    column: String,
    side: RowSide,
    value: Option<Cell>,
}
struct Identity {
    key: Vec<u8>,
    policy: RowPolicy,
    source: bool,
    target: bool,
}
impl Identity {
    fn readable(&self) -> bool {
        matches!(
            self.policy,
            RowPolicy::DomainState
                | RowPolicy::ConversationState
                | RowPolicy::PluginData
                | RowPolicy::LegacyData
                | RowPolicy::ReviewSettings
                | RowPolicy::VirtualBindings
                | RowPolicy::RoamingPreferences
        )
    }
}
impl RowPlan {
    fn review_identity(&self, table: &str, entry_id: i64) -> Result<Identity, CommandError> {
        if table.len() > 256
            || !self.tables.contains_key(table)
            || !(1..=MAX_SAFE as i64).contains(&entry_id)
        {
            return Err(invalid());
        }
        let mut statement = self.events.entries.prepare("SELECT row_key,policy,source_digest IS NOT NULL,target_digest IS NOT NULL FROM row_matches WHERE table_name=?1 AND entry_id=?2")?;
        let mut rows = statement.query(params![table, entry_id])?;
        let row = rows.next()?.ok_or_else(invalid)?;
        Ok(Identity {
            key: row.get(0)?,
            policy: RowPolicy::from_name(&row.get::<_, String>(1)?)?,
            source: row.get(2)?,
            target: row.get(3)?,
        })
    }
    fn review_columns(
        &self,
        table: &str,
        id: &Identity,
    ) -> Result<Vec<scan::Column>, CommandError> {
        scan::columns(
            if id.source {
                self.events.source.connection()
            } else {
                &self.events.target_snapshot
            },
            table,
        )
    }
    pub(crate) fn review_fields(
        &self,
        table: String,
        entry_id: i64,
        after: Option<usize>,
        limit: usize,
        check: &mut impl FnMut() -> Result<(), CommandError>,
    ) -> Result<RowFieldsPage, CommandError> {
        if !(1..=100).contains(&limit) {
            return Err(invalid());
        }
        let id = self.review_identity(&table, entry_id)?;
        let mut page = RowFieldsPage {
            table,
            entry_id,
            policy: id.policy,
            restricted: !id.readable(),
            entries: Vec::new(),
            next_after: None,
        };
        if page.restricted {
            return Ok(page);
        }
        let columns = self.review_columns(&page.table, &id)?;
        if after.is_some_and(|after| after >= columns.len()) {
            return Err(invalid());
        }
        let start = after.map_or(0, |after| after + 1);
        let end = (start + limit).min(columns.len());
        for column in &columns[start..end] {
            check()?;
            page.entries.push(Field {
                name: column.name.clone(),
                primary: column.primary,
                source: self.review_cell(
                    &page.table,
                    &id,
                    &columns,
                    &column.name,
                    RowSide::Source,
                    0,
                )?,
                target: self.review_cell(
                    &page.table,
                    &id,
                    &columns,
                    &column.name,
                    RowSide::Target,
                    0,
                )?,
            });
        }
        if end < columns.len() {
            page.next_after = Some(end - 1);
        }
        Ok(page)
    }
    pub(crate) fn review_field(
        &self,
        table: String,
        entry_id: i64,
        column: String,
        side: RowSide,
        offset: usize,
        check: &mut impl FnMut() -> Result<(), CommandError>,
    ) -> Result<RowFieldPage, CommandError> {
        check()?;
        let id = self.review_identity(&table, entry_id)?;
        if !id.readable() || column.len() > 256 || offset as u64 > MAX_SAFE {
            return Err(invalid());
        }
        let columns = self.review_columns(&table, &id)?;
        if !columns.iter().any(|c| c.name == column) {
            return Err(invalid());
        }
        let value = self.review_cell(&table, &id, &columns, &column, side, offset)?;
        check()?;
        Ok(RowFieldPage {
            table,
            entry_id,
            column,
            side,
            value,
        })
    }
    fn review_cell(
        &self,
        table: &str,
        id: &Identity,
        columns: &[scan::Column],
        column: &str,
        side: RowSide,
        offset: usize,
    ) -> Result<Option<Cell>, CommandError> {
        let conn = match side {
            RowSide::Source if id.source => self.events.source.connection(),
            RowSide::Target if id.target => &self.events.target_snapshot,
            _ => return Ok(None),
        };
        read_cell(conn, table, columns, &id.key, column, offset).map(Some)
    }
}

fn read_cell(
    conn: &Connection,
    table: &str,
    columns: &[scan::Column],
    key: &[u8],
    column: &str,
    offset: usize,
) -> Result<Cell, CommandError> {
    let mut primary: Vec<_> = columns.iter().filter(|column| column.primary > 0).collect();
    primary.sort_by_key(|column| column.primary);
    let mut values = decode_key(key, primary.len())?;
    let predicate = primary
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{} IS ?{}", scan::quoted(&c.name), i + 1))
        .collect::<Vec<_>>()
        .join(" AND ");
    let c = scan::quoted(column);
    // Only the requested slice crosses SQLite's result boundary; even a large
    // text/blob never becomes a whole Rust/IPC allocation. CAST avoids SQLite
    // text length/substr truncation at embedded NUL and preserves byte offsets.
    let sql = format!("SELECT typeof({c}), CASE WHEN typeof({c}) IN ('integer','real') THEN {c} END, length(CAST({c} AS BLOB)), substr(CAST({c} AS BLOB),?{},4096) FROM {} WHERE {predicate}", values.len() + 1, scan::quoted(table));
    values.push(ValueRef::Integer((offset as i64) + 1));
    let mut statement = conn.prepare(&sql)?;
    let mut rows = statement.query(params_from_iter(values.into_iter().map(BoundCell)))?;
    let row = rows.next()?.ok_or_else(|| {
        CommandError::new("backup/changed", "Review row is missing from its snapshot")
    })?;
    let kind: String = row.get(0)?;
    if kind != "text" && kind != "blob" {
        if offset != 0 {
            return Err(invalid());
        }
        return Ok(match row.get_ref(1)? {
            ValueRef::Null if kind == "null" => Cell::Null,
            ValueRef::Integer(value) => Cell::Integer {
                decimal: value.to_string(),
            },
            ValueRef::Real(value) => Cell::Real {
                decimal: value.to_string(),
                bits: format!("{:016x}", value.to_bits()),
            },
            _ => return Err(invalid()),
        });
    }
    let byte_length: usize = row.get(2)?;
    if offset > byte_length {
        return Err(invalid());
    }
    let mut bytes = row.get_ref(3)?.as_blob().map_err(|_| invalid())?.to_vec();
    debug_assert!(bytes.len() <= CHUNK_BYTES);
    let text = if kind == "text" {
        match std::str::from_utf8(&bytes) {
            Ok(text) => Some(text.to_owned()),
            Err(error)
                if error.error_len().is_none()
                    && error.valid_up_to() > 0
                    && offset + bytes.len() < byte_length =>
            {
                bytes.truncate(error.valid_up_to());
                Some(
                    std::str::from_utf8(&bytes)
                        .map_err(|_| invalid())?
                        .to_owned(),
                )
            }
            // Preserve invalid text exactly as bytes; never silently replace it.
            Err(_) => None,
        }
    } else {
        None
    };
    let next_offset = (offset + bytes.len() < byte_length).then_some(offset + bytes.len());
    let base64 = STANDARD.encode(&bytes);
    Ok(if kind == "text" {
        Cell::Text {
            base64,
            text,
            byte_length,
            offset,
            next_offset,
        }
    } else {
        Cell::Blob {
            base64,
            byte_length,
            offset,
            next_offset,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_row_review_preserves_sqlite_types_bytes_and_large_integer_identities() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE evidence(id INTEGER,tag BLOB,i INTEGER,r REAL,n TEXT,t TEXT,b BLOB,PRIMARY KEY(id,tag));
            INSERT INTO evidence VALUES (9223372036854775807,X'00FF',9223372036854775807,1.25,NULL,CAST(X'FF00' AS TEXT),X'00FF0102');").unwrap();
        let columns = scan::columns(&conn, "evidence").unwrap();
        let mut key = 2u64.to_le_bytes().to_vec();
        key.push(1);
        key.extend_from_slice(&i64::MAX.to_le_bytes());
        key.push(4);
        key.extend_from_slice(&2u64.to_le_bytes());
        key.extend_from_slice(&[0, 255]);
        let cell = |column, offset| {
            serde_json::to_value(
                read_cell(&conn, "evidence", &columns, &key, column, offset).unwrap(),
            )
            .unwrap()
        };
        assert_eq!(
            cell("i", 0),
            serde_json::json!({"type":"integer","decimal":"9223372036854775807"})
        );
        assert_eq!(cell("r", 0)["bits"], format!("{:016x}", 1.25f64.to_bits()));
        assert_eq!(cell("n", 0), serde_json::json!({"type":"null"}));
        let text = cell("t", 0);
        assert!(text["text"].is_null());
        assert_eq!(text["base64"], STANDARD.encode([255, 0]));
        assert_eq!(text["byteLength"], 2);
        assert_eq!(cell("b", 2)["base64"], STANDARD.encode([1, 2]));
        assert_eq!(cell("b", 4)["base64"], "");
        assert!(read_cell(&conn, "evidence", &columns, &key, "i", 1).is_err());
        for damaged in [&key[..key.len() - 1], &key[..1]] {
            assert!(read_cell(&conn, "evidence", &columns, damaged, "i", 0).is_err());
        }
        let mut extra = key.clone();
        extra.push(0);
        assert!(decode_key(&extra, 2).is_err());
    }
}
