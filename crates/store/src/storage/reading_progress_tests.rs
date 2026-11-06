use super::*;
use serde_json::json;

fn at(page: i64) -> Value {
    json!({"currentLocation":page,"totalLocations":1000,"progressPercent":(page as f64 / 10.0).round(),
        "locator":format!("epubcfi(/6/2!/4/2/1:{page})"),"chapterHref":"chapter.xhtml","status":"reading"})
}

fn saved(conn: &Connection) -> Value {
    serde_json::from_str(&scalar::<String>(
        conn,
        "SELECT progress_json FROM books WHERE id='b1'",
    ))
    .unwrap()
}

fn total_ms(conn: &Connection) -> i64 {
    scalar::<i64>(
        conn,
        "SELECT total_ms FROM reading_time_totals WHERE book_id='b1'",
    )
}

#[test]
fn ordering_agrees_with_frontend_fixtures() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("reading_progress_cases.json")).unwrap();
    for case in cases {
        let order = super::super::reading_progress::compare(&case["left"], &case["right"]) as i32;
        assert_eq!(
            order,
            case["order"].as_i64().unwrap() as i32,
            "{}",
            case["name"]
        );
    }
}

#[test]
fn last_observed_position_converges_in_both_orders_and_survives_replay() {
    // The tablet read on to page 300; the computer then turned BACK to 200.
    let far = session_event(
        "tablet",
        2000,
        "b1",
        60000,
        (1000, 2000),
        10,
        Some(observed(at(300), 2000)),
    );
    let near = session_event(
        "computer",
        3000,
        "b1",
        40000,
        (2000, 3000),
        10,
        Some(observed(at(200), 3000)),
    );
    for (local, remote) in [(&far, &near), (&near, &far)] {
        let (mut conn, dir) = conn_with_dir();
        commit_events_inner(&mut conn, &[imported("import", 1000, "b1", "Latest")]).unwrap();
        commit_events_inner(&mut conn, std::slice::from_ref(local)).unwrap();
        super::super::events::apply_remote_events_inner(
            &mut conn,
            &dir,
            std::slice::from_ref(remote),
            None,
        )
        .unwrap();
        assert_eq!(
            saved(&conn)["currentLocation"],
            200,
            "the page read last is where the book reopens"
        );
        assert_eq!(saved(&conn)["cfi"], at(200)["locator"]);
        assert_eq!(
            scalar::<i64>(
                &conn,
                "SELECT progress_observed_at FROM books WHERE id='b1'"
            ),
            3000
        );
        super::super::events::apply_remote_events_inner(
            &mut conn,
            &dir,
            std::slice::from_ref(remote),
            None,
        )
        .unwrap();
        assert_eq!(total_ms(&conn), 100000, "redelivery counts no time twice");
        // A farther page from a third device counts only by its own clock:
        // observed before the computer's turn back, it cannot override it.
        let further = session_event(
            "further",
            1500,
            "b1",
            50000,
            (1100, 1400),
            10,
            Some(observed(at(400), 1200)),
        );
        super::super::events::apply_remote_events_inner(&mut conn, &dir, &[further], None).unwrap();
        assert_eq!(saved(&conn)["currentLocation"], 200);
        // Observed after it, any page wins — further or not.
        let later = session_event(
            "later",
            3600,
            "b1",
            10000,
            (3400, 3600),
            10,
            Some(observed(at(250), 3500)),
        );
        super::super::events::apply_remote_events_inner(&mut conn, &dir, &[later], None).unwrap();
        assert_eq!(saved(&conn)["currentLocation"], 250);
        let before = saved(&conn);
        let tx = conn.transaction().unwrap();
        replay_into(&tx).unwrap();
        tx.commit().unwrap();
        assert_eq!(
            saved(&conn),
            before,
            "a full replay lands on the same position"
        );
        assert_eq!(total_ms(&conn), 160000);
    }
}

fn resting(cfi: &str) -> Value {
    json!({"modeKey":"sentence-reader:guided-reading","unitId":"sentence","contentVersion":"v1","cfi":cfi})
}

fn with_mode(mut progress: Value, mode: Value) -> Value {
    progress["readingMode"] = mode;
    progress
}

#[test]
fn the_reading_mode_resting_unit_travels_with_the_winning_position() {
    // The phone stepped on to a sentence on page 300; the computer had last
    // rested on a sentence on page 200, observed earlier.
    let phone = session_event(
        "phone",
        3000,
        "b1",
        40000,
        (2000, 3000),
        10,
        Some(observed(
            with_mode(at(300), resting("epubcfi(/6/2!/4/2,/1:300,/1:340)")),
            3000,
        )),
    );
    let computer = session_event(
        "computer",
        2000,
        "b1",
        40000,
        (1000, 2000),
        10,
        Some(observed(
            with_mode(at(200), resting("epubcfi(/6/2!/4/2,/1:200,/1:240)")),
            2000,
        )),
    );
    for (local, remote) in [(&computer, &phone), (&phone, &computer)] {
        let (mut conn, dir) = conn_with_dir();
        commit_events_inner(&mut conn, &[imported("import", 1000, "b1", "Latest")]).unwrap();
        commit_events_inner(&mut conn, std::slice::from_ref(local)).unwrap();
        super::super::events::apply_remote_events_inner(
            &mut conn,
            &dir,
            std::slice::from_ref(remote),
            None,
        )
        .unwrap();
        assert_eq!(saved(&conn)["currentLocation"], 300);
        assert_eq!(
            saved(&conn)["readingMode"]["cfi"],
            "epubcfi(/6/2!/4/2,/1:300,/1:340)",
            "the mode resumes on the unit observed with the winning position"
        );
    }

    let (mut conn, _dir) = conn_with_dir();
    commit_events_inner(&mut conn, &[imported("import", 1000, "b1", "Latest")]).unwrap();
    commit_events_inner(&mut conn, std::slice::from_ref(&phone)).unwrap();
    // A later observation without a resting unit (mode off) clears it; one
    // from a build that predates the field says nothing about the mode.
    let off = session_event(
        "off",
        4000,
        "b1",
        1000,
        (3500, 4000),
        11,
        Some(observed(with_mode(at(310), Value::Null), 4000)),
    );
    commit_events_inner(&mut conn, &[off]).unwrap();
    assert_eq!(saved(&conn)["readingMode"], Value::Null);
    let legacy = session_event(
        "legacy",
        5000,
        "b1",
        1000,
        (4500, 5000),
        12,
        Some(observed(at(320), 5000)),
    );
    commit_events_inner(&mut conn, &[legacy]).unwrap();
    assert!(saved(&conn).get("readingMode").is_none());
    // A malformed unit is not stored as one.
    let malformed = session_event(
        "malformed",
        6000,
        "b1",
        1000,
        (5500, 6000),
        13,
        Some(observed(
            with_mode(at(330), json!({"cfi":"epubcfi(/6/2!/4/2/1:0)"})),
            6000,
        )),
    );
    commit_events_inner(&mut conn, &[malformed]).unwrap();
    assert_eq!(saved(&conn)["currentLocation"], 330);
    assert!(saved(&conn).get("readingMode").is_none());
    let before = saved(&conn);
    let tx = conn.transaction().unwrap();
    replay_into(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(saved(&conn), before, "a full replay lands on the same unit");
}

#[test]
fn a_step_within_the_page_keeps_the_pending_session_open_until_flushed() {
    let mut conn = migrated_conn();
    commit_events_inner(&mut conn, &[imported("import", 1000, "b1", "Latest")]).unwrap();
    let first = with_mode(at(300), resting("epubcfi(/6/2!/4/2,/1:300,/1:340)"));
    let next = with_mode(at(300), resting("epubcfi(/6/2!/4/2,/1:340,/1:380)"));
    reading_session_position_inner(&conn, "b1", "2026-09-07", 10, 3000, &first).unwrap();
    let flush = session_event(
        "flush",
        4000,
        "b1",
        0,
        (3000, 3000),
        10,
        Some(observed(first, 3000)),
    );
    // The step lands while the flush of the previous unit is in flight, on
    // the same page and (coarse clock) at the same instant.
    reading_session_position_inner(&conn, "b1", "2026-09-07", 10, 3000, &next).unwrap();
    reading_session_flush_inner(&mut conn, &[flush]).unwrap();
    let pending = reading_sessions_pending_inner(&conn).unwrap();
    assert_eq!(
        pending.len(),
        1,
        "the newer unit is not retired with the older one"
    );
    assert_eq!(
        pending[0].progress["readingMode"]["cfi"],
        "epubcfi(/6/2!/4/2,/1:340,/1:380)"
    );
}

#[test]
fn pending_session_keeps_the_latest_page_and_a_flush_race_cannot_erase_it() {
    let mut conn = migrated_conn();
    commit_events_inner(&mut conn, &[imported("import", 1000, "b1", "Latest")]).unwrap();
    reading_session_position_inner(&conn, "b1", "2026-09-07", 10, 2000, &at(300)).unwrap();
    // Turning back is a page turn like any other: the bucket follows.
    let back =
        reading_session_position_inner(&conn, "b1", "2026-09-07", 10, 3000, &at(200)).unwrap();
    assert_eq!(back.progress["currentLocation"], 200);
    assert_eq!(back.position_at, Some(3000));
    let flush = session_event(
        "flush",
        4000,
        "b1",
        0,
        (2000, 3000),
        10,
        Some(observed(at(200), 3000)),
    );
    // While that flush is in flight the wall clock steps BACK and a turn to
    // 301 lands: the position moves, its clock does not run backwards.
    let stepped =
        reading_session_position_inner(&conn, "b1", "2026-09-07", 10, 1500, &at(301)).unwrap();
    assert_eq!(
        (
            stepped.progress["currentLocation"].as_i64(),
            stepped.position_at
        ),
        (Some(301), Some(3000))
    );
    reading_session_flush_inner(&mut conn, &[flush]).unwrap();
    assert_eq!(
        saved(&conn)["currentLocation"],
        200,
        "the flushed observation is projected"
    );
    let pending = reading_sessions_pending_inner(&conn).unwrap();
    assert_eq!(
        pending.len(),
        1,
        "a different position at the same clock keeps the bucket open"
    );
    assert_eq!(pending[0].progress["currentLocation"], 301);
    let rest = session_event(
        "rest",
        5000,
        "b1",
        0,
        (2000, 3000),
        10,
        Some(observed(at(301), 3000)),
    );
    reading_session_flush_inner(&mut conn, &[rest]).unwrap();
    assert_eq!(
        saved(&conn)["currentLocation"],
        301,
        "equal clocks fall back to the further page"
    );
    assert!(reading_sessions_pending_inner(&conn).unwrap().is_empty());
}

#[test]
fn legacy_events_follow_their_own_clock_and_equal_clocks_break_by_position() {
    let mut conn = migrated_conn();
    commit_events_inner(&mut conn, &[imported("import", 1000, "b1", "Latest")]).unwrap();
    for (id, wall, page) in [("a", 2000, 300), ("b", 3000, 301), ("c", 4000, 300)] {
        let mut p = at(page);
        p["bookId"] = json!("b1");
        commit_events_inner(&mut conn, &[ev(id, wall, "book.progressed", p)]).unwrap();
    }
    assert_eq!(
        saved(&conn)["currentLocation"],
        300,
        "the latest stamp wins, not the furthest page"
    );
    let mut p = at(300);
    p["locator"] = json!("epubcfi(/6/2!/4/2/1:302)");
    p["bookId"] = json!("b1");
    commit_events_inner(&mut conn, &[ev("d", 5000, "book.progressed", p)]).unwrap();
    assert_eq!(saved(&conn)["cfi"], "epubcfi(/6/2!/4/2/1:302)");
    // Same wall clock (distinct HLC counters, or the unique HLC index would
    // treat them as redeliveries): the further CFI start wins, an earlier
    // one loses.
    let mut p = at(300);
    p["locator"] = json!("epubcfi(/6/2!/4/2/1:303)");
    p["bookId"] = json!("b1");
    let mut further = ev("e", 5000, "book.progressed", p);
    further.hlc.counter = 1;
    commit_events_inner(&mut conn, &[further]).unwrap();
    assert_eq!(saved(&conn)["cfi"], "epubcfi(/6/2!/4/2/1:303)");
    let mut p = at(300);
    p["bookId"] = json!("b1");
    let mut earlier = ev("f", 5000, "book.progressed", p);
    earlier.hlc.counter = 2;
    commit_events_inner(&mut conn, &[earlier]).unwrap();
    assert_eq!(saved(&conn)["cfi"], "epubcfi(/6/2!/4/2/1:303)");
}

#[test]
fn upgrade_settles_the_last_observed_page_without_double_counting_or_rebuilding_legacy_data() {
    let mut conn = test_conn();
    super::super::schema::run_migrations_up_to(&mut conn, 53).unwrap();
    commit_events_inner(
        &mut conn,
        &[
            imported("import", 1000, "b1", "Latest"),
            session_event("far", 2000, "b1", 60000, (1000, 2000), 10, Some(at(300))),
            session_event("near", 3000, "b1", 40000, (2000, 3000), 10, Some(at(200))),
        ],
    )
    .unwrap();
    // Recreate the v53 furthest-position projection and an unrelated legacy field.
    conn.execute("UPDATE books SET progress_json=?1,progress_percent=30,progress_observed_at=2000,author='Legacy author' WHERE id='b1'",
        params![json!({"currentLocation":300,"totalLocations":1000,"progressPercent":30,"cfi":at(300)["locator"]}).to_string()]).unwrap();
    run_migrations(&mut conn).unwrap();
    assert_eq!(
        saved(&conn)["currentLocation"],
        200,
        "the page turned back to comes back"
    );
    assert_eq!(
        scalar::<i64>(
            &conn,
            "SELECT progress_observed_at FROM books WHERE id='b1'"
        ),
        3000
    );
    assert_eq!(
        total_ms(&conn),
        100000,
        "recovery replays positions, not time"
    );
    assert_eq!(
        scalar::<String>(&conn, "SELECT author FROM books WHERE id='b1'"),
        "Legacy author"
    );
    run_migrations(&mut conn).unwrap();
    assert_eq!(saved(&conn)["currentLocation"], 200);
    // A pre-v27 row carries a position but no clock: any logged observation settles it.
    conn.execute("UPDATE books SET progress_json=?1,progress_percent=90,progress_observed_at=NULL WHERE id='b1'",
        params![at(900).to_string()]).unwrap();
    let tx = conn.transaction().unwrap();
    super::super::apply::recover_logged_progress(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(saved(&conn)["currentLocation"], 200);
}

#[test]
fn upgrade_defers_incomplete_log_replay_and_ignores_old_checkpoints() {
    let (mut conn, dir) = conn_with_dir();
    commit_events_inner(&mut conn, &[imported("import", 1000, "b1", "Latest")]).unwrap();
    let checkpoint = create_checkpoint(&mut conn, &dir, "local", None).unwrap();
    conn.execute(
        "UPDATE projection_checkpoints SET schema_version=53 WHERE id=?1",
        params![checkpoint.id],
    )
    .unwrap();
    assert!(super::super::checkpoints::newest_checkpoint(&conn)
        .unwrap()
        .is_none());
    // Upgrade an actual incomplete v53 schema. Do not erase its checkpoint-derived books.
    // Every schema-changing migration >= 54 must be reverted here, so v54+
    // runs again on the v53 shape: v55's column and v56's font tables/triggers.
    conn.execute_batch(
        "ALTER TABLE books DROP COLUMN source_path;
         DROP TRIGGER trg_user_font_removal_cleanup_delete;
         DROP TRIGGER trg_user_font_removal_cleanup_restore;
         DROP TABLE user_font_removal_cleanup;
         DROP TABLE user_fonts;
         DELETE FROM schema_migrations WHERE version >= 54;",
    )
    .unwrap();
    super::super::checkpoints::set_log_complete(&conn, false).unwrap();
    run_migrations(&mut conn).unwrap();
    assert!(super::super::events::projections_stale_conn(&conn).unwrap());
    assert!(
        super::super::events::finalize_staged_events_inner(&mut conn, &dir)
            .unwrap()
            .is_none()
    );
    assert_eq!(scalar::<i64>(&conn, "SELECT COUNT(*) FROM books"), 1);
    super::super::checkpoints::set_log_complete(&conn, true).unwrap();
    assert!(
        super::super::events::finalize_staged_events_inner(&mut conn, &dir)
            .unwrap()
            .is_some()
    );
}

#[test]
fn book_merge_and_upgrade_recovery_keep_the_last_read_position_with_aliases() {
    let mut conn = test_conn();
    super::super::schema::run_migrations_up_to(&mut conn, 53).unwrap();
    let mut keeper = at(300);
    keeper["bookId"] = json!("b1");
    let mut merged = at(301);
    merged["bookId"] = json!("b2");
    commit_events_inner(
        &mut conn,
        &[
            imported("import", 1000, "b1", "Latest"),
            imported("duplicate", 1001, "b2", "Duplicate"),
            ev("keeper", 2000, "book.progressed", keeper),
            ev("merged", 2001, "book.progressed", merged),
            ev(
                "merge",
                3000,
                "book.merged",
                json!({"keepId":"b1","mergedId":"b2"}),
            ),
        ],
    )
    .unwrap();
    assert_eq!(
        saved(&conn)["currentLocation"],
        301,
        "the record read last supplies the keeper's position"
    );
    conn.execute(
        "UPDATE books SET progress_json=?1,progress_percent=30,progress_observed_at=2000 WHERE id='b1'",
        params![at(300).to_string()],
    )
    .unwrap();
    run_migrations(&mut conn).unwrap();
    assert_eq!(
        saved(&conn)["currentLocation"],
        301,
        "history of the merged id settles the keeper"
    );
    assert_eq!(scalar::<i64>(&conn, "SELECT COUNT(*) FROM books"), 1);

    // The other way round: the merged record is FURTHER but was read earlier.
    let mut conn = migrated_conn();
    let mut keeper = at(300);
    keeper["bookId"] = json!("b1");
    let mut merged = at(301);
    merged["bookId"] = json!("b2");
    commit_events_inner(
        &mut conn,
        &[
            imported("import", 1000, "b1", "Latest"),
            imported("duplicate", 1001, "b2", "Duplicate"),
            ev("merged", 2000, "book.progressed", merged),
            ev("keeper", 2001, "book.progressed", keeper),
            ev(
                "merge",
                3000,
                "book.merged",
                json!({"keepId":"b1","mergedId":"b2"}),
            ),
        ],
    )
    .unwrap();
    assert_eq!(
        saved(&conn)["currentLocation"],
        300,
        "an earlier page on the merged record does not move the keeper"
    );
}
