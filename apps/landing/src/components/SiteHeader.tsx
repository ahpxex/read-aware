import { Link, useLocation } from "@tanstack/react-router";
import { isDocsLocale, localizePath, UI_STRINGS, type Locale } from "../lib/i18n";
import { REPO_URL } from "../lib/releases";
import { HEADER_ICON_URL } from "../lib/site";
import { MoreMenu } from "./MoreMenu";

/** Docs exist only in the docs-locale subset; other locales fall back to English. */
function docsPath(locale: Locale): string {
  return isDocsLocale(locale) ? localizePath("/docs", locale) : "/docs";
}

/**
 * The shared site header. Each page places it inside its own width container,
 * so the landing's narrow column and the docs' wider grid both line up with it.
 * The language switcher lives inside MoreMenu rather than beside it — see
 * that component for why.
 *
 * Three named links and an overflow menu, deliberately: the row stays this
 * length however much the site grows, because everything new goes into
 * MoreMenu instead. Download keeps its place — it is the landing's primary
 * call to action, and burying it would cost a click from every docs page.
 */
export function SiteHeader({ locale = "en" }: { locale?: Locale }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const strings = UI_STRINGS[locale];

  return (
    <header className="flex flex-wrap items-center justify-between gap-y-2 py-7">
      <Link to="/" className="flex items-center gap-2.5">
        <img
          src={HEADER_ICON_URL}
          alt=""
          width={26}
          height={26}
          className="h-[26px] w-[26px]"
        />
        <span className="text-[1.0625rem] font-medium tracking-tight">
          ReadAware
        </span>
      </Link>
      <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.9375rem] text-fg-muted">
        <Link
          to={docsPath(locale)}
          activeProps={{ className: "text-fg" }}
          className="transition-colors hover:text-fg"
        >
          {strings.docs}
        </Link>
        <Link to="/" hash="download" className="transition-colors hover:text-fg">
          {strings.download}
        </Link>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-fg"
        >
          GitHub
        </a>
        <MoreMenu locale={locale} pathname={pathname} />
      </nav>
    </header>
  );
}
