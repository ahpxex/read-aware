use std::path::Path;

fn main() {
    require_embedded_directories();
    tauri_build::build()
}

/// The built-in plugins are embedded from `plugins/<id>/dist` by the
/// `include_dir!` lines of `src/plugin_bundled.rs`. Those directories are
/// build output and not in git, so a fresh checkout has none until the
/// plugins are built; `tauri dev` and `tauri build` do it first. Say so here,
/// where the fix can be named, instead of leaving it to the embedding
/// macro's "not a directory". The paths are read from those lines
/// themselves, so there is no second list to keep in step.
fn require_embedded_directories() {
    const SOURCE: &str = "src/plugin_bundled.rs";
    const EMBEDDED: &str = "\"$CARGO_MANIFEST_DIR/";
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let source = std::fs::read_to_string(crate_root.join(SOURCE))
        .unwrap_or_else(|error| panic!("reading {SOURCE} failed: {error}"));
    let missing: Vec<&str> = source
        .split(EMBEDDED)
        .skip(1)
        .filter_map(|rest| rest.split('"').next())
        .filter(|relative| !crate_root.join(relative).is_dir())
        .map(|relative| relative.trim_start_matches("../"))
        .collect();
    if !missing.is_empty() {
        panic!(
            "embedded plugin output is missing: {}. It is build output, not in git. \
             Run `bun run --filter @read-aware/desktop prepare:plugins` from the repository root.",
            missing.join(", ")
        );
    }
}
