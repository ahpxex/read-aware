//! Two handles on one lock file contend like two processes do (OS advisory
//! locks belong to the open file, not the process), so one test process can
//! play both the app and the CLI.
use super::*;
use crate::error::CODE_STORE_IN_USE;

#[test]
fn shared_holders_coexist_and_block_an_exclusive_section() {
    let dir = tempfile::tempdir().unwrap();
    let app = StoreLock::acquire(dir.path(), Wait::Fail).unwrap();
    let cli = StoreLock::acquire(dir.path(), Wait::Fail).unwrap();
    assert!(app.exclusive(Wait::Fail).unwrap().is_none());
    let error = app.with_exclusive(|| Ok(())).unwrap_err();
    assert_eq!(error.code, CODE_STORE_IN_USE);
    drop(cli);
    // Alone now: the section runs, then the holder is back to shared.
    assert_eq!(app.with_exclusive(|| Ok(7)).unwrap(), 7);
    let again = StoreLock::acquire(dir.path(), Wait::Fail).unwrap();
    drop(again);
}

#[test]
fn an_exclusive_section_turns_new_holders_away_until_it_ends() {
    let dir = tempfile::tempdir().unwrap();
    let app = StoreLock::acquire(dir.path(), Wait::Fail).unwrap();
    let alone = app.exclusive(Wait::Fail).unwrap().expect("no other holder");
    let refused = StoreLock::acquire(dir.path(), Wait::Fail).err().unwrap();
    assert_eq!(refused.code, CODE_STORE_IN_USE);
    drop(alone);
    // Back to shared: a second holder fits beside it again.
    StoreLock::acquire(dir.path(), Wait::Fail).unwrap();
}

#[test]
fn a_blocking_holder_waits_for_the_exclusive_section_to_finish() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_path_buf();
    let app = StoreLock::acquire(&path, Wait::Fail).unwrap();
    let alone = app.exclusive(Wait::Fail).unwrap().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let waiter = std::thread::spawn(move || {
        let lock = StoreLock::acquire(&path, Wait::Block).unwrap();
        tx.send(()).unwrap();
        lock
    });
    // Still inside the exclusive section: the waiter has not got in.
    assert!(rx
        .recv_timeout(std::time::Duration::from_millis(200))
        .is_err());
    drop(alone);
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .expect("the waiter enters once the section ends");
    drop(waiter.join().unwrap());
}

#[test]
fn presence_reports_live_and_departed_processes() {
    let dir = tempfile::tempdir().unwrap();
    let presence = ProcessPresence::claim(dir.path()).unwrap();
    assert!(process_alive(dir.path(), &presence.id).unwrap());
    let id = presence.id.clone();
    drop(presence);
    assert!(!process_alive(dir.path(), &id).unwrap());
    // Owners recorded before presence locks existed have no file.
    assert!(!process_alive(dir.path(), &uuid::Uuid::new_v4().to_string()).unwrap());
    assert!(!process_alive(dir.path(), "not-a-process-id").unwrap());
}

#[test]
fn a_crashed_process_leaves_a_file_but_not_a_lock() {
    let dir = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let path = dir.path().join("locks").join(format!("{id}.lock"));
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    // The file a crashed process left: present, but nobody holds its lock.
    std::fs::write(&path, b"").unwrap();
    assert!(!process_alive(dir.path(), &id).unwrap());
    assert!(!path.exists(), "the dead owner's file is cleared");
}

#[test]
fn opening_a_library_that_needs_maintenance_beside_another_process_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let app = StoreLock::acquire(dir.path(), Wait::Fail).unwrap();
    let cli = StoreLock::acquire(dir.path(), Wait::Fail).unwrap();
    // A brand-new library still has every migration to run.
    let refused = crate::storage::init_db(dir.path(), &cli, Wait::Fail).unwrap_err();
    assert_eq!(refused.code, CODE_STORE_IN_USE);
    drop(app);
    crate::storage::init_db(dir.path(), &cli, Wait::Fail).unwrap();
}

#[test]
fn an_up_to_date_library_opens_beside_another_process() {
    let dir = tempfile::tempdir().unwrap();
    let app = StoreLock::acquire(dir.path(), Wait::Fail).unwrap();
    crate::storage::init_db(dir.path(), &app, Wait::Fail).unwrap();
    let cli = StoreLock::acquire(dir.path(), Wait::Fail).unwrap();
    let conn = crate::storage::init_db(dir.path(), &cli, Wait::Fail).unwrap();
    assert_eq!(
        crate::storage::schema_version(&conn).unwrap(),
        crate::storage::SCHEMA_VERSION
    );
}

#[test]
fn a_library_from_a_newer_build_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let lock = StoreLock::acquire(dir.path(), Wait::Fail).unwrap();
    let mut conn = crate::storage::init_db(dir.path(), &lock, Wait::Fail).unwrap();
    conn.execute(
        "INSERT INTO schema_migrations (version, name) VALUES (?1, 'from the future')",
        [crate::storage::SCHEMA_VERSION + 1],
    )
    .unwrap();
    let newer = crate::error::CODE_STORE_SCHEMA_NEWER;
    assert_eq!(
        crate::storage::run_migrations(&mut conn).unwrap_err().code,
        newer
    );
    drop(conn);
    assert_eq!(
        crate::storage::init_db(dir.path(), &lock, Wait::Fail)
            .unwrap_err()
            .code,
        newer
    );
}
