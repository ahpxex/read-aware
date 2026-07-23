import { useEffect, useRef, useState } from "react";
import { CaretDown, Check, Translate } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import {
  LOCALES,
  LOCALE_LABEL,
  LOCALE_LANG,
  localizePath,
  type Locale,
} from "../lib/i18n";

/**
 * The language switcher: a quiet icon trigger opening a small anchored menu,
 * mirroring DownloadMenu's popover pattern. Entries are plain anchors (full
 * loads) so each locale boots from its own prerendered HTML.
 */
export function LanguageMenu({
  locale,
  pathname,
}: {
  locale: Locale;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Change language"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/25"
      >
        <Translate size={17} aria-hidden="true" />
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
          className="absolute right-0 top-[calc(100%+0.625rem)] z-30 w-36 rounded-md border border-border-strong bg-surface p-1 shadow-[0_10px_30px_-12px_rgba(38,36,32,0.28)]"
        >
          {LOCALES.map((target) => (
            <a
              key={target}
              href={localizePath(pathname, target)}
              role="menuitem"
              lang={LOCALE_LANG[target]}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center justify-between rounded px-3 py-2 text-[0.9375rem] transition-colors hover:bg-fill",
                target === locale ? "text-fg" : "text-fg-muted",
              )}
            >
              <span>{LOCALE_LABEL[target]}</span>
              {target === locale && (
                <Check size={14} weight="bold" aria-hidden="true" />
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
