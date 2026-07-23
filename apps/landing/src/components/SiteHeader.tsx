import { Link, useLocation } from "@tanstack/react-router";
import { UI_STRINGS, hasLocaleVariants, type Locale } from "../lib/i18n";
import { REPO_URL } from "../lib/releases";
import { DISCORD_URL, HEADER_ICON_URL } from "../lib/site";
import { LanguageMenu } from "./LanguageMenu";

const NAV_TO = {
  en: { docs: "/docs", blog: "/blog" },
  zh: { docs: "/zh/docs", blog: "/zh/blog" },
  ja: { docs: "/ja/docs", blog: "/ja/blog" },
} as const;

/**
 * The shared site header. Each page places it inside its own width container,
 * so the landing's narrow column and the docs' wider grid both line up with it.
 * On docs/blog pages a language switcher appears; it uses plain anchors (full
 * loads) so each locale boots from its own prerendered HTML.
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
          to={NAV_TO[locale].docs}
          activeProps={{ className: "text-fg" }}
          className="transition-colors hover:text-fg"
        >
          {strings.docs}
        </Link>
        <Link
          to={NAV_TO[locale].blog}
          activeProps={{ className: "text-fg" }}
          className="transition-colors hover:text-fg"
        >
          {strings.blog}
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
        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-fg"
        >
          Discord
        </a>
        {hasLocaleVariants(pathname) && (
          <LanguageMenu locale={locale} pathname={pathname} />
        )}
      </nav>
    </header>
  );
}
