//! Host-private metadata feed. The public adapter must derive this selector from
//! actual grants; it must never forward plugin-supplied event types or KV keys.
use super::*;
use rusqlite::OptionalExtension;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangeSelector {
    #[serde(default)]
    pub projection_key: Option<String>,
    pub event_types: Vec<String>,
    pub settings_keys: Vec<String>,
    pub book_id: Option<String>,
    pub plugin_id: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityChange {
    kind: String,
    operation: String,
    entity_id: String,
    book_id: Option<String>,
    plugin_id: Option<String>,
    detail: Option<String>,
    event_id: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityChangePage {
    changes: Vec<CapabilityChange>,
    cursor: String,
    has_more: bool,
}
fn invalid() -> CommandError {
    CommandError::new("changes/invalid-query", "Invalid change selector")
}
fn expired() -> CommandError {
    CommandError::new(
        "changes/cursor-expired",
        "Change history or cursor expired; capture a new baseline",
    )
}
fn selector_key(owner: &str, selector: &mut ChangeSelector) -> Result<String, CommandError> {
    if selector
        .projection_key
        .as_ref()
        .is_some_and(|s| s.len() > 32768)
        || owner.is_empty()
        || owner.len() > 512
        || selector.event_types.len() > 256
        || selector.settings_keys.len() > 256
        || selector
            .event_types
            .iter()
            .chain(selector.settings_keys.iter())
            .any(|s| s.is_empty() || s.len() > 512)
        || selector
            .book_id
            .as_ref()
            .is_some_and(|s| s.is_empty() || s.len() > 1024)
        || selector
            .plugin_id
            .as_ref()
            .is_some_and(|s| s.is_empty() || s.len() > 128)
    {
        return Err(invalid());
    }
    if selector.book_id.is_some()
        && selector.settings_keys.iter().any(|key| {
            !["read-aware-reader-settings", "read-aware-reader-overrides"].contains(&key.as_str())
        })
    {
        return Err(invalid());
    }
    selector.event_types.sort();
    selector.event_types.dedup();
    selector.settings_keys.sort();
    selector.settings_keys.dedup();
    Ok(serde_json::to_string(selector)?)
}
fn epoch(conn: &Connection) -> Result<String, CommandError> {
    // Older wipes removed this singleton. A fresh epoch also invalidates any
    // surviving token rather than silently attaching it to a new history.
    conn.execute("INSERT OR IGNORE INTO capability_change_state(id,epoch) VALUES(1,lower(hex(randomblob(24))))", [])?;
    Ok(conn.query_row(
        "SELECT epoch FROM capability_change_state WHERE id=1",
        [],
        |r| r.get(0),
    )?)
}
pub(crate) fn invalidate(conn: &Connection) -> Result<(), CommandError> {
    conn.execute("INSERT INTO capability_change_state(id,epoch) VALUES(1,lower(hex(randomblob(24)))) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch", [])?;
    Ok(())
}
pub(crate) fn reset_after_wipe(conn: &Connection) -> Result<(), CommandError> {
    // Delete-trigger producers may have recreated notices during the wipe.
    conn.execute("DELETE FROM capability_changes", [])?;
    conn.execute("DELETE FROM capability_change_cursors", [])?;
    invalidate(conn)
}
fn cursor(
    conn: &Connection,
    owner: &str,
    selector: &str,
    position: i64,
    epoch: &str,
) -> Result<String, CommandError> {
    let token: String = conn.query_row("SELECT lower(hex(randomblob(24)))", [], |r| r.get(0))?;
    conn.execute("INSERT INTO capability_change_cursors(token,owner,selector,seq,epoch) VALUES(?1,?2,?3,?4,?5)", params![token,owner,selector,position,epoch])?;
    conn.execute("DELETE FROM capability_change_cursors WHERE owner=?1 AND rowid NOT IN (SELECT rowid FROM capability_change_cursors WHERE owner=?1 ORDER BY rowid DESC LIMIT 256)", [owner])?;
    Ok(token)
}
pub(crate) fn capability_changes_open_inner(
    conn: &mut Connection,
    owner: &str,
    mut selector: ChangeSelector,
) -> Result<String, CommandError> {
    let key = selector_key(owner, &mut selector)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let position: i64 = tx.query_row(
        "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='capability_changes'),0)",
        [],
        |r| r.get(0),
    )?;
    let token = cursor(&tx, owner, &key, position, &epoch(&tx)?)?;
    tx.commit()?;
    Ok(token)
}
pub(crate) fn capability_changes_read_inner(
    conn: &mut Connection,
    owner: &str,
    mut selector: ChangeSelector,
    token: &str,
    limit: usize,
) -> Result<CapabilityChangePage, CommandError> {
    let key = selector_key(owner, &mut selector)?;
    if token.len() != 48 || limit == 0 || limit > 100 {
        return Err(invalid());
    }
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let saved: Option<(String, i64, String)> = tx
        .query_row(
            "SELECT selector,seq,epoch FROM capability_change_cursors WHERE token=?1 AND owner=?2",
            params![token, owner],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let (bound, after, prior_epoch) = saved.ok_or_else(expired)?;
    let current_epoch = epoch(&tx)?;
    if bound != key {
        return Err(CommandError::new(
            "changes/cursor-scope-changed",
            "Change cursor belongs to different grants or query",
        ));
    }
    let (first,last): (i64,i64) = tx.query_row("SELECT COALESCE(MIN(seq),0),COALESCE((SELECT seq FROM sqlite_sequence WHERE name='capability_changes'),0) FROM capability_changes", [], |r| Ok((r.get(0)?,r.get(1)?)))?;
    if prior_epoch != current_epoch || after > last || first > after + 1 {
        return Err(expired());
    }
    let event_types = serde_json::to_string(&selector.event_types)?;
    let settings = serde_json::to_string(&selector.settings_keys)?;
    let rows = {
        let mut stmt = tx.prepare("SELECT seq,kind,operation,entity_id,book_id,plugin_id,detail,event_id FROM capability_changes
          WHERE seq>?1 AND (
            (kind='event' AND operation IN (SELECT value FROM json_each(?2)) AND (?4 IS NULL OR book_id=?4))
            OR (kind='document' AND plugin_id=?5 AND (?4 IS NULL OR book_id=?4))
            OR (kind='setting' AND entity_id IN (SELECT value FROM json_each(?3)) AND (?4 IS NULL OR book_id=?4 OR entity_id='read-aware-reader-settings'))) ORDER BY seq LIMIT ?6")?;
        let values = stmt
            .query_map(
                params![
                    after,
                    event_types,
                    settings,
                    selector.book_id,
                    selector.plugin_id,
                    limit + 1
                ],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        CapabilityChange {
                            kind: r.get(1)?,
                            operation: r.get(2)?,
                            entity_id: r.get(3)?,
                            book_id: r.get(4)?,
                            plugin_id: r.get(5)?,
                            detail: r.get(6)?,
                            event_id: r.get(7)?,
                        },
                    ))
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        values
    };
    let has_more = rows.len() > limit;
    let position = if has_more { rows[limit - 1].0 } else { last };
    let next = cursor(&tx, owner, &key, position, &current_epoch)?;
    let changes = rows
        .into_iter()
        .take(limit)
        .map(|(_, change)| change)
        .collect();
    tx.commit()?;
    Ok(CapabilityChangePage {
        changes,
        cursor: next,
        has_more,
    })
}
#[tauri::command]
pub async fn capability_changes_open(
    owner: String,
    selector: ChangeSelector,
    app: tauri::AppHandle,
) -> Result<String, CommandError> {
    crate::storage::blocking("capability_changes_open", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        capability_changes_open_inner(&mut conn, &owner, selector)
    })
    .await
}
#[tauri::command]
pub async fn capability_changes_read(
    owner: String,
    selector: ChangeSelector,
    cursor: String,
    limit: usize,
    app: tauri::AppHandle,
) -> Result<CapabilityChangePage, CommandError> {
    crate::storage::blocking("capability_changes_read", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        capability_changes_read_inner(&mut conn, &owner, selector, &cursor, limit)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn changes_are_transactional_scoped_and_resumable_after_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("changes.sqlite");
        let mut conn = Connection::open(&path).unwrap();
        apply_connection_pragmas(&conn).unwrap();
        register_sql_functions(&conn).unwrap();
        run_migrations(&mut conn).unwrap();
        let selector = ChangeSelector {
            projection_key: None,
            event_types: vec![],
            settings_keys: vec![],
            book_id: Some("book".into()),
            plugin_id: Some("sample".into()),
        };
        let token =
            capability_changes_open_inner(&mut conn, "plugin:sample", selector.clone()).unwrap();
        {
            let tx = conn.transaction().unwrap();
            tx.execute("INSERT INTO plugin_documents(plugin_id,collection,id,json,book_id,updated_at) VALUES('sample','notes','rolled-back','{}','book','now')",[]).unwrap();
        }
        conn.execute("INSERT INTO plugin_documents(plugin_id,collection,id,json,book_id,updated_at) VALUES('sample','notes','visible','{\"secret\":\"PRIVATE_BODY\"}','book','now'),('other','notes','foreign','{}','book','now'),('sample','notes','other-book','{}','outside','now')",[]).unwrap();
        drop(conn);
        let mut conn = Connection::open(&path).unwrap();
        apply_connection_pragmas(&conn).unwrap();
        register_sql_functions(&conn).unwrap();
        let page =
            capability_changes_read_inner(&mut conn, "plugin:sample", selector.clone(), &token, 20)
                .unwrap();
        assert_eq!(page.changes.len(), 1);
        assert_eq!(page.changes[0].entity_id, "visible");
        assert!(!serde_json::to_string(&page)
            .unwrap()
            .contains("PRIVATE_BODY"));
        assert!(capability_changes_read_inner(
            &mut conn,
            "plugin:other",
            selector.clone(),
            &token,
            20
        )
        .is_err());
        let mut changed = selector.clone();
        changed.book_id = Some("outside".into());
        assert_eq!(
            capability_changes_read_inner(&mut conn, "plugin:sample", changed, &token, 20)
                .err()
                .unwrap()
                .code,
            "changes/cursor-scope-changed"
        );
        assert!(capability_changes_read_inner(
            &mut conn,
            "plugin:sample",
            selector.clone(),
            &page.cursor,
            20
        )
        .unwrap()
        .changes
        .is_empty());
        let events = ChangeSelector {
            projection_key: None,
            event_types: vec![
                "note.updated".into(),
                "book.merged".into(),
                "memory.revised".into(),
            ],
            settings_keys: vec![],
            book_id: Some("book".into()),
            plugin_id: None,
        };
        let event_cursor =
            capability_changes_open_inner(&mut conn, "plugin:sample", events.clone()).unwrap();
        conn.execute("INSERT INTO domain_events(id,type,hlc_wall_ms,hlc_counter,hlc_device,aggregate_type,aggregate_id,payload_json,created_at) VALUES
          ('note-create','note.created',10,0,'device','annotation','note','{\"noteId\":\"note\",\"bookId\":\"book\",\"body\":\"SECRET_NOTE\"}','now'),
          ('note-edit','note.updated',11,0,'device','annotation','note','{\"noteId\":\"note\",\"body\":\"NEW_SECRET\"}','now'),
          ('memory-create','memory.promoted',12,0,'device','memory','memory','{\"memoryId\":\"memory\",\"scope\":\"book\",\"bookId\":\"book\"}','now'),
          ('memory-move','memory.revised',13,0,'device','memory','memory','{\"memoryId\":\"memory\",\"scope\":\"user\"}','now'),
          ('merge','book.merged',14,0,'device','book','book','{\"keepId\":\"book\",\"mergedId\":\"outside\"}','now')",[]).unwrap();
        let routed =
            capability_changes_read_inner(&mut conn, "plugin:sample", events, &event_cursor, 20)
                .unwrap();
        assert_eq!(routed.changes.len(), 3);
        assert!(routed
            .changes
            .iter()
            .all(|change| change.book_id.as_deref() == Some("book")));
        assert!(!serde_json::to_string(&routed).unwrap().contains("SECRET"));
        let settings = ChangeSelector {
            projection_key: None,
            event_types: vec![],
            settings_keys: vec!["read-aware-reader-overrides".into()],
            book_id: Some("book".into()),
            plugin_id: None,
        };
        let setting_cursor =
            capability_changes_open_inner(&mut conn, "plugin:sample", settings.clone()).unwrap();
        conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES('read-aware-reader-overrides','{\"book\":{\"scope\":\"book\"},\"outside\":{\"scope\":\"book\"}}','now')",[]).unwrap();
        let settings_page = capability_changes_read_inner(
            &mut conn,
            "plugin:sample",
            settings.clone(),
            &setting_cursor,
            20,
        )
        .unwrap();
        assert_eq!(settings_page.changes.len(), 1);
        conn.execute("UPDATE app_kv SET value_json='{\"book\":{\"scope\":\"book\"},\"outside\":{\"scope\":\"global\"}}' WHERE key='read-aware-reader-overrides'",[]).unwrap();
        assert!(capability_changes_read_inner(
            &mut conn,
            "plugin:sample",
            settings,
            &settings_page.cursor,
            20
        )
        .unwrap()
        .changes
        .is_empty());
        let credentials = ChangeSelector {
            projection_key: None,
            event_types: vec![],
            settings_keys: vec!["read-aware-ai-config".into()],
            book_id: None,
            plugin_id: None,
        };
        let credential_cursor =
            capability_changes_open_inner(&mut conn, "plugin:sample", credentials.clone()).unwrap();
        {
            let tx = conn.transaction().unwrap();
            tx.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES('read-aware-secret:ai-api-key.rollback','SECRET_SEALED','now')",[]).unwrap();
        }
        assert!(capability_changes_read_inner(
            &mut conn,
            "plugin:sample",
            credentials.clone(),
            &credential_cursor,
            20
        )
        .unwrap()
        .changes
        .is_empty());
        conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES('read-aware-secret:ai-api-key.provider','SECRET_SEALED','now'),('read-aware-secret:plugin.sample.token','PRIVATE_SEALED','now'),('read-aware-secret:sync.session','PRIVATE_SESSION','now')",[]).unwrap();
        conn.execute("UPDATE app_kv SET value_json='SECRET_ROTATED' WHERE key='read-aware-secret:ai-api-key.provider'",[]).unwrap();
        conn.execute("UPDATE app_kv SET value_json=value_json WHERE key='read-aware-secret:ai-api-key.provider'",[]).unwrap();
        conn.execute(
            "DELETE FROM app_kv WHERE key='read-aware-secret:ai-api-key.provider'",
            [],
        )
        .unwrap();
        let credential_page = capability_changes_read_inner(
            &mut conn,
            "plugin:sample",
            credentials,
            &credential_cursor,
            20,
        )
        .unwrap();
        assert_eq!(credential_page.changes.len(), 3);
        assert!(credential_page
            .changes
            .iter()
            .all(|change| change.entity_id == "read-aware-ai-config"
                && change.detail.is_none()
                && change.book_id.is_none()));
        let serialized = serde_json::to_string(&credential_page).unwrap();
        for private in [
            "SECRET",
            "PRIVATE",
            "ai-api-key",
            "provider",
            "sync.session",
        ] {
            assert!(!serialized.contains(private));
        }
        conn.execute("INSERT INTO domain_events(id,type,hlc_wall_ms,hlc_counter,hlc_device,payload_json,created_at) VALUES('string-pref','preference.changed',15,0,'device','{\"key\":\"read-aware-default-mark-color\",\"value\":\"yellow\"}','now')",[]).unwrap();
        conn.execute("INSERT INTO domain_events(id,type,hlc_wall_ms,hlc_counter,hlc_device,payload_json,created_at) VALUES('reset-event','book.removed',1,0,'device','{}','now')",[]).unwrap();
        conn.execute("DELETE FROM domain_events WHERE id='reset-event'", [])
            .unwrap();
        assert_eq!(
            capability_changes_read_inner(
                &mut conn,
                "plugin:sample",
                selector.clone(),
                &page.cursor,
                20
            )
            .err()
            .unwrap()
            .code,
            "changes/cursor-expired"
        );
        let before_wipe =
            capability_changes_open_inner(&mut conn, "plugin:sample", selector.clone()).unwrap();
        super::super::schema::wipe_all_data_inner(&mut conn, dir.path()).unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM capability_changes", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            capability_changes_read_inner(
                &mut conn,
                "plugin:sample",
                selector.clone(),
                &before_wipe,
                20
            )
            .err()
            .unwrap()
            .code,
            "changes/cursor-expired"
        );
        let fresh =
            capability_changes_open_inner(&mut conn, "plugin:sample", selector.clone()).unwrap();
        conn.execute("INSERT INTO plugin_documents(plugin_id,collection,id,json,book_id,updated_at) VALUES('sample','notes','after-wipe','{}','book','now')",[]).unwrap();
        let after =
            capability_changes_read_inner(&mut conn, "plugin:sample", selector.clone(), &fresh, 20)
                .unwrap();
        assert_eq!(after.changes.len(), 1);
        assert_eq!(after.changes[0].entity_id, "after-wipe");
        // A rolled-back restore must not expire a valid cursor.
        {
            let tx = conn.transaction().unwrap();
            invalidate(&tx).unwrap();
        }
        assert!(capability_changes_read_inner(
            &mut conn,
            "plugin:sample",
            selector.clone(),
            &after.cursor,
            20
        )
        .is_ok());
        invalidate(&conn).unwrap();
        assert_eq!(
            capability_changes_read_inner(
                &mut conn,
                "plugin:sample",
                selector.clone(),
                &after.cursor,
                20
            )
            .err()
            .unwrap()
            .code,
            "changes/cursor-expired"
        );
        conn.execute("DELETE FROM capability_change_state", [])
            .unwrap();
        assert!(capability_changes_open_inner(&mut conn, "plugin:sample", selector).is_ok());
    }
}
