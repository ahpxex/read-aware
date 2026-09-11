use super::*;

fn identity() -> Identity {
    Identity::new(
        "com.readaware.app.dev",
        "ReadAware Dev",
        "/opt/Read Aware/read-aware",
        "read-aware",
    )
    .unwrap()
}

#[test]
fn desktop_mime_toggle_preserves_links_localizations_actions_and_one_launcher_identity() {
    let id = identity();
    let old = b"[Desktop Entry]\nType=Application\nName=ReadAware Dev\nExec=read-aware %U\nName[fr]=Liseuse\nMimeType=application/epub+zip;x-scheme-handler/readaware-dev;other/type;\nActions=Inspect;\n[Desktop Action Inspect]\nName=Inspect\nExec=read-aware --inspect\n";
    let disabled = desktop(&id, Some(old), false).unwrap();
    let parsed = parse(&disabled).unwrap();
    assert_eq!(
        parsed.get_from(Some("Desktop Entry"), "Hidden"),
        Some("false")
    );
    assert_eq!(
        parsed.get_from(Some("Desktop Entry"), "DBusActivatable"),
        Some("false")
    );
    assert_eq!(
        parsed.get_from(Some("Desktop Entry"), "MimeType"),
        Some("x-scheme-handler/readaware-dev;other/type;")
    );
    assert_eq!(
        parsed.get_from(Some("Desktop Entry"), "Name[fr]"),
        Some("Liseuse")
    );
    assert_eq!(
        parsed.get_from(Some("Desktop Action Inspect"), "Exec"),
        Some("read-aware --inspect")
    );
    assert_eq!(id.desktop_id(), "ReadAware Dev.desktop");
    let enabled = desktop(&id, Some(&disabled), true).unwrap();
    let parsed = parse(&enabled).unwrap();
    let mimes = list(parsed.get_from(Some("Desktop Entry"), "MimeType"));
    for kind in book_types() {
        assert!(mimes.contains(&kind.mime));
    }
    assert_eq!(desktop(&id, Some(&enabled), true).unwrap(), enabled);
}

#[test]
fn owned_entry_can_move_but_foreign_or_ambiguous_entries_cannot_be_overwritten() {
    let mut id = identity();
    let initial = desktop(&id, None, true).unwrap();
    id.executable = "/new/location/app.AppImage".into();
    let updated = desktop(&id, Some(&initial), true).unwrap();
    assert_eq!(
        parse(&updated)
            .unwrap()
            .get_from(Some("Desktop Entry"), "Exec"),
        Some("\"/new/location/app.AppImage\" %U")
    );
    for input in [
        "[Desktop Entry]\nName=Other\nExec=read-aware %U\n",
        "[Desktop Entry]\nName=ReadAware Dev\nExec=other %U\n",
        "[Desktop Entry]\nX-ReadAware-Owner=other\n",
        "[Desktop Entry]\nName=ReadAware Dev\nName=Other\nExec=read-aware %U\n",
    ] {
        assert!(desktop(&id, Some(input.as_bytes()), true).is_err());
    }
}

#[test]
fn mimeapps_removes_only_our_associations_and_preserves_default_order() {
    let id = identity();
    let old = b"[Default Applications]\napplication/pdf=Other.desktop;ReadAware Dev.desktop;Last.desktop;\n[Added Associations]\napplication/pdf=First.desktop;ReadAware Dev.desktop;Last.desktop;\ntext/html=Browser.desktop;\n[Removed Associations]\napplication/pdf=Excluded.desktop;\n[Unrelated]\nKey=Value\n";
    let disabled = associations(&id, Some(old), false).unwrap();
    let parsed = parse(&disabled).unwrap();
    assert_eq!(
        parsed.get_from(Some("Default Applications"), "application/pdf"),
        Some("Other.desktop;ReadAware Dev.desktop;Last.desktop;")
    );
    assert_eq!(
        parsed.get_from(Some("Added Associations"), "application/pdf"),
        Some("First.desktop;Last.desktop;")
    );
    assert_eq!(
        parsed.get_from(Some("Removed Associations"), "application/pdf"),
        Some("Excluded.desktop;ReadAware Dev.desktop;")
    );
    assert_eq!(parsed.get_from(Some("Unrelated"), "Key"), Some("Value"));
    let enabled = associations(&id, Some(&disabled), true).unwrap();
    let parsed = parse(&enabled).unwrap();
    assert_eq!(
        parsed.get_from(Some("Added Associations"), "application/pdf"),
        Some("First.desktop;Last.desktop;ReadAware Dev.desktop;")
    );
    assert_eq!(
        parsed.get_from(Some("Removed Associations"), "application/pdf"),
        Some("Excluded.desktop;")
    );
    assert_eq!(associations(&id, Some(&enabled), true).unwrap(), enabled);
}

#[test]
fn structured_mime_xml_owns_its_package_and_contains_every_extension() {
    let id = identity();
    let bytes = mime_package(&id).unwrap();
    check_package(&id, &bytes).unwrap();
    let other = Identity::new("other.app", "Other", "/other", "other").unwrap();
    assert!(check_package(&other, &bytes).is_err());
    let mut reader = quick_xml::Reader::from_reader(bytes.as_slice());
    let mut globs = Vec::new();
    loop {
        match reader.read_event().unwrap() {
            Event::Empty(element) if element.name().as_ref() == b"glob" => {
                globs.push(
                    element
                        .try_get_attribute("pattern")
                        .unwrap()
                        .unwrap()
                        .unescape_value()
                        .unwrap()
                        .into_owned(),
                );
            }
            Event::Eof => break,
            _ => {}
        }
    }
    assert_eq!(globs.len(), 14);
    for ext in book_types().into_iter().flat_map(|kind| kind.extensions) {
        assert!(globs.contains(&format!("*.{ext}")));
    }
}

#[test]
fn desktop_encoding_preserves_literal_percent_quotes_and_two_escape_layers() {
    assert_eq!(
        executable("/a b/$x`y`\\%f\""),
        "\"/a b/\\\\$x\\\\`y\\\\`\\\\\\\\%%f\\\\\"\""
    );
    let id = Identity::new("safe.id", "ReadAware", "/a b/$x%f\"", "read-aware").unwrap();
    let bytes = desktop(&id, None, true).unwrap();
    assert_eq!(
        parse(&bytes)
            .unwrap()
            .get_from(Some("Desktop Entry"), "Exec"),
        Some(format!("{} %U", executable(&id.executable)).as_str())
    );
    for (name, path) in [
        ("../foreign", "/app"),
        ("Name\nOther", "/app"),
        ("Name", "relative"),
        ("Name", "/a=b"),
    ] {
        assert!(Identity::new("safe.id", name, path, "app").is_err());
    }
}

#[test]
fn linux_config_removes_only_bundled_book_types_not_deep_links() {
    let (value, paths) = tauri::utils::config::parse::read_from(
        tauri::utils::platform::Target::Linux,
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")),
    )
    .unwrap();
    assert!(paths
        .iter()
        .any(|path| path.ends_with("tauri.linux.conf.json")));
    assert_eq!(value["bundle"]["fileAssociations"], serde_json::json!([]));
    for format in ["deb", "rpm"] {
        assert_eq!(
            value["bundle"]["linux"][format]["depends"],
            serde_json::json!(["xdg-utils", "shared-mime-info", "desktop-file-utils"])
        );
    }
    assert_eq!(
        value["plugins"]["deep-link"]["desktop"]["schemes"],
        serde_json::json!(["readaware"])
    );
    let _: tauri::Config = serde_json::from_value(value).unwrap();
}
