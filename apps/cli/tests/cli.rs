//! End-to-end runs of the `ra` binary against a temporary library.
use std::path::Path;
use std::process::{Command, Output};

fn ra(dir: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_ra"))
        .arg("--data-dir")
        .arg(dir)
        .args(args)
        .env_remove("READAWARE_DATA_DIR")
        .output()
        .expect("ra runs")
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn json(output: &Output) -> serde_json::Value {
    serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("not JSON ({error}): {}", stdout(output)))
}

const PROSE: &str = "It was the best of times, it was the worst of times.\n";

#[test]
fn a_missing_library_is_not_created_by_accident() {
    let dir = tempfile::tempdir().unwrap();
    let library = dir.path().join("nowhere");
    let output = ra(&library, &["books", "list"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("ra init"), "{}", stderr(&output));
    assert!(!library.join("read-aware.db").exists());
    let output = ra(&library, &["--json", "books", "list"]);
    assert_eq!(json(&output)["error"]["code"], "fs/not-found");
}

#[test]
fn init_import_list_and_show_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let library = dir.path().join("library");
    let init = ra(&library, &["--json", "init"]);
    assert!(init.status.success(), "{}", stderr(&init));
    assert_eq!(json(&init)["created"], true);
    let again = ra(&library, &["init"]);
    assert!(stdout(&again).contains("already exists"));

    let book = dir
        .path()
        .join("a tale of two cities - charles dickens.txt");
    std::fs::write(&book, PROSE).unwrap();
    let imported = ra(&library, &["--json", "import", book.to_str().unwrap()]);
    assert!(imported.status.success(), "{}", stderr(&imported));
    let result = &json(&imported)["results"][0];
    assert_eq!(result["status"], "imported");
    assert_eq!(result["book"]["title"], "A Tale Of Two Cities");
    assert_eq!(result["book"]["author"], "Charles Dickens");
    let id = result["book"]["id"].as_str().unwrap().to_owned();

    // The same file again is a duplicate, reported, not an error.
    let duplicate = ra(&library, &["import", book.to_str().unwrap()]);
    assert!(duplicate.status.success());
    assert!(
        stdout(&duplicate).starts_with("duplicate"),
        "{}",
        stdout(&duplicate)
    );

    let list = ra(&library, &["--json", "books", "list"]);
    let books = json(&list)["books"].as_array().unwrap().clone();
    assert_eq!(books.len(), 1);
    assert_eq!(books[0]["id"], id.as_str());
    let text = ra(&library, &["books", "list"]);
    assert!(stdout(&text).contains("A Tale Of Two Cities — Charles Dickens"));
    assert!(stdout(&text).contains("1 book"));

    // A unique id prefix is enough.
    let show = ra(&library, &["books", "show", &id[..6]]);
    assert!(show.status.success(), "{}", stderr(&show));
    assert!(stdout(&show).contains(&id));
    let missing = ra(&library, &["--json", "books", "show", "zzzz"]);
    assert_eq!(missing.status.code(), Some(1));
    assert_eq!(json(&missing)["error"]["code"], "library/book-not-found");
}

#[test]
fn a_batch_imports_what_it_can_and_fails_with_the_rest() {
    let dir = tempfile::tempdir().unwrap();
    let library = dir.path().join("library");
    assert!(ra(&library, &["init"]).status.success());
    let good = dir.path().join("good.txt");
    std::fs::write(&good, PROSE).unwrap();
    let junk = dir.path().join("junk.bin");
    std::fs::write(
        &junk,
        (0..256).map(|i| (i * 37 + 11) as u8).collect::<Vec<_>>(),
    )
    .unwrap();
    let missing = dir.path().join("missing.epub");
    let output = ra(
        &library,
        &[
            "--json",
            "import",
            good.to_str().unwrap(),
            junk.to_str().unwrap(),
            missing.to_str().unwrap(),
        ],
    );
    assert_eq!(output.status.code(), Some(1));
    let results = json(&output)["results"].as_array().unwrap().clone();
    let statuses: Vec<_> = results
        .iter()
        .map(|r| r["status"].as_str().unwrap())
        .collect();
    assert_eq!(statuses, ["imported", "failed", "failed"]);
    assert_eq!(results[1]["error"]["code"], "book/unsupported-format");
}

#[test]
fn usage_errors_exit_with_two() {
    let dir = tempfile::tempdir().unwrap();
    let output = ra(dir.path(), &["import"]);
    assert_eq!(output.status.code(), Some(2));
    let output = ra(dir.path(), &["--bogus"]);
    assert_eq!(output.status.code(), Some(2));
}

#[test]
fn a_library_held_for_maintenance_is_reported_not_waited_on() {
    let dir = tempfile::tempdir().unwrap();
    let library = dir.path().join("library");
    assert!(ra(&library, &["init"]).status.success());
    // Another process (here: this test) holds the library exclusively, as the
    // app does during a full restore.
    let holder = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(library.join("store.lock"))
        .unwrap();
    holder.lock().unwrap();
    let output = ra(&library, &["--json", "books", "list"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(json(&output)["error"]["code"], "store/in-use");
    holder.unlock().unwrap();
    assert!(ra(&library, &["books", "list"]).status.success());
}

#[test]
fn library_text_cannot_drive_the_terminal() {
    let dir = tempfile::tempdir().unwrap();
    let library = dir.path().join("library");
    assert!(ra(&library, &["init"]).status.success());
    // A title is whatever the file says; this one carries an ANSI escape.
    let hostile = dir.path().join("evil\u{1b}[2Jtitle.txt");
    std::fs::write(&hostile, PROSE).unwrap();
    let imported = ra(&library, &["import", hostile.to_str().unwrap()]);
    assert!(imported.status.success(), "{}", stderr(&imported));
    for output in [imported, ra(&library, &["books", "list"])] {
        assert!(!stdout(&output).contains('\u{1b}'), "{:?}", stdout(&output));
        assert!(!stderr(&output).contains('\u{1b}'));
    }
    // JSON keeps the real value, escaped.
    let listed = ra(&library, &["--json", "books", "list"]);
    assert!(json(&listed)["books"][0]["fileName"]
        .as_str()
        .unwrap()
        .contains('\u{1b}'));
}
