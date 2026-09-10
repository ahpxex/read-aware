import { AppError } from "./errors";
import type { SettingOption, SettingsOptionsPage, SettingsOptionsQuery } from "./settings";

export function validateSettingsOptionsQuery(query: SettingsOptionsQuery): Required<Pick<SettingsOptionsQuery, "path" | "search" | "offset" | "limit">> & SettingsOptionsQuery {
  if (!query || typeof query.path !== "string" || !query.path || query.path.length > 256 ||
      (query.search !== undefined && (typeof query.search !== "string" || query.search.length > 120))) {
    throw new AppError("settings/options-invalid", "An exact setting path and bounded search are required");
  }
  const offset = query.offset ?? 0, limit = query.limit ?? 25;
  if (query.target !== undefined && (!query.target ||
      (query.target.kind !== "global" && query.target.kind !== "book") ||
      (query.target.kind === "book" && (typeof query.target.bookId !== "string" || !query.target.bookId.trim())))) {
    throw new AppError("settings/options-invalid", "Choose a global or specific book target");
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      (query.revision !== undefined && (!Number.isSafeInteger(query.revision) || query.revision < 0)) ||
      (offset > 0 && query.revision === undefined)) {
    throw new AppError("settings/options-invalid", "Use a valid page size/offset and retain the catalog revision");
  }
  return { ...query, offset, limit, search: (query.search ?? "").trim() };
}

export function pageSettingOptions(options: readonly SettingOption[], revision: number, query: SettingsOptionsQuery): SettingsOptionsPage {
  const accepted = validateSettingsOptionsQuery(query);
  if (accepted.revision !== undefined && accepted.revision !== revision) {
    throw new AppError("settings/options-stale", "Settings catalog changed; restart option discovery");
  }
  const search = accepted.search.toLocaleLowerCase();
  const filtered = options.filter(option => !search || `${option.label} ${String(option.value)}`.toLocaleLowerCase().includes(search));
  const end = Math.min(filtered.length, accepted.offset + accepted.limit);
  return { path: accepted.path, revision, options: structuredClone(filtered.slice(accepted.offset, end)),
    total: filtered.length, offset: accepted.offset, nextOffset: end < filtered.length ? end : null };
}
