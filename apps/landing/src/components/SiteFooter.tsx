import { Link } from "@tanstack/react-router";
import { useSiteCopy } from "../i18n/use-site-copy";
import { isBlogLocale, localizePath, type Locale } from "../lib/i18n";
import { CONTACT_EMAIL, HEADER_ICON_URL } from "../lib/site";
import { TOPIC_PAGES } from "../lib/topic-pages";

/**
 * The shared site footer; placed inside each page's width container.
 *
 * Keep secondary destinations in the initial HTML as well as the interactive
 * More menu, so visitors and crawlers can follow them without opening a menu.
 */
export function SiteFooter({ locale = "en" }: { locale?: Locale }) {
  const strings = useSiteCopy("chrome");

  return (
    <footer className="mt-8 border-t border-border py-8 text-[0.9375rem] text-fg-muted">
      <nav className="mb-5 flex flex-wrap gap-x-5 gap-y-2">
        <Link to={localizePath("/docs", locale) as never}>{strings.docs}</Link>
        <Link to={localizePath("/pricing", locale) as never}>{strings.pricing}</Link>
        <Link
          to={localizePath("/blog", isBlogLocale(locale) ? locale : "en") as never}
        >
          {strings.blog}
        </Link>
        <Link to={localizePath("/changelog", locale) as never}>{strings.changelog}</Link>
      </nav>
      {locale === "en" && (
        <p className="mb-6 flex flex-wrap gap-x-5 gap-y-1 text-[0.875rem] text-fg-subtle">
          {TOPIC_PAGES.map((page) => (
            <Link
              key={page.path}
              to={page.path}
              className="transition-colors hover:text-fg"
            >
              {page.label}
            </Link>
          ))}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <img
            src={HEADER_ICON_URL}
            alt=""
            width={20}
            height={20}
            className="h-5 w-5"
          />
          <span className="text-fg">ReadAware</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <Link
            to={localizePath("/privacy", locale) as never}
            className="transition-colors hover:text-fg"
          >
            {strings.privacy}
          </Link>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="transition-colors hover:text-fg"
          >
            {CONTACT_EMAIL}
          </a>
          <span>{strings.tagline}</span>
        </div>
      </div>
    </footer>
  );
}
