/**
 * 书籍正文抽取与持久化（docs/agent-architecture.md §11.5 的产品侧 v2）。
 * 阅读器首次打开时复用已经解析的 foliate book 抽取并持久化到桌面 blob store
 *（`booktext:<id>` 的 JSON 字节，SQLite blob_objects 登记）；若尚未打开，则
 * agent 的 BookTextPort 在首次需要时懒回填。导入本身绝不启动主线程全书解析。
 *
 * 无浏览器持久化 —— agent 只在桌面壳里运行，浏览器构建是纯 UI；非 Tauri 下
 * 读返回 null、写是空操作（抽取仍可跑，只是不落盘，靠端口的会话缓存）。
 */
import { deleteDesktopBlob, getDesktopBlob, putDesktopBlob } from "../../../platform/blob-store";
import { isTauri } from "../../../platform/environment";
import { flattenToc } from "../../reader/lib/epub-utils";
import { makeFoliateBook } from "../../reader/lib/foliate-engine";
import { ensureUsableToc } from "../../reader/lib/toc-synthesis";
import type { TocNavItem } from "../../reader/lib/reader-types";
import { getStoredBookFile } from "./library-db";

export interface ExtractedChapter {
  title?: string;
  text: string;
  /**
   * 本章覆盖的 hrefs：归属 TOC 条目的 href + 各 spine section 的 id。
   * 阅读位置 / 选区的 chapter href 靠它反查到章节索引。
   */
  hrefs?: string[];
}

/** 持久化格式带版本号。PDF 复用 v2 结构；旧实现不会写入空的 PDF 记录。
 *  v3：抽取前先 ensureUsableToc 修复残缺目录 —— 结构未变，但残缺 nav 的书
 *  此前被合并成一整章，需要按修复后的目录重抽。 */
const FORMAT_VERSION = 3;

interface PersistedBookText {
  bookId: string;
  version: number;
  extractedAt: string;
  chapters: ExtractedChapter[];
}

const blobKey = (bookId: string) => `booktext:${bookId}`;

async function readPersisted(bookId: string): Promise<PersistedBookText | null> {
  if (!isTauri()) return null;
  const bytes = await getDesktopBlob(blobKey(bookId));
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as PersistedBookText;
  } catch {
    return null;
  }
}

async function writePersisted(record: PersistedBookText): Promise<void> {
  if (!isTauri()) return;
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  await putDesktopBlob(blobKey(record.bookId), bytes, "application/json");
}

/** 删书时清理对应的正文 blob。 */
export async function deleteBookText(bookIds: string[]): Promise<void> {
  if (!isTauri()) return;
  for (const bookId of bookIds) {
    await deleteDesktopBlob(blobKey(bookId));
  }
}

// ── 抽取 ──

type FoliateSectionLike = {
  id?: string | number;
  createDocument?: () => Promise<Document> | Document;
  getText?: () => Promise<string> | string;
  linear?: string;
};

type FoliateResolvedLike = { index?: number } | null | undefined;

type FoliateBookLike = {
  toc?: unknown;
  sections?: FoliateSectionLike[];
  resolveHref?: (href: string) => FoliateResolvedLike | Promise<FoliateResolvedLike>;
};

/** 让出主线程一拍 —— 抽取是导入后的后台活，逐章喘气比冻住 UI 重要。 */
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * 抽取 v2。v1 把拍平的 TOC 标签按序号硬配给留下来的 section（spine 文件数
 * ≠ TOC 条目数,必然错位）。v2 用 book.resolveHref 把每个 TOC 条目（含嵌套
 * 子项）定位到它真正指向的 section,按归属把跨文件的章节合并成一条,并记下
 * 每章覆盖的 hrefs 作为阅读位置的反查键。
 *
 * `preopened`：阅读器已经解析过的 foliate book —— 复用它省掉第二次整书解析
 *（MOBI/AZW3 开卷即全文解压,解析两遍代价加倍）。
 */
async function extract(bookId: string, preopened?: unknown): Promise<ExtractedChapter[]> {
  let book: FoliateBookLike;
  if (preopened) {
    // 阅读器传来的 book 已经过 ensureUsableToc（开卷前修复残缺目录）。
    book = preopened as FoliateBookLike;
  } else {
    const file = await getStoredBookFile(bookId);
    if (!file) return [];
    book = (await makeFoliateBook(file)) as FoliateBookLike;
    // 懒回填路径同样先修目录，否则残缺 nav 会把整本书合并成一章。
    await ensureUsableToc(book);
  }
  const sections = book.sections ?? [];
  const entries = flattenToc((book.toc ?? []) as TocNavItem[]);

  // section → 归属 TOC 条目：条目解析到的 section 先到先得（指进同一文件的
  // 子条目不抢所有权）,没有条目直指的 section 归前一个有主的条目（跨文件章节）。
  const ownerOf: (number | undefined)[] = new Array(sections.length).fill(undefined);
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    try {
      const resolved = await book.resolveHref?.(entries[entryIndex].href);
      const sectionIndex = resolved?.index;
      if (
        typeof sectionIndex === "number" &&
        sectionIndex >= 0 &&
        sectionIndex < sections.length &&
        ownerOf[sectionIndex] === undefined
      ) {
        ownerOf[sectionIndex] = entryIndex;
      }
    } catch {
      // 解析失败的条目不参与归属
    }
  }
  for (let i = 1; i < sections.length; i++) {
    if (ownerOf[i] === undefined) ownerOf[i] = ownerOf[i - 1];
  }

  // 逐 section 抽文本（线性阅读顺序）,再按归属合并。每个 section 一次
  // DOMParser 是纯 CPU 块 —— 章节之间让出主线程,大书抽取不再冻 UI。
  const isPageTextBook = sections.some((section) => typeof section.getText === "function");
  const pieces: {
    owner: number | undefined;
    href?: string;
    sectionIndex: number;
    text: string;
  }[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (
      section.linear === "no" ||
      (typeof section.getText !== "function" && typeof section.createDocument !== "function")
    ) continue;
    await yieldToUi();
    let text = "";
    try {
      if (section.getText) {
        text = (await section.getText()).replace(/\s+/g, " ").trim();
      } else if (section.createDocument) {
        const doc = await section.createDocument();
        text = (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
      }
    } catch {
      // 单个 section 失败不拖垮整本书
    }
    pieces.push({
      owner: ownerOf[i],
      href: section.id == null ? undefined : String(section.id),
      sectionIndex: i,
      text,
    });
  }

  const chapters: ExtractedChapter[] = [];
  let current: {
    owner: number | undefined;
    title?: string;
    hrefs: string[];
    texts: string[];
    firstSection: number;
    lastSection: number;
    textLength: number;
  } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.texts.filter(Boolean).join(" ").trim();
    if (text.length >= 40) {
      const hrefs = [...new Set(current.hrefs)];
      const pageTitle = current.firstSection === current.lastSection
        ? `Page ${current.firstSection + 1}`
        : `Pages ${current.firstSection + 1}-${current.lastSection + 1}`;
      chapters.push({
        title: current.title ?? (isPageTextBook ? pageTitle : undefined),
        text,
        hrefs: hrefs.length ? hrefs : undefined,
      });
    }
    current = null;
  };
  for (const piece of pieces) {
    const sameTocOwner =
      current !== null && piece.owner !== undefined && piece.owner === current.owner;
    const samePdfChunk =
      current !== null &&
      isPageTextBook &&
      piece.owner === undefined &&
      current.owner === undefined &&
      current.texts.length < 8 &&
      current.textLength < 16_000;
    const merges = sameTocOwner || samePdfChunk;
    if (!merges) {
      flush();
      const entry = piece.owner !== undefined ? entries[piece.owner] : undefined;
      current = {
        owner: piece.owner,
        title: entry?.label,
        hrefs: entry?.href ? [entry.href] : [],
        texts: [],
        firstSection: piece.sectionIndex,
        lastSection: piece.sectionIndex,
        textLength: 0,
      };
    }
    if (piece.href) current!.hrefs.push(piece.href);
    current!.texts.push(piece.text);
    current!.lastSection = piece.sectionIndex;
    current!.textLength += piece.text.length;
  }
  flush();
  return chapters;
}

const inflight = new Map<string, Promise<ExtractedChapter[]>>();

/** 只读已持久化的正文；未抽取返回 null（全书架检索用 —— 绝不触发批量抽取）。 */
export async function getPersistedBookText(bookId: string): Promise<ExtractedChapter[] | null> {
  const record = await readPersisted(bookId);
  return record && record.version === FORMAT_VERSION ? record.chapters : null;
}

/**
 * 确保某本书的正文已抽取并持久化：阅读器首开与端口的懒回填共用。
 * 并发去重；抽取失败返回空数组（下次再试）。`preopened` 见 extract。
 */
export async function ensureBookTextExtracted(
  bookId: string,
  preopened?: unknown,
): Promise<ExtractedChapter[]> {
  // Virtual (plugin-provided) books have no blob to extract from.
  {
    const { listLibraryBooks } = await import("./library-db");
    const record = (await listLibraryBooks()).find((b) => b.id === String(bookId));
    if (record?.format === "virtual") return [];
  }

  const persisted = await getPersistedBookText(bookId);
  if (persisted) return persisted;

  let pending = inflight.get(bookId);
  if (!pending) {
    pending = extract(bookId, preopened)
      .then(async (chapters) => {
        if (chapters.length > 0) {
          await writePersisted({
            bookId,
            version: FORMAT_VERSION,
            extractedAt: new Date().toISOString(),
            chapters,
          });
        }
        return chapters;
      })
      .finally(() => inflight.delete(bookId));
    inflight.set(bookId, pending);
  }
  return pending;
}
