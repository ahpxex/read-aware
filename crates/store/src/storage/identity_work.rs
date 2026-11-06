//! Device-local immutable inference pages, conditionally appended against the complete source set.
use super::{identity_consolidation, Db};
use crate::error::CommandError;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;

const MAX_PAGES: i64 = 4096;
const MAX_INDEX: i64 = 9_007_199_254_740_991;
const MAX_CHECKPOINT_BYTES: usize = 256_000;
const MAX_PAGE_BYTES: usize = 48_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityWorkPage {
    pub revision: String,
    pub index: i64,
    pub page_count: i64,
    pub base_index: i64,
    pub checkpoint: Option<String>,
    pub json: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityWorkReceipt {
    pub revision: String,
    pub page_count: i64,
    pub status: &'static str,
}
fn invalid() -> CommandError {
    CommandError::new("memory/invalid-input", "Invalid identity work page")
}
fn conflict() -> CommandError {
    CommandError::new("memory/conflict", "Identity work or source set changed")
}
fn validate(revision: &str, index: i64) -> Result<(), CommandError> {
    if revision.len() != 69
        || !revision.starts_with("icg1:")
        || !revision[5..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || !(0..MAX_INDEX).contains(&index)
    {
        return Err(invalid());
    }
    Ok(())
}
fn current(conn: &Connection, revision: &str) -> Result<(), CommandError> {
    if identity_consolidation::read_snapshot(conn)?.revision != revision {
        return Err(conflict());
    }
    Ok(())
}
struct WorkHeader {
    revision: String,
    page_count: i64,
    base_index: i64,
    checkpoint: Option<String>,
}
fn header(conn: &Connection) -> Result<Option<WorkHeader>, CommandError> {
    Ok(conn
        .query_row(
            "SELECT revision,page_count,base_index,checkpoint FROM identity_consolidation_work WHERE id=1",
            [],
            |row| {
                Ok(WorkHeader {
                    revision: row.get(0)?,
                    page_count: row.get(1)?,
                    base_index: row.get(2)?,
                    checkpoint: row.get(3)?,
                })
            },
        )
        .optional()?)
}

pub(crate) fn identity_work_read_inner(
    conn: &mut Connection,
    revision: &str,
    index: i64,
) -> Result<IdentityWorkPage, CommandError> {
    validate(revision, index)?;
    let tx = conn.transaction()?;
    current(&tx, revision)?;
    let (count, base_index, checkpoint) = header(&tx)?
        .filter(|work| work.revision == revision)
        .map_or((0, 0, None), |work| {
            (work.page_count, work.base_index, work.checkpoint)
        });
    // Index zero is also the atomic resume/header read. Other pruned reads are stale.
    if index != 0 && index < base_index {
        return Err(conflict());
    }
    let json = if index >= base_index && index < count {
        Some(tx.query_row(
            "SELECT json FROM identity_consolidation_pages WHERE page_index=?1",
            [index],
            |row| row.get(0),
        )?)
    } else {
        None
    };
    tx.commit()?;
    Ok(IdentityWorkPage {
        revision: revision.into(),
        index,
        page_count: count,
        base_index,
        checkpoint,
        json,
    })
}

pub(crate) fn identity_work_append_inner(
    conn: &mut Connection,
    revision: &str,
    index: i64,
    json: &str,
) -> Result<IdentityWorkReceipt, CommandError> {
    validate(revision, index)?;
    if json.len() > MAX_PAGE_BYTES
        || !serde_json::from_str::<serde_json::Value>(json)
            .map_err(|_| invalid())?
            .is_object()
    {
        return Err(invalid());
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    current(&tx, revision)?;
    let (count, base_index) = if let Some(work) =
        header(&tx)?.filter(|work| work.revision == revision)
    {
        (work.page_count, work.base_index)
    } else {
        if index != 0 {
            return Err(conflict());
        }
        tx.execute("DELETE FROM identity_consolidation_pages", [])?;
        tx.execute("INSERT INTO identity_consolidation_work(id,revision,page_count) VALUES(1,?1,0) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,page_count=0,base_index=0,checkpoint=NULL", [revision])?;
        (0, 0)
    };
    if index < base_index {
        return Err(conflict());
    }
    if index < count {
        let existing: String = tx.query_row(
            "SELECT json FROM identity_consolidation_pages WHERE page_index=?1",
            [index],
            |row| row.get(0),
        )?;
        if existing != json {
            return Err(conflict());
        }
        tx.commit()?;
        return Ok(IdentityWorkReceipt {
            revision: revision.into(),
            page_count: count,
            status: "retained",
        });
    }
    if index != count {
        return Err(conflict());
    }
    if count - base_index >= MAX_PAGES {
        return Err(CommandError::new(
            "memory/invalid-input",
            "Compact identity work before appending more pages",
        ));
    }
    tx.execute(
        "INSERT INTO identity_consolidation_pages(page_index,json) VALUES(?1,?2)",
        rusqlite::params![index, json],
    )?;
    tx.execute(
        "UPDATE identity_consolidation_work SET page_count=?1 WHERE id=1",
        [count + 1],
    )?;
    tx.commit()?;
    Ok(IdentityWorkReceipt {
        revision: revision.into(),
        page_count: count + 1,
        status: "appended",
    })
}

#[tauri::command]
pub async fn identity_work_read(
    expected_revision: String,
    index: i64,
    app: tauri::AppHandle,
) -> Result<IdentityWorkPage, CommandError> {
    super::blocking("identity_work_read", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        identity_work_read_inner(&mut conn, &expected_revision, index)
    })
    .await
}
#[tauri::command]
pub async fn identity_work_append(
    expected_revision: String,
    index: i64,
    json: String,
    app: tauri::AppHandle,
) -> Result<IdentityWorkReceipt, CommandError> {
    super::blocking("identity_work_append", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        identity_work_append_inner(&mut conn, &expected_revision, index, &json)
    })
    .await
}

/// Tail comparison prevents a stale compactor from deleting a newer page. The monotonic
/// index is never reset within a source revision, so old append retries cannot cause ABA.
pub(crate) fn identity_work_compact_inner(
    conn: &mut Connection,
    revision: &str,
    expected_page_count: i64,
    json: &str,
) -> Result<IdentityWorkReceipt, CommandError> {
    if expected_page_count < 1 {
        return Err(invalid());
    }
    validate(revision, expected_page_count - 1)?;
    if json.len() > MAX_CHECKPOINT_BYTES
        || !serde_json::from_str::<serde_json::Value>(json)
            .map_err(|_| invalid())?
            .is_object()
    {
        return Err(invalid());
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    current(&tx, revision)?;
    let WorkHeader {
        revision: stored,
        page_count: count,
        base_index: base,
        checkpoint,
    } = header(&tx)?.ok_or_else(conflict)?;
    if stored != revision || count != expected_page_count {
        return Err(conflict());
    }
    if base == count {
        if checkpoint.as_deref() != Some(json) {
            return Err(conflict());
        }
        return Ok(IdentityWorkReceipt {
            revision: revision.into(),
            page_count: count,
            status: "retained",
        });
    }
    tx.execute("DELETE FROM identity_consolidation_pages", [])?;
    tx.execute(
        "UPDATE identity_consolidation_work SET base_index=page_count,checkpoint=?1 WHERE id=1",
        [json],
    )?;
    tx.commit()?;
    Ok(IdentityWorkReceipt {
        revision: revision.into(),
        page_count: count,
        status: "compacted",
    })
}

#[tauri::command]
pub async fn identity_work_compact(
    expected_revision: String,
    expected_page_count: i64,
    json: String,
    app: tauri::AppHandle,
) -> Result<IdentityWorkReceipt, CommandError> {
    super::blocking("identity_work_compact", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        identity_work_compact_inner(&mut conn, &expected_revision, expected_page_count, &json)
    })
    .await
}
