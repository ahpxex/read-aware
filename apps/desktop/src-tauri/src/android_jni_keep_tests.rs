//! Release builds minify `MainActivity` with R8, which cannot see that Rust
//! calls activity methods over JNI by name. A method missing from the keep
//! rules works in `tauri android dev` (unminified) and is stripped from every
//! release APK, where the call fails with "Java exception was thrown" — the
//! fate of the battery strip and the folder import in 0.6.11. This runs on
//! every host, so the omission fails CI instead of shipping.

use std::path::{Path, PathBuf};

const ANDROID_APP: &str = "gen/android/app";
const ACTIVITY: &str = "src/main/java/com/readaware/app/MainActivity.kt";

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn rust_sources(dir: &Path, out: &mut String) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rust_sources(&path, out);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            out.push_str(&std::fs::read_to_string(&path).unwrap());
        }
    }
}

/// Names of the functions `MainActivity.kt` declares.
fn activity_methods(source: &str) -> Vec<String> {
    source
        .lines()
        .map(str::trim)
        .filter(|line| !line.starts_with("//") && !line.starts_with('*'))
        .filter_map(|line| line.split_once("fun ").map(|(_, rest)| rest))
        .map(|rest| {
            rest.chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect::<String>()
        })
        .filter(|name| !name.is_empty())
        .collect()
}

/// Whether Rust calls `name` over JNI: the method name literal followed by
/// its JNI signature literal, which always starts with `(` (`"name", "()I"`).
fn called_over_jni(rust: &str, name: &str) -> bool {
    let quoted = format!("\"{name}\"");
    rust.match_indices(&quoted).any(|(at, _)| {
        let rest = rust[at + quoted.len()..].trim_start();
        rest.strip_prefix(',')
            .is_some_and(|rest| rest.trim_start().starts_with("\"("))
    })
}

#[test]
fn every_activity_method_rust_calls_survives_release_minification() {
    let root = manifest_dir();
    let activity = std::fs::read_to_string(root.join(ANDROID_APP).join(ACTIVITY)).unwrap();
    let rules = std::fs::read_to_string(root.join(ANDROID_APP).join("proguard-rules.pro")).unwrap();
    let mut rust = String::new();
    rust_sources(&root.join("src"), &mut rust);

    let called: Vec<String> = activity_methods(&activity)
        .into_iter()
        .filter(|name| called_over_jni(&rust, name))
        .collect();
    // Guard against a parser that silently finds nothing.
    for known in ["batteryLevelPercent", "startFolderPick", "installUpdateApk"] {
        assert!(
            called.iter().any(|name| name == known),
            "{known} not detected"
        );
    }
    let missing: Vec<&String> = called
        .iter()
        .filter(|name| !rules.contains(&format!(" {name}(")))
        .collect();
    assert!(
        missing.is_empty(),
        "MainActivity methods called from Rust but not kept in proguard-rules.pro: {missing:?}"
    );
}
