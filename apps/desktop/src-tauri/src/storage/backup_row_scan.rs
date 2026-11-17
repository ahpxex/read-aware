use crate::error::CommandError;
use rusqlite::{types::ValueRef, Connection};

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Column {
    pub(super) name: String,
    kind: String,
    pub(super) primary: i64,
}
pub(super) fn quoted(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}
pub(super) fn columns(conn: &Connection, table: &str) -> Result<Vec<Column>, CommandError> {
    let mut query = conn.prepare(&format!("PRAGMA table_info({})", quoted(table)))?;
    let columns = query
        .query_map([], |row| {
            Ok(Column {
                name: row.get(1)?,
                kind: row.get(2)?,
                primary: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(columns)
}

/// A SQLite value bound back exactly as read (no JSON or number coercion).
pub(super) struct BoundCell<'a>(pub(super) ValueRef<'a>);
impl rusqlite::ToSql for BoundCell<'_> {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(rusqlite::types::ToSqlOutput::Borrowed(self.0))
    }
}
