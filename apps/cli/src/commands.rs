//! The `ra` commands.
use crate::library;
use crate::output::{plain, Output};
use read_aware_store::error::CommandError;
use read_aware_store::import::{
    import_book, ImportBookOutcome, ImportBookRequest, ImportIntent, StageFrom,
};
use read_aware_store::storage::{get_book_inner, list_books_inner, LibraryBook};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// `books list`: every book, most recently added first.
pub fn books_list(dir: &Path, out: &Output) -> Result<ExitCode, CommandError> {
    let library = library::open(dir)?;
    let mut books = {
        let conn = library.db.0.lock()?;
        list_books_inner(&conn)?
    };
    books.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| a.title.cmp(&b.title))
    });
    out.emit(&json!({ "books": books }), || {
        for book in &books {
            println!("{}  {}", short_id(&book.id), summary(book));
        }
        println!(
            "{} book{}",
            books.len(),
            if books.len() == 1 { "" } else { "s" }
        );
    });
    Ok(ExitCode::SUCCESS)
}

/// `books show <id>`: one book, by its id or a unique id prefix.
pub fn books_show(dir: &Path, id: &str, out: &Output) -> Result<ExitCode, CommandError> {
    let library = library::open(dir)?;
    let book = {
        let conn = library.db.0.lock()?;
        match get_book_inner(&conn, id)? {
            Some(book) => book,
            None => by_prefix(list_books_inner(&conn)?, id)?,
        }
    };
    out.emit(&json!({ "book": book }), || {
        println!("{}", plain(&book.title));
        println!("  author    {}", plain(&book.author));
        println!("  id        {}", plain(&book.id));
        println!("  format    {}", plain(&book.format));
        println!(
            "  file      {} ({} bytes)",
            plain(&book.file_name),
            book.file_size
        );
        if let Some(source_path) = &book.source_path {
            println!("  folder    {}", plain(source_path));
        }
        println!(
            "  status    {}, {:.0}% read",
            plain(&book.reading_status),
            book.progress_percent
        );
        println!("  cover     {}", plain(&book.cover_status));
        if book.metadata_status.as_deref() == Some("deferred") {
            println!("  metadata  waiting for the ReadAware app to read it");
        }
        println!("  added     {}", plain(&book.created_at));
        if let Some(opened) = &book.last_opened_at {
            println!("  opened    {}", plain(opened));
        }
    });
    Ok(ExitCode::SUCCESS)
}

fn by_prefix(books: Vec<LibraryBook>, prefix: &str) -> Result<LibraryBook, CommandError> {
    let mut matches: Vec<LibraryBook> = books
        .into_iter()
        .filter(|book| book.id.starts_with(prefix))
        .collect();
    match matches.len() {
        1 => Ok(matches.remove(0)),
        0 => Err(CommandError::new(
            "library/book-not-found",
            format!("No book with id {prefix}"),
        )),
        count => Err(CommandError::new(
            "library/invalid-query",
            format!("{count} books start with {prefix}; give more of the id"),
        )),
    }
}

/// `import <file>...`: each file through the app's own import pipeline.
/// Every file is attempted; the exit code is 1 when any failed.
pub fn import(dir: &Path, files: &[PathBuf], out: &Output) -> Result<ExitCode, CommandError> {
    let library = library::open(dir)?;
    let mut results = Vec::with_capacity(files.len());
    let mut failed = false;
    for path in files {
        let result = import_one(&library, path);
        if !out.json {
            match &result {
                Ok(ImportBookOutcome::Imported {
                    book,
                    metadata_deferred,
                    ..
                }) => {
                    let pending = if *metadata_deferred {
                        "  (title and author are filled in when the ReadAware app reads it)"
                    } else {
                        ""
                    };
                    println!(
                        "imported   {}  {}{pending}",
                        short_id(&book.id),
                        summary(book)
                    );
                }
                Ok(ImportBookOutcome::Duplicate { book }) => {
                    println!(
                        "duplicate  {}  {}  ← {}",
                        short_id(&book.id),
                        summary(book),
                        plain(path.display())
                    );
                }
                Err(error) => eprintln!(
                    "failed     {}: {}",
                    plain(path.display()),
                    plain(&error.message)
                ),
            }
        }
        failed |= result.is_err();
        results.push(match result {
            Ok(ImportBookOutcome::Imported {
                book,
                cover,
                metadata_deferred,
                ..
            }) => json!({
                "file": path,
                "status": "imported",
                "book": book,
                "cover": cover,
                "metadataDeferred": metadata_deferred,
            }),
            Ok(ImportBookOutcome::Duplicate { book }) => json!({
                "file": path,
                "status": "duplicate",
                "book": book,
            }),
            Err(error) => json!({
                "file": path,
                "status": "failed",
                "error": { "code": error.code, "message": error.message },
            }),
        });
    }
    if out.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({ "results": results }))
                .expect("JSON values always serialize")
        );
    }
    Ok(if failed {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    })
}

fn import_one(library: &library::Library, path: &Path) -> Result<ImportBookOutcome, CommandError> {
    let metadata = std::fs::metadata(path).map_err(|error| {
        CommandError::context(&format!("Cannot read {}", path.display()), error)
    })?;
    if !metadata.is_file() {
        return Err(CommandError::new(
            "fs/not-found",
            format!("{} is not a file", path.display()),
        ));
    }
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            CommandError::new(
                "fs/not-found",
                format!("{} has no usable file name", path.display()),
            )
        })?
        .to_owned();
    let request = ImportBookRequest {
        book_id: uuid::Uuid::new_v4().to_string(),
        file_name,
        mime_type: None,
        source_path: None,
        origin: Some("user".to_owned()),
        dedupe_by_name: true,
    };
    import_book(
        &library.db,
        &library.dir,
        library.session.owner(),
        &request,
        StageFrom::File(path),
        ImportIntent::Record,
    )
}

/// `init`: create a library where none exists yet.
pub fn init(dir: &Path, out: &Output) -> Result<ExitCode, CommandError> {
    let existed = library::exists(dir);
    let library = library::open_or_create(dir)?;
    let books = {
        let conn = library.db.0.lock()?;
        list_books_inner(&conn)?.len()
    };
    out.emit(
        &json!({ "dir": dir, "created": !existed, "books": books }),
        || {
            if existed {
                println!(
                    "A ReadAware library already exists at {} ({books} books).",
                    plain(dir.display())
                );
            } else {
                println!(
                    "Created an empty ReadAware library at {}.",
                    plain(dir.display())
                );
            }
        },
    );
    Ok(ExitCode::SUCCESS)
}

fn short_id(id: &str) -> String {
    plain(id.get(..8).unwrap_or(id))
}

fn summary(book: &LibraryBook) -> String {
    let progress = if book.progress_percent > 0.0 {
        format!(", {:.0}%", book.progress_percent)
    } else {
        String::new()
    };
    format!(
        "{} — {}  [{}{progress}]",
        plain(&book.title),
        plain(&book.author),
        plain(&book.format)
    )
}
