import type {
  TocNavItem,
  TocEntry,
  SpineEntry,
} from "./reader-types";

export function normalizeHref(href: string) {
  return href.split("#")[0];
}

export function canonicalHref(href: string) {
  return decodeURI(normalizeHref(href))
    .replace(/^(\.\.\/)+/, "")
    .replace(/^\/+/, "");
}

export function hrefMatches(left: string, right: string) {
  const normalizedLeft = canonicalHref(left);
  const normalizedRight = canonicalHref(right);

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(normalizedRight) ||
    normalizedRight.endsWith(normalizedLeft)
  );
}

/** Like canonicalHref, but keeps the fragment — chapters that share a spine
 *  file are distinguishable only by it. */
function canonicalHrefWithFragment(href: string) {
  return decodeURI(href)
    .replace(/^(\.\.\/)+/, "")
    .replace(/^\/+/, "");
}

export function findTocIndexForHref(entries: TocEntry[], href: string | null) {
  if (!href) return -1;
  // Fragment-aware first: several TOC entries can point into one spine file
  // (Gutenberg books pack 2+ chapters per file), where the file-level match
  // below would always land on the file's first entry.
  const target = canonicalHrefWithFragment(href);
  const exact = entries.findIndex((entry) => {
    const candidate = canonicalHrefWithFragment(entry.href);
    return candidate === target || candidate.endsWith(target) || target.endsWith(candidate);
  });
  if (exact >= 0) return exact;
  return entries.findIndex((entry) => hrefMatches(entry.href, href));
}

export function flattenToc(
  items: TocNavItem[],
  depth = 0,
): TocEntry[] {
  const flattened: Omit<TocEntry, "spineIndex">[] = [];

  for (const item of items) {
    if (item.href) {
      flattened.push({
        id: item.id ?? `${item.href}-${depth}`,
        href: item.href,
        label: item.label?.trim() || "Untitled chapter",
        depth,
      });
    }

    if (item.subitems?.length) {
      flattened.push(...flattenToc(item.subitems, depth + 1));
    }
  }

  return flattened as TocEntry[];
}

export function isFrontmatterEntry(label: string) {
  const normalizedLabel = label.trim().toLowerCase();
  return (
    normalizedLabel === "cover" ||
    normalizedLabel === "title page" ||
    normalizedLabel === "epigraph" ||
    normalizedLabel === "copyright" ||
    normalizedLabel === "contents"
  );
}

export function filterValidTocEntries(
  entries: TocEntry[],
  spineEntries: SpineEntry[],
) {
  return entries
    .map((entry) => {
      const spineEntry = spineEntries.find((candidate) =>
        hrefMatches(entry.href, candidate.href),
      );
      if (!spineEntry) return null;

      return {
        ...entry,
        href: spineEntry.href,
        spineIndex: spineEntry.index,
      };
    })
    .filter((entry): entry is TocEntry => entry !== null);
}

export function pickInitialTocEntry(entries: TocEntry[]) {
  return (
    entries.find((entry) => /^chapter\b/i.test(entry.label.trim())) ??
    entries.find((entry) =>
      /^(prologue|introduction|preface)\b/i.test(entry.label.trim()),
    ) ??
    entries.find((entry) => !isFrontmatterEntry(entry.label)) ??
    entries[0] ??
    null
  );
}

export function getTocEntryForSpineIndex(
  entries: TocEntry[],
  spineIndex: number,
) {
  let candidate: TocEntry | null = null;

  for (const entry of entries) {
    if (entry.spineIndex <= spineIndex) {
      candidate = entry;
      continue;
    }

    break;
  }

  return candidate;
}

export function resolveInitialDisplayTarget(
  entries: TocEntry[],
  spineEntries: SpineEntry[],
) {
  const initialEntry = pickInitialTocEntry(entries);
  return initialEntry?.href ?? spineEntries[0]?.href;
}
