//! The shared connection's lock, with recovery from panics under it.
use crate::error::{CommandError, CODE_DB_ERROR};
use rusqlite::Connection;
use std::sync::{Mutex, MutexGuard};

/// The one connection every storage command serializes on. A plain `Mutex`
/// would stay poisoned after any panic under the lock, failing every later
/// storage command until restart. The connection itself is recoverable:
/// rusqlite's `Transaction`/`Savepoint` roll back when dropped during
/// unwinding, so SQLite is normally back in autocommit before the guard is
/// released. Recovery re-establishes that invariant explicitly — rolling back
/// anything a failed drop-rollback or a raw `BEGIN` left open — before the
/// connection is handed out again.
pub struct SharedConnection(Mutex<Connection>);

impl SharedConnection {
    pub fn new(conn: Connection) -> Self {
        Self(Mutex::new(conn))
    }

    pub fn lock(&self) -> Result<MutexGuard<'_, Connection>, CommandError> {
        match self.0.lock() {
            Ok(guard) => Ok(guard),
            Err(poisoned) => {
                let guard = poisoned.into_inner();
                log::error!("storage connection lock was poisoned by a panic; recovering");
                recover(&guard)?;
                // Only a verified connection clears the flag; after a failed
                // rollback the next caller retries recovery instead.
                self.0.clear_poison();
                Ok(guard)
            }
        }
    }
}

fn recover(conn: &Connection) -> Result<(), CommandError> {
    if !conn.is_autocommit() {
        conn.execute_batch("ROLLBACK").map_err(|error| {
            log::error!("storage recovery could not roll back an open transaction: {error}");
            CommandError::context("storage recovery rollback failed", error)
        })?;
    }
    if !conn.is_autocommit() {
        return Err(CommandError::new(
            CODE_DB_ERROR,
            "storage recovery left a transaction open",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn shared() -> Arc<SharedConnection> {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE notes(text TEXT NOT NULL)")
            .unwrap();
        Arc::new(SharedConnection::new(conn))
    }

    fn panic_under_lock(shared: &Arc<SharedConnection>, work: fn(&mut Connection)) {
        let holder = shared.clone();
        let outcome = std::thread::spawn(move || {
            let mut conn = holder.lock().unwrap();
            work(&mut conn);
            panic!("injected failure while holding the storage lock");
        })
        .join();
        assert!(outcome.is_err());
        assert!(shared.0.is_poisoned());
    }

    fn count(shared: &SharedConnection) -> i64 {
        shared
            .lock()
            .unwrap()
            .query_row("SELECT count(*) FROM notes", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn a_panic_inside_a_transaction_rolls_back_and_storage_keeps_working() {
        let shared = shared();
        panic_under_lock(&shared, |conn| {
            let tx = conn.transaction().unwrap();
            tx.execute("INSERT INTO notes VALUES ('half-written')", [])
                .unwrap();
            // Unwinding drops the live `tx` before the guard: a rollback.
            panic!("injected failure inside the transaction");
        });
        assert_eq!(count(&shared), 0);
        assert!(!shared.0.is_poisoned());
        shared
            .lock()
            .unwrap()
            .execute("INSERT INTO notes VALUES ('after recovery')", [])
            .unwrap();
        assert_eq!(count(&shared), 1);
    }

    #[test]
    fn recovery_rolls_back_a_transaction_the_panic_left_open() {
        let shared = shared();
        panic_under_lock(&shared, |conn| {
            conn.execute_batch("BEGIN; INSERT INTO notes VALUES ('uncommitted');")
                .unwrap();
        });
        let conn = shared.lock().unwrap();
        assert!(conn.is_autocommit());
        assert_eq!(
            conn.query_row("SELECT count(*) FROM notes", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            0
        );
        drop(conn);
        assert!(!shared.0.is_poisoned());
    }

    #[test]
    fn an_unpoisoned_lock_is_handed_out_untouched() {
        let shared = shared();
        let conn = shared.lock().unwrap();
        conn.execute_batch("BEGIN; INSERT INTO notes VALUES ('mine');")
            .unwrap();
        assert!(!conn.is_autocommit());
        conn.execute_batch("COMMIT").unwrap();
        drop(conn);
        assert_eq!(count(&shared), 1);
    }
}
