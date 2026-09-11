use super::*;
use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
};

#[derive(Default)]
struct Store {
    values: RefCell<BTreeMap<(String, String), String>>,
    writes: Cell<usize>,
    fail_at: Cell<Option<usize>>,
    fail_read: Cell<bool>,
    fail_notify: Cell<bool>,
    notifications: Cell<usize>,
}

impl Store {
    fn put(&self, key: &str, name: &str, value: &str) {
        self.values
            .borrow_mut()
            .insert((key.into(), name.into()), value.into());
    }
    fn value(&self, key: &str, name: &str) -> Option<String> {
        self.values
            .borrow()
            .get(&(key.into(), name.into()))
            .cloned()
    }
}

impl Registry for Store {
    fn read(&self, key: &str, name: &str) -> Result<Option<String>, CommandError> {
        if self.fail_read.get() {
            return Err(unavailable("injected registry read failure"));
        }
        Ok(self.value(key, name))
    }
    fn write(&self, key: &str, name: &str, value: Option<&str>) -> Result<(), CommandError> {
        self.writes.set(self.writes.get() + 1);
        if let Some(value) = value {
            self.put(key, name, value);
        } else {
            self.values.borrow_mut().remove(&(key.into(), name.into()));
        }
        if self.fail_at.get() == Some(self.writes.get()) {
            self.fail_at.set(None);
            return Err(unavailable("injected partial registry write failure"));
        }
        Ok(())
    }
    fn notify(&self) -> Result<(), CommandError> {
        self.notifications.set(self.notifications.get() + 1);
        if self.fail_notify.replace(false) {
            return Err(unavailable("injected notification failure"));
        }
        Ok(())
    }
}

fn identity() -> Identity {
    Identity::new(
        "com.readaware.app",
        "ReadAware",
        r"C:\Program Files\ReadAware\ReadAware.exe",
    )
    .unwrap()
}

fn install(store: &Store, id: &Identity, enabled: bool) {
    commit(store, &prepare(store, id, enabled).unwrap(), || Ok(())).unwrap();
}

#[test]
fn registers_all_types_without_changing_defaults_or_other_open_with_choices() {
    let store = Store::default();
    let id = identity();
    store.put(".epub", "", "Other.Reader");
    store.put(".epub\\OpenWithProgids", "Other.Reader", "");
    let changes = prepare(&store, &id, true).unwrap();
    assert!(changes
        .iter()
        .all(|change| !change.key.contains("UserChoice")));
    commit(&store, &changes, || {
        assert_eq!(store.notifications.get(), 1);
        assert_eq!(
            store.value(&format!("{}\\shell\\open\\command", id.prog_id()), ""),
            Some(id.command())
        );
        Ok(())
    })
    .unwrap();
    for ext in book_types().iter().flat_map(|kind| &kind.extensions) {
        assert_eq!(
            store.value(&format!(".{ext}\\OpenWithProgids"), &id.prog_id()),
            Some(String::new())
        );
    }
    assert_eq!(store.value(".epub", "").as_deref(), Some("Other.Reader"));
    install(&store, &id, false);
    assert_eq!(store.value(".epub", "").as_deref(), Some("Other.Reader"));
    assert_eq!(
        store
            .value(".epub\\OpenWithProgids", "Other.Reader")
            .as_deref(),
        Some("")
    );
    assert_eq!(
        store.value(&format!("{}\\shell\\open\\command", id.prog_id()), ""),
        None
    );
    for ext in book_types().iter().flat_map(|kind| &kind.extensions) {
        assert_eq!(
            store.value(&format!(".{ext}\\OpenWithProgids"), &id.prog_id()),
            None
        );
    }
    assert!(prepare(&store, &id, false).unwrap().is_empty());
}

#[test]
fn moved_executable_updates_owned_command_and_dev_identity_is_separate() {
    let store = Store::default();
    let mut id = identity();
    install(&store, &id, true);
    id.executable = r"D:\New location\ReadAware.exe".into();
    install(&store, &id, true);
    let dev = Identity::new("com.readaware.app.dev", "ReadAware Dev", r"C:\dev\app.exe").unwrap();
    install(&store, &dev, true);
    install(&store, &id, false);
    assert_eq!(
        store.value(&format!("{}\\shell\\open\\command", dev.prog_id()), ""),
        Some(dev.command())
    );
    install(&store, &id, true);
    assert_eq!(
        store.value(&format!("{}\\shell\\open\\command", id.prog_id()), ""),
        Some(id.command())
    );
}

#[test]
fn every_partial_registry_write_restores_exact_previous_values() {
    let baseline = Store::default();
    install(&baseline, &identity(), true);
    let before = baseline.values.borrow().clone();
    let count = prepare(&baseline, &identity(), false).unwrap().len();
    for fail_at in 1..=count {
        let store = Store::default();
        *store.values.borrow_mut() = before.clone();
        store.fail_at.set(Some(fail_at));
        let changes = prepare(&store, &identity(), false).unwrap();
        assert!(
            commit::<()>(&store, &changes, || panic!("failed registry must not save")).is_err()
        );
        assert_eq!(*store.values.borrow(), before, "failure at write {fail_at}");
    }
}

#[test]
fn sqlite_failure_restores_registry_before_policy_is_published() {
    let store = Store::default();
    let queue = crate::external_open::ExternalOpenQueue::new(vec![]);
    queue.publish(false).unwrap();
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE preferences (value TEXT); CREATE TRIGGER reject BEFORE INSERT ON preferences BEGIN SELECT RAISE(ABORT, 'injected'); END;").unwrap();
    let error = commit(&store, &prepare(&store, &identity(), true).unwrap(), || {
        queue.commit(true, false, || {
            conn.execute("INSERT INTO preferences VALUES ('enabled')", [])?;
            Ok(())
        })
    })
    .unwrap_err();
    assert_eq!(error.code, "db/error");
    assert!(store.values.borrow().is_empty());
    assert_eq!(store.notifications.get(), 2);
}

#[test]
fn read_errors_do_not_write_and_notification_failure_is_compensated() {
    let store = Store::default();
    store.fail_read.set(true);
    assert!(prepare(&store, &identity(), true).is_err());
    assert_eq!(store.writes.get(), 0);
    store.fail_read.set(false);
    store.fail_notify.set(true);
    assert!(commit::<()>(
        &store,
        &prepare(&store, &identity(), true).unwrap(),
        || panic!("no save")
    )
    .is_err());
    assert!(store.values.borrow().is_empty());
}

#[test]
fn external_edit_before_apply_rejects_without_overwriting_it() {
    let store = Store::default();
    let changes = prepare(&store, &identity(), true).unwrap();
    store.put(&identity().prog_id(), "ReadAwareOwner", "foreign");
    assert!(commit::<()>(&store, &changes, || panic!("no save")).is_err());
    assert_eq!(store.writes.get(), 0);
    assert_eq!(
        store
            .value(&identity().prog_id(), "ReadAwareOwner")
            .as_deref(),
        Some("foreign")
    );
}

#[test]
fn compensation_conflict_is_reported_and_does_not_overwrite_external_edit() {
    let store = Store::default();
    let id = identity();
    let key = format!("{}\\shell\\open\\command", id.prog_id());
    let error = commit(&store, &prepare(&store, &id, true).unwrap(), || {
        store.put(&key, "", "external edit");
        Err::<(), _>(CommandError::new("db/locked", "injected failure"))
    })
    .unwrap_err();
    assert_eq!(error.code, "settings/unavailable");
    assert!(error.message.contains("compensation failed"));
    assert_eq!(store.value(&key, "").as_deref(), Some("external edit"));
}

fn legacy(store: &Store, id: &Identity) {
    store.put(
        "EPUB\\shell\\open\\command",
        "",
        &format!("{} \"%1\"", id.executable),
    );
    store.put("EPUB\\DefaultIcon", "", &format!("{},0", id.executable));
    store.put("EPUB\\shell\\open", "", &format!("Open with {}", id.name));
    store.put("EPUB\\shell", "", "open");
    store.put("EPUB", "", "EPUB e-book");
    store.put(".epub", "", "EPUB");
    store.put(".epub", "EPUB_backup", "Previous.Reader");
}

#[test]
fn retires_proven_legacy_class_and_restores_only_its_still_active_default() {
    let store = Store::default();
    let id = identity();
    legacy(&store, &id);
    install(&store, &id, false);
    assert_eq!(store.value(".epub", "").as_deref(), Some("Previous.Reader"));
    assert_eq!(store.value(".epub", "EPUB_backup"), None);
    assert_eq!(store.value("EPUB\\shell\\open\\command", ""), None);
    legacy(&store, &id);
    store.put(".epub", "", "New.Default");
    install(&store, &id, true);
    assert_eq!(store.value(".epub", "").as_deref(), Some("New.Default"));
}

#[test]
fn refuses_foreign_namespace_and_leaves_unproven_legacy_class_untouched() {
    let store = Store::default();
    let id = identity();
    legacy(&store, &id);
    store.put("EPUB\\shell\\open\\command", "", "Other.exe %1");
    install(&store, &id, false);
    assert_eq!(
        store.value("EPUB\\shell\\open\\command", "").as_deref(),
        Some("Other.exe %1")
    );
    assert_eq!(store.value(".epub", "").as_deref(), Some("EPUB"));
    store.put(&id.prog_id(), "ReadAwareOwner", "foreign");
    assert!(prepare(&store, &id, true).is_err());
    store.values.borrow_mut().clear();
    store.put(&id.prog_id(), "", "Foreign class");
    assert!(prepare(&store, &id, true).is_err());
}

#[test]
fn failed_legacy_migration_restores_generic_class_and_backup() {
    let store = Store::default();
    let id = identity();
    legacy(&store, &id);
    let before = store.values.borrow().clone();
    assert!(commit(&store, &prepare(&store, &id, true).unwrap(), || {
        Err::<(), _>(CommandError::new("db/locked", "injected failure"))
    })
    .is_err());
    assert_eq!(*store.values.borrow(), before);
}

#[test]
fn windows_installer_does_not_create_a_competing_registration_and_uninstall_covers_all_types() {
    let (merged, paths) = tauri::utils::config::parse::read_from(
        tauri::utils::platform::Target::Windows,
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")),
    )
    .unwrap();
    assert!(paths
        .iter()
        .any(|path| path.ends_with("tauri.windows.conf.json")));
    let _: tauri::Config = serde_json::from_value(merged.clone()).unwrap();
    assert_eq!(merged["bundle"]["fileAssociations"], serde_json::json!([]));
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../../tauri.windows.conf.json")).unwrap();
    assert_eq!(config["bundle"]["fileAssociations"], serde_json::json!([]));
    assert_eq!(
        config["bundle"]["windows"]["nsis"]["installMode"],
        "currentUser"
    );
    let hook = include_str!("../../../windows/file-associations.nsh");
    let paths: Vec<_> = hook
        .lines()
        .filter(|line| line.contains("!insertmacro READ_AWARE_REMOVE_OPEN_WITH"))
        .collect();
    let extensions: Vec<_> = book_types()
        .into_iter()
        .flat_map(|kind| kind.extensions)
        .collect();
    assert_eq!(paths.len(), extensions.len());
    for ext in extensions {
        assert!(paths.iter().any(|line| line.ends_with(&format!("\"{ext}\""))));
    }
    assert!(hook.contains("ReadAwareOwner"));
    assert_eq!(hook.matches("!insertmacro READ_AWARE_ABORT_UNINSTALL").count(), 3);
    let restores_stack = |source: &str| {
        let expected = ["!macro READ_AWARE_ABORT_UNINSTALL", "Pop $2", "Pop $1", "Pop $R0", "Abort", "!macroend"];
        source.lines().map(str::trim).collect::<Vec<_>>()
            .windows(expected.len()).any(|lines| lines == expected)
    };
    for newline in ["\n", "\r\n"] {
        let source = hook.lines().collect::<Vec<_>>().join(newline);
        assert!(restores_stack(&source));
        assert!(!restores_stack(&source.replace("Pop $1", "Pop $R1")));
    }
    assert!(!hook.contains("UserChoice"));
    assert!(!hook.contains("HKLM"));
}

#[test]
fn quotes_executable_path_and_rejects_registry_or_command_injection() {
    let id = identity();
    assert_eq!(
        id.command(),
        r#""C:\Program Files\ReadAware\ReadAware.exe" "%1""#
    );
    for invalid in ["", "x\\evil", "x\n", "x\0"] {
        assert!(Identity::new(invalid, "ReadAware", "app.exe").is_err());
    }
    for invalid in ["", "app\".exe", "app\n.exe", "app\0.exe"] {
        assert!(Identity::new("com.readaware.app", "ReadAware", invalid).is_err());
    }
}
