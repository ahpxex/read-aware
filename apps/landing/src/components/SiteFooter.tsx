import { Link } from "@tanstack/react-router";
import { REPO_URL } from "../lib/releases";
import { CONTACT_EMAIL, DISCORD_URL, HEADER_ICON_URL } from "../lib/site";

/** The shared site footer; placed inside each page's width container. */
export function SiteFooter() {
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
        <Link to="/docs" className="transition-colors hover:text-fg">
          Docs
        </Link>
        <Link to="/blog" className="transition-colors hover:text-fg">
          Blog
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
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="transition-colors hover:text-fg"
        >
          {CONTACT_EMAIL}
        </a>
        <span>Local-first. Yours.</span>
      </div>
    </footer>
  );
}
