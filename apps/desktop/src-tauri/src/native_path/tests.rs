use std::io::{self, Cursor, Read};

use super::stage_reader;
use crate::error::{CODE_FS_NO_SPACE, CODE_FS_PERMISSION};

#[test]
fn stages_in_private_cache_and_removes_the_file_on_drop() {
    let app_dir = tempfile::tempdir().unwrap();
    let cache_dir = app_dir.path().join("cache").join("book-imports");
    let bytes: Vec<u8> = (0..131_072).map(|index| index as u8).collect();

    let staged = stage_reader(Cursor::new(&bytes), &cache_dir).unwrap();
    assert_eq!(staged.path.parent(), Some(cache_dir.as_path()));
    assert_eq!(std::fs::read(&staged.path).unwrap(), bytes);

    let path = staged.path.clone();
    drop(staged);
    assert!(!path.exists());
    assert!(cache_dir.is_dir());
}

#[test]
fn simultaneous_imports_keep_independent_staging_files() {
    let cache_dir = tempfile::tempdir().unwrap();
    let first = stage_reader(Cursor::new(b"first book"), cache_dir.path()).unwrap();
    let second = stage_reader(Cursor::new(b"second book"), cache_dir.path()).unwrap();

    assert_ne!(first.path, second.path);
    drop(first);
    assert_eq!(std::fs::read(&second.path).unwrap(), b"second book");
    drop(second);
    assert_eq!(std::fs::read_dir(cache_dir.path()).unwrap().count(), 0);
}

struct FailingReader(Option<io::Error>);

impl Read for FailingReader {
    fn read(&mut self, _buffer: &mut [u8]) -> io::Result<usize> {
        Err(self.0.take().unwrap())
    }
}

#[test]
fn failed_copy_preserves_error_code_and_removes_partial_file() {
    let cache_dir = tempfile::tempdir().unwrap();
    for (cause, code) in [
        (io::ErrorKind::PermissionDenied.into(), CODE_FS_PERMISSION),
        (io::Error::from_raw_os_error(28), CODE_FS_NO_SPACE),
    ] {
        let source = Cursor::new(b"partial book").chain(FailingReader(Some(cause)));

        let error = stage_reader(source, cache_dir.path()).err().unwrap();
        assert_eq!(error.code, code);
        assert!(error.message.contains("Failed to stage selected book"));
        assert_eq!(std::fs::read_dir(cache_dir.path()).unwrap().count(), 0);
    }
}

#[test]
fn unavailable_cache_fails_without_modifying_existing_data() {
    let app_dir = tempfile::tempdir().unwrap();
    let cache_path = app_dir.path().join("cache");
    std::fs::write(&cache_path, b"existing file").unwrap();

    let error = stage_reader(Cursor::new(b"book"), &cache_path)
        .err()
        .unwrap();
    assert!(error.message.contains("Failed to create the import cache"));
    assert_eq!(std::fs::read(&cache_path).unwrap(), b"existing file");
}

#[test]
fn stages_empty_files_without_leaking_temporary_files() {
    let cache_dir = tempfile::tempdir().unwrap();
    let staged = stage_reader(io::empty(), cache_dir.path()).unwrap();
    assert_eq!(std::fs::metadata(&staged.path).unwrap().len(), 0);
    drop(staged);
    assert_eq!(std::fs::read_dir(cache_dir.path()).unwrap().count(), 0);
}
