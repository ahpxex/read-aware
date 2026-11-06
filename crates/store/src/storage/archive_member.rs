//! Portable backup-archive member paths. Shared because opening the store
//! resolves an interrupted full restore (`backup_restore_files::recover`)
//! before anything else runs, and that recovery validates the same paths the
//! desktop backup extractor writes.
use crate::error::CommandError;

pub const CODE_INVALID: &str = "backup/invalid-archive";
pub const MAX_MEMBER_PATH: usize = 8192;

fn invalid(message: &str) -> CommandError {
    CommandError::new(CODE_INVALID, message)
}

/// A portable, normalized relative path. The extractor never honors tar links,
/// permissions, absolute paths, metadata extensions or filesystem aliases.
pub fn member_path(path: &str) -> Result<(), CommandError> {
    if path.is_empty()
        || path.len() > MAX_MEMBER_PATH
        || path.contains('\\')
        || path.chars().any(char::is_control)
    {
        return Err(invalid("invalid archive member path"));
    }
    for part in path.split('/') {
        let device = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.is_empty()
            || part == "."
            || part == ".."
            || part
                .chars()
                .any(|c| matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
            || part.ends_with(['.', ' '])
            || matches!(
                device.as_str(),
                "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$" | "CLOCK$"
            )
            || device
                .strip_prefix("COM")
                .or_else(|| device.strip_prefix("LPT"))
                .is_some_and(|suffix| {
                    matches!(
                        suffix,
                        "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                    )
                })
        {
            return Err(invalid("non-portable archive member path"));
        }
    }
    if path != "database.sqlite"
        && path != "secret.key"
        && !path.starts_with("blobs/")
        && !path.starts_with("plugins/")
        && !path.starts_with("bundled-plugins/")
    {
        return Err(invalid("unexpected archive member namespace"));
    }
    Ok(())
}
