//! Bounded, immutable review evidence in the plan's private database. These
//! pages never authorize installation or apply source rows. Credential slots
//! retain their dedicated facts-only route; ordinary user content is host-only.
use super::FilePlan;
use crate::error::CommandError;
use rusqlite::{params, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

const MAX_PAGE_BYTES: usize = 8 * 1024 * 1024;
fn invalid() -> CommandError {
    CommandError::new("backup/invalid-archive", "Invalid backup review page")
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum ReviewQuery {
    Events { after: Option<String>, limit: usize },
    Files { after: Option<String>, limit: usize },
    Programs { after: Option<String>, limit: usize },
    Credentials { after: Option<String>, limit: usize },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JsonPage {
    entries: Vec<Value>,
    next_after: Option<String>,
}
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum ReviewPage {
    Events(super::super::super::EventMatchPage),
    Files(JsonPage),
    Programs(JsonPage),
    Credentials(JsonPage),
}
fn check_page(after: &str, limit: usize) -> Result<(), CommandError> {
    if !(1..=100).contains(&limit) || after.len() > 8192 {
        return Err(invalid());
    }
    Ok(())
}

impl FilePlan {
    /// Capture facts while the target is still fenced and version-checked.
    /// Existing program inspection caps all manifests together at 16 MiB.
    pub(crate) fn prepare_review(
        &self,
        target: &Transaction<'_>,
        root: &Path,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<(), CommandError> {
        let cache = self.rows.events().entries.unchecked_transaction()?;
        cache.execute_batch("CREATE TABLE backup_review(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,id));")?;
        let insert = |kind: &str, id: &str, json: String| -> Result<(), CommandError> {
            if id.len() > 8192 || json.len() > MAX_PAGE_BYTES {
                return Err(CommandError::new(
                    "backup/incomplete",
                    "Backup review entry exceeds its bound",
                ));
            }
            cache.execute(
                "INSERT INTO backup_review(kind,id,json) VALUES (?1,?2,?3)",
                params![kind, id, json],
            )?;
            Ok(())
        };
        // Keep the existing semantic/crypto inspection; only non-secret facts
        // and bounded manifests enter the private review cache.
        for fact in self.program_facts(target, root, &mut check)? {
            check()?;
            insert("programs", &fact.id, serde_json::to_string(&fact)?)?;
        }
        for fact in self.credential_facts(target, root, &mut check)? {
            check()?;
            insert("credentials", &fact.slot, serde_json::to_string(&fact)?)?;
        }
        check()?;
        self.verify_target(target, root, &mut check)?;
        self.verify_source(&mut check)?;
        cache.commit()?;
        Ok(())
    }

    pub(crate) fn review_page(
        &self,
        query: ReviewQuery,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<ReviewPage, CommandError> {
        check()?;
        let result = match query {
            ReviewQuery::Events { after, limit } => {
                ReviewPage::Events(self.rows.events().page(after.as_deref(), limit)?)
            }
            ReviewQuery::Files { after, limit } => {
                let page = self.page(after.as_deref().unwrap_or(""), limit)?;
                let mut entries = Vec::new();
                let mut bytes = 0;
                let mut last = None;
                let mut next_after = page.next_after;
                for entry in page.entries {
                    check()?;
                    let json = serde_json::to_value(entry)?;
                    let size = serde_json::to_vec(&json)?.len();
                    if bytes + size > MAX_PAGE_BYTES {
                        if entries.is_empty() {
                            return Err(invalid());
                        }
                        next_after = last;
                        break;
                    }
                    bytes += size;
                    entries.push(json);
                    last = Some(entry.path.clone());
                }
                ReviewPage::Files(JsonPage {
                    entries,
                    next_after,
                })
            }
            ReviewQuery::Programs { after, limit } => ReviewPage::Programs(cached_page(
                &self.rows.events().entries,
                "programs",
                after.as_deref().unwrap_or(""),
                limit,
                &mut check,
            )?),
            ReviewQuery::Credentials { after, limit } => ReviewPage::Credentials(cached_page(
                &self.rows.events().entries,
                "credentials",
                after.as_deref().unwrap_or(""),
                limit,
                &mut check,
            )?),
        };
        check()?;
        Ok(result)
    }
}

fn cached_page(
    connection: &rusqlite::Connection,
    kind: &str,
    after: &str,
    limit: usize,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<JsonPage, CommandError> {
    check_page(after, limit)?;
    let mut statement = connection.prepare(
        "SELECT id,json FROM backup_review WHERE kind=?1 AND id>?2 ORDER BY id LIMIT ?3",
    )?;
    let mut rows = statement.query(params![kind, after, limit as i64 + 1])?;
    let mut entries = Vec::new();
    let mut last = None;
    let mut next_after = None;
    let mut bytes = 0;
    while let Some(row) = rows.next()? {
        check()?;
        let id: String = row.get(0)?;
        if entries.len() == limit {
            next_after = last;
            break;
        }
        let json: String = row.get(1)?;
        if bytes + json.len() > MAX_PAGE_BYTES {
            if entries.is_empty() {
                return Err(invalid());
            }
            next_after = last;
            break;
        }
        bytes += json.len();
        entries.push(serde_json::from_str(&json)?);
        last = Some(id);
    }
    Ok(JsonPage {
        entries,
        next_after,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_review_byte_boundary_continues_without_skipping_or_truncating_entries() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE backup_review(kind TEXT,id TEXT,json TEXT,PRIMARY KEY(kind,id));",
        )
        .unwrap();
        let body = serde_json::json!({ "manifest": "a".repeat(MAX_PAGE_BYTES / 2) }).to_string();
        for id in ["a", "b"] {
            conn.execute(
                "INSERT INTO backup_review VALUES ('programs',?1,?2)",
                params![id, body],
            )
            .unwrap();
        }
        let first = cached_page(&conn, "programs", "", 100, &mut || Ok(())).unwrap();
        assert_eq!(first.entries.len(), 1);
        assert_eq!(first.next_after.as_deref(), Some("a"));
        assert_eq!(
            first.entries[0]["manifest"].as_str().unwrap().len(),
            MAX_PAGE_BYTES / 2
        );
        let second = cached_page(
            &conn,
            "programs",
            first.next_after.as_deref().unwrap(),
            100,
            &mut || Ok(()),
        )
        .unwrap();
        assert_eq!(second.entries.len(), 1);
        assert!(second.next_after.is_none());
        assert!(cached_page(&conn, "programs", "", 0, &mut || Ok(())).is_err());
        assert!(cached_page(&conn, "programs", "", 101, &mut || Ok(())).is_err());
        assert_eq!(
            cached_page(&conn, "programs", "", 1, &mut || Err(CommandError::new(
                "backup/cancelled",
                "cancel"
            )))
            .err()
            .unwrap()
            .code,
            "backup/cancelled"
        );
    }
}
