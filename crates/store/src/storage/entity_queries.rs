use super::{entity_registry as registry, Db};
use crate::error::CommandError;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityIdentity {
    pub id: String,
    pub definition: Option<registry::EntityDefinition>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityAlias {
    pub entity_id: String,
    pub alias: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum EntityItem {
    Identity(EntityIdentity),
    Alias(EntityAlias),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityPage {
    pub kind: String,
    pub canonical_id: Option<String>,
    pub canonical_definition: Option<registry::EntityDefinition>,
    pub items: Vec<EntityItem>,
    pub offset: i64,
    pub next_offset: Option<i64>,
    pub total: i64,
    pub revision: String,
}

struct Query<'a> {
    kind: &'a str,
    entity_id: Option<&'a str>,
    search: &'a str,
    offset: i64,
    limit: i64,
    expected_revision: Option<&'a str>,
}

fn invalid() -> CommandError {
    CommandError::new("memory/invalid-query", "Invalid entity registry query")
}

fn normalize(input: &Value) -> Result<Query<'_>, CommandError> {
    let fields = input.as_object().ok_or_else(invalid)?;
    let kind = fields
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    if !matches!(kind, "identities" | "members" | "aliases") {
        return Err(invalid());
    }
    let allowed = if kind == "identities" {
        "search"
    } else {
        "entityId"
    };
    if fields.keys().any(|key| {
        !["kind", "offset", "limit", "expectedRevision", allowed].contains(&key.as_str())
    }) {
        return Err(invalid());
    }
    let number = |key, default| {
        fields
            .get(key)
            .map_or(Ok(default), |v| v.as_i64().ok_or_else(invalid))
    };
    let offset = number("offset", 0)?;
    let limit = number("limit", 25)?;
    if !(0..=9_007_199_254_740_991).contains(&offset) || !(1..=100).contains(&limit) {
        return Err(invalid());
    }
    let expected_revision = fields
        .get("expectedRevision")
        .map(|v| {
            v.as_str()
                .filter(|s| registry::valid_revision(s))
                .ok_or_else(invalid)
        })
        .transpose()?;
    if offset > 0 && expected_revision.is_none() {
        return Err(invalid());
    }
    let search = fields
        .get("search")
        .map(|v| {
            v.as_str()
                .filter(|s| s.encode_utf16().count() <= 128)
                .ok_or_else(invalid)
        })
        .transpose()?
        .unwrap_or("");
    let entity_id = fields
        .get("entityId")
        .map(|v| {
            v.as_str()
                .filter(|s| registry::valid_text(s, 256))
                .ok_or_else(invalid)
        })
        .transpose()?;
    if kind != "identities" && entity_id.is_none() {
        return Err(invalid());
    }
    Ok(Query {
        kind,
        entity_id,
        search,
        offset,
        limit,
        expected_revision,
    })
}

fn identity(row: &rusqlite::Row<'_>) -> rusqlite::Result<EntityItem> {
    let kind: Option<String> = row.get(1)?;
    Ok(EntityItem::Identity(EntityIdentity {
        id: row.get(0)?,
        definition: match kind {
            Some(kind) => Some(registry::EntityDefinition {
                kind,
                canonical_name: row.get(2)?,
            }),
            None => None,
        },
    }))
}

pub(crate) fn entity_query_inner(
    conn: &mut Connection,
    input: &Value,
) -> Result<EntityPage, CommandError> {
    let query = normalize(input)?;
    let tx = conn.transaction()?;
    registry::require_fresh(&tx)?;
    let revision = registry::revision(&tx)?;
    if query
        .expected_revision
        .is_some_and(|expected| expected != revision)
    {
        return Err(CommandError::new(
            "memory/conflict",
            "Entity registry changed; restart pagination",
        ));
    }
    let canonical_id = query
        .entity_id
        .map(|id| registry::root(&tx, id))
        .transpose()?
        .flatten();
    let base = match query.kind {
        "identities" => "FROM roots r LEFT JOIN entities e ON e.id=r.id WHERE ?1='' OR EXISTS (
            SELECT 1 FROM membership m LEFT JOIN entities d ON d.id=m.id WHERE m.root_id=r.id AND (
                instr(lower(m.id),lower(?1))>0 OR instr(lower(d.canonical_name),lower(?1))>0 OR EXISTS (
                    SELECT 1 FROM entity_aliases a WHERE a.entity_id=m.id AND instr(lower(a.alias),lower(?1))>0)))",
        "members" => "FROM membership m LEFT JOIN entities e ON e.id=m.id WHERE m.root_id=?1",
        _ => "FROM entity_aliases a JOIN membership m ON m.id=a.entity_id WHERE m.root_id=?1",
    };
    let argument = if query.kind == "identities" {
        Some(query.search)
    } else {
        canonical_id.as_deref()
    };
    let total: i64 = tx.query_row(
        &format!("{} SELECT count(*) {base}", registry::MEMBERSHIP),
        [argument],
        |row| row.get(0),
    )?;
    if query.offset > total {
        return Err(invalid());
    }
    let (select, order) = match query.kind {
        "identities" => ("r.id,e.kind,e.canonical_name", "r.id"),
        "members" => ("m.id,e.kind,e.canonical_name", "m.id"),
        _ => ("a.entity_id,a.alias", "a.alias,a.entity_id"),
    };
    let items = {
        let mut stmt = tx.prepare(&format!(
            "{} SELECT {select} {base} ORDER BY {order} LIMIT ?2 OFFSET ?3",
            registry::MEMBERSHIP
        ))?;
        let rows = stmt.query_map(params![argument, query.limit, query.offset], |row| {
            if query.kind == "aliases" {
                Ok(EntityItem::Alias(EntityAlias {
                    entity_id: row.get(0)?,
                    alias: row.get(1)?,
                }))
            } else {
                identity(row)
            }
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let end = query.offset + items.len() as i64;
    let canonical_definition = canonical_id
        .as_deref()
        .map(|id| registry::definition(&tx, id))
        .transpose()?
        .flatten();
    tx.commit()?;
    Ok(EntityPage {
        kind: query.kind.into(),
        canonical_id,
        canonical_definition,
        items,
        offset: query.offset,
        next_offset: (end < total).then_some(end),
        total,
        revision,
    })
}

#[tauri::command]
pub async fn entity_query(query: Value, app: tauri::AppHandle) -> Result<EntityPage, CommandError> {
    super::blocking("entity_query", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        entity_query_inner(&mut conn, &query)
    })
    .await
}
