//! Plugin identity rules shared by the desktop host and the store.

/// Same shape the web-side manifest validator enforces: lowercase ASCII,
/// digits, hyphens; no leading hyphen; max 64 chars.
pub fn valid_plugin_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && !id.starts_with('-')
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}
