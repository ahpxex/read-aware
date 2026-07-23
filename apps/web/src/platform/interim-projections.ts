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

/** Wire shape of the Rust `ReadingTimeWire` (camelCase serde). */
export type ReadingTimeWire = {
  totals: { bookId: string; totalMs: number; firstStartedAt?: number | null; lastReadAt?: number | null }[];
  daily: { bookId: string; localDay: string; ms: number }[];
  hourly: { bookId: string; localHour: number; ms: number }[];
};

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

/**
 * Pre-v9 vocabulary blobs go straight into the built-in vocabulary plugin's
 * document collection (bootstrap write into its namespace — the one place the
 * app writes plugin documents on a plugin's behalf).
 */
async function migrateVocabularyKv(): Promise<void> {
  const raw = localKV.getItem(VOCABULARY_KV_KEY);
  if (!raw) return;
  try {
    const items = JSON.parse(raw) as LegacyVocabularyItem[];
    if (Array.isArray(items)) {
      for (const item of items) {
        await invoke("plugin_docs_put", {
          pluginId: "dictionary",
          collection: "words",
          id: item.id,
          json: JSON.stringify({
            term: item.term,
            language: item.language,
            entry: item.entry ?? null,
            context: item.context,
            bookTitle: item.bookTitle,
            addedAt: new Date(item.addedAt).toISOString(),
          }),
          bookId: item.bookId,
          anchor: null,
        });
      }
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
  // Wave 5: the retired core vocabulary projection moves into the built-in
  // dictionary plugin's document collection (idempotent; empty second run).
  try {
    const moved = await invoke<number>("vocabulary_migrate_to_plugin_documents");
    if (moved > 0) console.info(`[interim-projections] moved ${moved} vocabulary entries to the plugin`);
  } catch (err) {
    console.error("[interim-projections] vocabulary handoff failed; will retry next launch", err);
  }
  try {
    readingTime = await invoke<ReadingTimeWire>("reading_time_load");
  } catch (err) {
    console.error("[interim-projections] hydrate failed; starting empty", err);
  }
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
