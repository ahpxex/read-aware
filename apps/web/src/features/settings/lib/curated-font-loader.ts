import { curatedFacesFor } from "./curated-fonts";
import type { CuratedFontFace } from "./curated-fonts-data.generated";

/**
 * Progressive loader for the curated reading fonts. Nothing is bundled: each
 * face's woff2 is fetched on first use from its source CDN, persisted in
 * IndexedDB (so it's available offline afterwards), and exposed as an
 * `@font-face` rule backed by an in-memory blob URL. The same rule string is
 * injected into both the app document (UI + preview) and the foliate section
 * iframe (book text), so they render identically.
 */

const DB_NAME = "read-aware-fonts";
const STORE = "faces";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function db(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

function idbGet(database: IDBDatabase, key: string): Promise<ArrayBuffer | undefined> {
  return new Promise((resolve, reject) => {
    const req = database.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(database: IDBDatabase, key: string, value: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Fetch a face's bytes, served from the IndexedDB cache when present. */
async function loadFaceBytes(face: CuratedFontFace): Promise<ArrayBuffer> {
  const database = await db().catch(() => null);
  if (database) {
    const cached = await idbGet(database, face.url).catch(() => undefined);
    if (cached) return cached;
  }
  const res = await fetch(face.url);
  if (!res.ok) throw new Error(`Font fetch failed (${res.status}) for ${face.url}`);
  const bytes = await res.arrayBuffer();
  if (database) await idbPut(database, face.url, bytes).catch(() => undefined);
  return bytes;
}

function faceRule(face: CuratedFontFace, blobUrl: string): string {
  const range = face.unicodeRange ? `unicode-range:${face.unicodeRange};` : "";
  return `@font-face{font-family:"${face.family}";font-style:${face.style};font-weight:${face.weight};font-display:swap;src:url(${blobUrl}) format("woff2");${range}}`;
}

const faceCssMemo = new Map<string, Promise<string>>();

// CJK fonts split into ~100 unicode-range chunks per weight, so a font can carry
// a couple hundred faces. Cap concurrent fetches so selecting one doesn't fire
// hundreds of requests (and IndexedDB writes) at once.
const FETCH_CONCURRENCY = 8;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function buildFaceCss(fontId: string): Promise<string> {
  const faces = curatedFacesFor(fontId);
  const rules = await mapLimit(faces, FETCH_CONCURRENCY, async (face) => {
    try {
      const bytes = await loadFaceBytes(face);
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "font/woff2" }));
      return faceRule(face, blobUrl);
    } catch {
      // A dropped chunk just means those glyphs fall back — don't fail the font.
      return "";
    }
  });
  return rules.filter(Boolean).join("\n");
}

/**
 * Ensure a curated font is downloaded + cached and return its `@font-face` CSS
 * (with blob URLs), ready to inject. Memoized per session, so repeat calls — and
 * the app-document vs iframe injection sites — share one download and one set of
 * blob URLs.
 */
export function ensureCuratedFontFaceCss(fontId: string): Promise<string> {
  let pending = faceCssMemo.get(fontId);
  if (!pending) {
    pending = buildFaceCss(fontId);
    faceCssMemo.set(fontId, pending);
  }
  return pending;
}

/** Inject a curated font's `@font-face` into the app document (UI + preview). */
export async function injectCuratedFontFace(fontId: string): Promise<void> {
  const css = await ensureCuratedFontFaceCss(fontId);
  if (!css) return;
  const elementId = `curated-font-${fontId}`;
  let style = document.getElementById(elementId) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = elementId;
    document.head.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}
