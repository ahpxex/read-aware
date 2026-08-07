import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, CaretDown } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { UI_STRINGS, type Locale } from "../lib/i18n";
import { CONTACT_EMAIL, DISCORD_URL } from "../lib/site";

/**
 * The header's overflow menu, mirroring LanguageMenu's popover pattern.
 *
 * It exists so the header can stay at four items no matter how much the site
 * grows: everything past Docs / Download / GitHub lands here instead of
 * lengthening the row. That also lets the footer stop repeating the header —
 * this menu, not the footer, is now where the secondary links live.
 *
 * Internal destinations are router Links (client navigation); external ones
 * are plain anchors marked with an arrow so the boundary is visible before
 * the click.
 */
const MORE_TO = {
  en: { blog: "/blog", changelog: "/changelog" },
  zh: { blog: "/zh/blog", changelog: "/zh/changelog" },
  ja: { blog: "/ja/blog", changelog: "/ja/changelog" },
} as const;

const itemClass =
  "flex items-center justify-between gap-3 rounded px-3 py-2 text-[0.9375rem] text-fg-muted transition-colors hover:bg-fill hover:text-fg";

export function MoreMenu({ locale = "en" }: { locale?: Locale }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const strings = UI_STRINGS[locale];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/25"
      >
        {strings.more}
        <CaretDown
          size={11}
          weight="bold"
          aria-hidden="true"
          className={cn("transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.625rem)] z-30 w-44 rounded-md border border-border-strong bg-surface p-1 shadow-[0_10px_30px_-12px_rgba(38,36,32,0.28)]"
        >
          <Link
            to={MORE_TO[locale].blog}
            role="menuitem"
            onClick={close}
            activeProps={{ className: "text-fg" }}
            className={itemClass}
          >
            {strings.blog}
          </Link>
          <Link
            to={MORE_TO[locale].changelog}
            role="menuitem"
            onClick={close}
            activeProps={{ className: "text-fg" }}
            className={itemClass}
          >
            {strings.changelog}
          </Link>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={close}
            className={itemClass}
          >
            Discord
            <ArrowUpRight size={13} aria-hidden="true" className="shrink-0" />
          </a>
          {/* No "Release notes" entry: it would sit one row under Changelog
              pointing at nearly the same thing. The changelog page links to
              the GitHub release per version and in full at the bottom, which
              is where someone who wants the complete record is already looking. */}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            role="menuitem"
            onClick={close}
            className={itemClass}
          >
            Email
          </a>
        </div>
      )}
    </div>
  );
}
