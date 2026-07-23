/**
 * Boot-hydrated snapshots of the SQLite-backed interim projections that
 * feature code reads SYNCHRONOUSLY (vocabulary notebook, reading-time
 * stats) — the same design as `localKV`: hydrate once before the app module
 * graph evaluates, read from memory, write through fire-and-forget.
 *
 * Also owns the one-time app_kv → SQLite migration for both stores
 * (migration wave 4; see hydrateLocalStore). Desktop-only — in the browser
 * shell the feature libs keep their localStorage fallbacks.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./environment";
import { localKV } from "./local-store";

const VOCABULARY_KV_KEY = "read-aware-vocabulary";
const READING_STATS_KV_KEY = "read-aware-reading-stats";

/** Wire shape of the Rust `VocabularyEntryRow` (camelCase serde). */
export type VocabularyEntryRow = {
  id: string;
  term: string;
  language: string;
  entryJson: string;
  context?: string;
  bookId?: string;
  bookTitle?: string;
  /** ISO timestamp. */
  addedAt: string;
};

/** Wire shape of the Rust `ReadingTimeWire` (camelCase serde). */
export type ReadingTimeWire = {
  totals: { bookId: string; totalMs: number; firstStartedAt?: number | null; lastReadAt?: number | null }[];
  daily: { bookId: string; localDay: string; ms: number }[];
  hourly: { bookId: string; localHour: number; ms: number }[];
};

let vocabularyRows: VocabularyEntryRow[] = [];
let readingTime: ReadingTimeWire = { totals: [], daily: [], hourly: [] };

// ─── One-time app_kv → SQLite migrations ─────────────────────────────────────

type LegacyVocabularyItem = {
  id: string;
  term: string;
  language: string;
  entry: unknown;
  context?: string;
  bookId?: string;
  bookTitle?: string;
  addedAt: number;
};

async function migrateVocabularyKv(): Promise<void> {
  const raw = localKV.getItem(VOCABULARY_KV_KEY);
  if (!raw) return;
  try {
    const items = JSON.parse(raw) as LegacyVocabularyItem[];
    if (Array.isArray(items) && items.length > 0) {
      await invoke("vocabulary_import", {
        entries: items.map((item) => ({
          id: item.id,
          term: item.term,
          language: item.language,
          entryJson: JSON.stringify(item.entry ?? null),
          context: item.context,
          bookId: item.bookId,
          bookTitle: item.bookTitle,
          addedAt: new Date(item.addedAt).toISOString(),
        })),
      });
    }
    localKV.removeItem(VOCABULARY_KV_KEY);
  } catch (err) {
    console.error("[interim-projections] vocabulary import failed; will retry next launch", err);
  }
}

type LegacyBookStats = {
  bookId: string;
  firstStartedAt: number | null;
  lastReadAt: number | null;
  totalMs: number;
  daily: Record<string, number>;
  byHour: number[];
};

async function migrateReadingStatsKv(): Promise<void> {
  const raw = localKV.getItem(READING_STATS_KV_KEY);
  if (!raw) return;
  try {
    const store = JSON.parse(raw) as Record<string, LegacyBookStats>;
    const books = Object.values(store ?? {});
    if (books.length > 0) {
      const wire: ReadingTimeWire = {
        totals: books.map((book) => ({
          bookId: book.bookId,
          totalMs: book.totalMs,
          firstStartedAt: book.firstStartedAt,
          lastReadAt: book.lastReadAt,
        })),
        daily: books.flatMap((book) =>
          Object.entries(book.daily ?? {}).map(([localDay, ms]) => ({
            bookId: book.bookId,
            localDay,
            ms,
          })),
        ),
        hourly: books.flatMap((book) =>
          (book.byHour ?? []).flatMap((ms, localHour) =>
            ms > 0 ? [{ bookId: book.bookId, localHour, ms }] : [],
          ),
        ),
      };
      await invoke("reading_time_import", { wire });
    }
    localKV.removeItem(READING_STATS_KV_KEY);
  } catch (err) {
    console.error("[interim-projections] reading-time import failed; will retry next launch", err);
  }
}

/**
 * Migrate any remaining app_kv blobs, then hydrate the snapshots. MUST run
 * before the app module graph evaluates (same contract as
 * hydrateLocalStore, which calls this).
 */
export async function hydrateInterimProjections(): Promise<void> {
  if (!isTauri()) return;
  await migrateVocabularyKv();
  await migrateReadingStatsKv();
  try {
    [vocabularyRows, readingTime] = await Promise.all([
      invoke<VocabularyEntryRow[]>("vocabulary_list"),
      invoke<ReadingTimeWire>("reading_time_load"),
    ]);
  } catch (err) {
    console.error("[interim-projections] hydrate failed; starting empty", err);
  }
}

// ─── Vocabulary snapshot (sync reads, write-through) ─────────────────────────

export function getVocabularyRows(): VocabularyEntryRow[] {
  return vocabularyRows;
}

export function putVocabularyRow(row: VocabularyEntryRow): void {
  vocabularyRows = [row, ...vocabularyRows.filter((existing) => existing.id !== row.id)];
  void invoke("vocabulary_put", { entry: row }).catch((err) => {
    console.error("[interim-projections] vocabulary_put failed", err);
  });
}

export function removeVocabularyRow(id: string): void {
  vocabularyRows = vocabularyRows.filter((existing) => existing.id !== id);
  void invoke("vocabulary_remove", { id }).catch((err) => {
    console.error("[interim-projections] vocabulary_remove failed", err);
  });
}

// ─── Reading-time (boot snapshot + write-through deltas) ─────────────────────

/** The boot snapshot — live truth after boot is the readingStatsAtom. */
export function getReadingTimeSnapshot(): ReadingTimeWire {
  return readingTime;
}

export function recordReadingTimeDelta(
  bookId: string,
  ms: number,
  atEpochMs: number,
  localDay: string,
  localHour: number,
): void {
  void invoke("reading_time_record", { bookId, ms, atEpochMs, localDay, localHour }).catch(
    (err) => {
      console.error("[interim-projections] reading_time_record failed", err);
    },
  );
}

export function importReadingTime(wire: ReadingTimeWire): void {
  readingTime = wire;
  void invoke("reading_time_import", { wire }).catch((err) => {
    console.error("[interim-projections] reading_time_import failed", err);
  });
}

/** Fresh read from SQLite (async consumers, e.g. the reading domain). */
export async function loadReadingTime(): Promise<ReadingTimeWire> {
  if (!isTauri()) return readingTime;
  return invoke<ReadingTimeWire>("reading_time_load");
}
