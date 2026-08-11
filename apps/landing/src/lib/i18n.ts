/**
 * Locale support for the site. English is the source of truth at the
 * unprefixed paths; translations live at /zh and /ja as their own route files
 * (no i18n framework — docs/blog pages are hand-maintained TSX mirrors, while
 * the homepage and changelog render per-locale content objects). This module
 * holds the locale set, the path mapping between language versions, and the
 * few chrome strings shared components need.
 */
export type Locale = "en" | "zh" | "ja";

/**
 * Where an explicit language-switcher pick persists. The homepage's
 * browser-language redirect defers to it, so a chosen language sticks
 * across visits instead of fighting the Accept-Language heuristic.
 */
export const LOCALE_CHOICE_KEY = "read-aware-landing-locale";

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

/** The homepage, docs, blog, and changelog pages exist in every locale. */
export function hasLocaleVariants(pathname: string): boolean {
  const base = localizePath(pathname, "en");
  return (
    base === "/" ||
    base.startsWith("/docs") ||
    base.startsWith("/blog") ||
    base.startsWith("/changelog")
  );
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
    more: string;
    language: string;
    changelog: string;
    changelogTitle: string;
    changelogLead: string;
    changelogNew: string;
    changelogImproved: string;
    changelogFixed: string;
    changelogOlder: string;
    changelogRelease: string;
  }
> = {
  en: {
    docs: "Docs",
    blog: "Blog",
    download: "Download",
    allPosts: "← All posts",
    tagline: "Local-first. Yours.",
    more: "More",
    language: "Language",
    changelog: "Changelog",
    changelogTitle: "Changelog",
    changelogLead:
      "What changed in each release, written for the people using it. Every version's complete notes and downloads live on GitHub.",
    changelogNew: "New",
    changelogImproved: "Improved",
    changelogFixed: "Fixed",
    changelogOlder: "Older releases on GitHub →",
    changelogRelease: "Release notes",
  },
  zh: {
    docs: "文档",
    blog: "博客",
    download: "下载",
    allPosts: "← 全部文章",
    tagline: "本地优先，数据归你。",
    more: "更多",
    language: "语言",
    changelog: "更新日志",
    changelogTitle: "更新日志",
    changelogLead:
      "每一版改了什么，写给用它的人看。每个版本的完整说明和安装包都在 GitHub 上。",
    changelogNew: "新增",
    changelogImproved: "改进",
    changelogFixed: "修复",
    changelogOlder: "更早的版本在 GitHub 上 →",
    changelogRelease: "发布说明",
  },
  ja: {
    docs: "ドキュメント",
    blog: "ブログ",
    download: "ダウンロード",
    allPosts: "← 記事一覧",
    tagline: "ローカルファースト。あなたのもの。",
    more: "その他",
    language: "言語",
    changelog: "変更履歴",
    changelogTitle: "変更履歴",
    changelogLead:
      "各リリースで何が変わったかを、使う人に向けて書いています。各バージョンの完全な記録とダウンロードはGitHubにあります。",
    changelogNew: "新機能",
    changelogImproved: "改善",
    changelogFixed: "修正",
    changelogOlder: "以前のリリースはGitHubで →",
    changelogRelease: "リリースノート",
  },
};
