import { Link } from "@tanstack/react-router";
import { useSiteCopy } from "../i18n/use-site-copy";
import { localizePath, type Locale } from "../lib/i18n";
import { CONTACT_EMAIL, HEADER_ICON_URL } from "../lib/site";
import { TOPIC_PAGES } from "../lib/topic-pages";

/**
 * The shared site footer; placed inside each page's width container.
 *
 * It used to mirror the header link for link, which made it a second place to
 * keep in sync and a second thing to read. Now that the header's More menu
 * holds the secondary destinations, the footer only has to say whose site
 * this is and how to reach them.
 *
 * The one exception is the topic-page row: those pages (lib/topic-pages.ts)
 * exist to be found from search, and a crawlable link from every page is what
 * gets them crawled and ranked. English pages only, so only the English
 * footer carries the row.
 */
export function SiteFooter({ locale = "en" }: { locale?: Locale }) {
  const strings = useSiteCopy("chrome");

  return (
    <footer className="mt-8 border-t border-border py-8 text-[0.9375rem] text-fg-muted">
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
