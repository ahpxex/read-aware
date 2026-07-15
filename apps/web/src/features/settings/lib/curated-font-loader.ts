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

/** 每个分片的下载时限 —— CDN 被墙时 fetch 会挂到操作系统级超时,必须自己兜底。 */
const FACE_FETCH_TIMEOUT_MS = 20_000;

/** Fetch a face's bytes, served from the IndexedDB cache when present. */
async function loadFaceBytes(face: CuratedFontFace): Promise<ArrayBuffer> {
  const database = await db().catch(() => null);
  if (database) {
    const cached = await idbGet(database, face.url).catch(() => undefined);
    if (cached) return cached;
  }
  const res = await fetch(face.url, { signal: AbortSignal.timeout(FACE_FETCH_TIMEOUT_MS) });
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

// ── 下载进度广播：UI 据此渲染"正在下载 · N%"。按 fontId 订阅。 ──
export interface CuratedFontProgress {
  done: number;
  total: number;
}

const progressState = new Map<string, CuratedFontProgress>();
const progressListeners = new Map<string, Set<(progress: CuratedFontProgress) => void>>();

export function getCuratedFontProgress(fontId: string): CuratedFontProgress | undefined {
  return progressState.get(fontId);
}

export function subscribeCuratedFontProgress(
  fontId: string,
  listener: (progress: CuratedFontProgress) => void,
): () => void {
  let set = progressListeners.get(fontId);
  if (!set) {
    set = new Set();
    progressListeners.set(fontId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

function reportProgress(fontId: string, progress: CuratedFontProgress): void {
  progressState.set(fontId, progress);
  progressListeners.get(fontId)?.forEach((listener) => listener(progress));
}

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

/**
 * The faces to fetch for a font, narrowed to the requested numeric weights.
 * CJK fonts carry ~100 unicode-range chunks per weight, so fetching only the
 * weights a session needs (see `readerFontWeightsNeeded`) is what keeps adding
 * weight presets from multiplying the download. No `weights` — or a filter
 * that matches nothing (a weight the family doesn't ship) — means every face.
 */
function facesFor(fontId: string, weights?: readonly number[]): CuratedFontFace[] {
  const all = curatedFacesFor(fontId);
  if (!weights || weights.length === 0) return all;
  const wanted = new Set(weights);
  const filtered = all.filter((face) => wanted.has(face.weight));
  return filtered.length > 0 ? filtered : all;
}

async function buildFaceCss(fontId: string, weights?: readonly number[]): Promise<string> {
  const faces = facesFor(fontId, weights);
  let done = 0;
  reportProgress(fontId, { done: 0, total: faces.length });
  const rules = await mapLimit(faces, FETCH_CONCURRENCY, async (face) => {
    try {
      const bytes = await loadFaceBytes(face);
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "font/woff2" }));
      return faceRule(face, blobUrl);
    } catch {
      // A dropped chunk just means those glyphs fall back — don't fail the font.
      return "";
    } finally {
      done += 1;
      reportProgress(fontId, { done, total: faces.length });
    }
  });
  const css = rules.filter(Boolean).join("\n");
  // 一个分片都没拿到 = 下载整体失败（典型场景：CDN 不可达/被墙）。
  // 必须抛出而不是返回空串,否则失败会被当成"成功的空结果"静默呈现。
  if (!css && faces.length > 0) {
    throw new Error(`curated font ${fontId}: all ${faces.length} face fetches failed`);
  }
  return css;
}

/** One memo entry per (font, weight set) — different sets are different CSS. */
function memoKey(fontId: string, weights?: readonly number[]): string {
  if (!weights || weights.length === 0) return fontId;
  return `${fontId}@${[...weights].sort((a, b) => a - b).join(",")}`;
}

/**
 * Ensure a curated font is downloaded + cached and return its `@font-face` CSS
 * (with blob URLs), ready to inject. `weights` narrows the faces to those
 * numeric weights (weights the family doesn't ship are simply absent — the
 * renderer falls back to the nearest face). Memoized per session and per weight
 * set, so repeat calls — and the app-document vs iframe injection sites — share
 * one download and one set of blob URLs; overlapping sets still share bytes
 * through the IndexedDB cache. Failures are NOT memoized: re-selecting retries.
 */
export function ensureCuratedFontFaceCss(
  fontId: string,
  weights?: readonly number[],
): Promise<string> {
  const key = memoKey(fontId, weights);
  let pending = faceCssMemo.get(key);
  if (!pending) {
    pending = buildFaceCss(fontId, weights).catch((error: unknown) => {
      faceCssMemo.delete(key);
      throw error;
    });
    faceCssMemo.set(key, pending);
  }
  return pending;
}

/** Inject a curated font's `@font-face` into the app document (UI + preview). */
export async function injectCuratedFontFace(
  fontId: string,
  weights?: readonly number[],
): Promise<void> {
  const css = await ensureCuratedFontFaceCss(fontId, weights);
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
