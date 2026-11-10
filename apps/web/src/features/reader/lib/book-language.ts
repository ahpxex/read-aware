import type { FoliateBook } from "./foliate-engine";
import { createLogger } from "../../../platform/logger";

const log = createLogger("book-language");

/** Regional editions share a font: en-US/en-GB -> en, zh-Hans/zh-Hant -> zh. */
export function normalizeBookLanguage(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 80) return null;
  try {
    const language = new Intl.Locale(value.trim().replaceAll("_", "-")).language;
    return ["und", "mul", "zxx"].includes(language) ? null : language;
  } catch {
    return null; // Missing/malformed publisher metadata is not a reader failure.
  }
}

/** Only infer scripts that distinguish these languages; Latin alone is not English. */
export function inferBookLanguage(text: string): string | null {
  const sample = text.slice(0, 4096);
  const letters = sample.match(/\p{Letter}/gu)?.length ?? 0;
  if (letters < 20) return null;
  if ((sample.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0) > letters * 0.05) return "ja";
  if ((sample.match(/\p{Script=Hangul}/gu)?.length ?? 0) > letters * 0.1) return "ko";
  if ((sample.match(/\p{Script=Han}/gu)?.length ?? 0) > letters * 0.5) return "zh";
  return null;
}

/** Metadata first; a bounded source-document fallback never follows individual passages. */
export async function detectBookLanguage(book: FoliateBook): Promise<string> {
  for (const value of [book.metadata?.language].flat()) {
    const language = normalizeBookLanguage(value);
    if (language) return language;
  }
  let sample = "";
  for (const section of book.sections
    .filter((section) => section.linear !== "no" && section.createDocument)
    .slice(0, 3)) {
    try {
      const doc = await section.createDocument!();
      const language = normalizeBookLanguage(doc.documentElement.lang || doc.documentElement.getAttribute("xml:lang"));
      if (language) return language;
      sample += ` ${doc.body?.textContent ?? doc.documentElement.textContent ?? ""}`.slice(0, 4096 - sample.length);
      if (sample.length >= 4096) break;
    } catch (error) {
      log.warn("Could not read a language sample", error);
    }
  }
  return inferBookLanguage(sample) ?? "und";
}

const languages = new WeakMap<FoliateBook, Promise<string>>();

/**
 * The book's language, worked out once per parsed book: without publisher
 * metadata it reads sample documents, and the same parsed book is opened
 * again for every layout switch and every reopening.
 */
export function bookLanguage(book: FoliateBook): Promise<string> {
  let language = languages.get(book);
  if (!language) {
    language = detectBookLanguage(book);
    languages.set(book, language);
  }
  return language;
}
