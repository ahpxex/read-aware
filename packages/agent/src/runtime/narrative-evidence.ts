import type { Id } from "@read-aware/core";
import type { BookTextPort, TurnAttachment } from "../ports";
import type { ReadingCursor } from "./reading-cursor";

export interface NarrativeBookIndex {
  chapterTexts: string[];
  normalizedChapters: string[];
  tocText: string;
  normalizedToc: string;
}

export interface NarrativeEvidenceInput {
  answer: string;
  readerText: string;
  attachments?: TurnAttachment[];
  cursor?: ReadingCursor;
  toolEvidence?: string[];
  book: NarrativeBookIndex;
  /** A verified grant allows future facts, but never text absent from this edition. */
  allowFuture?: boolean;
}

export interface NarrativeEvidenceViolation {
  kind:
    | "future-quote"
    | "future-phrase"
    | "future-name"
    | "ungrounded-quote"
    | "ungrounded-enumeration"
    | "ungrounded-name";
  phrase: string;
}

interface WordSegment {
  segment: string;
  isWordLike?: boolean;
}

const Segmenter = (
  Intl as unknown as {
    Segmenter: new (
      locale: string,
      options: { granularity: "word" },
    ) => { segment(text: string): Iterable<WordSegment> };
  }
).Segmenter;
const segmenter = new Segmenter("zh", { granularity: "word" });
const QUOTED_SPAN = /[“「『"]([^”」』"\n]{2,80})[”」』"]/gu;
const ATTRIBUTION_CUE = /(?:书中|原文|作者|文中|写道|写着|说过|说道|称为|名言|表述|quote|book|author|writes?|says?)/iu;
const NAME_ACTIONS = "说问答道想看笑摇点走来回叫站坐拿望听";
const ENUMERATION = /([\p{Script=Han}A-Za-z]{2,6})[、/]([\p{Script=Han}A-Za-z]{2,6})([、/]|和|与|及)([\p{Script=Han}A-Za-z]{2,6})/gu;
const ENUMERATION_CUE = /(?:核心|三种|三样|公式|所谓|书中|原文|文中|写|说|是|用|包括|分为|即)/u;
const TRANSLITERATION_CHAR = /[阿埃艾爱安奥巴贝比波布达德迪多俄尔法费夫弗格哈赫胡基加捷杰卡凯柯克库拉莱勒雷里利罗洛马梅米姆穆娜尼诺帕佩皮普奇乔切日萨塞斯塔泰特托瓦维沃乌西希谢亚耶伊扎泽佐露莘乜甫辽]/gu;
const NAME_ENDING = /[夫卡娃娜奇斯尔科基克维丁林拉罗沙]$/u;
const NAME_CONTEXT = /([\p{Script=Han}]{4,40}?)(?=(?:的|说|问|答|道|会|将|曾|上吊|自杀|死|杀|，|。|、|；|：|$))/gu;
const HIGH_RISK_OUTCOME_TERMS = [
  "弑父",
  "杀父",
  "真凶",
  "凶手",
  "自缢",
  "自杀",
  "遇害",
  "被杀",
  "谋杀",
  "叛徒",
] as const;

/** Comparison form only. It never replaces text shown to the reader. */
export function normalizeEvidenceText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}]/gu, "");
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle || needle.length > haystack.length) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, from);
    if (found < 0) break;
    count += 1;
    from = found + Math.max(1, needle.length);
  }
  return count;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasNearEditionPhrase(haystack: string, needle: string, maxDistance: number): boolean {
  if (needle.length < 4 || haystack.length < needle.length) return false;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle[0]!, from);
    if (found < 0 || found + needle.length > haystack.length) return false;
    const candidate = haystack.slice(found, found + needle.length);
    if (
      candidate[candidate.length - 1] === needle[needle.length - 1] &&
      candidate !== needle
    ) {
      let distance = 0;
      for (let index = 0; index < needle.length; index += 1) {
        if (candidate[index] !== needle[index]) distance += 1;
        if (distance > maxDistance) break;
      }
      if (distance > 0 && distance <= maxDistance) return true;
    }
    from = found + 1;
  }
  return false;
}

function enumerationCandidates(answer: string): Array<{ phrase: string; normalized: string }> {
  const candidates: Array<{ phrase: string; normalized: string }> = [];
  for (const match of answer.matchAll(ENUMERATION)) {
    const [phrase, first = "", middle = "", connector = "", last = ""] = match;
    const nearby = answer.slice(Math.max(0, (match.index ?? 0) - 40), (match.index ?? 0) + phrase.length + 20);
    if (!ENUMERATION_CUE.test(nearby)) continue;
    for (let firstLength = 2; firstLength <= first.length; firstLength += 1) {
      for (let lastLength = 2; lastLength <= last.length; lastLength += 1) {
        const firstItem = first.slice(-firstLength);
        const lastItem = last.slice(0, lastLength);
        const display = `${firstItem}、${middle}${connector}${lastItem}`;
        candidates.push({ phrase: display, normalized: normalizeEvidenceText(display) });
      }
    }
  }
  return candidates;
}

function possibleTransliteratedNames(answer: string): string[] {
  const candidates = new Set<string>();
  for (const match of answer.matchAll(NAME_CONTEXT)) {
    const run = match[1] ?? "";
    for (let length = 4; length <= Math.min(8, run.length); length += 1) {
      const candidate = run.slice(-length);
      const transliterated = candidate.match(TRANSLITERATION_CHAR)?.length ?? 0;
      if (transliterated >= 2 && NAME_ENDING.test(candidate)) candidates.add(candidate);
    }
  }
  return [...candidates];
}

function wordRuns(text: string): string[][] {
  return text
    .split(/[\n。！？!?；;：:,，、（）()【】\[\]]+/u)
    .map((part) =>
      [...segmenter.segment(part)]
        .filter((segment) => segment.isWordLike)
        .map((segment) => segment.segment),
    )
    .filter((run) => run.length > 0);
}

function phraseCandidates(text: string): Array<{ phrase: string; tokenCount: number }> {
  const candidates = new Map<string, { phrase: string; tokenCount: number }>();
  for (const words of wordRuns(text)) {
    for (let start = 0; start < words.length; start += 1) {
      for (let length = 1; length <= 5 && start + length <= words.length; length += 1) {
        const phrase = words.slice(start, start + length).join("");
        const normalized = normalizeEvidenceText(phrase);
        if (normalized.length < 4 || normalized.length > 24) continue;
        if (length === 1 && !(/[\p{Script=Han}]/u.test(phrase) || normalized.length >= 8)) {
          continue;
        }
        candidates.set(normalized, { phrase, tokenCount: length });
      }
    }
  }
  return [...candidates.values()];
}

function quotedSpans(text: string): Array<{ phrase: string; index: number }> {
  return [...text.matchAll(QUOTED_SPAN)]
    .map((match) => ({ phrase: match[1]?.trim() ?? "", index: match.index ?? 0 }))
    .filter(({ phrase }) => normalizeEvidenceText(phrase).length >= 4);
}

function readerKnownText(input: NarrativeEvidenceInput): string {
  return [
    input.readerText,
    input.cursor?.visibleText,
    ...(input.attachments?.map((attachment) => attachment.text) ?? []),
    ...(input.toolEvidence ?? []),
  ]
    .filter(Boolean)
    .join("\n");
}

function safeChapterCeiling(cursor?: ReadingCursor): number {
  if (cursor?.chapterIndex === undefined) return -1;
  return cursor.visibleText?.trim() ? cursor.chapterIndex - 1 : cursor.chapterIndex;
}

/**
 * Load once per thread. The index stays host-side: unread prose is used only
 * as a negative evidence boundary and is never inserted into the model prompt.
 */
export async function loadNarrativeBookIndex(
  bookText: BookTextPort,
  bookId: Id,
): Promise<NarrativeBookIndex> {
  const toc = await bookText.getToc(bookId);
  const chapterTexts = await Promise.all(
    toc.map((chapter) => bookText.getChapterText(bookId, chapter.index).then((text) => text ?? "")),
  );
  const tocText = toc.map((chapter) => chapter.title ?? "").join("\n");
  return {
    chapterTexts,
    normalizedChapters: chapterTexts.map(normalizeEvidenceText),
    tocText,
    normalizedToc: normalizeEvidenceText(tocText),
  };
}

/**
 * Detect distinctive answer material that exists only beyond the reader's
 * boundary. This is intentionally conservative: ordinary language is allowed;
 * exact quotes, recurring phrases, and likely proper names carry the signal.
 */
export function inspectNarrativeEvidence(
  input: NarrativeEvidenceInput,
): NarrativeEvidenceViolation[] {
  const ceiling = safeChapterCeiling(input.cursor);
  const safeChapters = input.book.normalizedChapters.slice(0, ceiling + 1).join("");
  const unreadChapters = input.book.normalizedChapters.slice(ceiling + 1).join("");
  const fullBook = `${safeChapters}${unreadChapters}`;
  const known = normalizeEvidenceText(readerKnownText(input));
  const allowed = `${safeChapters}${known}${input.book.normalizedToc}`;
  const violations = new Map<string, NarrativeEvidenceViolation>();
  const strictPhraseScan =
    /(?:进度|读到哪|读了多少|还剩|剩多少|目录|第[一二三四五六七八九十百0-9]+部|一共[一二三四五六七八九十百0-9]+部)/u.test(
      input.readerText,
    ) ||
    /(?:不剧透|不提前|先不说|先不展开|不能告诉|还没读到|没读到|等你读到|留到后面)/u.test(
      input.answer,
    );

  const allowedPhrase = (normalized: string) =>
    allowed.includes(normalized) || input.book.normalizedToc.includes(normalized);

  for (const candidate of enumerationCandidates(input.answer)) {
    if (allowedPhrase(candidate.normalized) || fullBook.includes(candidate.normalized)) continue;
    if (hasNearEditionPhrase(fullBook, candidate.normalized, 2)) {
      violations.set(candidate.normalized, {
        kind: "ungrounded-enumeration",
        phrase: candidate.phrase,
      });
      break;
    }
  }

  for (const phrase of possibleTransliteratedNames(input.answer)) {
    const normalized = normalizeEvidenceText(phrase);
    if (allowedPhrase(normalized) || fullBook.includes(normalized)) continue;
    if (hasNearEditionPhrase(fullBook, normalized, 2)) {
      violations.set(normalized, { kind: "ungrounded-name", phrase });
    }
  }

  if (!input.allowFuture) {
    for (const phrase of HIGH_RISK_OUTCOME_TERMS) {
      const normalized = normalizeEvidenceText(phrase);
      if (
        input.answer.includes(phrase) &&
        !allowedPhrase(normalized) &&
        unreadChapters.includes(normalized)
      ) {
        violations.set(normalized, { kind: "future-phrase", phrase });
      }
    }
  }

  for (const { phrase, index } of quotedSpans(input.answer)) {
    const normalized = normalizeEvidenceText(phrase);
    if (allowedPhrase(normalized)) continue;
    const nearby = input.answer.slice(Math.max(0, index - 36), index + phrase.length + 40);
    const futureCount = countOccurrences(unreadChapters, normalized);
    if (
      !input.allowFuture &&
      futureCount > 0 &&
      (futureCount >= 2 || normalized.length >= 8 || ATTRIBUTION_CUE.test(nearby))
    ) {
      violations.set(normalized, { kind: "future-quote", phrase });
      continue;
    }
    if (!fullBook.includes(normalized) && ATTRIBUTION_CUE.test(nearby)) {
      violations.set(normalized, { kind: "ungrounded-quote", phrase });
    }
  }

  for (const { phrase, tokenCount } of phraseCandidates(input.answer)) {
    if (input.allowFuture || !strictPhraseScan) continue;
    const normalized = normalizeEvidenceText(phrase);
    if (allowedPhrase(normalized)) continue;
    const futureCount = countOccurrences(unreadChapters, normalized);
    // Recurrence is the distinction between a book-specific formula/name and
    // ordinary prose that happens to recur later. Multi-word paraphrases need
    // substantially stronger evidence than a single lexicalized term.
    const requiredCount =
      tokenCount > 1 ? 8 : normalized.length <= 4 ? 5 : 3;
    if (futureCount < requiredCount) continue;
    violations.set(normalized, { kind: "future-phrase", phrase });
  }

  for (const words of wordRuns(input.answer)) {
    if (input.allowFuture) break;
    for (const word of words) {
      const normalized = normalizeEvidenceText(word);
      if (!/^[\p{Script=Han}]{2,3}$/u.test(normalized) || allowedPhrase(normalized)) continue;
      const futureCount = countOccurrences(unreadChapters, normalized);
      if (futureCount < 4) continue;
      const actionPattern = new RegExp(`${escapeRegExp(word)}[${NAME_ACTIONS}]`, "gu");
      if ((unreadChapters.match(actionPattern) ?? []).length < 2) continue;
      const answerNameContext = new RegExp(
        `${escapeRegExp(word)}(?:会|将|曾|说|问|答|道|想|看|笑|摇|点|走|来|是|在|与|和|、)`,
        "u",
      );
      if (!answerNameContext.test(input.answer)) continue;
      violations.set(normalized, { kind: "future-name", phrase: word });
    }
  }

  return [...violations.values()];
}
