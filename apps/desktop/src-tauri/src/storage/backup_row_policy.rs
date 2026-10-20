//! Routing obligations, not merge decisions. Unknown tables fail closed so a
//! future migration cannot be silently left out of full restore planning.
use crate::{error::CommandError, storage::apply::DERIVED_TABLES};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum RowPolicy {
    DomainState,
    ConversationState,
    PluginData,
    LegacyData,
    ReviewSettings,
    VirtualBindings,
    RoamingPreferences,
    ResealCredential,
    TranslateRoamingSecret,
    PreserveDevice,
    RecoverReading,
    ReviewRuntimeHistory,
    Rebuild,
    Schema,
    EventIdentity,
    PluginJournal,
    BlobFiles,
}
impl RowPolicy {
    pub(super) fn name(self) -> &'static str {
        match self {
            Self::DomainState => "domain-state",
            Self::ConversationState => "conversation-state",
            Self::PluginData => "plugin-data",
            Self::LegacyData => "legacy-data",
            Self::ReviewSettings => "review-settings",
            Self::VirtualBindings => "virtual-bindings",
            Self::RoamingPreferences => "roaming-preferences",
            Self::ResealCredential => "reseal-credential",
            Self::TranslateRoamingSecret => "translate-roaming-secret",
            Self::PreserveDevice => "preserve-device",
            Self::RecoverReading => "recover-reading",
            Self::ReviewRuntimeHistory => "review-runtime-history",
            Self::Rebuild => "rebuild",
            Self::Schema => "schema",
            Self::EventIdentity => "event-identity",
            Self::PluginJournal => "plugin-journal",
            Self::BlobFiles => "blob-files",
        }
    }
    pub(super) fn from_name(value: &str) -> Result<Self, CommandError> {
        for policy in [
            Self::DomainState,
            Self::ConversationState,
            Self::PluginData,
            Self::LegacyData,
            Self::ReviewSettings,
            Self::VirtualBindings,
            Self::RoamingPreferences,
            Self::ResealCredential,
            Self::TranslateRoamingSecret,
            Self::PreserveDevice,
            Self::RecoverReading,
            Self::ReviewRuntimeHistory,
            Self::Rebuild,
            Self::Schema,
            Self::EventIdentity,
            Self::PluginJournal,
            Self::BlobFiles,
        ] {
            if policy.name() == value {
                return Ok(policy);
            }
        }
        Err(CommandError::internal("unknown backup row policy"))
    }
    pub(super) fn compare_rows(self) -> bool {
        !matches!(
            self,
            Self::Rebuild | Self::Schema | Self::EventIdentity | Self::PluginJournal
        )
    }
}

pub(super) fn table(name: &str) -> Result<RowPolicy, CommandError> {
    use RowPolicy::*;
    Ok(match name {
        "domain_events" => EventIdentity,
        "schema_migrations" => Schema,
        "plugin_update_journal" => PluginJournal,
        "ai_messages" | "ai_conversations" => ConversationState,
        "plugin_documents" => PluginData,
        "vocabulary_entries" => LegacyData,
        "app_kv" => ReviewSettings,
        "synced_preferences" => RoamingPreferences,
        "blob_objects" => BlobFiles,
        // Format 2 closes these on the owning device before capture/planning.
        // Retain explicit responsibility; never import or discard pending facts.
        "reading_sessions_pending" => RecoverReading,
        "local_device"
        | "sync_profile"
        | "sync_cursors"
        | "event_sync_state"
        | "blob_sync_state"
        // Execution receipts, jobs and capability cursors belong to this device.
        // A backup must not import another device's pending actions or authority.
        | "atomic_receipts"
        | "durable_jobs"
        | "capability_change_state"
        | "capability_changes"
        | "capability_change_cursors"
        | "restored_credential_publications"
        | "book_import_cleanup" => PreserveDevice,
        "identity_consolidation_work" | "identity_consolidation_pages" => ReviewRuntimeHistory,
        "identity_consolidation_checkpoint"
        | "context_bundle_source_clock"
        | "plugin_document_generations"
        | "projection_checkpoints"
        | "book_removal_cleanup"
        | "user_font_removal_cleanup"
        | "blobs"
        | "annotations_fts"
        | "annotations_fts_data"
        | "annotations_fts_idx"
        | "annotations_fts_content"
        | "annotations_fts_docsize"
        | "annotations_fts_config"
        | "sqlite_sequence"
        | "sqlite_stat1"
        | "sqlite_stat4" => Rebuild,
        name if DERIVED_TABLES.contains(&name) => DomainState,
        _ => {
            return Err(CommandError::new(
                "backup/incomplete",
                format!("backup table has no merge policy: {name}"),
            ))
        }
    })
}

pub(super) fn keyed(table: &str, key: &str) -> RowPolicy {
    use RowPolicy::*;
    // Plugin object grants belong to this device and are reissued only by the
    // restore consent path. Never expose the persisted map as a generic source
    // setting that can overwrite the target authority.
    if table == "app_kv" && key == "read-aware-plugins-book-access" {
        return PreserveDevice;
    }
    if table == "synced_preferences" {
        return if key.starts_with("secret:") {
            TranslateRoamingSecret
        } else {
            RoamingPreferences
        };
    }
    if key.starts_with("read-aware-secret:sync.")
        || key.starts_with("read-aware-backup-restore-accepted:")
        || key.starts_with("read-aware-sync-")
        || key.starts_with("read-aware-migrated-")
    {
        PreserveDevice
    } else if key.starts_with("read-aware-secret:") {
        ResealCredential
    } else if key == "read-aware-virtual-books" {
        VirtualBindings
    } else if let Some(rest) = key.strip_prefix("read-aware-plugin.") {
        match rest.split_once('.') {
            Some((_, "schedule-state" | "schedule-runs")) => ReviewRuntimeHistory,
            _ => PluginData,
        }
    } else if key.starts_with("read-aware-plugin-host.schema.") {
        PluginData
    } else {
        ReviewSettings
    }
}
