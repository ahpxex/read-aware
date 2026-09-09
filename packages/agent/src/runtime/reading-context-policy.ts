import { AppError, ERR_AI_CONTEXT_CHANGED } from "@read-aware/core";
import type { TurnRecord } from "../ports";
import type { ReadingCursor } from "./reading-cursor";
import { policyCall } from "./policy-call";

export type ReadingContextPermissions = { selection: boolean; surrounding: boolean };
export interface ReadingContextPolicy {
  snapshot(): ReadingContextPermissions;
  subscribe(listener: () => void): () => void;
}
export const FULL_READING_CONTEXT: ReadingContextPermissions = { selection: true, surrounding: true };

/** Tightening revokes this operation permanently; granting more only affects a new turn. */
export function readingContextCall(policy: ReadingContextPolicy | undefined, signal?: AbortSignal,
  permissions = policy?.snapshot() ?? FULL_READING_CONTEXT) {
  const captured = { ...permissions };
  const call = policyCall({
    enabled: () => {
      const current = policy?.snapshot() ?? FULL_READING_CONTEXT;
      return (!captured.selection || current.selection) && (!captured.surrounding || current.surrounding);
    },
    subscribe: listener => policy?.subscribe(listener) ?? (() => {}),
  }, () => new AppError(ERR_AI_CONTEXT_CHANGED, "[ai/context-changed] Reading context permissions changed during the request.", { retryable: true }), signal);
  return { ...call, permissions: captured };
}
export type ReadingContextCall = ReturnType<typeof readingContextCall>;

export function permittedReadingCursor(cursor: ReadingCursor | undefined, permissions: ReadingContextPermissions): ReadingCursor | undefined {
  if (!cursor || (permissions.selection && permissions.surrounding)) return cursor;
  // The viewport may contain the selected passage. Withhold it as a whole,
  // rather than using approximate substring redaction as a privacy boundary.
  const { visibleText: _text, ...location } = cursor;
  return location;
}

/** Local attachments remain intact; only the inference copy is filtered. */
export function permittedTurnRecords(records: TurnRecord[], permissions: ReadingContextPermissions): TurnRecord[] {
  return permissions.selection ? records : records.map(record => ({ ...record, attachments: undefined }));
}
