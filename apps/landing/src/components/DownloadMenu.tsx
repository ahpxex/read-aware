import { useEffect, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { RELEASES_URL, type PlatformDownload, type PlatformId } from "../lib/releases";

type DownloadMenuProps = {
  downloads: PlatformDownload[];
  platform: PlatformId | null;
};

/**
 * The primary call to action. When the visitor's OS is known and its installer
 * has resolved, the left half downloads it in one click; the caret opens the
 * full platform list inline. It never scrolls the page — a download button
 * should download.
 */
export function DownloadMenu({ downloads, platform }: DownloadMenuProps) {
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

  const detected = platform
    ? downloads.find((download) => download.id === platform)
    : undefined;
  const direct =
    detected && detected.primary && !detected.comingSoon
      ? { name: detected.name, url: detected.primary.url }
      : null;

  const solid =
    "inline-flex h-11 items-center bg-fg text-base text-inverse-fg transition-colors hover:bg-fg/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/25";

  return (
    <div ref={rootRef} className="relative inline-flex">
      <div className="inline-flex overflow-hidden rounded-md">
        {direct ? (
          <a href={direct.url} className={cn(solid, "px-5")}>
            Download for {direct.name}
          </a>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={open}
            className={cn(solid, "px-5")}
          >
            Download
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label="Choose a platform"
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(solid, "border-l border-inverse-fg/20 px-2.5")}
        >
          <CaretDown
            size={14}
            weight="bold"
            aria-hidden="true"
            className={cn("transition-transform", open && "rotate-180")}
          />
        </button>
      </div>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-64 rounded-md border border-border-strong bg-surface p-1 shadow-[0_10px_30px_-12px_rgba(38,36,32,0.28)]"
        >
          {downloads.map((download) => {
            const href = download.primary?.url ?? RELEASES_URL;

            if (download.comingSoon) {
              return (
                <div
                  key={download.id}
                  className="flex items-baseline justify-between px-3 py-2 text-fg-subtle"
                >
                  <span className="text-[0.9375rem]">{download.name}</span>
                  <span className="text-[0.8125rem] italic">Coming soon</span>
                </div>
              );
            }

            return (
              <a
                key={download.id}
                href={href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-baseline justify-between rounded px-3 py-2 transition-colors hover:bg-fill"
              >
                <span className="text-[0.9375rem]">{download.name}</span>
                <span className="text-[0.8125rem] text-fg-subtle">
                  {download.primary ? download.primary.url.split(".").pop() : "web"}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
