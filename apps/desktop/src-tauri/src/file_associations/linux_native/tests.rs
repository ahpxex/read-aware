use super::super::{linux, linux_entry::Identity};
use super::*;

#[test]
fn native_files_reject_symlinks_and_preserve_private_config_permissions() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let temp = tempfile::tempdir().unwrap();
    let system = NativeSystem::new(temp.path().join("data"), temp.path().join("config")).unwrap();
    let path = system.config_home().join("mimeapps.list");
    system
        .write(&path, Some(b"[Section]\nKey=value\n"))
        .unwrap();
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    system.write(&path, Some(b"changed")).unwrap();
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let link = temp.path().join("link");
    symlink(&path, &link).unwrap();
    assert!(system.read(&link).is_err());
    assert!(system.write(&link, Some(b"wrong")).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"changed");
}

#[test]
fn native_command_failure_is_not_accepted_and_relative_roots_are_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let system = NativeSystem::new(temp.path().join("data"), temp.path().join("config")).unwrap();
    assert!(system
        .run("readaware-definitely-missing-tool", &[])
        .is_err());
    assert!(system.run("false", &[]).is_err());
    assert!(NativeSystem::new("relative".into(), temp.path().into()).is_err());
}

#[test]
fn real_xdg_install_disable_reenable_and_rollback_stay_in_temporary_roots() {
    let temp = tempfile::tempdir().unwrap();
    let system = NativeSystem::new(temp.path().join("data"), temp.path().join("config")).unwrap();
    let id = Identity::new(
        "com.readaware.native-tests",
        "ReadAware Native Tests",
        std::env::current_exe().unwrap().to_str().unwrap(),
        "readaware-test",
    )
    .unwrap();
    let defaults = system.config_home().join("mimeapps.list");
    system
        .write(
            &defaults,
            Some(b"[Default Applications]\napplication/pdf=Other.desktop;\n"),
        )
        .unwrap();
    linux::commit(
        &system,
        &linux::prepare(&system, &id, true).unwrap(),
        || Ok(()),
    )
    .unwrap();
    let package = system
        .data_home()
        .join("mime/packages")
        .join(id.package_name());
    assert!(package.exists());
    assert!(system
        .data_home()
        .join("applications/mimeinfo.cache")
        .exists());
    let enabled_entry = fs::read(
        system
            .data_home()
            .join("applications")
            .join(id.desktop_id()),
    )
    .unwrap();
    let enabled_defaults = fs::read(&defaults).unwrap();
    let cache = system.data_home().join("applications/mimeinfo.cache");
    let cache_has_handler = || {
        let ini = ini::Ini::load_from_file(&cache).unwrap();
        ini.get_from(Some("MIME Cache"), "application/pdf")
            .unwrap_or_default()
            .split(';')
            .any(|entry| entry == id.desktop_id())
    };
    assert!(cache_has_handler());
    linux::commit(
        &system,
        &linux::prepare(&system, &id, false).unwrap(),
        || Ok(()),
    )
    .unwrap();
    assert!(!package.exists());
    assert!(!cache_has_handler());
    let defaults_ini = ini::Ini::load_from_file(&defaults).unwrap();
    assert_eq!(
        defaults_ini.get_from(Some("Default Applications"), "application/pdf"),
        Some("Other.desktop;")
    );
    linux::commit(
        &system,
        &linux::prepare(&system, &id, true).unwrap(),
        || Ok(()),
    )
    .unwrap();
    assert!(package.exists());
    assert!(cache_has_handler());
    let failure = linux::commit(
        &system,
        &linux::prepare(&system, &id, false).unwrap(),
        || Err::<(), _>(CommandError::new("db/locked", "injected SQLite failure")),
    )
    .unwrap_err();
    assert_eq!(failure.code, "db/locked");
    assert!(package.exists());
    assert_eq!(
        fs::read(
            system
                .data_home()
                .join("applications")
                .join(id.desktop_id())
        )
        .unwrap(),
        enabled_entry
    );
    assert_eq!(fs::read(defaults).unwrap(), enabled_defaults);
}
