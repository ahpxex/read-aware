import type { BookTocEntry } from "@read-aware/plugin-types";

export function flattenToc(entries: BookTocEntry[]): BookTocEntry[] {
  return entries.flatMap(entry => [entry, ...flattenToc(entry.children)]);
}

export function chapterNumber(value: string): number | null {
  const normalized = value.normalize("NFKC").trim();
  if (/^\d+$/.test(normalized)) {
    const number = Number(normalized);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }
  if (!/^[零〇一二两兩三四五六七八九十百千万萬]+$/.test(normalized)) return null;
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000, 萬: 10000 };
  if ([...normalized].every(char => char in digits)) {
    const number = Number([...normalized].map(char => digits[char]).join(""));
    return number > 0 && Number.isSafeInteger(number) ? number : null;
  }
  let total = 0, section = 0, digit = 0;
  for (const char of normalized) {
    if (char in digits) digit = digits[char];
    else if (units[char] === 10000) { total += (section + digit || 1) * 10000; section = 0; digit = 0; }
    else { section += (digit || 1) * units[char]; digit = 0; }
  }
  return total + section + digit || null;
}

function printedNumber(label: string): number | null {
  const text = label.normalize("NFKC").trim();
  const match = text.match(/^第\s*([\d零〇一二两兩三四五六七八九十百千万萬]+)\s*[章节章節回]/u)
    ?? text.match(/^(?:chapter|chapitre|kapitel|capítulo|глава)\s+(\d+)\b/iu)
    ?? text.match(/^(\d+)(?:[.)、:\s]|$)/u);
  return match ? chapterNumber(match[1]) : null;
}

/** Printed numbering and TOC ordinals are deliberately separate modes. */
export function findChapters(entries: BookTocEntry[], query: string, mode: "chapter" | "ordinal"): BookTocEntry[] {
  const all = flattenToc(entries);
  const number = chapterNumber(query);
  if (mode === "ordinal") return number === null ? [] : all.filter(entry => entry.ordinal === number);
  if (number !== null) return all.filter(entry => printedNumber(entry.label) === number);
  const title = query.normalize("NFKC").trim().toLocaleLowerCase();
  return title ? all.filter(entry => entry.label.normalize("NFKC").toLocaleLowerCase().includes(title)) : [];
}
