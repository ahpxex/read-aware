import { Link } from "@tanstack/react-router";
import { REPO_URL } from "../lib/releases";
import { DISCORD_URL, HEADER_ICON_URL } from "../lib/site";

/**
 * The shared site header. Each page places it inside its own width container,
 * so the landing's narrow column and the docs' wider grid both line up with it.
 */
export function SiteHeader() {
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
          to="/docs"
          activeProps={{ className: "text-fg" }}
          className="transition-colors hover:text-fg"
        >
          Docs
        </Link>
        <Link
          to="/blog"
          activeProps={{ className: "text-fg" }}
          className="transition-colors hover:text-fg"
        >
          Blog
        </Link>
        <Link to="/" hash="download" className="transition-colors hover:text-fg">
          Download
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
      </nav>
    </header>
  );
}
