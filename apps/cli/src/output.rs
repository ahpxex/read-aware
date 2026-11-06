//! What the CLI prints: text for people on stdout, diagnostics on stderr, or
//! one JSON document on stdout with `--json`.
use read_aware_store::error::CommandError;
use std::process::ExitCode;

/// Text safe to print to a terminal. Book titles, authors and file names come
/// from untrusted files; a control character in one (an ANSI escape sequence)
/// would otherwise drive the terminal. JSON output is escaped by serde.
pub fn plain(value: impl std::fmt::Display) -> String {
    value
        .to_string()
        .chars()
        .map(|c| {
            if c.is_control() {
                char::REPLACEMENT_CHARACTER
            } else {
                c
            }
        })
        .collect()
}

pub struct Output {
    pub json: bool,
}

impl Output {
    /// Print `value` as JSON (with `--json`) or run `text` to print it for people.
    pub fn emit(&self, value: &serde_json::Value, text: impl FnOnce()) {
        if self.json {
            println!(
                "{}",
                serde_json::to_string_pretty(value).expect("JSON values always serialize")
            );
        } else {
            text();
        }
    }

    /// Report a failure (its stable code and message) and exit with 1.
    pub fn fail(&self, error: &CommandError) -> ExitCode {
        if self.json {
            println!(
                "{}",
                serde_json::json!({ "error": { "code": error.code, "message": error.message } })
            );
        } else {
            eprintln!("ra: {}", plain(&error.message));
        }
        ExitCode::FAILURE
    }
}

struct StderrLogger {
    level: log::LevelFilter,
}

impl log::Log for StderrLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= self.level
    }
    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            eprintln!("[{}] {}", record.level(), plain(record.args()));
        }
    }
    fn flush(&self) {}
}

/// Warnings always reach stderr; `-v` adds the store's info lines, `-vv` debug.
pub fn init_logging(verbose: u8) {
    let level = match verbose {
        0 => log::LevelFilter::Warn,
        1 => log::LevelFilter::Info,
        _ => log::LevelFilter::Debug,
    };
    let logger = Box::leak(Box::new(StderrLogger { level }));
    if log::set_logger(logger).is_ok() {
        log::set_max_level(level);
    }
}
