import { UI_STRINGS, type Locale } from "../lib/i18n";
import { CONTACT_EMAIL, HEADER_ICON_URL } from "../lib/site";

/**
 * The shared site footer; placed inside each page's width container.
 *
 * It used to mirror the header link for link, which made it a second place to
 * keep in sync and a second thing to read. Now that the header's More menu
 * holds the secondary destinations, the footer only has to say whose site
 * this is and how to reach them.
 */
export function SiteFooter({ locale = "en" }: { locale?: Locale }) {
  const strings = UI_STRINGS[locale];

  return (
    <footer className="mt-8 flex flex-col gap-3 border-t border-border py-8 text-[0.9375rem] text-fg-muted sm:flex-row sm:items-center sm:justify-between">
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
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="transition-colors hover:text-fg"
        >
          {CONTACT_EMAIL}
        </a>
        <span>{strings.tagline}</span>
      </div>
    </footer>
  );
}
