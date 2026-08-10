/**
 * 真书 fixture 层：eval 场景在合成小书之外挂载真实 EPUB 全文。
 * 与 repl 共用 loadEpubFixture；进程内缓存一次抽取。
 * 场景应搭配 defineAgentEvalScenario 的 seedSummary —— 69 万字的正文
 * 绝不能被 scenarioInput 原样序列化进每条 run 记录。
 */
import { fileURLToPath } from "node:url";
import type { Id } from "@read-aware/core";
import { loadEpubFixture, type EpubFixture } from "../testing/epub-fixture";
import type { InMemorySeed } from "../testing/fixtures";
import type { JsonValue } from "./types";

export const KARAMAZOV_BOOK_ID = "eval-karamazov" as Id;

const EPUB_PATH = fileURLToPath(new URL("../../fixtures/karamazov.epub", import.meta.url));

let cached: EpubFixture | undefined;

export function karamazovEpub(): EpubFixture {
  cached ??= loadEpubFixture(EPUB_PATH);
  return cached;
}

/** Calibre 元数据书名带营销长尾，截到第一个全角括号前（与 repl 同规则）。 */
export function karamazovTitle(): string {
  return karamazovEpub().title.split("【")[0]!.trim();
}

export function karamazovSeed(progressPercent: number): InMemorySeed {
  const epub = karamazovEpub();
  return {
    books: [
      {
        id: KARAMAZOV_BOOK_ID,
        title: karamazovTitle(),
        author: epub.author,
        progressPercent,
        status: "reading",
      },
    ],
    chapters: { [KARAMAZOV_BOOK_ID]: epub.chapters },
  };
}

/** run 工件里代替全书正文的种子摘要。 */
export function karamazovSeedSummary(progressPercent: number): JsonValue {
  const epub = karamazovEpub();
  return {
    fixture: "fixtures/karamazov.epub",
    book: karamazovTitle(),
    chapters: epub.chapters.length,
    totalChars: epub.chapters.reduce((total, chapter) => total + chapter.text.length, 0),
    progressPercent,
  };
}

/** 章节标题去掉前导中文序号（"四 老三阿辽沙" → "老三阿辽沙"），做断言关键词用。 */
export function chapterTitleKey(chapterIndex: number): string {
  const title = karamazovEpub().chapters[chapterIndex]?.title ?? "";
  return title.replace(/^[一二三四五六七八九十百零〇\s]+/, "").trim();
}

/** 从章节正文取一句 20–80 字的完整句（与书文本逐字一致，可被全文检索命中）。 */
export function pickSentence(chapterIndex: number): string {
  const chapter = karamazovEpub().chapters[chapterIndex];
  if (!chapter) throw new Error(`karamazov fixture has no chapter ${chapterIndex}`);
  // 正文以"章题\n\n"开头——先剥掉，且句子内不得含换行，否则断言片段永远匹配不上散文
  const body = chapter.text.replace(/^[^\n]*\n+/, "");
  const sentence = body
    .split(/(?<=[。！？])/)
    .map((part) => part.trim())
    .find((part) => part.length >= 20 && part.length <= 80 && !part.includes("\n"));
  return sentence ?? body.slice(0, 60).replace(/\n+/g, "");
}

/** 章节正文开头一段，作 cursor 的 visibleText。 */
export function chapterViewport(chapterIndex: number, chars = 320): string {
  const chapter = karamazovEpub().chapters[chapterIndex];
  if (!chapter) throw new Error(`karamazov fixture has no chapter ${chapterIndex}`);
  return chapter.text.slice(0, chars);
}
