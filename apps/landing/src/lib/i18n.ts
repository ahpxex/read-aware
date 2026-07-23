/**
 * Locale support for the docs and blog. English is the source of truth at the
 * unprefixed paths; translations live at /zh and /ja as their own route files
 * (no i18n framework — a translated page is a hand-maintained TSX file, kept
 * in sync by the publishing pipeline). This module holds the locale set, the
 * path mapping between language versions, and the few chrome strings shared
 * components need. The landing page itself stays English-only.
 */
export type Locale = "en" | "zh" | "ja";

export const LOCALES: readonly Locale[] = ["en", "zh", "ja"];

/** BCP 47 tags for <html lang>, hreflang, and date formatting. */
export const LOCALE_LANG: Record<Locale, string> = {
  en: "en",
  zh: "zh-CN",
  ja: "ja",
};

/** Native-name labels for the language switcher menu. */
export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  zh: "中文",
  ja: "日本語",
};

const PREFIX: Record<Locale, string> = { en: "", zh: "/zh", ja: "/ja" };

export function localeFromPathname(pathname: string): Locale {
  if (pathname === "/zh" || pathname.startsWith("/zh/")) return "zh";
  if (pathname === "/ja" || pathname.startsWith("/ja/")) return "ja";
  return "en";
}

/** The same page's pathname in another locale ("/zh/docs/install" ↔ "/docs/install"). */
export function localizePath(pathname: string, locale: Locale): string {
  const current = localeFromPathname(pathname);
  const base =
    current === "en" ? pathname : pathname.slice(PREFIX[current].length) || "/";
  return locale === "en" ? base : `${PREFIX[locale]}${base}`;
}

/** Only docs and blog pages exist in every locale. */
export function hasLocaleVariants(pathname: string): boolean {
  const base = localizePath(pathname, "en");
  return base.startsWith("/docs") || base.startsWith("/blog");
}

/** Chrome strings for the shared header, footer, and article frames. */
export const UI_STRINGS: Record<
  Locale,
  {
    docs: string;
    blog: string;
    download: string;
    allPosts: string;
    tagline: string;
  }
> = {
  en: {
    docs: "Docs",
    blog: "Blog",
    download: "Download",
    allPosts: "← All posts",
    tagline: "Local-first. Yours.",
  },
  zh: {
    docs: "文档",
    blog: "博客",
    download: "下载",
    allPosts: "← 全部文章",
    tagline: "本地优先，数据归你。",
  },
  ja: {
    docs: "ドキュメント",
    blog: "ブログ",
    download: "ダウンロード",
    allPosts: "← 記事一覧",
    tagline: "ローカルファースト。あなたのもの。",
  },
};
