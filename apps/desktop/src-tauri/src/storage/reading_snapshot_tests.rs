use super::*;

fn query(
    book: Option<&str>,
    day: Option<&str>,
    after: Option<ReadingTimeCursor>,
    limit: i64,
) -> ReadingTimeQuery {
    ReadingTimeQuery {
        book_id: book.map(str::to_owned),
        local_day: day.map(str::to_owned),
        after,
        limit: Some(limit),
    }
}

#[test]
fn snapshot_counts_pending_once_across_a_racing_tick_and_flush() {
    let mut conn = migrated_conn();
    commit_events_inner(&mut conn, &[imported("e1", 1_000, "b1", "Time")]).unwrap();
    reading_session_accrue_inner(&conn, "b1", "2026-09-07", 15, 20_000, 1_020_000).unwrap();
    reading_session_position_inner(
        &conn,
        "b1",
        "2026-09-07",
        15,
        1_030_000,
        &position(12, "ch1"),
    )
    .unwrap();
    let first = reading_time_snapshot_inner(&mut conn, query(Some("b1"), None, None, 1)).unwrap();
    assert_eq!(
        (first.settled_ms, first.pending_ms, first.total_ms),
        (0, 20_000, 20_000)
    );
    assert_eq!(first.pending[0].position_at, Some(1_030_000));
    reading_session_accrue_inner(&conn, "b1", "2026-09-07", 15, 5_000, 1_040_000).unwrap();
    let flush = session_event(
        "s1",
        2_000,
        "b1",
        20_000,
        1_000_000,
        1_030_000,
        15,
        Some(position(12, "ch1")),
    );
    reading_session_flush_inner(&mut conn, &[flush]).unwrap();
    let second =
        reading_time_snapshot_inner(&mut conn, query(Some("b1"), Some("2026-09-07"), None, 1))
            .unwrap();
    assert_eq!(
        (second.settled_ms, second.pending_ms, second.total_ms),
        (20_000, 5_000, 25_000)
    );
    assert_eq!(second.pending[0].position_at, Some(1_030_000));
    let count = scalar::<i64>(&conn, "SELECT COUNT(*) FROM domain_events");
    reading_time_snapshot_inner(&mut conn, query(None, None, None, 1)).unwrap();
    assert_eq!(
        scalar::<i64>(&conn, "SELECT COUNT(*) FROM domain_events"),
        count
    );
}

#[test]
fn snapshot_pages_are_bounded_but_totals_are_not_and_scope_is_exact() {
    let mut conn = migrated_conn();
    commit_events_inner(
        &mut conn,
        &[
            imported("e1", 1_000, "a", "A"),
            imported("e2", 1_001, "b", "B"),
        ],
    )
    .unwrap();
    for (id, day, hour, ms) in [
        ("a", "2026-09-07", 1, 100),
        ("a", "2026-09-07", 2, 200),
        ("b", "2026-09-08", 1, 300),
    ] {
        reading_session_accrue_inner(&conn, id, day, hour, ms, 1_010_000).unwrap();
    }
    let page = reading_time_snapshot_inner(&mut conn, query(None, None, None, 1)).unwrap();
    assert_eq!(
        (page.pending.len(), page.total_ms, page.pending_bucket_count),
        (1, 600, 3)
    );
    let next =
        reading_time_snapshot_inner(&mut conn, query(None, None, page.next_cursor, 2)).unwrap();
    assert_eq!((next.pending.len(), next.total_ms), (2, 600));
    assert!(next.next_cursor.is_none());
    let day =
        reading_time_snapshot_inner(&mut conn, query(None, Some("2026-09-07"), None, 100)).unwrap();
    assert_eq!(day.total_ms, 300);
    let one = reading_time_snapshot_inner(&mut conn, query(Some("b"), None, None, 100)).unwrap();
    assert_eq!(one.pending_bucket_count, 1);
    assert_eq!(one.total_ms, 300);
    for day in ["2026-02-30", "2026-1-01", "bad"] {
        assert!(reading_time_snapshot_inner(&mut conn, query(None, Some(day), None, 1)).is_err());
    }
    assert!(reading_time_snapshot_inner(&mut conn, query(Some("missing"), None, None, 1)).is_err());
    assert!(reading_time_snapshot_inner(&mut conn, query(None, None, None, 101)).is_err());
    set_projections_stale_conn(&conn, true).unwrap();
    assert!(reading_time_snapshot_inner(&mut conn, query(None, None, None, 1)).is_err());
}

#[test]
fn snapshot_is_consistent_while_a_separate_connection_flushes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("time.db");
    let mut conn = Connection::open(&path).unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    commit_events_inner(&mut conn, &[imported("e1", 1_000, "b1", "Time")]).unwrap();
    reading_session_accrue_inner(&conn, "b1", "2026-09-07", 15, 20_000, 1_000_000).unwrap();
    std::thread::scope(|scope| {
        scope.spawn(|| {
            let mut writer = Connection::open(&path).unwrap();
            apply_connection_pragmas(&writer).unwrap();
            register_sql_functions(&writer).unwrap();
            for index in 0..20 {
                let event = session_event(
                    &format!("s{index}"),
                    2_000 + index,
                    "b1",
                    1_000,
                    1_000_000,
                    1_000_000,
                    15,
                    None,
                );
                reading_session_flush_inner(&mut writer, &[event]).unwrap();
                std::thread::yield_now();
            }
        });
        for _ in 0..100 {
            let sample =
                reading_time_snapshot_inner(&mut conn, query(Some("b1"), None, None, 10)).unwrap();
            assert_eq!(sample.total_ms, 20_000);
            let history = reading_time_scope_inner(&mut conn, Some("b1".into())).unwrap();
            let total: i64 = history.totals.iter().map(|row| row.total_ms).sum();
            assert_eq!(history.daily.iter().map(|row| row.ms).sum::<i64>(), total);
            assert_eq!(history.hourly.iter().map(|row| row.ms).sum::<i64>(), total);
        }
    });
    let sample = reading_time_snapshot_inner(&mut conn, query(Some("b1"), None, None, 10)).unwrap();
    assert_eq!((sample.settled_ms, sample.pending_ms), (20_000, 0));
}

#[test]
fn scoped_history_validates_book_and_projection_and_never_flushes() {
    let mut conn = migrated_conn();
    commit_events_inner(&mut conn, &[imported("a", 1_000, "a", "A"), imported("b", 1_001, "b", "B")]).unwrap();
    commit_events_inner(&mut conn, &[session_event("s1", 2_000, "a", 5_000, 1_000_000, 1_000_000, 15, None),
        session_event("s2", 2_001, "b", 10_000, 1_000_000, 1_000_000, 18, None)]).unwrap();
    reading_session_accrue_inner(&conn, "a", "2026-09-07", 15, 9_000, 1_010_000).unwrap();
    let event_count = scalar::<i64>(&conn, "SELECT COUNT(*) FROM domain_events");
    let one = reading_time_scope_inner(&mut conn, Some("a".into())).unwrap();
    assert_eq!(one.totals.len(), 1);
    assert_eq!(one.totals[0].total_ms, 5_000);
    assert!(one.daily.iter().all(|row| row.book_id == "a"));
    assert!(one.hourly.iter().all(|row| row.book_id == "a"));
    let all = reading_time_scope_inner(&mut conn, None).unwrap();
    assert_eq!(all.totals.iter().map(|row| row.total_ms).sum::<i64>(), 15_000);
    assert_eq!(scalar::<i64>(&conn, "SELECT SUM(ms) FROM reading_sessions_pending"), 9_000);
    assert_eq!(scalar::<i64>(&conn, "SELECT COUNT(*) FROM domain_events"), event_count);
    for id in ["missing", " "] { assert!(reading_time_scope_inner(&mut conn, Some(id.into())).is_err()); }
    set_projections_stale_conn(&conn, true).unwrap();
    assert!(reading_time_scope_inner(&mut conn, None).is_err());
}
