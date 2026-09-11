use super::*;
use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
};

#[derive(Default)]
struct Fake {
    files: RefCell<BTreeMap<PathBuf, Vec<u8>>>,
    calls: Cell<usize>,
    fail_at: Cell<Option<usize>>,
    fail_read: Cell<bool>,
    refreshes: Cell<usize>,
    ignore_mime: Cell<bool>,
}
impl Fake {
    fn changed(&self) -> Result<(), CommandError> {
        self.calls.set(self.calls.get() + 1);
        if self.fail_at.get() == Some(self.calls.get()) {
            self.fail_at.set(None);
            return Err(error("injected OS failure after mutation"));
        }
        Ok(())
    }
}
impl System for Fake {
    fn data_home(&self) -> &Path {
        Path::new("/data")
    }
    fn config_home(&self) -> &Path {
        Path::new("/config")
    }
    fn data_dirs(&self) -> &[PathBuf] {
        &[]
    }
    fn read(&self, path: &Path) -> Result<Option<Vec<u8>>, CommandError> {
        if self.fail_read.get() {
            return Err(error("injected read/permission failure"));
        }
        Ok(self.files.borrow().get(path).cloned())
    }
    fn write(&self, path: &Path, bytes: Option<&[u8]>) -> Result<(), CommandError> {
        if let Some(bytes) = bytes {
            self.files.borrow_mut().insert(path.into(), bytes.into());
        } else {
            self.files.borrow_mut().remove(path);
        }
        self.changed()
    }
    fn mime(&self, path: &Path, bytes: &[u8], install: bool) -> Result<(), CommandError> {
        if self.ignore_mime.get() {
            return self.changed();
        }
        self.write(path, install.then_some(bytes))
    }
    fn refresh(&self) -> Result<(), CommandError> {
        self.refreshes.set(self.refreshes.get() + 1);
        self.changed()
    }
}
fn id() -> Identity {
    Identity::new("test.readaware", "ReadAware Test", "/opt/app", "app").unwrap()
}

#[test]
fn publish_occurs_only_after_verified_files_mime_install_and_cache_refresh() {
    let system = Fake::default();
    let plan = prepare(&system, &id(), true).unwrap();
    commit(&system, &plan, || {
        assert!(system.files.borrow().contains_key(&plan.package.path));
        assert_eq!(system.refreshes.get(), 1);
        Ok(())
    })
    .unwrap();
    let disabled = prepare(&system, &id(), false).unwrap();
    commit(&system, &disabled, || Ok(())).unwrap();
    assert!(!system.files.borrow().contains_key(&plan.package.path));
    assert_eq!(system.refreshes.get(), 2);
    let calls = system.calls.get();
    commit(&system, &prepare(&system, &id(), false).unwrap(), || Ok(())).unwrap();
    assert_eq!(system.calls.get(), calls);
}

#[test]
fn every_partial_os_step_compensates_without_persisting() {
    for enabled in [false, true] {
        for fail in 1..=4 {
            let system = Fake::default();
            if !enabled {
                commit(&system, &prepare(&system, &id(), true).unwrap(), || Ok(())).unwrap();
            }
            let before = system.files.borrow().clone();
            system.calls.set(0);
            system.fail_at.set(Some(fail));
            assert!(commit::<()>(
                &system,
                &prepare(&system, &id(), enabled).unwrap(),
                || panic!("must not save")
            )
            .is_err());
            assert_eq!(
                *system.files.borrow(),
                before,
                "failure {fail}, enabled {enabled}"
            );
        }
    }
}

#[test]
fn sqlite_failure_restores_all_three_files_and_the_previous_shared_defaults() {
    let system = Fake::default();
    let original =
        b"[Default Applications]\napplication/pdf=Other.desktop;\n# keep exact bytes on rollback\n";
    system
        .files
        .borrow_mut()
        .insert(PathBuf::from("/config/mimeapps.list"), original.to_vec());
    let before = system.files.borrow().clone();
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE prefs (value TEXT); CREATE TRIGGER reject BEFORE INSERT ON prefs BEGIN SELECT RAISE(ABORT, 'injected'); END;").unwrap();
    let error = commit(&system, &prepare(&system, &id(), true).unwrap(), || {
        conn.execute("INSERT INTO prefs VALUES ('enabled')", [])?;
        Ok(())
    })
    .unwrap_err();
    assert_eq!(error.code, "db/error");
    assert_eq!(*system.files.borrow(), before);
}

#[test]
fn read_failure_and_foreign_package_are_not_empty_success() {
    let system = Fake::default();
    system.fail_read.set(true);
    assert!(prepare(&system, &id(), true).is_err());
    assert_eq!(system.calls.get(), 0);
    system.fail_read.set(false);
    system.files.borrow_mut().insert(
        PathBuf::from("/data/mime/packages").join(id().package_name()),
        b"<foreign/>".to_vec(),
    );
    assert!(prepare(&system, &id(), true).is_err());
    assert_eq!(system.calls.get(), 0);
}

#[test]
fn external_edits_before_write_and_during_compensation_are_preserved() {
    let system = Fake::default();
    let plan = prepare(&system, &id(), true).unwrap();
    let path = plan.files[0].path.clone();
    system
        .files
        .borrow_mut()
        .insert(path.clone(), b"external".to_vec());
    assert!(commit::<()>(&system, &plan, || panic!("no save")).is_err());
    assert_eq!(system.calls.get(), 0);
    system.files.borrow_mut().clear();
    let failure = commit(&system, &plan, || {
        system
            .files
            .borrow_mut()
            .insert(path.clone(), b"external".to_vec());
        Err::<(), _>(error("injected persistence failure"))
    })
    .unwrap_err();
    assert!(failure.message.contains("compensation failed"));
    assert_eq!(system.read(&path).unwrap(), Some(b"external".to_vec()));
}

#[test]
fn late_read_denial_reports_compensation_failure_explicitly() {
    let system = Fake::default();
    let plan = prepare(&system, &id(), true).unwrap();
    let result = commit(&system, &plan, || {
        system.fail_read.set(true);
        Err::<(), _>(error("injected late read denial"))
    });
    assert!(result.unwrap_err().message.contains("compensation failed"));
}

#[test]
fn ignored_xdg_install_is_detected_before_sqlite() {
    let system = Fake::default();
    system.ignore_mime.set(true);
    let plan = prepare(&system, &id(), true).unwrap();
    assert!(commit::<()>(&system, &plan, || panic!(
        "must not persist missing registration"
    ))
    .is_err());
    assert!(system.files.borrow().is_empty());
}
