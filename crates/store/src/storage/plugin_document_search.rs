use rusqlite::{functions::FunctionFlags, Connection};
use serde_json::Value;

fn matches(value: &Value, query: &str) -> bool {
    match value {
        Value::String(text) => text.to_lowercase().contains(query),
        Value::Array(items) => items.iter().any(|item| matches(item, query)),
        Value::Object(fields) => fields
            .iter()
            .any(|(key, value)| key.to_lowercase().contains(query) || matches(value, query)),
        scalar => scalar.to_string().contains(query),
    }
}

pub(super) fn register(conn: &Connection) -> rusqlite::Result<()> {
    conn.create_scalar_function(
        "ra_plugin_document_matches",
        2,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let json: String = ctx.get(0)?;
            let query: String = ctx.get(1)?;
            // Parse JSON so escaped strings and nested values are searched as
            // data, not their serialized spelling. Corruption is a read failure.
            let value: Value = serde_json::from_str(&json)
                .map_err(|error| rusqlite::Error::UserFunctionError(Box::new(error)))?;
            Ok(matches(&value, &query))
        },
    )
}
