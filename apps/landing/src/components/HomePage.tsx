import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { DownloadMenu } from "./DownloadMenu";
import { DownloadSection } from "./DownloadSection";
import { Plate } from "./Plate";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { useDocumentLang } from "../hooks/useDocumentLang";
import { useLatestRelease } from "../hooks/useLatestRelease";
import { useSiteCopy } from "../i18n/use-site-copy";
import { LOCALES, LOCALE_CHOICE_KEY, type Locale } from "../lib/i18n";

/**
 * First visit to `/`: follow the browser language to /zh or /ja. An explicit
 * pick in the language switcher (persisted under LOCALE_CHOICE_KEY) always
 * wins — someone who chose English on a zh-CN system stays on English, and
 * someone who chose 中文 gets it back on their next visit. Only the homepage
 * redirects; deep links to docs/blog land exactly where they point.
 */
function useBrowserLocaleRedirect(locale: Locale) {
  useEffect(() => {
    if (locale !== "en" || window.location.pathname !== "/") return;
    let choice: string | null = null;
    try {
      choice = localStorage.getItem(LOCALE_CHOICE_KEY);
    } catch {
      // Storage unavailable — treat as no stored preference.
    }
    const stored =
      choice && (LOCALES as readonly string[]).includes(choice)
        ? (choice as Locale)
        : null;
    const target = stored ? (stored === "en" ? null : stored) : detectBrowserLocale();
    if (target) window.location.replace(`/${target}/`);
  }, [locale]);
}

/** The first of the visitor's languages we can serve decides — including en. */
function detectBrowserLocale(): Exclude<Locale, "en"> | null {
  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  for (const entry of languages) {
    const lang = (entry ?? "").toLowerCase();
    if (lang.startsWith("en")) return null;
    if (lang.startsWith("zh")) {
      return lang.includes("hant") || lang.startsWith("zh-tw") || lang.startsWith("zh-hk")
        ? "zh-hant"
        : "zh";
    }
    for (const candidate of ["ja", "fr", "de", "ru", "es"] as const) {
      if (lang.startsWith(candidate)) return candidate;
    }
  }
  return null;
}

export function HomePage({ locale }: { locale: Locale }) {
  useDocumentLang(locale);
  useBrowserLocaleRedirect(locale);
  const { t } = useTranslation("site");
  const release = useLatestRelease();
  const content = useSiteCopy("home");
  const downloadStrings = {
    ...content.download,
    latest: (tag: string) => t("home.download.latest", { tag }),
    downloadFor: (name: string) => t("home.download.downloadFor", { name }),
  };
  const freeLine = release.tag
    ? t("home.freeLineWithTag", { tag: release.tag })
    : t("home.freeLine");

  return (
    <div className="min-h-screen bg-paper text-fg">
      <div className="mx-auto max-w-3xl px-6">
        <SiteHeader locale={locale} />

        <main id="top">
          {/* Title */}
          <section className="max-w-[36rem] pt-12 sm:pt-16">
            <h1 className="text-[clamp(2.1rem,4.8vw,3rem)] font-normal leading-[1.12] tracking-[-0.01em]">
              {content.heroTitle}
            </h1>
            <p className="mt-6 text-[1.1875rem] leading-[1.75] text-fg">
              {content.heroLead}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <DownloadMenu
                downloads={release.downloads}
                platform={release.platform}
                strings={downloadStrings}
              />
              <span className="text-[0.9375rem] text-fg-muted">
                {freeLine}
              </span>
            </div>
          </section>

          {/* Plate: the shelf */}
          <div className="mt-14 sm:mt-16">
            <Plate
              base="shelf"
              alt={content.shelfAlt}
              caption={content.shelfCaption}
              eager
            />
          </div>

          {/* The page */}
          <section className="mt-20 max-w-[36rem] sm:mt-24">
            <h2 className="text-[clamp(1.5rem,3vw,1.9rem)] font-normal leading-[1.18] tracking-[-0.01em]">
              {content.readerTitle}
            </h2>
            <p className="mt-5 text-[1.0625rem] leading-[1.75] text-fg">
              {content.readerBody}
            </p>
          </section>
          <div className="mt-10">
            <Plate
              base="reader"
              alt={content.readerAlt}
              caption={content.readerCaption}
            />
          </div>

          {/* The memory */}
          <section className="mt-20 max-w-[36rem] sm:mt-24">
            <h2 className="text-[clamp(1.5rem,3vw,1.9rem)] font-normal leading-[1.18] tracking-[-0.01em]">
              {content.memoryTitle}
            </h2>
            <p className="mt-5 text-[1.0625rem] leading-[1.75] text-fg">
              {content.memoryBody}
            </p>
          </section>
          <div className="mt-10">
            <Plate
              base="context"
              alt={content.contextAlt}
              caption={content.contextCaption}
            />
          </div>

          {/* The plugins */}
          <section className="mt-20 max-w-[36rem] sm:mt-24">
            <h2 className="text-[clamp(1.5rem,3vw,1.9rem)] font-normal leading-[1.18] tracking-[-0.01em]">
              {content.pluginTitle}
            </h2>
            <p className="mt-5 text-[1.0625rem] leading-[1.75] text-fg">
              {content.pluginBody}
            </p>
          </section>
          <div className="mt-10">
            <Plate
              base="plugins"
              alt={content.pluginAlt}
              caption={content.pluginCaption}
            />
          </div>

          {/* The sync */}
          <section className="mt-20 max-w-[36rem] sm:mt-24">
            <h2 className="text-[clamp(1.5rem,3vw,1.9rem)] font-normal leading-[1.18] tracking-[-0.01em]">
              {content.syncTitle}
            </h2>
            <p className="mt-5 text-[1.0625rem] leading-[1.75] text-fg">
              {content.syncBody}
            </p>
          </section>

          {/* In short */}
          <section className="mt-20 max-w-[36rem] sm:mt-24">
            <h2 className="text-[clamp(1.5rem,3vw,1.9rem)] font-normal leading-[1.18] tracking-[-0.01em]">
              {content.inShortTitle}
            </h2>
            <dl className="mt-8">
              {content.notes.map(({ title, body }, index) => (
                <div
                  key={title}
                  className={index === 0 ? "py-5" : "border-t border-border py-5"}
                >
                  <dt className="text-[1.0625rem] font-medium">{title}</dt>
                  <dd className="mt-1.5 text-[1.0625rem] leading-[1.7] text-fg-muted">
                    {body}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Download */}
          <DownloadSection
            downloads={release.downloads}
            platform={release.platform}
            tag={release.tag}
            strings={downloadStrings}
          />
        </main>

        <SiteFooter locale={locale} />
      </div>
    </div>
  );
}
