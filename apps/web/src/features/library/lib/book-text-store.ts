/**
 * 书籍正文抽取与持久化（docs/agent-architecture.md §11.5 的产品侧 v2）。
 * 导入时抽取一次、按设备持久化；agent 的 BookTextPort 只读这里，首次对话
 * 不再付整书离屏解析的代价。存储介质：桌面走 blob store（`booktext:<id>`
 * 的 JSON 字节），浏览器 dev 走独立 IndexedDB 库。
 *
 * 桌面端 blob store 尚无删除命令 —— 删书后正文 blob 成为孤儿（无害，
 * 等事件日志/GC 接管）；浏览器路径会同步删除。
 */
import { getDesktopBlob, putDesktopBlob } from "../../../platform/blob-store";
import { isTauri } from "../../../platform/environment";
import { makeFoliateBook } from "../../reader/lib/foliate-engine";
import { getStoredBookBlob } from "./library-db";

export interface ExtractedChapter {
  title?: string;
  text: string;
}

/** 持久化格式带版本号：抽取逻辑变了可整体重抽。 */
const FORMAT_VERSION = 1;

interface PersistedBookText {
  bookId: string;
  version: number;
  extractedAt: string;
  chapters: ExtractedChapter[];
}

const blobKey = (bookId: string) => `booktext:${bookId}`;

// ── 浏览器 dev 介质：独立 IndexedDB（模式同 memory-store） ──

const DB_NAME = "read-aware-book-text";
const STORE = "chapters";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "bookId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

// ── 持久化读写 ──

async function readPersisted(bookId: string): Promise<PersistedBookText | null> {
  if (isTauri()) {
    const bytes = await getDesktopBlob(blobKey(bookId));
    if (!bytes) return null;
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as PersistedBookText;
    } catch {
      return null;
    }
  }
  return ((await withStore("readonly", (store) => store.get(bookId))) ??
    null) as PersistedBookText | null;
}

async function writePersisted(record: PersistedBookText): Promise<void> {
  if (isTauri()) {
    const bytes = new TextEncoder().encode(JSON.stringify(record));
    await putDesktopBlob(blobKey(record.bookId), bytes, "application/json");
    return;
  }
  await withStore("readwrite", (store) => store.put(record));
}

/** 删书时清理（仅浏览器介质可删；见文件头）。 */
export async function deleteBookText(bookIds: string[]): Promise<void> {
  if (isTauri() || bookIds.length === 0) return;
  for (const bookId of bookIds) {
    await withStore("readwrite", (store) => store.delete(bookId));
  }
}

// ── 抽取 ──

type FoliateSectionLike = {
  createDocument?: () => Promise<Document> | Document;
  linear?: string;
};

async function extract(bookId: string): Promise<ExtractedChapter[]> {
  const blob = await getStoredBookBlob(bookId);
  if (!blob) return [];
  const book = await makeFoliateBook(new File([blob], `${bookId}.book`));
  const tocLabels = (book.toc ?? [])
    .map((item) => item.label?.trim())
    .filter(Boolean) as string[];
  const chapters: ExtractedChapter[] = [];
  for (const section of (book.sections ?? []) as FoliateSectionLike[]) {
    if (section.linear === "no" || !section.createDocument) continue;
    try {
      const doc = await section.createDocument();
      const text = (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.length < 40) continue;
      chapters.push({ title: tocLabels[chapters.length], text });
    } catch {
      // 单个 section 失败不拖垮整本书
    }
  }
  return chapters;
}

const inflight = new Map<string, Promise<ExtractedChapter[]>>();

/** 只读已持久化的正文；未抽取返回 null（全书架检索用 —— 绝不触发批量抽取）。 */
export async function getPersistedBookText(bookId: string): Promise<ExtractedChapter[] | null> {
  const record = await readPersisted(bookId);
  return record && record.version === FORMAT_VERSION ? record.chapters : null;
}

/**
 * 确保某本书的正文已抽取并持久化：导入后台任务与端口的懒回填共用。
 * 并发去重；抽取失败返回空数组（下次再试）。
 */
export async function ensureBookTextExtracted(bookId: string): Promise<ExtractedChapter[]> {
  const persisted = await getPersistedBookText(bookId);
  if (persisted) return persisted;

  let pending = inflight.get(bookId);
  if (!pending) {
    pending = extract(bookId)
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
