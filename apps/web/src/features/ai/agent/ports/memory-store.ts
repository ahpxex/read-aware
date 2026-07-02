/**
 * 记忆的产品侧存储（interim：IndexedDB；目标：SQLite `memories` 投影 +
 * memory.* 事件，见 docs/data-model.md §5.2）。一条记录一行，含 status —
 * superseded/forgotten 保留不删，等事件日志接管后可追溯。
 */
import type { MemoryRecord } from "@read-aware/agent";

const DB_NAME = "read-aware-memories";
const STORE = "memories";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("scope", "scope");
        store.createIndex("status", "status");
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

export async function listAllMemoryRows(): Promise<MemoryRecord[]> {
  return (await withStore("readonly", (store) => store.getAll())) as MemoryRecord[];
}

export async function putMemoryRow(record: MemoryRecord): Promise<void> {
  await withStore("readwrite", (store) => store.put(record));
}

export async function getMemoryRow(id: string): Promise<MemoryRecord | undefined> {
  return (await withStore("readonly", (store) => store.get(id))) as MemoryRecord | undefined;
}
