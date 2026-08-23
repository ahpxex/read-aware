/**
 * Locale support for the site. English is the source of truth at the
 * unprefixed paths; translations live at /zh and /ja as their own route files
 * (no i18n framework — docs/blog pages are hand-maintained TSX mirrors, while
 * the homepage and changelog render per-locale content objects). This module
 * holds the locale set, the path mapping between language versions, and the
 * few chrome strings shared components need.
 */
export type Locale = "en" | "zh" | "zh-hant" | "ja" | "fr" | "de" | "ru" | "es";

/**
 * Where an explicit language-switcher pick persists. The homepage's
 * browser-language redirect defers to it, so a chosen language sticks
 * across visits instead of fighting the Accept-Language heuristic.
 */
export const LOCALE_CHOICE_KEY = "read-aware-landing-locale";

/** The full site locale set — mirrors the app's own i18n locales. */
export const LOCALES: readonly Locale[] = [
  "en",
  "zh",
  "zh-hant",
  "ja",
  "fr",
  "de",
  "ru",
  "es",
];

/**
 * Docs pages are hand-maintained TSX mirrors and now exist in every locale.
 * Blog mirrors remain a three-language subset (English source + zh/ja); the
 * homepage and changelog render per-locale content objects and exist in every
 * locale.
 */
export type DocsLocale = Locale;

export const DOCS_LOCALES: readonly DocsLocale[] = LOCALES;

/** Blog mirrors exist only in this three-language subset. */
export type BlogLocale = "en" | "zh" | "ja";

export const BLOG_LOCALES: readonly BlogLocale[] = ["en", "zh", "ja"];

export function isBlogLocale(locale: Locale): locale is BlogLocale {
  return (BLOG_LOCALES as readonly Locale[]).includes(locale);
}

/** BCP 47 tags for <html lang>, hreflang, and date formatting. */
export const LOCALE_LANG: Record<Locale, string> = {
  en: "en",
  zh: "zh-CN",
  "zh-hant": "zh-Hant",
  ja: "ja",
  fr: "fr",
  de: "de",
  ru: "ru",
  es: "es",
};

/** Native-name labels for the language switcher menu. */
export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  zh: "简体中文",
  "zh-hant": "繁體中文",
  ja: "日本語",
  fr: "Français",
  de: "Deutsch",
  ru: "Русский",
  es: "Español",
};

const PREFIX: Record<Locale, string> = {
  en: "",
  zh: "/zh",
  "zh-hant": "/zh-hant",
  ja: "/ja",
  fr: "/fr",
  de: "/de",
  ru: "/ru",
  es: "/es",
};

// Longest prefix first, so "/zh-hant" never matches as "/zh".
const PREFIXED = LOCALES.filter((locale) => locale !== "en").sort(
  (a, b) => PREFIX[b].length - PREFIX[a].length,
);

export function localeFromPathname(pathname: string): Locale {
  for (const locale of PREFIXED) {
    const prefix = PREFIX[locale];
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return locale;
  }
  return "en";
}

/** The same page's pathname in another locale ("/zh/docs/install" ↔ "/docs/install"). */
export function localizePath(pathname: string, locale: Locale): string {
  const current = localeFromPathname(pathname);
  const base =
    current === "en" ? pathname : pathname.slice(PREFIX[current].length) || "/";
  return locale === "en" ? base : `${PREFIX[locale]}${base}`;
}

/** The locales this page actually exists in (drives the switcher and hreflang). */
export function availableLocales(pathname: string): readonly Locale[] {
  const base = localizePath(pathname, "en");
  if (base === "/" || base.startsWith("/changelog") || base.startsWith("/pricing")) {
    return LOCALES;
  }
  if (base.startsWith("/docs")) return DOCS_LOCALES;
  if (base.startsWith("/blog")) return BLOG_LOCALES;
  return [];
}

export function hasLocaleVariants(pathname: string): boolean {
  return availableLocales(pathname).length > 1;
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
    pricing: string;
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
    pricing: "Pricing",
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
    pricing: "定价",
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
    pricing: "料金",
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
  "zh-hant": {
    "docs": "文件",
    "blog": "部落格",
    "download": "下載",
    "allPosts": "← 所有文章",
    "tagline": "本地優先。屬於你。",
    "more": "更多",
    "language": "語言",
    "pricing": "定價",
    "changelog": "更新日誌",
    "changelogTitle": "更新日誌",
    "changelogLead": "每個版本變了什麼，寫給使用的人看。每個版本的完整說明與下載都在 GitHub 上。",
    "changelogNew": "新增",
    "changelogImproved": "改善",
    "changelogFixed": "修正",
    "changelogOlder": "更早的版本在 GitHub 上 →",
    "changelogRelease": "版本說明"
  },
  fr: {
    "docs": "Docs",
    "blog": "Blog",
    "download": "Télécharger",
    "allPosts": "← Tous les articles",
    "tagline": "Local d'abord. À vous.",
    "more": "Plus",
    "language": "Langue",
    "pricing": "Tarifs",
    "changelog": "Journal des modifications",
    "changelogTitle": "Journal des modifications",
    "changelogLead": "Ce qui a changé dans chaque version, écrit pour celles et ceux qui utilisent l'application. Les notes complètes et les téléchargements de chaque version sont sur GitHub.",
    "changelogNew": "Nouveau",
    "changelogImproved": "Amélioré",
    "changelogFixed": "Corrigé",
    "changelogOlder": "Versions précédentes sur GitHub →",
    "changelogRelease": "Notes de version"
  },
  de: {
    "docs": "Dokumentation",
    "blog": "Blog",
    "download": "Download",
    "allPosts": "← Alle Beiträge",
    "tagline": "Local-First. Deins.",
    "more": "Mehr",
    "language": "Sprache",
    "pricing": "Preise",
    "changelog": "Änderungsprotokoll",
    "changelogTitle": "Änderungsprotokoll",
    "changelogLead": "Was sich in jeder Version geändert hat, geschrieben für die Menschen, die sie nutzen. Die vollständigen Notizen und Downloads jeder Version gibt es auf GitHub.",
    "changelogNew": "Neu",
    "changelogImproved": "Verbessert",
    "changelogFixed": "Behoben",
    "changelogOlder": "Ältere Versionen auf GitHub →",
    "changelogRelease": "Versionshinweise"
  },
  ru: {
    "docs": "Документация",
    "blog": "Блог",
    "download": "Скачать",
    "allPosts": "← Все записи",
    "tagline": "Локальный подход (local-first). Ваше.",
    "more": "Ещё",
    "language": "Язык",
    "pricing": "Тарифы",
    "changelog": "Журнал изменений",
    "changelogTitle": "Журнал изменений",
    "changelogLead": "Что изменилось в каждом выпуске, написанное для тех, кто этим пользуется. Полные примечания и загрузки каждой версии — на GitHub.",
    "changelogNew": "Новое",
    "changelogImproved": "Улучшено",
    "changelogFixed": "Исправлено",
    "changelogOlder": "Старые выпуски на GitHub →",
    "changelogRelease": "Примечания к выпуску"
  },
  es: {
    "docs": "Documentación",
    "blog": "Blog",
    "download": "Descargar",
    "allPosts": "← Todas las publicaciones",
    "tagline": "Local primero (local-first). Tuyo.",
    "more": "Más",
    "language": "Idioma",
    "pricing": "Precios",
    "changelog": "Registro de cambios",
    "changelogTitle": "Registro de cambios",
    "changelogLead": "Lo que cambió en cada versión, escrito para quienes la usan. Las notas completas y las descargas de cada versión viven en GitHub.",
    "changelogNew": "Nuevo",
    "changelogImproved": "Mejorado",
    "changelogFixed": "Corregido",
    "changelogOlder": "Versiones anteriores en GitHub →",
    "changelogRelease": "Notas de la versión"
  },
};
