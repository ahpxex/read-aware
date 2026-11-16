import type { AppLocale } from "../../../i18n";

type Script = "zh" | "ja" | "ru" | "ko" | "latin";

/** The script a message is written in, by the same signals the agent's reply-language anchor uses. */
function scriptOf(text: string): Script | null {
  if (/[぀-ヿ]/.test(text)) return "ja";
  const han = (text.match(/[一-鿿]/g) ?? []).length;
  const hangul = (text.match(/[가-힯]/g) ?? []).length;
  if (hangul > han) return "ko";
  if (han > 0) return "zh";
  if (/[Ѐ-ӿ]/.test(text)) return "ru";
  return /\p{L}/u.test(text) ? "latin" : null;
}

const LATIN_LOCALES: ReadonlySet<AppLocale> = new Set(["en", "de", "fr", "es"]);

/**
 * The language to offer ready-made prompts in: the one the reader writes to
 * the agent in, read from their most recent messages (newest first), so a
 * reader with an English interface who asks in Chinese is offered Chinese.
 * A majority of the recent messages decides; a tie goes to the newest. The
 * interface language settles what the script alone cannot — Simplified or
 * Traditional Chinese, which Latin-script language — and stands in when there
 * is nothing to read or the script has no catalog (Korean).
 */
export function conversationLocale(recentMessages: readonly string[], interfaceLocale: AppLocale): AppLocale {
  const scripts = recentMessages
    .slice(0, 5)
    .map(scriptOf)
    .filter((script): script is Script => script !== null);
  if (scripts.length === 0) return interfaceLocale;
  const counts = new Map<Script, number>();
  for (const script of scripts) counts.set(script, (counts.get(script) ?? 0) + 1);
  const top = Math.max(...counts.values());
  // Newest first, so the first script reaching the top count is the most recent of the tied.
  const script = scripts.find((candidate) => counts.get(candidate) === top)!;
  switch (script) {
    case "zh":
      return interfaceLocale === "zh-Hant" ? "zh-Hant" : "zh-Hans";
    case "ja":
      return "ja";
    case "ru":
      return "ru";
    case "latin":
      return LATIN_LOCALES.has(interfaceLocale) ? interfaceLocale : "en";
    case "ko":
      return interfaceLocale;
  }
}
