/**
 * Title/author guesses from a book's file name — the fallback when a format
 * carries no extractable metadata (plain PDFs most often). File names in the
 * wild arrive wrapped in distribution junk — site tags, tracker domains,
 * bare years, version and download counters — which is stripped so the shelf
 * placeholder shows a book title, not a download artifact. Anything that
 * might be part of the actual title (an unbracketed year like "1984", an
 * edition note like "(Illustrated)") is left alone.
 */

/** Known book extensions, stripped repeatedly so "book.fb2.zip" fully bares. */
const EXTENSION_RE =
  /\.(?:pdf|epub|mobi|azw3?|kf8|prc|fb2|fbz|zip|cbz|cbr|txt|text|html?|xhtml)$/i;

/** A domain-looking token ("www.site.com", "z-lib.org/..."), wherever it sits. */
const DOMAIN_TOKEN_RE =
  /(?:www\.)?[a-z0-9][\w-]*(?:\.[\w-]+)*\.(?:com|net|org|cc|co|me|io|info|xyz|top|vip|cn|ru|la|site|club|pub|app|link)(?:\/[\w/-]*)?/gi;

/** Well-known distribution sources, with or without their TLD. */
const JUNK_SOURCE_RE =
  /z-?lib(?:rary)?|libgen|annas?-?archive|oceanofpdf|epubw|jiumodiary|bookzz|b-?ok|sanet|salttiger|epublibre/i;

/** A bracketed group that is release noise rather than title. */
const JUNK_WORD_RE =
  /^(?:e-?book|pdf|epub|mobi|azw3?|kindle|retail|scan(?:ned)?|ocr|fixed|final|complete|正版|完整版|精校(?:版)?|电子书|扫描版|文字版|无水印|高清(?:版)?)$/i;

const YEAR_ONLY_RE = /^(?:19|20)\d{2}$/;

/** Pure counters: "(1)" download dupes, "v2", stray digit runs. */
const COUNTER_ONLY_RE = /^[\d\s._\-v]+$/i;

const BRACKET_GROUP_RES = [
  /\(([^()]*)\)/g,
  /\[([^[\]]*)\]/g,
  /【([^【】]*)】/g,
  /（([^（）]*)）/g,
];

function isJunkGroup(content: string): boolean {
  const inner = content.trim();
  if (!inner) return true;
  DOMAIN_TOKEN_RE.lastIndex = 0;
  return (
    DOMAIN_TOKEN_RE.test(inner) ||
    JUNK_SOURCE_RE.test(inner) ||
    YEAR_ONLY_RE.test(inner) ||
    COUNTER_ONLY_RE.test(inner) ||
    JUNK_WORD_RE.test(inner)
  );
}

function stripDistributionJunk(value: string): string {
  let out = value;
  for (const groupRe of BRACKET_GROUP_RES) {
    out = out.replace(groupRe, (match, inner) =>
      isJunkGroup(String(inner)) ? " " : match,
    );
  }
  DOMAIN_TOKEN_RE.lastIndex = 0;
  out = out.replace(DOMAIN_TOKEN_RE, " ");
  // A trailing version tag ("v2", "v1.3") is release noise; inner ones stay.
  out = out.replace(/\bv\d+(?:\.\d+)*\s*$/i, " ");
  return out;
}

function stripBookExtensions(fileName: string): string {
  let out = fileName;
  while (EXTENSION_RE.test(out)) out = out.replace(EXTENSION_RE, "");
  return out;
}

function toTitleCase(value: string) {
  return value.replace(/\w\S*/g, (segment) => (
    segment.charAt(0).toUpperCase() + segment.slice(1)
  ));
}

function normalizeFileNamePart(value: string) {
  const trimmed = value
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    // Dangling separators left where junk was cut out.
    .replace(/^[\s\-–—·.]+|[\s\-–—·.]+$/g, "")
    .trim();
  if (!trimmed) return "";
  return toTitleCase(trimmed);
}

/**
 * "Title - Author" is the dominant naming convention; everything before the
 * first " - " is the title, the rest the author. Junk is stripped first so a
 * site tag glued to either side never pollutes the split.
 */
export function parseFileName(fileName: string): { title: string; author: string } {
  let base = stripDistributionJunk(stripBookExtensions(fileName)).replace(/_+/g, " ");
  // Dots as word separators ("Deep.Learning.with.Python") — only when the
  // name has no real spaces, so "Dr. Strange" keeps its dot.
  if (!/\s/.test(base.trim()) && (base.match(/\./g)?.length ?? 0) >= 2) {
    base = base.replace(/\./g, " ");
  }
  const [rawTitle, ...rawAuthorParts] = base.split(/\s+-\s+/);
  const title = normalizeFileNamePart(rawTitle ?? "") || "Untitled";
  const author = normalizeFileNamePart(rawAuthorParts.join(" - ")) || "Unknown author";
  return { title, author };
}
