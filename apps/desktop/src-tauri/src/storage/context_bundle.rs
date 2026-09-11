//! Immutable context artifact validation. This is not a source-read authorization.
use crate::error::CommandError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

const MAX_BYTES: usize = 1024 * 1024;
const ITEM_KINDS: &[&str] = &[
    "curated_profile",
    "derived_profile",
    "reading_goal",
    "memory",
    "annotation",
    "chapter_digest",
    "conversation_insight",
    "entity",
];

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Content {
    format: String,
    schema_version: u32,
    recipe_version: u32,
    pub kind: String,
    pub scope: Scope,
    source_revision: String,
    pub items: Vec<Item>,
    omissions: Vec<Omission>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub(super) enum Scope {
    User,
    Book { id: String },
    Conversation { id: String },
}
impl Scope {
    pub fn parts(&self) -> (&str, Option<&str>) {
        match self {
            Self::User => ("user", None),
            Self::Book { id } => ("book", Some(id)),
            Self::Conversation { id } => ("conversation", Some(id)),
        }
    }
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Item {
    pub kind: String,
    pub id: String,
    pub revision: String,
    pub label: String,
    pub text: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Omission {
    kind: String,
    reason: String,
    count: u64,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Bundle {
    pub version: String,
    pub content: Content,
}

fn invalid() -> CommandError {
    CommandError::new("memory/invalid-input", "Invalid context bundle")
}
fn text(value: &str, max: usize, empty: bool) -> bool {
    value.encode_utf16().count() <= max && (empty || !value.is_empty()) && !value.contains('\0')
}
fn allows(recipe: &str, kind: &str) -> bool {
    match recipe {
        "user_profile_context" => matches!(
            kind,
            "curated_profile" | "derived_profile" | "memory" | "entity"
        ),
        "reading_intent_context" => matches!(kind, "reading_goal" | "memory"),
        "book_memory_context" => matches!(kind, "memory" | "annotation" | "chapter_digest"),
        "conversation_insights_context" => matches!(kind, "conversation_insight" | "memory"),
        _ => false,
    }
}

pub(super) fn valid_selector(kind: &str, scope: &Scope) -> bool {
    let (scope, id) = scope.parts();
    if id.is_some_and(|id| !text(id, 256, false)) {
        return false;
    }
    match kind {
        "user_profile_context" => scope == "user",
        "reading_intent_context" => scope == "user" || scope == "book",
        "book_memory_context" => scope == "book",
        "conversation_insights_context" => scope == "book" || scope == "conversation",
        _ => false,
    }
}

pub(super) fn canonical(content: &Content) -> Result<String, CommandError> {
    let (scope, id) = content.scope.parts();
    if content.format != "readaware.context"
        || content.schema_version != 1
        || content.recipe_version != 1
        || !text(&content.source_revision, 256, false)
        || !valid_selector(&content.kind, &content.scope)
        || content.items.len() > 512
        || content.omissions.len() > 24
    {
        return Err(invalid());
    }
    let mut seen = HashSet::new();
    for item in &content.items {
        if !ITEM_KINDS.contains(&item.kind.as_str())
            || !allows(&content.kind, &item.kind)
            || !text(&item.id, 256, false)
            || !text(&item.revision, 256, false)
            || !text(&item.label, 512, true)
            || !text(&item.text, MAX_BYTES, true)
            || !seen.insert((&item.kind, &item.id))
        {
            return Err(invalid());
        }
    }
    let mut omitted = HashSet::new();
    for item in &content.omissions {
        if !allows(&content.kind, &item.kind)
            || !matches!(item.reason.as_str(), "privacy" | "spoiler" | "unavailable")
            || item.count == 0
            || item.count > 9_007_199_254_740_991
            || !omitted.insert((&item.kind, &item.reason))
        {
            return Err(invalid());
        }
    }
    let items: Vec<_> = content
        .items
        .iter()
        .map(|i| json!([i.kind, i.id, i.revision, i.label, i.text]))
        .collect();
    let omissions: Vec<_> = content
        .omissions
        .iter()
        .map(|i| json!([i.kind, i.reason, i.count]))
        .collect();
    let encoded = serde_json::to_string(&json!([
        content.format,
        content.schema_version,
        content.recipe_version,
        content.kind,
        scope,
        id,
        content.source_revision,
        items,
        omissions
    ]))?;
    if encoded.len() > MAX_BYTES {
        return Err(invalid());
    }
    Ok(encoded)
}

pub(super) fn validate(value: &Value) -> Result<Bundle, CommandError> {
    let bundle: Bundle = serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    let bytes = canonical(&bundle.content)?;
    if bundle.version != format!("cb1:{:x}", Sha256::digest(bytes.as_bytes())) {
        return Err(invalid());
    }
    Ok(bundle)
}
