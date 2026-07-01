import { GROUP_ORDER, type CommandGroupKey, type CommandItem } from "./build-commands";

/** Books shown under an empty query (most-recent first); the rest on demand. */
const EMPTY_BOOK_LIMIT = 5;
/** Cap matched books so a large library can't flood the list. */
const MATCH_BOOK_LIMIT = 30;

export type CommandGroup = { group: CommandGroupKey; items: CommandItem[] };

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j += 1) {
    if (hay[j] === needle[i]) i += 1;
  }
  return i === needle.length;
}

/** Higher is better; null means no match. Prefix > substring > field > fuzzy. */
function score(item: CommandItem, q: string): number | null {
  const title = item.title.toLowerCase();
  const idx = title.indexOf(q);
  if (idx === 0) return 100 - title.length * 0.01;
  if (idx > 0) return 60 - idx * 0.1;
  const hay = `${title} ${item.subtitle ?? ""} ${item.keywords ?? ""} ${item.group}`.toLowerCase();
  if (hay.includes(q)) return 30;
  if (isSubsequence(q, hay)) return 10;
  return null;
}

function bucket(
  items: CommandItem[],
  orderByScore: Map<CommandGroupKey, number> | null,
): CommandGroup[] {
  const groups = new Map<CommandGroupKey, CommandItem[]>();
  for (const item of items) {
    const list = groups.get(item.group) ?? [];
    list.push(item);
    groups.set(item.group, list);
  }
  const result: CommandGroup[] = [...groups.entries()].map(([group, groupItems]) => ({
    group,
    items: groupItems,
  }));
  if (orderByScore) {
    // Query active: surface the section with the strongest match first.
    result.sort((a, b) => (orderByScore.get(b.group) ?? 0) - (orderByScore.get(a.group) ?? 0));
  } else {
    const rank = (group: string) => {
      const i = (GROUP_ORDER as readonly string[]).indexOf(group);
      return i === -1 ? GROUP_ORDER.length : i;
    };
    result.sort((a, b) => rank(a.group) - rank(b.group));
  }
  return result;
}

/**
 * Filter + group items for the current query. With no query, sections follow the
 * fixed `GROUP_ORDER` and books are limited to the most recent few. With a query,
 * items are scored, sections are ordered by their best match, and matched books
 * are capped.
 */
export function filterCommands(items: CommandItem[], rawQuery: string): CommandGroup[] {
  const q = rawQuery.trim().toLowerCase();

  if (!q) {
    let books = 0;
    const visible = items.filter((item) => {
      if (item.kind !== "book") return true;
      books += 1;
      return books <= EMPTY_BOOK_LIMIT;
    });
    return bucket(visible, null);
  }

  const scored = items
    .map((item) => ({ item, value: score(item, q) }))
    .filter((entry): entry is { item: CommandItem; value: number } => entry.value !== null)
    .sort((a, b) => b.value - a.value);

  const bestByGroup = new Map<CommandGroupKey, number>();
  let books = 0;
  const visible: CommandItem[] = [];
  for (const { item, value } of scored) {
    if (item.kind === "book") {
      books += 1;
      if (books > MATCH_BOOK_LIMIT) continue;
    }
    visible.push(item);
    if (!bestByGroup.has(item.group)) bestByGroup.set(item.group, value);
  }

  return bucket(visible, bestByGroup);
}
