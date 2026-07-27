/**
 * Chapter segmentation for plain-text books.
 *
 * A `.txt` book has no structure at all — no spine, no nav, not even a
 * paragraph model. Everything the reader needs downstream (a table of
 * contents, chapter-scoped retrieval, bounded section documents) has to be
 * recovered from the prose itself. Headings are matched conservatively: a
 * heading is a SHORT line that opens with a chapter marker, so a sentence that
 * merely mentions "第三章" mid-paragraph is not mistaken for one.
 *
 * When no heading pattern holds (a single essay, a scraped article), the text
 * is cut into bounded chunks on paragraph boundaries instead — sections must
 * stay bounded because foliate paginates one whole section at a time.
 */

export type TextChapter = { title?: string; lines: string[] };

/** Below this many detected headings, the file is treated as unstructured. */
const MIN_HEADINGS = 3;
/** A heading is a short line; prose lines are longer. */
const MAX_HEADING_CHARS = 48;
/** Target characters per synthesized chunk when there are no headings. */
const CHUNK_CHARS = 60_000;

const HEADING_PATTERNS = [
  // 第一章 / 第 12 节 / 第三十回 / 第二卷, optionally followed by a title.
  /^第\s*[0-9零〇一二三四五六七八九十百千两 ]+\s*[章節节回卷篇部集话話]([\s　].*)?$/,
  // Chapter 1 / Part IV / Book Two / Act 3
  /^(chapter|part|book|act|section)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b.*$/i,
  // Standalone front/back matter markers.
  /^(序|序章|自序|前言|引子|楔子|后记|後記|尾声|尾聲|附录|附錄|番外|终章|終章)$/,
  /^(preface|prologue|epilogue|foreword|afterword|introduction|appendix)\b.*$/i,
  // A bare number on its own line, as used by many scraped serials.
  /^[0-9]{1,4}[.、]?$/,
];

function isHeading(line: string): boolean {
  const trimmed = line.trim().replace(/^[\s　]+/, "");
  if (!trimmed || trimmed.length > MAX_HEADING_CHARS) return false;
  return HEADING_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Split decoded text into chapters, by headings when the book has them. */
export function splitTextIntoChapters(text: string): TextChapter[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const headingIndexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isHeading(lines[i]!)) headingIndexes.push(i);
  }

  if (headingIndexes.length < MIN_HEADINGS) return chunkLines(lines);

  const chapters: TextChapter[] = [];
  const preface = lines.slice(0, headingIndexes[0]!);
  if (preface.some((line) => line.trim())) chapters.push({ lines: preface });

  for (let i = 0; i < headingIndexes.length; i++) {
    const start = headingIndexes[i]!;
    const end = i + 1 < headingIndexes.length ? headingIndexes[i + 1]! : lines.length;
    chapters.push({
      title: lines[start]!.trim().replace(/^[\s　]+/, ""),
      lines: lines.slice(start + 1, end),
    });
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
