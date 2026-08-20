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
import { parseBookFile } from "../../reader/lib/parse-book";
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
 *  此前被合并成一整章，需要按修复后的目录重抽。
 *  v4：结构性增量（v3 记录原样可读，视同 complete）——
 *    - `complete`：终局标记。true + chapters 为空 = "全书没有可抽取的
 *      文字层"的定论（纯图扫描版），从此不再反复重抽；
 *    - `checkpoint`：长书（扫描 PDF 逐页抽取以分钟计）的断点——每隔
 *      一批 section 落一次已抽原料，中断后下次续跑而不是从头再来。 */
const FORMAT_VERSION = 4;

/** checkpoint 里的一条 section 原料（合并成章之前的形态）。 */
interface PieceRecord {
  sectionIndex: number;
  href?: string;
  text: string;
}

interface PersistedBookText {
  bookId: string;
  version: number;
  extractedAt: string;
  chapters: ExtractedChapter[];
  /** v4：true = 抽取完整跑完（chapters 为空即无文字层的定论）。v3 记录视同 true。 */
  complete?: boolean;
  /** v4：未跑完时的断点（已抽 section 原料 + 续跑点）；complete 后清除。 */
  checkpoint?: { nextSection: number; pieces: PieceRecord[] };
}

/** 正文可用性（agent 工具据此把"扫描版没字"与"还没抽"说成两回事）。 */
export type BookTextStatus = "ok" | "unextracted" | "textless";

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

/**
 * 让出主线程一拍 —— 抽取是后台活，逐章喘气比冻住 UI 重要。
 * 不能用 setTimeout(0)：WKWebView 对失焦/被遮挡窗口把 timer 节流到 ~1s，
 * 一次三千页的抽取会从分钟级被拖成小时级（实测 1 页/秒）。MessageChannel
 * 的任务调度不受 timer 节流，同样把控制权还给事件循环。
 */
const yieldToUi = (() => {
  if (typeof MessageChannel === "undefined") {
    return () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const channel = new MessageChannel();
  const waiters: Array<() => void> = [];
  channel.port1.onmessage = () => waiters.shift()?.();
  return () =>
    new Promise<void>((resolve) => {
      waiters.push(resolve);
      channel.port2.postMessage(null);
    });
})();

/** 断点落盘节流：每抽完这么多 section 存一次 checkpoint（只对长书生效）。 */
const CHECKPOINT_EVERY_SECTIONS = 25;
/** 短书不值得断点开销——低于该 section 数一口气抽完。 */
const CHECKPOINT_MIN_SECTIONS = 60;

interface ExtractOutcome {
  chapters: ExtractedChapter[];
  /** 抽取中被吞掉的 section 失败数——空结果 + 有失败 ≠ 无文字层。 */
  sectionsFailed: number;
}

/**
 * 抽取 v2。v1 把拍平的 TOC 标签按序号硬配给留下来的 section（spine 文件数
 * ≠ TOC 条目数,必然错位）。v2 用 book.resolveHref 把每个 TOC 条目（含嵌套
 * 子项）定位到它真正指向的 section,按归属把跨文件的章节合并成一条,并记下
 * 每章覆盖的 hrefs 作为阅读位置的反查键。
 *
 * `preopened`：阅读器已经解析过的 foliate book —— 复用它省掉第二次整书解析
 *（MOBI/AZW3 开卷即全文解压,解析两遍代价加倍）。
 *
 * 长书（扫描 PDF 逐页 streamTextContent 以分钟计）每批 section 落一次
 * checkpoint：中断（关书、退出、崩溃）后下次从断点续抽，工作量只会累积
 * 不会白费。失败的 section 计数上报——调用方据此区分"抽完了确实没字"
 * （纯图扫描版的定论）与"这次没抽全"（下次重试）。
 */
async function extract(bookId: string, preopened?: unknown): Promise<ExtractOutcome> {
  let book: FoliateBookLike;
  if (preopened) {
    // 阅读器传来的 book 已经过 ensureUsableToc（开卷前修复残缺目录）。
    book = preopened as FoliateBookLike;
  } else {
    const file = await getStoredBookFile(bookId);
    if (!file) return { chapters: [], sectionsFailed: 0 };
    book = (await parseBookFile(file)) as FoliateBookLike;
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

  // 断点续抽：上次没跑完的原料直接采信（同一本书、同一格式版本），
  // 从记录的续跑点接着抽。
  const useCheckpoints = sections.length >= CHECKPOINT_MIN_SECTIONS;
  let resumed: PieceRecord[] = [];
  let startSection = 0;
  if (useCheckpoints) {
    const prior = await readPersisted(bookId);
    if (prior?.version === FORMAT_VERSION && !prior.complete && prior.checkpoint) {
      resumed = prior.checkpoint.pieces;
      startSection = prior.checkpoint.nextSection;
    }
  }

  // 逐 section 抽文本（线性阅读顺序）,再按归属合并。每个 section 一次
  // DOMParser 是纯 CPU 块 —— 章节之间让出主线程,大书抽取不再冻 UI。
  const isPageTextBook = sections.some((section) => typeof section.getText === "function");
  const rawPieces: PieceRecord[] = [...resumed];
  let sectionsFailed = 0;
  let consecutiveFailures = 0;
  let sinceCheckpoint = 0;
  for (let i = startSection; i < sections.length; i++) {
    const section = sections[i];
    if (
      section.linear === "no" ||
      (typeof section.getText !== "function" && typeof section.createDocument !== "function")
    ) continue;
    await yieldToUi();
    let text = "";
    let failed = false;
    try {
      if (section.getText) {
        text = (await section.getText()).replace(/\s+/g, " ").trim();
      } else if (section.createDocument) {
        const doc = await section.createDocument();
        text = (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
      }
    } catch {
      // 单个 section 失败不拖垮整本书——但必须记账：空结果 + 有失败
      // 绝不能被误判成"这本书没有文字层"。孤立失败按"该页确实取不出字"
      // 记录后继续；连续失败是基础设施死了（关书销毁了 PDF 代理、blob
      // 流断了），继续迭代只会把剩下几百页全爬成空——立即中止，断点
      // 停在最后一段好进度上，下次续跑。
      failed = true;
      sectionsFailed += 1;
      consecutiveFailures += 1;
      if (consecutiveFailures >= 5) {
        return { chapters: [], sectionsFailed };
      }
    }
    if (!failed) consecutiveFailures = 0;
    rawPieces.push({
      href: section.id == null ? undefined : String(section.id),
      sectionIndex: i,
      text,
    });
    sinceCheckpoint += 1;
    // 间隔随已抽规模自适应（≥25，约每 5% 一次）：checkpoint 每次全量重写
    // 原料，固定间隔对三千页的书是 O(n²) 的 IO。
    const checkpointInterval = Math.max(
      CHECKPOINT_EVERY_SECTIONS,
      Math.floor(rawPieces.length / 20),
    );
    if (useCheckpoints && sinceCheckpoint >= checkpointInterval) {
      sinceCheckpoint = 0;
      await writePersisted({
        bookId,
        version: FORMAT_VERSION,
        extractedAt: new Date().toISOString(),
        chapters: [],
        complete: false,
        checkpoint: { nextSection: i + 1, pieces: rawPieces },
      });
    }
  }

  const pieces = rawPieces.map((piece) => ({
    owner: ownerOf[piece.sectionIndex],
    href: piece.href,
    sectionIndex: piece.sectionIndex,
    text: piece.text,
  }));

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
  return { chapters, sectionsFailed };
}

const inflight = new Map<string, Promise<ExtractedChapter[]>>();

/** 记录是终局态吗？v3 只写过"有章节才落盘"，一律视同 complete。 */
function isComplete(record: PersistedBookText): boolean {
  if (record.version === 3) return true;
  return record.version === FORMAT_VERSION && record.complete === true;
}

/** 只读已持久化的正文；未抽取（或只有断点）返回 null（全书架检索用 —— 绝不触发批量抽取）。 */
export async function getPersistedBookText(bookId: string): Promise<ExtractedChapter[] | null> {
  const record = await readPersisted(bookId);
  return record && isComplete(record) ? record.chapters : null;
}

/**
 * 正文可用性三态：ok（有正文）/ textless（抽完的定论：全书没有文字层，
 * 纯图扫描版）/ unextracted（还没抽，或只有断点）。agent 的工具层据此
 * 把"没字"与"没抽"说成两回事，而不是同一个空目录。
 */
export async function getBookTextStatus(bookId: string): Promise<BookTextStatus> {
  const record = await readPersisted(bookId);
  if (!record || !isComplete(record)) return "unextracted";
  return record.chapters.length > 0 ? "ok" : "textless";
}

/**
 * 确保某本书的正文已抽取并持久化：阅读器首开与端口的懒回填共用。
 * 并发去重。终局语义：
 *  - 完整跑完且有章节 → 落盘正文；
 *  - 完整跑完、零章节、零失败 → 落盘"无文字层"定论（空 chapters +
 *    complete），此后不再对纯图扫描版反复发起全书重抽；
 *  - 有 section 失败且没抽到任何章节 → 不落终局（断点保留），下次再试。
 * `preopened` 见 extract。
 */
export async function ensureBookTextExtracted(
  bookId: string,
  preopened?: unknown,
): Promise<ExtractedChapter[]> {
  // Virtual (plugin-provided) books have no blob to extract from.
  let format: string | undefined;
  {
    const { listLibraryBooks } = await import("./library-db");
    const record = (await listLibraryBooks()).find((b) => b.id === String(bookId));
    if (record?.format === "virtual") return [];
    format = record?.format;
  }

  const persisted = await getPersistedBookText(bookId);
  if (persisted) return persisted;

  let pending = inflight.get(bookId);
  if (!pending) {
    pending = extract(bookId, preopened)
      .then(async ({ chapters, sectionsFailed }) => {
        if (chapters.length > 0 || sectionsFailed === 0) {
          await writePersisted({
            bookId,
            version: FORMAT_VERSION,
            extractedAt: new Date().toISOString(),
            chapters,
            complete: true,
          });
        }
        return chapters;
      })
      .finally(() => inflight.delete(bookId));
    inflight.set(bookId, pending);
  }
  // 扫描 PDF 的懒路径（agent 冷查询一本从未打开过的书）逐页抽取以分钟计，
  // 阻塞等它会把一次工具调用挂死。PDF 冷查询改为：抽取已在后台启动
  // （并会 checkpoint 续跑），本次如实返回"还没抽完"——工具层把这个
  // 状态讲给模型听。阅读器传来 preopened 的路径本就在后台任务里，照旧
  // 等到跑完。其余格式的抽取是秒级，维持阻塞语义（跨书检索依赖它）。
  if (format === "pdf" && !preopened) {
    pending.catch(() => {});
    return [];
  }
  return pending;
}
