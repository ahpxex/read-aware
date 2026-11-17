//! Compare against this build's actual migration result, never execute source DDL.
use super::*;
use rusqlite::types::ValueRef;

#[derive(Debug, PartialEq, Eq)]
struct Object {
    kind: String,
    table: String,
    sql: Option<String>,
}
fn catalog(conn: &Connection) -> Result<BTreeMap<String, Object>, CommandError> {
    let mut statement =
        conn.prepare("SELECT name,type,tbl_name,sql FROM sqlite_schema ORDER BY name LIMIT 4097")?;
    let mut query = statement.query([])?;
    let mut objects = BTreeMap::new();
    let mut metadata_bytes = 0usize;
    while let Some(row) = query.next()? {
        for index in 0..4 {
            if let ValueRef::Text(bytes) = row.get_ref(index)? {
                metadata_bytes += bytes.len();
                if bytes.len() > if index == 3 { 256 * 1024 } else { 1024 }
                    || metadata_bytes > 4 * 1024 * 1024
                {
                    return Err(invalid("SQLite schema metadata exceeds limit"));
                }
            }
        }
        let name: String = row.get(0)?;
        if objects
            .insert(
                name,
                Object {
                    kind: row.get(1)?,
                    table: row.get(2)?,
                    sql: row.get(3)?,
                },
            )
            .is_some()
            || objects.len() > 4096
        {
            return Err(invalid("duplicate or excessive SQLite schema objects"));
        }
    }
    Ok(objects)
}

/// This build's own migration result at `version`: what an archive written at
/// that version must contain, object for object.
fn expected_catalog(version: i64) -> Result<BTreeMap<String, Object>, CommandError> {
    let mut conn = Connection::open_in_memory()?;
    storage::register_sql_functions(&conn)?;
    storage::run_migrations_up_to(&mut conn, version)?;
    // sqlite_stat1/4 are optional local optimizer state. Their schema is checked
    // against SQLite's own output; arbitrary sqlite_* objects are not exempt.
    conn.execute_batch("ANALYZE;")?;
    catalog(&conn)
}

struct Column {
    name: String,
    kind: String,
    required: bool,
    hidden: bool,
}
fn columns(conn: &Connection, table: &str) -> Result<Vec<Column>, CommandError> {
    let quoted = table.replace('"', "\"\"");
    let mut statement = conn.prepare(&format!("PRAGMA table_xinfo(\"{quoted}\")"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(Column {
                name: row.get(1)?,
                kind: row.get(2)?,
                required: row.get::<_, bool>(3)? || row.get::<_, i64>(5)? != 0,
                hidden: row.get::<_, i64>(6)? == 1,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn check_value(value: ValueRef<'_>, column: &Column, table: &str) -> Result<(), CommandError> {
    let valid = match value {
        ValueRef::Null => !column.required,
        ValueRef::Integer(_) => matches!(column.kind.as_str(), "INTEGER" | "REAL" | ""),
        ValueRef::Real(number) => number.is_finite() && matches!(column.kind.as_str(), "REAL" | ""),
        ValueRef::Text(bytes) => {
            let text = std::str::from_utf8(bytes).map_err(|_| invalid("non-UTF8 SQLite text"))?;
            if (column.name.ends_with("_json") || column.name == "json") && table != "app_kv" {
                // KV deliberately stores opaque plugin strings and sealed secrets.
                // Other persisted JSON must parse without the live readers' null
                // fallback. Presentation parts and historical values are retained.
                let _: serde_json::Value = serde_json::from_str(text)
                    .map_err(|_| invalid("invalid persisted JSON in backup"))?;
            }
            matches!(column.kind.as_str(), "TEXT" | "")
        }
        ValueRef::Blob(_) => matches!(column.kind.as_str(), "BLOB" | ""),
    };
    if !valid {
        return Err(invalid(
            "SQLite row does not match its declared storage type",
        ));
    }
    Ok(())
}

/// Check `conn` is exactly this build's schema at `version`, with well-typed
/// rows, and count them. The counts are compared with the manifest only while
/// the database is still as it was written (`expected_counts`); after the
/// private copy is migrated they are this build's own result.
pub(super) fn validate(
    conn: &Connection,
    version: i64,
    expected_counts: Option<&BTreeMap<String, u64>>,
    control: &Control,
) -> Result<BTreeMap<String, u64>, CommandError> {
    control.check()?;
    let actual = catalog(conn)?;
    let expected = expected_catalog(version)?;
    for (name, object) in &actual {
        if expected.get(name) != Some(object) {
            return Err(invalid(&format!(
                "unsupported SQLite schema object: {name}"
            )));
        }
    }
    for name in expected.keys() {
        // The original inline blob table is dropped by normal startup after
        // migrations, and may remain empty in migration-only database fixtures.
        if !actual.contains_key(name)
            && !matches!(
                name.as_str(),
                "blobs" | "sqlite_autoindex_blobs_1" | "sqlite_stat1" | "sqlite_stat4"
            )
        {
            return Err(invalid(&format!("missing SQLite schema object: {name}")));
        }
    }
    let mut migrations =
        conn.prepare("SELECT version,name FROM schema_migrations ORDER BY version")?;
    let mut versions = migrations.query([])?;
    let mut count = 0;
    while let Some(row) = versions.next()? {
        let Some((version, name, _)) = storage::MIGRATIONS.get(count) else {
            return Err(invalid(
                "backup migration history contains unexpected records",
            ));
        };
        if row.get::<_, i64>(0)? != *version || row.get_ref(1)? != ValueRef::Text(name.as_bytes()) {
            return Err(invalid(
                "backup migration history does not match this build",
            ));
        }
        count += 1;
    }
    let applied = storage::MIGRATIONS
        .iter()
        .take_while(|(migration, _, _)| *migration <= version)
        .count();
    if count != applied {
        return Err(invalid(
            "backup migration history does not match this build",
        ));
    }
    let mut counts = BTreeMap::new();
    for (name, object) in &actual {
        control.check()?;
        if object.kind != "table" || name.starts_with("sqlite_") {
            continue;
        }
        let info = columns(conn, name)?;
        let visible: Vec<_> = info
            .into_iter()
            .filter(|column| {
                // FTS table_xinfo includes hidden query/rank columns that SELECT *
                // intentionally does not materialize.
                !column.hidden
            })
            .collect();
        let quoted = name.replace('"', "\"\"");
        let mut statement = conn.prepare(&format!("SELECT * FROM \"{quoted}\""))?;
        if statement.column_count() != visible.len() {
            return Err(invalid("unexpected hidden or generated SQLite columns"));
        }
        let mut query = statement.query([])?;
        let mut count = 0u64;
        while let Some(row) = query.next()? {
            control.check()?;
            for (index, column) in visible.iter().enumerate() {
                check_value(row.get_ref(index)?, column, name)?;
            }
            count += 1;
        }
        counts.insert(name.clone(), count);
    }
    if expected_counts.is_some_and(|tables| *tables != counts) {
        return Err(invalid("backup table counts differ from manifest"));
    }
    if counts.get("blobs").copied().unwrap_or(0) != 0 {
        return Err(invalid(
            "legacy inline blobs must be migrated before full backup",
        ));
    }
    if counts.get("plugin_update_journal").copied().unwrap_or(0) != 0 {
        return Err(invalid("backup contains an unfinished plugin update"));
    }
    let mut foreign = conn.prepare("PRAGMA foreign_key_check")?;
    if foreign.query([])?.next()?.is_some() {
        return Err(invalid("backup contains broken declared references"));
    }
    Ok(counts)
}
