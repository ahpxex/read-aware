/**
 * IndexedDB storage for annotations (highlights, notes, AI chats)
 */

import type { AIChat, AIChatMessage, Annotation, AnnotationFilters, Highlight, Note } from "./annotation-types";

const DB_NAME = "read-aware-annotations";
const DB_VERSION = 1;
const ANNOTATIONS_STORE = "annotations";

let dbPromise: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
  });
}

function openAnnotationsDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(ANNOTATIONS_STORE)) {
        const store = db.createObjectStore(ANNOTATIONS_STORE, { keyPath: "id" });
        store.createIndex("bookId", "bookId", { unique: false });
        store.createIndex("type", "type", { unique: false });
        store.createIndex("bookId_type", ["bookId", "type"], { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to open the annotations database."));
  });

  return dbPromise;
}

// Generic annotation operations
export async function saveAnnotation(annotation: Annotation): Promise<Annotation> {
  const db = await openAnnotationsDb();
  const transaction = db.transaction(ANNOTATIONS_STORE, "readwrite");
  transaction.objectStore(ANNOTATIONS_STORE).put(annotation);
  await waitForTransaction(transaction);
  return annotation;
}

export async function getAnnotation(id: string): Promise<Annotation | null> {
  const db = await openAnnotationsDb();
  const transaction = db.transaction(ANNOTATIONS_STORE, "readonly");
  const result = await requestToPromise(
    transaction.objectStore(ANNOTATIONS_STORE).get(id) as IDBRequest<Annotation | undefined>,
  );
  await waitForTransaction(transaction);
  return result ?? null;
}

export async function deleteAnnotation(id: string): Promise<void> {
  const db = await openAnnotationsDb();
  const transaction = db.transaction(ANNOTATIONS_STORE, "readwrite");
  transaction.objectStore(ANNOTATIONS_STORE).delete(id);
  await waitForTransaction(transaction);
}

export async function listAnnotations(filters?: AnnotationFilters): Promise<Annotation[]> {
  const db = await openAnnotationsDb();
  const transaction = db.transaction(ANNOTATIONS_STORE, "readonly");
  const store = transaction.objectStore(ANNOTATIONS_STORE);
  
  let annotations: Annotation[];
  
  if (filters?.bookId && filters?.type) {
    const index = store.index("bookId_type");
    annotations = await requestToPromise(index.getAll([filters.bookId, filters.type]) as IDBRequest<Annotation[]>);
  } else if (filters?.bookId) {
    const index = store.index("bookId");
    annotations = await requestToPromise(index.getAll(filters.bookId) as IDBRequest<Annotation[]>);
  } else if (filters?.type) {
    const index = store.index("type");
    annotations = await requestToPromise(index.getAll(filters.type) as IDBRequest<Annotation[]>);
  } else {
    annotations = await requestToPromise(store.getAll() as IDBRequest<Annotation[]>);
  }
  
  await waitForTransaction(transaction);
  
  // Apply search filter in memory
  if (filters?.searchQuery) {
    const query = filters.searchQuery.toLowerCase();
    annotations = annotations.filter((a) => 
      a.text.toLowerCase().includes(query) ||
      ("content" in a && a.content?.toLowerCase().includes(query))
    );
  }
  
  // Sort by creation time, newest first
  return annotations.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

// Highlight operations
export async function createHighlight(
  bookId: string,
  cfiRange: string | null,
  chapterHref: string | null,
  text: string,
  color: Highlight["color"] = "yellow"
): Promise<Highlight> {
  const now = new Date().toISOString();
  const highlight: Highlight = {
    id: crypto.randomUUID(),
    bookId,
    type: "highlight",
    cfiRange,
    chapterHref,
    text,
    color,
    createdAt: now,
    updatedAt: now,
  };
  return saveAnnotation(highlight) as Promise<Highlight>;
}

export async function listHighlights(bookId?: string): Promise<Highlight[]> {
  const annotations = await listAnnotations({ bookId, type: "highlight" });
  return annotations as Highlight[];
}

// Note operations
export async function createNote(
  bookId: string,
  cfiRange: string | null,
  chapterHref: string | null,
  text: string,
  content: string
): Promise<Note> {
  const now = new Date().toISOString();
  const note: Note = {
    id: crypto.randomUUID(),
    bookId,
    type: "note",
    cfiRange,
    chapterHref,
    text,
    content,
    createdAt: now,
    updatedAt: now,
  };
  return saveAnnotation(note) as Promise<Note>;
}

export async function updateNote(id: string, content: string): Promise<Note | null> {
  const note = await getAnnotation(id);
  if (!note || note.type !== "note") return null;
  
  const updated: Note = {
    ...note,
    content,
    updatedAt: new Date().toISOString(),
  };
  return saveAnnotation(updated) as Promise<Note>;
}

export async function listNotes(bookId?: string): Promise<Note[]> {
  const annotations = await listAnnotations({ bookId, type: "note" });
  return annotations as Note[];
}

// AI Chat operations
export async function createAIChat(
  bookId: string,
  cfiRange: string | null,
  chapterHref: string | null,
  text: string,
  initialMessage: string
): Promise<AIChat> {
  const now = new Date().toISOString();
  const chat: AIChat = {
    id: crypto.randomUUID(),
    bookId,
    type: "ai-chat",
    cfiRange,
    chapterHref,
    text,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "user",
        content: initialMessage,
        timestamp: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  return saveAnnotation(chat) as Promise<AIChat>;
}

export async function addMessageToChat(
  chatId: string,
  role: AIChatMessage["role"],
  content: string
): Promise<AIChat | null> {
  const chat = await getAnnotation(chatId);
  if (!chat || chat.type !== "ai-chat") return null;
  
  const now = new Date().toISOString();
  const newMessage: AIChatMessage = {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: now,
  };
  
  const updated: AIChat = {
    ...chat,
    messages: [...chat.messages, newMessage],
    updatedAt: now,
  };
  return saveAnnotation(updated) as Promise<AIChat>;
}

export async function listAIChats(bookId?: string): Promise<AIChat[]> {
  const annotations = await listAnnotations({ bookId, type: "ai-chat" });
  return annotations as AIChat[];
}
