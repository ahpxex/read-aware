import type { TocNavItem, TocEntry } from "./reader-types";

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

/** Native chapter keys and public chapter steps share TOC order, not source
 * section order. Repeated parent/child targets must not trap next-chapter. */
export function adjacentTocEntry(entries: TocEntry[], href: string | null, direction: -1 | 1): TocEntry | undefined {
  const current = findTocIndexForHref(entries, href);
  if (current < 0) return direction === 1 ? entries[0] : entries.at(-1);
  const target = canonicalHrefWithFragment(entries[current].href);
  let index = current + direction;
  while (entries[index] && canonicalHrefWithFragment(entries[index].href) === target) index += direction;
  return entries[index];
}

export function flattenToc(
  items: TocNavItem[],
  depth = 0,
): TocEntry[] {
  const flattened: Omit<TocEntry, "spineIndex">[] = [];

  for (const item of items) {
    if (item.href) {
      flattened.push({
        id: String(item.id ?? `${item.href}-${depth}`),
        href: item.href,
        label: item.label?.trim() || "Untitled chapter",
        depth,
      });
    }

    if (item.subitems?.length) {
      flattened.push(...flattenToc(item.subitems, depth + 1));
    }
  }

  return flattened.map((item, spineIndex) => ({ ...item, spineIndex }));
}
