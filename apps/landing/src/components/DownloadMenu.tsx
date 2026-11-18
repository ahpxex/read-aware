import { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { Popover, buttonClassName } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { RELEASES_URL, type PlatformDownload, type PlatformId } from "../lib/releases";

export type DownloadStrings = {
  comingSoon: string;
  download: string;
  downloadFor: (name: string) => string;
  choosePlatform: string;
};

const DEFAULT_STRINGS: DownloadStrings = {
  comingSoon: "Coming soon",
  download: "Download",
  downloadFor: (name) => `Download for ${name}`,
  choosePlatform: "Choose a platform",
};

type DownloadMenuProps = {
  downloads: PlatformDownload[];
  platform: PlatformId | null;
  strings?: DownloadStrings;
};

/**
 * The primary call to action. When the visitor's OS is known and its installer
 * has resolved, the left half downloads it in one click; the caret opens the
 * full platform list inline. It never scrolls the page — a download button
 * should download.
 *
 * The two halves are one button: the shared Button look rounds all four
 * corners, so each half squares the side it shares with the other and only the
 * group's outer corners stay round (radius.css: joined groups round only their
 * outer corners).
 */
export function DownloadMenu({ downloads, platform, strings = DEFAULT_STRINGS }: DownloadMenuProps) {
  const [open, setOpen] = useState(false);
  const detected = platform ? downloads.find((download) => download.id === platform) : undefined;
  const direct =
    detected && detected.primary && !detected.comingSoon ? { name: detected.name, url: detected.primary.url } : null;

  return (
    <div className="inline-flex items-stretch">
      {direct && (
        <a href={direct.url} className={buttonClassName({ size: "lg", className: "rounded-r-none" })}>
          {strings.downloadFor(direct.name)}
        </a>
      )}
      <Popover
        open={open}
        onOpenChange={setOpen}
        align={direct ? "right" : "left"}
        triggerLabel={direct ? strings.choosePlatform : strings.download}
        triggerClassName={buttonClassName({
          size: "lg",
          className: direct ? "rounded-l-none border-l border-inverse-fg/20 px-2.5" : undefined,
        })}
        panelClassName="w-64 p-1"
        trigger={
          <>
            {!direct && strings.download}
            <CaretDown
              size={14}
              weight="bold"
              aria-hidden="true"
              className={cn("transition-transform", open && "rotate-180")}
            />
          </>
        }
      >
        {downloads.map((download) => {
          const href = download.primary?.url ?? RELEASES_URL;

          if (download.comingSoon) {
            return (
              <div key={download.id} className="flex items-baseline justify-between px-3 py-2 text-fg-subtle">
                <span className="text-[0.9375rem]">{download.name}</span>
                <span className="text-[0.8125rem] italic">{strings.comingSoon}</span>
              </div>
            );
          }

          return (
            <a
              key={download.id}
              href={href}
              onClick={() => setOpen(false)}
              className="flex items-baseline justify-between rounded-control px-3 py-2 transition-colors hover:bg-fill"
            >
              <span className="text-[0.9375rem]">{download.name}</span>
              <span className="text-[0.8125rem] text-fg-subtle">
                {download.primary ? download.primary.url.split(".").pop() : "web"}
              </span>
            </a>
          );
        })}
      </Popover>
    </div>
  );
}
