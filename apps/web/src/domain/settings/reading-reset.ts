import { AppError, type ReadingSettingsReset, type SettingChange } from "@read-aware/core";
import { DEFAULT_READER_PREFERENCES } from "../../features/settings/lib/reader-settings";
import { buildSettingDefinitions, type SettingsDraft } from "./catalog";

function samePreferences(a: SettingsDraft["reading"], b: SettingsDraft["reading"]): boolean {
  return Object.keys(a).length === Object.keys(b).length
    && Object.entries(a).every(([key, value]) => b[key as keyof typeof b] === value);
}

export function readingResetPaths(draft: SettingsDraft): string[] {
  return buildSettingDefinitions(draft).filter(definition =>
    definition.section === "reading" && definition.supportedTargets?.includes("book") && definition.write).map(definition => definition.path);
}

export function resetReadingDraft(source: SettingsDraft, request: ReadingSettingsReset): { draft: SettingsDraft; changed: SettingChange[] } {
  let target = request?.target;
  if (!request || Object.keys(request).some(key => key !== "target" && key !== "action")
    || !["defaults", "inherit"].includes(request.action) || !target || !["global", "book", "all-books"].includes(target.kind)
    || Object.keys(target).some(key => key !== "kind" && !(target.kind === "book" && key === "bookId"))
    || (target.kind === "book" && (typeof target.bookId !== "string" || !target.bookId.trim() || target.bookId.length > 256))
    || (request.action === "inherit" && target.kind === "global")) {
    throw new AppError("ui/invalid-target", "Invalid reading reset target");
  }
  if (target.kind === "book") target = { ...target, bookId: target.bookId.trim() };
  const draft = { ...source, reading: { ...source.reading }, readerOverrides: { ...source.readerOverrides } };
  if (target.kind === "book") {
    if (request.action === "inherit") delete draft.readerOverrides[target.bookId];
    else draft.readerOverrides[target.bookId] = { scope: "book", settings: { ...DEFAULT_READER_PREFERENCES } };
  } else {
    if (request.action === "defaults") draft.reading = { ...DEFAULT_READER_PREFERENCES };
    if (target.kind === "all-books") draft.readerOverrides = {};
  }
  const changed = !samePreferences(source.reading, draft.reading)
    || Object.keys(source.readerOverrides).length !== Object.keys(draft.readerOverrides).length
    || Object.entries(source.readerOverrides).some(([id, before]) => {
      const after = draft.readerOverrides[id];
      return !after || before.scope !== after.scope || !samePreferences(before.settings, after.settings);
    });
  if (!changed) return { draft: source, changed: [] };
  const queryTarget = target.kind === "book" ? target : { kind: "global" as const };
  // A bundle reset invalidates every reader field, including equal values whose source changed.
  const paths = new Set(readingResetPaths(draft));
  return { draft, changed: buildSettingDefinitions(draft)
    .filter(definition => paths.has(definition.path))
    .map(definition => ({ path: definition.path, value: definition.read(draft, queryTarget), target })) };
}
