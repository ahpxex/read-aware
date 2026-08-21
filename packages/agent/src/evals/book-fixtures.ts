/**
 * 真书 fixture 层：eval 场景在合成小书之外挂载真实 EPUB 全文。
 * 多书注册表——每本真书一个 spec（叙事性、正文起始章、展示书名），
 * 帮助函数全部按书实例化；与 repl 共用 loadEpubFixture，进程内缓存一次抽取。
 * 场景应搭配 defineAgentEvalScenario 的 seedSummary —— 几十万字的正文
 * 绝不能被 scenarioInput 原样序列化进每条 run 记录。
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Id } from "@read-aware/core";
import type { ChapterDigest } from "../ports";
import { loadEpubFixture, type EpubFixture } from "../testing/epub-fixture";
import type { InMemorySeed } from "../testing/fixtures";
import type { JsonValue } from "./types";

export interface RealBookSpec {
  /** fixtures/<slug>.epub 与 fixtures/<slug>-digests.json 的文件名词干。 */
  slug: string;
  narrativity: "narrative" | "expository";
  /**
   * 正文第一章 index：之前的辅文（版权/目录/序言/人物表）不进纪要注入——
   * 目录与人物表携带前瞻信息，纪要层面把它们当噪音剔除。
   */
  firstContentChapter: number;
  /** 展示书名；缺省从 EPUB 元数据书名派生（去营销长尾）。 */
  title?: string;
}

/** 注册表：每本入库真书一条。digests fixture 由 eval:digests 脚本生成。 */
const REAL_BOOKS = {
  karamazov: {
    slug: "karamazov",
    narrativity: "narrative",
    // 0-4 是版权/作者的话/辅文/人物表/目录。
    firstContentChapter: 5,
  },
  lebon: {
    slug: "lebon",
    narrativity: "expository",
    // 0-3 是目录/译者序/两版序言；引言起才是勒庞自己的论证。
    firstContentChapter: 4,
    title: "乌合之众",
  },
  santi: {
    slug: "santi",
    narrativity: "narrative",
    // 0-3 是目录/获奖感言/卷扉页；第一章起为正文。
    firstContentChapter: 4,
    title: "三体全集",
  },
  refactoring: {
    slug: "refactoring",
    narrativity: "expository",
    // 0-5 是电子书说明/环衬/版权/目录/初版序；Preface 起是 Fowler 本人的实文。
    // fixture 已剥离全部插图（原 36MB → 文本骨架），正文一字未动。
    firstContentChapter: 6,
  },
  berger: {
    slug: "berger",
    narrativity: "expository",
    // 0-2 是版权/推荐序/自测页；前言起是作者正文。
    firstContentChapter: 3,
    title: "如何用提问解决问题",
  },
} as const satisfies Record<string, RealBookSpec>;

export type RealBookSlug = keyof typeof REAL_BOOKS;

export interface RealBookFixture {
  bookId: Id;
  spec: RealBookSpec;
  epub(): EpubFixture;
  title(): string;
  /** digests fixture 是否已生成（新书先入 EPUB、后补纪要是合法中间态）。 */
  hasDigests(): boolean;
  /**
   * 生产态的图切片：真实管线对全书跑出的章节纪要（一次生成、入库为
   * fixture，永远确定），按读者进度截取。正文里读者读到哪、图就长到哪，
   * 与空闲管线在产品里的行为同形。
   */
  digestsSeed(throughChapterIndex: number): Record<string, ChapterDigest[]>;
  seed(progressPercent: number, status?: "reading" | "finished"): InMemorySeed;
  /** run 工件里代替全书正文的种子摘要。 */
  seedSummary(progressPercent: number): JsonValue;
  /** 章节标题去掉前导中文序号（"四 老三阿辽沙" → "老三阿辽沙"），做断言关键词用。 */
  chapterTitleKey(chapterIndex: number): string;
  /** 从章节正文取一句 20–80 字的完整句（与书文本逐字一致，可被全文检索命中）。 */
  pickSentence(chapterIndex: number): string;
  /** 章节正文开头一段，作 cursor 的 visibleText。 */
  chapterViewport(chapterIndex: number, chars?: number): string;
}

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url));
}

/** Calibre 类元数据书名的营销长尾：截到第一个全角括号/冒号团之前。 */
function trimMarketingTitle(raw: string): string {
  return raw.split(/[【（(]/)[0]!.trim() || raw.trim();
}

const epubCache = new Map<string, EpubFixture>();
const digestsCache = new Map<string, ChapterDigest[]>();
const fixtureCache = new Map<string, RealBookFixture>();

function createRealBook(spec: RealBookSpec): RealBookFixture {
  const bookId = `eval-${spec.slug}` as Id;
  const epub = (): EpubFixture => {
    let cached = epubCache.get(spec.slug);
    if (!cached) {
      cached = loadEpubFixture(fixturePath(`${spec.slug}.epub`));
      epubCache.set(spec.slug, cached);
    }
    return cached;
  };
  const digestsFile = fixturePath(`${spec.slug}-digests.json`);
  const digests = (): ChapterDigest[] => {
    let cached = digestsCache.get(spec.slug);
    if (!cached) {
      cached = JSON.parse(readFileSync(digestsFile, "utf8")) as ChapterDigest[];
      digestsCache.set(spec.slug, cached);
    }
    return cached;
  };
  const title = (): string => spec.title ?? trimMarketingTitle(epub().title);

  return {
    bookId,
    spec,
    epub,
    title,
    hasDigests: () => existsSync(digestsFile),
    digestsSeed: (throughChapterIndex) => ({
      [bookId]: digests().filter(
        (digest) =>
          digest.chapterIndex >= spec.firstContentChapter &&
          digest.chapterIndex < throughChapterIndex,
      ),
    }),
    seed: (progressPercent, status = "reading") => ({
      books: [
        {
          id: bookId,
          title: title(),
          author: epub().author,
          progressPercent,
          status,
          narrativity: spec.narrativity,
        },
      ],
      chapters: { [bookId]: epub().chapters },
    }),
    seedSummary: (progressPercent) => ({
      fixture: `fixtures/${spec.slug}.epub`,
      book: title(),
      chapters: epub().chapters.length,
      totalChars: epub().chapters.reduce((total, chapter) => total + chapter.text.length, 0),
      progressPercent,
    }),
    chapterTitleKey: (chapterIndex) => {
      const chapterTitle = epub().chapters[chapterIndex]?.title ?? "";
      // 剥中文序号（"四 老三阿辽沙"）与英文 "Chapter N" 前缀——断言关键词
      // 只留题名本体，模型换一种编号说法（第四章/Chapter 4/#4）不该判错。
      return chapterTitle
        .replace(/^[第一二三四五六七八九十百零〇\s]+[章节部卷]?\s*/, "")
        .replace(/^Chapter\s+\d+\s*/i, "")
        .trim();
    },
    pickSentence: (chapterIndex) => {
      const chapter = epub().chapters[chapterIndex];
      if (!chapter) throw new Error(`${spec.slug} fixture has no chapter ${chapterIndex}`);
      // 正文以"章题\n\n"开头——先剥掉，且句子内不得含换行，否则断言片段永远匹配不上散文
      const body = chapter.text.replace(/^[^\n]*\n+/, "");
      // 文种感知取句：CJK 书按句号类断句（20–80 字），拉丁文书按 ". " 断句
      // （60–180 字符，且句首大写——避开缩写误断的碎片）。
      const cjkRatio =
        (body.slice(0, 2000).match(/[一-鿿]/g)?.length ?? 0) / Math.min(body.length, 2000);
      const sentence =
        cjkRatio > 0.2
          ? body
              .split(/(?<=[。！？])/)
              .map((part) => part.trim())
              .find((part) => part.length >= 20 && part.length <= 80 && !part.includes("\n"))
          : body
              .split(/(?<=[.!?])\s+/)
              .map((part) => part.trim())
              .find(
                (part) =>
                  part.length >= 60 &&
                  part.length <= 180 &&
                  !part.includes("\n") &&
                  /^[A-Z“"]/.test(part),
              );
      return sentence ?? body.slice(0, 60).replace(/\n+/g, "");
    },
    chapterViewport: (chapterIndex, chars = 320) => {
      const chapter = epub().chapters[chapterIndex];
      if (!chapter) throw new Error(`${spec.slug} fixture has no chapter ${chapterIndex}`);
      return chapter.text.slice(0, chars);
    },
  };
}

export function realBook(slug: RealBookSlug): RealBookFixture {
  let fixture = fixtureCache.get(slug);
  if (!fixture) {
    fixture = createRealBook(REAL_BOOKS[slug]);
    fixtureCache.set(slug, fixture);
  }
  return fixture;
}

export function realBookSlugs(): RealBookSlug[] {
  return Object.keys(REAL_BOOKS) as RealBookSlug[];
}
