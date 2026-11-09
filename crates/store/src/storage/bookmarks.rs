//! Bookmarks: named reading targets in a book (`bookmark.*` events).
//!
//! The payload shape mirrors `packages/core/src/bookmarks.ts`; this module
//! re-checks it before projecting so a malformed event can neither commit
//! locally nor land a row the reader cannot open.
use crate::error::CommandError;
use rusqlite::{params, Connection, Transaction};
use serde::Serialize;
use serde_json::{Map, Value};

const NAME_MAX: usize = 120;
const CONTENT_VERSION_MAX: usize = 1024;
const LOCATOR_MAX: usize = 8192;
const QUOTE_EXACT_MAX: usize = 12000;
const QUOTE_CONTEXT_MAX: usize = 2000;

fn invalid(detail: &str) -> CommandError {
    CommandError::new(
        "bookmarks/invalid-input",
        format!("Invalid bookmark: {detail}"),
    )
}

fn non_blank(value: Option<&Value>, max: usize) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty() && s.chars().count() <= max)
}

/// A display name: non-blank, at most 120 characters.
pub fn name(payload: &Value) -> Result<String, CommandError> {
    non_blank(payload.get("name"), NAME_MAX)
        .map(str::to_owned)
        .ok_or_else(|| invalid("name"))
}

pub fn kind(payload: &Value) -> Result<&str, CommandError> {
    match payload.get("kind").and_then(Value::as_str) {
        Some(kind @ ("location" | "selection")) => Ok(kind),
        _ => Err(invalid("kind")),
    }
}

/// The canonical target JSON: `contentVersion`, exactly one of `cfi` / `href`
/// / `fraction` (0..=1), an optional text quote; a selection needs a CFI.
pub fn target_json(payload: &Value, kind: &str) -> Result<String, CommandError> {
    let raw = payload
        .get("target")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("target"))?;
    if raw.keys().any(|key| {
        !["contentVersion", "cfi", "href", "fraction", "textQuote"].contains(&key.as_str())
    }) {
        return Err(invalid("target keys"));
    }
    let mut target = Map::new();
    let version = non_blank(raw.get("contentVersion"), CONTENT_VERSION_MAX)
        .ok_or_else(|| invalid("contentVersion"))?;
    target.insert("contentVersion".into(), Value::from(version));
    let locators: Vec<&str> = ["cfi", "href", "fraction"]
        .into_iter()
        .filter(|key| raw.get(*key).is_some_and(|v| !v.is_null()))
        .collect();
    match locators.as_slice() {
        ["fraction"] => {
            let in_range = raw
                .get("fraction")
                .and_then(Value::as_f64)
                .is_some_and(|f| f.is_finite() && (0.0..=1.0).contains(&f));
            if !in_range {
                return Err(invalid("fraction"));
            }
            // Kept as sent, so a replay serializes the same number.
            target.insert("fraction".into(), raw["fraction"].clone());
        }
        [locator] => {
            let value =
                non_blank(raw.get(*locator), LOCATOR_MAX).ok_or_else(|| invalid(locator))?;
            target.insert((*locator).into(), Value::from(value));
        }
        _ => return Err(invalid("exactly one locator")),
    }
    if kind == "selection" && !target.contains_key("cfi") {
        return Err(invalid("selection without cfi"));
    }
    if let Some(quote) = raw.get("textQuote").filter(|v| !v.is_null()) {
        let quote = quote.as_object().ok_or_else(|| invalid("textQuote"))?;
        if quote
            .keys()
            .any(|key| !["exact", "prefix", "suffix"].contains(&key.as_str()))
        {
            return Err(invalid("textQuote keys"));
        }
        let mut canonical = Map::new();
        let exact = non_blank(quote.get("exact"), QUOTE_EXACT_MAX)
            .ok_or_else(|| invalid("textQuote.exact"))?;
        canonical.insert("exact".into(), Value::from(exact));
        for key in ["prefix", "suffix"] {
            if let Some(value) = quote.get(key) {
                let text = value
                    .as_str()
                    .filter(|s| s.chars().count() <= QUOTE_CONTEXT_MAX)
                    .ok_or_else(|| invalid(key))?;
                canonical.insert(key.into(), Value::from(text));
            }
        }
        target.insert("textQuote".into(), Value::Object(canonical));
    }
    Ok(serde_json::to_string(&Value::Object(target))?)
}

pub fn apply_created(
    tx: &Transaction<'_>,
    id: &str,
    book_id: &str,
    payload: &Value,
    at: &str,
) -> Result<(), CommandError> {
    let kind = kind(payload)?;
    let target = target_json(payload, kind)?;
    let chapter = match payload.get("chapterHref") {
        None | Some(Value::Null) => None,
        value => Some(non_blank(value, LOCATOR_MAX).ok_or_else(|| invalid("chapterHref"))?),
    };
    tx.execute(
        "INSERT INTO bookmarks (id, book_id, name, kind, target_json, chapter_href, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(id) DO UPDATE SET
            book_id = excluded.book_id, name = excluded.name, kind = excluded.kind,
            target_json = excluded.target_json, chapter_href = excluded.chapter_href,
            updated_at = excluded.updated_at",
        params![id, book_id, name(payload)?, kind, target, chapter, at],
    )?;
    Ok(())
}

pub fn apply_renamed(
    tx: &Transaction<'_>,
    id: &str,
    payload: &Value,
    at: &str,
) -> Result<(), CommandError> {
    tx.execute(
        "UPDATE bookmarks SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, name(payload)?, at],
    )?;
    Ok(())
}

/// One projected bookmark — what `bookmarks_list` returns (camelCase serde),
/// the `Bookmark` read model in packages/core.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkRow {
    pub id: String,
    pub book_id: String,
    pub name: String,
    pub kind: String,
    pub target: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chapter_href: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Bookmarks oldest first, for one book or the whole library.
pub fn bookmarks_list_inner(
    conn: &Connection,
    book_id: Option<&str>,
) -> Result<Vec<BookmarkRow>, CommandError> {
    let sql = if book_id.is_some() {
        "SELECT * FROM bookmarks WHERE book_id = ?1 ORDER BY created_at, id"
    } else {
        "SELECT * FROM bookmarks ORDER BY created_at, id"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(book_id), |row| {
        let target: String = row.get("target_json")?;
        Ok(BookmarkRow {
            id: row.get("id")?,
            book_id: row.get("book_id")?,
            name: row.get("name")?,
            kind: row.get("kind")?,
            target: serde_json::from_str(&target).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?,
            chapter_href: row.get("chapter_href")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// One plugin document to adopt and the `bookmark.created` event it becomes.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkAdoption {
    pub document_id: String,
    pub event: super::EventRow,
}

/// Move bookmarks a plugin kept in its private documents into the library:
/// each `bookmark.created` event and the removal of its source document
/// commit in ONE transaction, so a document is never both migrated and left
/// behind (a retry would duplicate it) nor deleted without its bookmark. A
/// document whose book is no longer in the library (after following merges)
/// is left untouched. Returns how many were adopted. Retired Jumper's
/// `bookmarks` collection is the one caller.
pub fn adopt_plugin_documents_inner(
    conn: &mut Connection,
    plugin_id: &str,
    collection: &str,
    adoptions: &[BookmarkAdoption],
) -> Result<usize, CommandError> {
    if adoptions
        .iter()
        .any(|adoption| adoption.event.event_type != "bookmark.created")
    {
        return Err(invalid("only bookmark.created events can adopt documents"));
    }
    let tx = conn.transaction()?;
    let mut adopted = 0;
    for adoption in adoptions {
        let book_id = adoption
            .event
            .payload
            .get("bookId")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("bookId"))?;
        let book_id = super::apply::resolve_book_alias(&tx, book_id)?.unwrap_or(book_id.to_owned());
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM books WHERE id = ?1)",
            params![book_id],
            |row| row.get(0),
        )?;
        if !exists {
            continue;
        }
        super::events::commit_events_in_transaction(&tx, std::slice::from_ref(&adoption.event))?;
        tx.execute(
            "DELETE FROM plugin_documents WHERE plugin_id = ?1 AND collection = ?2 AND id = ?3",
            params![plugin_id, collection, adoption.document_id],
        )?;
        adopted += 1;
    }
    tx.commit()?;
    Ok(adopted)
}

#[cfg(test)]
#[path = "bookmarks_tests.rs"]
mod tests;
