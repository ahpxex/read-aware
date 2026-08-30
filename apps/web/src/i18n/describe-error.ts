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
  ERR_SYNC_MISDIRECTED,
  ERR_SYNC_NETWORK,
  ERR_SYNC_PASSPHRASE,
  ERR_SYNC_QUOTA,
  ERR_SYNC_RATE_LIMITED,
  ERR_SYNC_SERVER,
  ERR_SYNC_UNAUTHORIZED,
  ERR_AI_AUTH,
  ERR_AI_CONTEXT_OVERFLOW,
  ERR_AI_NETWORK,
  ERR_AI_NOT_CONFIGURED,
  ERR_AI_PROVIDER,
  ERR_AI_QUOTA,
  ERR_AI_RATE_LIMITED,
  ERR_AI_UNKNOWN,
  ERR_DB_ERROR,
  ERR_DB_LOCKED,
  ERR_FS_NOT_FOUND,
  ERR_FS_NO_SPACE,
  ERR_FS_PERMISSION,
  ERR_SECRETS_UNAVAILABLE,
  errorCode,
  isRetryable,
} from "@read-aware/core";

export type ErrorAction = "open-ai-settings";

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
  [ERR_AI_NOT_CONFIGURED]: { key: "aiNotConfigured", retryable: false, action: AI_SETTINGS },
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
export function describeError(
  error: unknown,
  options?: { fallback?: string },
): ErrorDescription {
  const described = describeErrorCode(errorCode(error));
  if (described) return described;
  return {
    body: options?.fallback ?? i18n.t("errors.generic", { ns: "common" }),
    retryable: isRetryable(error),
  };
}
