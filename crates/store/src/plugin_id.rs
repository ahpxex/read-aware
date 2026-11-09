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

/// Ids of retired first-party plugins. A device may still hold their private
/// data (documents, settings, book-access grants, shortcut overrides), so no
/// other package may ever take one of these ids and inherit it — and the
/// library's one-time adoption of retired Jumper bookmarks must only ever see
/// documents Jumper itself wrote.
pub const RETIRED_PLUGIN_IDS: &[&str] = &["jumper"];

pub fn retired_plugin_id(id: &str) -> bool {
    RETIRED_PLUGIN_IDS.contains(&id)
}
