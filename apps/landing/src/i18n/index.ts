import { createInstance, type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { LOCALES, type Locale } from "../lib/i18n";
import enSite from "./resources/en.site.json";

export type DocsResource = typeof import("./resources/en.docs.json");
export type DocsPageKey = keyof DocsResource["pages"];
export type SiteResource = typeof enSite;
export type BlogPostSlug = keyof SiteResource["blog"]["posts"];

export interface LandingRouterContext {
  i18n: I18nInstance;
}

type TranslatedLocale = Exclude<Locale, "en">;

const docsLoaders: Record<Locale, () => Promise<{ default: DocsResource }>> = {
  en: () => import("./resources/en.docs.json"),
  zh: () => import("./resources/zh.docs.json"),
  "zh-hant": () => import("./resources/zh-hant.docs.json"),
  ja: () => import("./resources/ja.docs.json"),
  fr: () => import("./resources/fr.docs.json"),
  de: () => import("./resources/de.docs.json"),
  ru: () => import("./resources/ru.docs.json"),
  es: () => import("./resources/es.docs.json"),
};

const siteLoaders = {
  zh: () => import("./resources/zh.site.json"),
  "zh-hant": () => import("./resources/zh-hant.site.json"),
  ja: () => import("./resources/ja.site.json"),
  fr: () => import("./resources/fr.site.json"),
  de: () => import("./resources/de.site.json"),
  ru: () => import("./resources/ru.site.json"),
  es: () => import("./resources/es.site.json"),
} satisfies Record<TranslatedLocale, () => Promise<{ default: unknown }>>;

function initializeLandingI18n(
  locale: Locale,
  site: SiteResource,
) {
  const instance = createInstance();
  const resources =
    locale === "en"
      ? { en: { site: enSite } }
      : {
          en: { site: enSite },
          [locale]: { site },
        };

  void instance.use(initReactI18next).init({
    lng: locale,
    lowerCaseLng: true,
    fallbackLng: "en",
    supportedLngs: LOCALES,
    defaultNS: "site",
    ns: ["site", "docs"],
    resources,
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance;
}

/** Load only English plus the locale needed by this browser or SSR render. */
export async function createLandingI18n(locale: Locale) {
  if (locale === "en") return initializeLandingI18n("en", enSite);
  const site = await siteLoaders[locale]();
  return initializeLandingI18n(locale, site.default as SiteResource);
}

/** Route enumeration does not render content, so it needs no translated chunk. */
export function createEnglishLandingI18n() {
  return initializeLandingI18n("en", enSite);
}

/** Docs are a route-scoped namespace, loaded before its layout and metadata. */
export async function ensureDocsResources(i18n: I18nInstance, locale: Locale) {
  const needed = locale === "en" ? ["en"] as const : ["en", locale] as const;
  await Promise.all(
    needed.map(async (language) => {
      if (i18n.hasResourceBundle(language, "docs")) return;
      const docs = (await docsLoaders[language]()).default;
      i18n.addResourceBundle(language, "docs", docs, true, true);
    }),
  );
}

export function docsPageMeta(i18n: I18nInstance, page: DocsPageKey) {
  return {
    meta: [
      { title: i18n.t(`pages.${page}.metaTitle`, { ns: "docs" }) },
      {
        name: "description",
        content: i18n.t(`pages.${page}.metaDescription`, { ns: "docs" }),
      },
    ],
  };
}

export function sitePageMeta(
  i18n: I18nInstance,
  page: "home" | "pricing" | "changelog",
) {
  return {
    meta: [
      { title: i18n.t(`${page}.metaTitle`, { ns: "site" }) },
      {
        name: "description",
        content: i18n.t(`${page}.metaDescription`, { ns: "site" }),
      },
    ],
  };
}

export function blogIndexMeta(i18n: I18nInstance) {
  return {
    meta: [
      { title: i18n.t("blog.metaTitle", { ns: "site" }) },
      {
        name: "description",
        content: i18n.t("blog.metaDescription", { ns: "site" }),
      },
    ],
  };
}

export function blogPostMeta(i18n: I18nInstance, slug: BlogPostSlug) {
  const title = i18n.t(`blog.posts.${slug}.title`, { ns: "site" });
  const blogLabel = i18n.t("chrome.blog", { ns: "site" });
  return {
    meta: [
      { title: `${title} — ReadAware ${blogLabel}` },
      {
        name: "description",
        content: i18n.t(`blog.posts.${slug}.description`, { ns: "site" }),
      },
    ],
  };
}
