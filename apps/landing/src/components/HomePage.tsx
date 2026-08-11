import { useEffect } from "react";
import { DownloadMenu } from "./DownloadMenu";
import { DownloadSection } from "./DownloadSection";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { useDocumentLang } from "../hooks/useDocumentLang";
import { useLatestRelease } from "../hooks/useLatestRelease";
import { HOME } from "../lib/home-content";
import { LOCALES, LOCALE_CHOICE_KEY, type Locale } from "../lib/i18n";

// Cache-buster for the retaken screenshot set (bump when replacing the files).
const SHOT_VERSION = "?v=041";

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

// A screenshot printed as a plate: a hairline frame does the separating, and a
// plain caption says what it is. No shadow, no border-radius, no figure number.
function Plate({
  src,
  alt,
  caption,
  eager = false,
}: {
  src: string;
  alt: string;
  caption: string;
  eager?: boolean;
}) {
  return (
    <figure className="m-0">
      <img
        src={src}
        alt={alt}
        width={2400}
        height={1600}
        loading={eager ? "eager" : "lazy"}
        className="block w-full border border-border-strong"
      />
      <figcaption className="mt-3 text-[0.9375rem] italic leading-normal text-fg-muted">
        {caption}
      </figcaption>
    </figure>
  );
}

export function HomePage({ locale }: { locale: Locale }) {
  useDocumentLang(locale);
  useBrowserLocaleRedirect(locale);
  const release = useLatestRelease();
  const content = HOME[locale];

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
                strings={content.download}
              />
              <span className="text-[0.9375rem] text-fg-muted">
                {content.freeLine(release.tag)}
              </span>
            </div>
          </section>

          {/* Plate: the shelf */}
          <div className="mt-14 sm:mt-16">
            <Plate
              src={`/screenshots/shelf.webp${SHOT_VERSION}`}
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
              src={`/screenshots/reader.webp${SHOT_VERSION}`}
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
              src={`/screenshots/context.webp${SHOT_VERSION}`}
              alt={content.contextAlt}
              caption={content.contextCaption}
            />
          </div>

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
            strings={content.download}
          />
        </main>

        <SiteFooter locale={locale} />
      </div>
    </div>
  );
}
