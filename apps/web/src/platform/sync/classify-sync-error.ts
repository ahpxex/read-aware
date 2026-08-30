/**
 * Map a sync-cycle failure to a stable error code for the status snapshot.
 * The status surfaces render localized copy from the code (`describeErrorCode`)
 * — the raw error goes to the log at the catch site, never into the snapshot.
 * Unclassifiable failures return null: surfaces fall back to their generic
 * sync-error line.
 */
import {
  ERR_SYNC_MISDIRECTED,
  ERR_SYNC_NETWORK,
  ERR_SYNC_PASSPHRASE,
  ERR_SYNC_QUOTA,
  ERR_SYNC_RATE_LIMITED,
  ERR_SYNC_SERVER,
  ERR_SYNC_UNAUTHORIZED,
  errorCode,
} from "@read-aware/core";
import { WrongPassphraseError } from "./connect";
import { RelayError, RelayMisdirectedError } from "./relay-client";

export function classifySyncError(error: unknown): string | null {
  // Already-coded failures (AppError/IpcError) keep their more specific code.
  const coded = errorCode(error);
  if (coded) return coded;
  if (error instanceof WrongPassphraseError) return ERR_SYNC_PASSPHRASE;
  if (error instanceof RelayMisdirectedError) return ERR_SYNC_MISDIRECTED;
  if (error instanceof RelayError) {
    if (error.status === 401 || error.status === 403) return ERR_SYNC_UNAUTHORIZED;
    if (error.status === 413) return ERR_SYNC_QUOTA;
    if (error.status === 429) return ERR_SYNC_RATE_LIMITED;
    if (error.status >= 500) return ERR_SYNC_SERVER;
    return null; // other 4xx: no copy is better than wrong copy
  }
  // fetch() rejects with TypeError on transport failure (offline, DNS, TLS).
  if (error instanceof TypeError) return ERR_SYNC_NETWORK;
  return null;
}
