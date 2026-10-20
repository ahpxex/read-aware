/**
 * The single mapping from thrown failures to user-facing copy.
 *
 * Every surface that shows an error — toast, inline block, fallback screen —
 * goes through here. The contract (see packages/core errors.ts):
 *
 * - A recognized stable code renders localized, actionable copy.
 * - Anything else renders the caller's localized fallback (or the generic
 *   line). Raw `error.message` NEVER reaches the user; it belongs in the file
 *   log (`createLogger(...).error(...)` at the failure site) where the
 *   diagnostics bundle picks it up.
 * - `retryable` is honest advice for the surface's affordances: true means
 *   "the same action may simply work next time".
 * - `action` names the fix surface when one exists (e.g. AI key problems →
 *   Settings → AI); surfaces decide how to render it.
 *
 * Callers must have the `common` namespace loaded (add it to
 * `useTranslation([...])`).
 */
import type common from "./locales/en/common.json";
import { i18n } from "./instance";
import {
  ERR_PLUGIN_INVALID_ARGUMENT,
  ERR_PLUGIN_QUOTA_EXCEEDED,
  ERR_PLUGIN_ASSET_CONFLICT,
  ERR_PLUGIN_INVALID_PACKAGE,
  ERR_PLUGIN_BUILT_IN,
  ERR_PLUGIN_CANDIDATE_STALE,
  ERR_PLUGIN_NO_PREVIOUS_VERSION,
  ERR_PLUGIN_UPDATE_REQUIRED,
  ERR_PLUGIN_APP_UPDATE_REQUIRED,
  ERR_UPDATE_UNAVAILABLE,
  ERR_UPDATE_NOT_READY,
  ERR_UPDATE_NETWORK,
  ERR_UPDATE_INVALID_RELEASE,
  ERR_UPDATE_INSTALL_FAILED,
  ERR_EXPORT_TARGET_INVALID,
  ERR_SYNC_MISDIRECTED,
  ERR_SYNC_NETWORK,
  ERR_SYNC_PASSPHRASE,
  ERR_SYNC_QUOTA,
  ERR_SYNC_RATE_LIMITED,
  ERR_SYNC_SERVER,
  ERR_SYNC_TRANSPORT_MISMATCH,
  ERR_SYNC_LOG_INCOMPLETE,
  ERR_SYNC_CHECKPOINT_MISMATCH,
  ERR_SYNC_CHECKPOINT_PRECONDITION,
  ERR_SYNC_TRANSPORT_UNAVAILABLE,
  ERR_SYNC_UNAUTHORIZED,
  ERR_AI_AUTH,
  ERR_AI_CONTEXT_OVERFLOW,
  ERR_AI_NETWORK,
  ERR_AI_NOT_CONFIGURED,
  ERR_AI_MEMORY_DISABLED,
  ERR_AI_CONTEXT_CHANGED,
  ERR_AI_CONTEXT_WITHHELD,
  ERR_AI_INVALID_READING_CONTEXT,
  ERR_AI_PROVIDER,
  ERR_AI_QUOTA,
  ERR_AI_RATE_LIMITED,
  ERR_AI_UNKNOWN,
  ERR_AI_REQUEST_CANCELLED,
  ERR_AI_REQUEST_TIMEOUT,
  ERR_AI_BUSY,
  ERR_DB_ERROR,
  ERR_DB_LOCKED,
  ERR_FS_NOT_FOUND,
  ERR_FS_NO_SPACE,
  ERR_FS_PERMISSION,
  ERR_SECRETS_UNAVAILABLE,
  errorCode,
  isRetryable,
} from "@read-aware/core";

/** `update-plugin`: install the plugin's newer release; `update-app`: update ReadAware. */
export type ErrorAction = "open-ai-settings" | "update-plugin" | "update-app";

export type ErrorDescription = {
  /** Localized, user-facing sentence. Never raw error text. */
  body: string;
  /** Whether simply trying the same action again is honest advice. */
  retryable: boolean;
  /** The fix surface to offer, when one exists. */
  action?: ErrorAction;
};

/** Keyed against the en catalog so a missing entry fails the typecheck. */
type ErrorCopyKey = keyof (typeof common)["errors"] & string;

type CopyEntry = {
  key: ErrorCopyKey;
  retryable: boolean;
  action?: ErrorAction;
};

const AI_SETTINGS: ErrorAction = "open-ai-settings";

const CODE_COPY: Record<string, CopyEntry> = {
  "local-api/bind": { key: "localApiBind", retryable: false },
  "local-api/unavailable": { key: "localApiUnavailable", retryable: true },
  "search/not-configured": { key: "searchNotConfigured", retryable: false, action: AI_SETTINGS },
  "search/auth": { key: "searchAuth", retryable: false, action: AI_SETTINGS },
  "search/access": { key: "searchAccess", retryable: false },
  "search/rate-limited": { key: "searchRateLimited", retryable: true },
  "search/network": { key: "searchNetwork", retryable: true },
  "search/timeout": { key: "searchTimeout", retryable: true },
  "search/cancelled": { key: "searchCancelled", retryable: false },
  "search/invalid-input": { key: "searchInvalidInput", retryable: false },
  "search/provider": { key: "searchProvider", retryable: true },
  "search/fetch-failed": { key: "searchFetchFailed", retryable: false },
  "search/too-large": { key: "searchTooLarge", retryable: false },
  "data/wipe-incomplete": { key: "dataWipeIncomplete", retryable: false },
  "backup/invalid-archive": { key: "backupInvalidArchive", retryable: false },
  "backup/unlock-failed": { key: "backupUnlockFailed", retryable: false },
  "backup/password-policy": { key: "backupPasswordPolicy", retryable: false },
  "backup/legacy-format": { key: "backupLegacyFormat", retryable: false },
  "backup/incomplete": { key: "backupIncomplete", retryable: false },
  "backup/recovery-required": { key: "backupRecoveryRequired", retryable: false },
  "backup/busy": { key: "backupBusy", retryable: true },
  "backup/changed": { key: "backupChanged", retryable: true },
  "backup/cancelled": { key: "backupCancelled", retryable: false },
  "ai/invalid-capability-query": { key: "capabilityQueryInvalid", retryable: false },
  "ai/capability-catalog-changed": { key: "capabilityCatalogChanged", retryable: false },
  "ai/capability-catalog-unavailable": { key: "capabilityCatalogUnavailable", retryable: false },
  "memory/invalid-query": { key: "memoryInvalidQuery", retryable: false },
  "memory/invalid-input": { key: "memoryInvalidInput", retryable: false },
  "memory/not-found": { key: "memoryNotFound", retryable: false },
  "memory/conflict": { key: "memoryConflict", retryable: false },
  "memory/unavailable": { key: "memoryUnavailable", retryable: false },
  "memory/observer-limit": { key: "memoryObserverLimit", retryable: false },
  "memory/task-limit": { key: "memoryTaskLimit", retryable: true },
  "memory/task-not-found": { key: "memoryTaskNotFound", retryable: false },
  "memory/observation-failed": { key: "memoryObservationFailed", retryable: true },
  "memory/cancelled": { key: "memoryCancelled", retryable: false },
  "memory/forbidden": { key: "memoryForbidden", retryable: false },
  "ui/invalid-target": { key: "workspaceInvalid", retryable: false },
  "ui/target-not-found": { key: "workspaceMissing", retryable: false },
  "ui/superseded": { key: "workspaceChanged", retryable: false },
  "ui/unavailable": { key: "workspaceUnavailable", retryable: true },
  "ui/timeout": { key: "workspaceTimeout", retryable: true },
  "ui/reading-permission": { key: "workspaceReadingPermission", retryable: false },
  "ui/observer-limit": { key: "workspaceObserverLimit", retryable: false },
  "settings/observer-limit": { key: "settingsObserverLimit", retryable: false },
  "settings/unavailable": { key: "settingsUnavailable", retryable: true },
  "reading/invalid-time-query": { key: "readingTimeInvalid", retryable: false },
  "reading/stats-stale": { key: "readingTimeStale", retryable: true },
  "reading/stats-invalid": { key: "readingTimeUnavailable", retryable: false },
  "reading/stats-unavailable": { key: "readingTimeUnavailable", retryable: true },
  "reading/stats-observer-limit": { key: "readingTimeLimit", retryable: false },
  "library/invalid-removal": { key: "bookRemovalInvalid", retryable: false },
  "library/folder-too-large": { key: "bookFolderTooLarge", retryable: false },
  "library/invalid-cleanup-query": { key: "bookCleanupInvalid", retryable: false },
  "library/cleanup-stale": { key: "bookCleanupStale", retryable: true },
  "library/removal-cleanup-pending": { key: "bookRemovalCleanupPending", retryable: false },
  "library/book-reappeared": { key: "bookRemovalReappeared", retryable: false },
  "library/cancelled": { key: "bookSearchCancelled", retryable: false },
  "library/invalid-query": { key: "bookSearchInvalid", retryable: false },
  "library/invalid-range": { key: "bookRangeInvalid", retryable: false },
  "library/range-not-found": { key: "bookRangeMissing", retryable: false },
  "library/range-ambiguous": { key: "bookRangeAmbiguous", retryable: false },
  "library/range-unsupported": { key: "bookRangeUnsupported", retryable: false },
  "library/range-forbidden": { key: "bookRangeForbidden", retryable: false },
  "library/book-not-found": { key: "bookNotFound", retryable: false },
  "plugin/recovery-required": { key: "pluginRecoveryRequired", retryable: false },
  "plugin/data-busy": { key: "pluginDataBusy", retryable: true },
  "transaction/conflict": { key: "transactionConflict", retryable: false },
  "changes/cursor-expired": { key: "changesExpired", retryable: false },
  "changes/cursor-scope-changed": { key: "changesScopeChanged", retryable: false },
  "changes/invalid-query": { key: "changesInvalid", retryable: false },
  "changes/unavailable": { key: "changesUnavailable", retryable: false },
  "jobs/unstable-source": { key: "jobsUnstableSource", retryable: false },
  "transaction/invalid-operation": { key: "transactionInvalid", retryable: false },
  "transaction/preview-expired": { key: "transactionPreviewExpired", retryable: false },
  "transaction/receipt-missing": { key: "transactionReceiptMissing", retryable: false },
  "transaction/quota-exceeded": { key: "transactionQuota", retryable: false },
  "transaction/no-changes": { key: "transactionNoChanges", retryable: false },
  "plugin/permission-denied": { key: "pluginServiceForbidden", retryable: false },
  "plugin/service-unavailable": { key: "pluginServiceUnavailable", retryable: false },
  "plugin/service-forbidden": { key: "pluginServiceForbidden", retryable: false },
  "plugin/service-cycle": { key: "pluginServiceCycle", retryable: false },
  "plugin/service-timeout": { key: "pluginServiceTimeout", retryable: false },
  "plugin/service-result-invalid": { key: "pluginServiceResultInvalid", retryable: false },
  "plugin/service-failed": { key: "pluginServiceFailed", retryable: false },
  "plugin/service-data-changed": { key: "pluginServiceDataChanged", retryable: false },
  "plugin/object-access-denied": { key: "pluginObjectAccessDenied", retryable: false },
  "plugin/settings-stale": { key: "pluginSettingsStale", retryable: false },
  "plugin/action-disabled": { key: "pluginActionDisabled", retryable: false },
  [ERR_PLUGIN_INVALID_ARGUMENT]: { key: "pluginInvalidArgument", retryable: false },
  [ERR_PLUGIN_ASSET_CONFLICT]: { key: "pluginAssetConflict", retryable: false },
  [ERR_PLUGIN_QUOTA_EXCEEDED]: { key: "pluginQuotaExceeded", retryable: false },
  [ERR_PLUGIN_INVALID_PACKAGE]: { key: "pluginInvalidPackage", retryable: false },
  [ERR_PLUGIN_BUILT_IN]: { key: "pluginBuiltIn", retryable: false },
  [ERR_PLUGIN_CANDIDATE_STALE]: { key: "pluginCandidateStale", retryable: false },
  [ERR_PLUGIN_NO_PREVIOUS_VERSION]: { key: "pluginNoPreviousVersion", retryable: false },
  [ERR_PLUGIN_UPDATE_REQUIRED]: { key: "pluginUpdateRequired", retryable: false, action: "update-plugin" },
  [ERR_PLUGIN_APP_UPDATE_REQUIRED]: { key: "pluginAppUpdateRequired", retryable: false, action: "update-app" },
  "plugin/object-access-state-invalid": { key: "pluginObjectAccessStateInvalid", retryable: false },
  [ERR_UPDATE_UNAVAILABLE]: { key: "updateUnavailable", retryable: false },
  [ERR_UPDATE_NOT_READY]: { key: "updateNotReady", retryable: false },
  [ERR_UPDATE_NETWORK]: { key: "updateNetwork", retryable: true },
  [ERR_UPDATE_INVALID_RELEASE]: { key: "updateInvalidRelease", retryable: false },
  [ERR_UPDATE_INSTALL_FAILED]: { key: "updateInstallFailed", retryable: false },
  [ERR_EXPORT_TARGET_INVALID]: { key: "exportTargetInvalid", retryable: false },
  "plugin/network-denied": { key: "pluginNetworkDenied", retryable: false },
  "plugin/network-redirect": { key: "pluginNetworkRedirect", retryable: false },
  "plugin/network-busy": { key: "pluginNetworkBusy", retryable: true },
  "plugin/network-rate-limited": { key: "pluginNetworkRateLimited", retryable: true },
  "plugin/network-failed": { key: "pluginNetworkFailed", retryable: true },
  "plugin/http-auth": { key: "pluginHttpAuth", retryable: false },
  "plugin/http-not-found": { key: "pluginHttpNotFound", retryable: false },
  "plugin/http-rate-limited": { key: "pluginHttpRateLimited", retryable: true },
  "plugin/http-server": { key: "pluginHttpServer", retryable: true },
  "plugin/http-rejected": { key: "pluginHttpRejected", retryable: false },
  [ERR_AI_REQUEST_CANCELLED]: { key: "aiRequestCancelled", retryable: false },
  [ERR_AI_REQUEST_TIMEOUT]: { key: "aiRequestTimeout", retryable: false },
  "ai/budget-exceeded": { key: "aiOutputBudget", retryable: false },
  "ai/input-budget-exceeded": { key: "aiInputBudget", retryable: false },
  "ai/image-unsupported": { key: "aiImageUnsupported", retryable: false },
  "ai/invalid-image": { key: "aiImageInvalid", retryable: false },
  "ai/image-budget-exceeded": { key: "aiImageBudget", retryable: false },
  "library/content-budget-exceeded": { key: "bookContentBudget", retryable: false },
  [ERR_AI_BUSY]: { key: "aiBusy", retryable: true },
  "ai/invalid-interaction": { key: "aiInvalidInteraction", retryable: false },
  "plugin/network-closed": { key: "pluginNetworkClosed", retryable: false },
  "plugin/network-read-invalid": { key: "pluginNetworkReadInvalid", retryable: false },
  "plugin/network-timeout": { key: "pluginNetworkTimeout", retryable: false },
  "plugin/payload-too-large": { key: "pluginNetworkBodyTooLarge", retryable: false },
  "library/text-extraction-failed": { key: "bookTextExtractionFailed", retryable: true },
  "library/text-unsupported": { key: "bookTextUnsupported", retryable: false },
  "library/text-timeout": { key: "bookTextTimeout", retryable: true },
  "library/text-cancelled": { key: "bookTextCancelled", retryable: false },
  "library/text-busy": { key: "bookTextBusy", retryable: true },
  "library/text-task-not-found": { key: "bookTextTaskNotFound", retryable: false },
  "library/text-task-limit": { key: "bookTextTaskLimit", retryable: true },
  "settings/invalid-shortcut": { key: "settingsInvalidShortcut", retryable: false },
  "settings/options-invalid": { key: "settingsOptionsInvalid", retryable: false },
  "settings/options-forbidden": { key: "settingsOptionsForbidden", retryable: false },
  "settings/forbidden": { key: "settingsForbidden", retryable: false },
  "settings/options-stale": { key: "settingsOptionsStale", retryable: false },
  "settings/options-unavailable": { key: "settingsOptionsUnavailable", retryable: true },
  "settings/font-enumeration-failed": { key: "settingsFontEnumerationFailed", retryable: true },
  "font/invalid": { key: "fontInvalid", retryable: false },
  "font/too-large": { key: "fontTooLarge", retryable: false },
  "font/still-present": { key: "fontStillPresent", retryable: false },
  "font/cleanup-stale": { key: "fontCleanupStale", retryable: true },
  "settings/shortcut-conflict": { key: "settingsShortcutConflict", retryable: false },
  "reader/playback-failed": { key: "readerPlaybackFailed", retryable: true },
  "reader/segmentation-failed": { key: "readerSegmentationFailed", retryable: true },
  "annotations/conflict": { key: "annotationConflict", retryable: false },
  "annotations/unavailable": { key: "annotationUnavailable", retryable: false },
  "annotations/observer-limit": { key: "annotationObserverLimit", retryable: false },
  "memory/forgotten-suppressed": { key: "memoryForgottenSuppressed", retryable: false },
  "memory/input-budget-exceeded": { key: "memoryInputBudgetExceeded", retryable: false },
  "memory/output-budget-exceeded": { key: "memoryOutputBudgetExceeded", retryable: false },
  "annotations/read-budget-exceeded": { key: "annotationReadBudgetExceeded", retryable: false },
  "annotations/observation-failed": { key: "annotationObservationFailed", retryable: true },
  "annotations/cancelled": { key: "annotationCancelled", retryable: false },
  "annotations/not-found": { key: "annotationNotFound", retryable: false },
  "annotations/invalid-input": { key: "annotationInvalidInput", retryable: false },
  "annotations/invalid-cursor": { key: "annotationInvalidInput", retryable: false },
  "annotations/forbidden": { key: "annotationForbidden", retryable: false },
  "book/unsupported-encryption": { key: "bookEncryption", retryable: false },
  "book/unsupported-format": { key: "bookUnsupportedFormat", retryable: false },
  "book/parse-failed": { key: "bookParseFailed", retryable: false },
  [ERR_FS_NOT_FOUND]: { key: "fsNotFound", retryable: false },
  [ERR_FS_PERMISSION]: { key: "fsPermission", retryable: false },
  [ERR_FS_NO_SPACE]: { key: "fsNoSpace", retryable: false },
  [ERR_DB_LOCKED]: { key: "dbLocked", retryable: true },
  [ERR_DB_ERROR]: { key: "dbError", retryable: false },
  [ERR_SECRETS_UNAVAILABLE]: { key: "secretsUnavailable", retryable: false },
  [ERR_SYNC_NETWORK]: { key: "syncNetwork", retryable: true },
  [ERR_SYNC_SERVER]: { key: "syncServer", retryable: true },
  [ERR_SYNC_RATE_LIMITED]: { key: "syncRateLimited", retryable: true },
  [ERR_SYNC_UNAUTHORIZED]: { key: "syncUnauthorized", retryable: false },
  [ERR_SYNC_MISDIRECTED]: { key: "syncMisdirected", retryable: false },
  [ERR_SYNC_PASSPHRASE]: { key: "syncPassphrase", retryable: false },
  [ERR_SYNC_QUOTA]: { key: "syncQuota", retryable: false },
  [ERR_SYNC_TRANSPORT_UNAVAILABLE]: { key: "syncTransportUnavailable", retryable: false },
  [ERR_SYNC_TRANSPORT_MISMATCH]: { key: "syncTransportMismatch", retryable: false },
  [ERR_SYNC_LOG_INCOMPLETE]: { key: "syncLogIncomplete", retryable: true },
  [ERR_SYNC_CHECKPOINT_MISMATCH]: { key: "syncCheckpointMismatch", retryable: false },
  [ERR_SYNC_CHECKPOINT_PRECONDITION]: { key: "syncCheckpointPrecondition", retryable: true },
  [ERR_AI_NOT_CONFIGURED]: { key: "aiNotConfigured", retryable: false, action: AI_SETTINGS },
  [ERR_AI_MEMORY_DISABLED]: { key: "aiMemoryDisabled", retryable: false, action: AI_SETTINGS },
  [ERR_AI_CONTEXT_CHANGED]: { key: "aiContextChanged", retryable: true },
  [ERR_AI_CONTEXT_WITHHELD]: { key: "aiContextWithheld", retryable: false, action: AI_SETTINGS },
  [ERR_AI_INVALID_READING_CONTEXT]: { key: "aiInvalidReadingContext", retryable: false },
  // Legacy alias: chat rows persisted before the shared code vocabulary carry
  // the old spelling in their errorCode column. Never remove.
  "ai-not-configured": { key: "aiNotConfigured", retryable: false, action: AI_SETTINGS },
  [ERR_AI_AUTH]: { key: "aiAuth", retryable: false, action: AI_SETTINGS },
  [ERR_AI_RATE_LIMITED]: { key: "aiRateLimited", retryable: true },
  [ERR_AI_QUOTA]: { key: "aiQuota", retryable: false },
  [ERR_AI_NETWORK]: { key: "aiNetwork", retryable: true },
  [ERR_AI_PROVIDER]: { key: "aiProvider", retryable: true },
  [ERR_AI_CONTEXT_OVERFLOW]: { key: "aiContextOverflow", retryable: false },
  [ERR_AI_UNKNOWN]: { key: "aiUnknown", retryable: false },
};

/** Copy for a bare stable code (e.g. a persisted `errorCode` column). */
export function describeErrorCode(code: string | undefined): ErrorDescription | null {
  const entry = code ? CODE_COPY[code] : undefined;
  if (!entry) return null;
  return {
    body: i18n.t(`errors.${entry.key}`, { ns: "common" }),
    retryable: entry.retryable,
    action: entry.action,
  };
}

/**
 * Copy for a thrown value. Unrecognized failures get `fallback` (already
 * localized by the caller — e.g. "Could not import this file.") or the generic
 * line; log the raw error at the failure site, don't show it.
 */
export function describeError(error: unknown, options?: { fallback?: string }): ErrorDescription {
  const described = describeErrorCode(errorCode(error));
  if (described) return described;
  return {
    body: options?.fallback ?? i18n.t("errors.generic", { ns: "common" }),
    retryable: isRetryable(error),
  };
}
