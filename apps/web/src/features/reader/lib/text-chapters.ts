/**
 * Chapter segmentation for plain-text books.
 *
 * A `.txt` book has no structure at all — no spine, no nav, not even a
 * paragraph model. Everything the reader needs downstream (a table of
 * contents, chapter-scoped retrieval, bounded section documents) has to be
 * recovered from the prose itself.
 *
 * Two kinds of heading are recognized. A *marked* heading names itself —
 * `第三章`, `Chapter 7`, `楔子` — and is trusted on sight, as long as it sits on
 * a short line of its own. A *numbered* heading is just a number (`01`,
 * `17、初遇`), which is far weaker evidence: a numbered list inside the prose
 * looks identical. Those are accepted only when the numbers across the whole
 * file read like chapter numbering — strictly increasing, starting near one.
 *
 * When no heading pattern holds (a single essay, a scraped article), the text
 * is cut into bounded chunks on paragraph boundaries instead: sections must
 * stay bounded because foliate paginates one whole section at a time.
 */

export type TextChapter = { title?: string; lines: string[] };

/** Below this many detected headings, the file is treated as unstructured. */
const MIN_HEADINGS = 3;
/** A heading is a short line; prose lines are longer. */
const MAX_HEADING_CHARS = 48;
/** How much title text may trail a bare number and still read as a heading. */
const MAX_NUMBERED_TITLE_CHARS = 30;
/** Target characters per synthesized chunk when there are no headings. */
const CHUNK_CHARS = 60_000;
/** Length of a label synthesized from a section's opening words. */
const LABEL_MAX_CHARS = 24;

const CJK_DIGITS = "零〇一二三四五六七八九十百千两";
/** Punctuation that may sit between a heading's number and its title. */
const SEPARATORS = String.raw`[\s　:：.。、,，·・\-—–~～]`;

const MARKED_HEADING_PATTERNS = [
  // 第一章 / 第 12 节 / 第三十回 / 第二卷, with or without a trailing title,
  // and with or without punctuation between the two.
  new RegExp(String.raw`^第\s*[0-9${CJK_DIGITS} ]+\s*[章節节回卷篇部集话話講讲折][\s　]*${SEPARATORS}*.*$`),
  // 卷一 / 上卷 / 下篇 — a volume marker that leads with the unit.
  new RegExp(String.raw`^[上中下]?[卷篇部]\s*[0-9${CJK_DIGITS}]+${SEPARATORS}*.*$`),
  // Chapter 1 / Part IV / Book Two / Act 3 / Volume 2
  /^(chapter|part|book|act|section|volume)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b.*$/i,
  // Front and back matter, alone or followed by a title.
  new RegExp(
    String.raw`^(序|序言|序章|自序|代序|小序|前言|引子|引言|导言|導言|楔子|后记|後記|后序|跋|尾声|尾聲|结语|結語|附录|附錄|番外|外传|外傳|终章|終章|全文完|正文)(${SEPARATORS}.*)?$`,
  ),
  /^(preface|prologue|epilogue|foreword|afterword|introduction|appendix|acknowledgements?|acknowledgments?)\b.*$/i,
];

/** `01`, `7.` — a number and nothing else. */
const BARE_NUMBER_HEADING = /^([0-9]{1,4})[.、]?$/;
/**
 * `17、初遇`, `3. The Road` — a number, a separator, a short title. The
 * separator is not optional: without it, `2017年7月北京第2版` reads as chapter
 * two thousand and seventeen, and one such line poisons the numbering check
 * for the whole book.
 */
const NUMBERED_HEADING = new RegExp(
  String.raw`^([0-9]{1,4})\s*${SEPARATORS}\s*(.{1,${MAX_NUMBERED_TITLE_CHARS}})$`,
);
/**
 * `一` alone on its line — how Chinese literary fiction usually numbers its
 * chapters (《围城》 does exactly this).
 */
const CJK_BARE_HEADING = new RegExp(String.raw`^([${CJK_DIGITS}]{1,6})$`);
/**
 * `一、初遇` — with a title, the separator is required. A paragraph opening
 * with 一 ("一个人走进来…") is prose; a line that is *only* the numeral is not.
 */
const CJK_NUMBERED_HEADING = new RegExp(
  String.raw`^([${CJK_DIGITS}]{1,6})\s*[、.。：:,，]\s*(.{0,${MAX_NUMBERED_TITLE_CHARS}})$`,
);

type Candidate = { line: number; title: string; value?: number };

/** Full-width digits and spaces are common in Chinese text dumps. */
function normalizeLine(raw: string): string {
  return raw
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]+/g, " ")
    .trim();
}

const CJK_DIGIT_VALUES: Record<string, number> = {
  零: 0, "〇": 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** Enough of a numeral reader to validate a numbering run: 0 through 99. */
function cjkNumberValue(text: string): number | null {
  if (text.length === 1) {
    if (text === "十") return 10;
    return CJK_DIGIT_VALUES[text] ?? null;
  }
  const match = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(text);
  if (!match) return null;
  const tens = match[1] ? CJK_DIGIT_VALUES[match[1]]! : 1;
  const ones = match[2] ? CJK_DIGIT_VALUES[match[2]]! : 0;
  return tens * 10 + ones;
}

function classify(line: string): Candidate | null {
  const text = normalizeLine(line);
  if (!text || text.length > MAX_HEADING_CHARS) return null;

  if (MARKED_HEADING_PATTERNS.some((pattern) => pattern.test(text))) {
    return { line: -1, title: text };
  }

  const numbered = BARE_NUMBER_HEADING.exec(text) ?? NUMBERED_HEADING.exec(text);
  if (numbered) return { line: -1, title: text, value: Number(numbered[1]) };

  const cjkNumbered = CJK_BARE_HEADING.exec(text) ?? CJK_NUMBERED_HEADING.exec(text);
  if (cjkNumbered) {
    const value = cjkNumberValue(cjkNumbered[1]!);
    if (value != null) return { line: -1, title: text, value };
  }

  return null;
}

/**
 * Do the numbered candidates read like chapter numbering, or like a list that
 * happens to live in the prose? Chapter numbers climb, one at a time, from the
 * start of the book.
 */
function numberingIsCredible(values: number[]): boolean {
  if (values.length < MIN_HEADINGS) return false;
  if (values[0]! > 2) return false;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! <= values[i - 1]!) return false;
  }
  const span = values[values.length - 1]! - values[0]!;
  // Tolerate missing numbers — scanned serials skip some — but not a sparse
  // scattering, which is what a numbered list inside the prose looks like.
  return span <= values.length * 3;
}

/**
 * A `.txt` book very often opens with its own table of contents — a stack of
 * heading-like lines with nothing between them. Taken at face value it becomes
 * a burst of empty one-line "chapters", and it wrecks the numbering check
 * afterwards, because the numbers then run 一…九 twice.
 *
 * Such a stack is recognized by two things together: the entries are packed
 * (no chapter's worth of prose between them), and each one says the same thing
 * as a heading further down the file — a listing entry always has the real
 * heading as its echo. Both conditions are needed. Packed alone would swallow
 * a genuine first chapter that follows the listing immediately; a repeated
 * title alone is just a book with two chapters named 序.
 */
const LISTING_MAX_CONTENT_CHARS = 40;
const LISTING_MIN_RUN = 3;

function dropContentsListing(candidates: Candidate[], lines: string[]): Candidate[] {
  const contentBetween = (from: number, to: number) => {
    let chars = 0;
    for (let i = from + 1; i < to; i++) chars += lines[i]!.trim().length;
    return chars;
  };

  const keep = new Array<boolean>(candidates.length).fill(true);
  let runStart = 0;
  for (let i = 1; i <= candidates.length; i++) {
    const packed =
      i < candidates.length &&
      contentBetween(candidates[i - 1]!.line, candidates[i]!.line) <= LISTING_MAX_CONTENT_CHARS;
    if (packed) continue;
    if (i - runStart >= LISTING_MIN_RUN) {
      for (let j = runStart; j < i; j++) {
        // The echo may be the very next entry: a listing often runs straight
        // into the heading it points at, with no prose in between.
        const echoed = candidates
          .slice(j + 1)
          .some((candidate) => candidate.title === candidates[j]!.title);
        if (echoed) keep[j] = false;
      }
    }
    runStart = i;
  }

  const kept = candidates.filter((_, index) => keep[index]);
  // Never let the heuristic strip a book down to nothing.
  return kept.length >= MIN_HEADINGS ? kept : candidates;
}

/** Split decoded text into chapters, by headings when the book has them. */
export function splitTextIntoChapters(text: string): TextChapter[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  const found: Candidate[] = [];
  for (let i = 0; i < lines.length; i++) {
    const candidate = classify(lines[i]!);
    if (candidate) found.push({ ...candidate, line: i });
  }
  const candidates = dropContentsListing(found, lines);

  const numbered = candidates.filter((candidate) => candidate.value != null);
  const accepted = numberingIsCredible(numbered.map((candidate) => candidate.value!))
    ? candidates
    : candidates.filter((candidate) => candidate.value == null);

  if (accepted.length < MIN_HEADINGS) return chunkLines(lines);

  const chapters: TextChapter[] = [];
  const preface = lines.slice(0, accepted[0]!.line);
  if (preface.some((line) => line.trim())) chapters.push({ lines: preface });

  for (let i = 0; i < accepted.length; i++) {
    const start = accepted[i]!.line;
    const end = i + 1 < accepted.length ? accepted[i + 1]!.line : lines.length;
    chapters.push({ title: accepted[i]!.title, lines: lines.slice(start + 1, end) });
  }
  return chapters;
}

/** Bounded chunks on paragraph boundaries, for text with no headings. */
function chunkLines(lines: string[]): TextChapter[] {
  const chapters: TextChapter[] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of lines) {
    current.push(line);
    size += line.length + 1;
    // Break only at a blank line so a chunk never splits a paragraph.
    if (size >= CHUNK_CHARS && !line.trim()) {
      chapters.push({ lines: current });
      current = [];
      size = 0;
    }
  }
  if (current.some((line) => line.trim()) || chapters.length === 0) {
    chapters.push({ lines: current });
  }
  return chapters;
}

/** Group a chapter's lines into paragraphs, dropping blank runs. */
export function linesToParagraphs(lines: string[]): string[] {
  const paragraphs: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) paragraphs.push(trimmed);
  }
  return paragraphs;
}

/**
 * A label for a section the text never titled — the leading run before the
 * first heading, or a synthesized chunk. Uses its opening words, the way the
 * TOC repair does for books with a deficient nav.
 */
export function labelFromOpeningWords(lines: string[]): string | undefined {
  const first = lines.map((line) => line.trim()).find(Boolean);
  if (!first) return undefined;
  const opening = normalizeLine(first);
  return opening.length > LABEL_MAX_CHARS
    ? `${opening.slice(0, LABEL_MAX_CHARS).trimEnd()}…`
    : opening;
}
