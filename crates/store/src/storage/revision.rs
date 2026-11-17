//! Content revisions: the optimistic-concurrency token most store snapshots
//! carry (memory, annotations, classification, digests, the profile, the
//! identity source set, conversation insights, merge previews). One rule makes
//! them all: `<prefix>:` and the lowercase hex SHA-256 of the snapshot tuple's
//! serde_json bytes. Several are persisted, synced or mirrored in TypeScript
//! (profile2, cins1, icg1), so this byte format must never change; a new kind
//! takes a new prefix. Random or counter tokens (plugin documents, durable
//! jobs, context-bundle sources) and the streaming page fences are different
//! things and do not use this.

use serde::Serialize;
use sha2::{Digest, Sha256};

pub fn content_revision(
    prefix: &str,
    snapshot: &impl Serialize,
) -> Result<String, serde_json::Error> {
    Ok(format!(
        "{prefix}:{:x}",
        Sha256::digest(serde_json::to_vec(snapshot)?)
    ))
}

/// Whether `value` has the shape of a `prefix` content revision.
pub fn is_content_revision(value: &str, prefix: &str) -> bool {
    value
        .strip_prefix(prefix)
        .and_then(|rest| rest.strip_prefix(':'))
        .is_some_and(|hash| {
            hash.len() == 64
                && hash
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_format_is_fixed() {
        // A persisted profile revision of ("summary", "event"): changing the
        // rule would orphan every stored and synced token.
        let revision = content_revision("profile2", &("summary", "event")).unwrap();
        assert_eq!(
            revision,
            format!("profile2:{:x}", Sha256::digest(br#"["summary","event"]"#))
        );
        assert!(is_content_revision(&revision, "profile2"));
        assert!(!is_content_revision(&revision, "mem1"));
        assert!(!is_content_revision(&revision.to_uppercase(), "profile2"));
        assert!(!is_content_revision("profile2:abc", "profile2"));
    }
}
