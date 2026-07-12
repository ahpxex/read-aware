import { cn } from "@read-aware/ui/cn";
import { RELEASES_URL, type PlatformDownload, type PlatformId } from "../lib/releases";

type DownloadSectionProps = {
  downloads: PlatformDownload[];
  platform: PlatformId | null;
  tag: string | null;
};

export function DownloadSection({ downloads, platform, tag }: DownloadSectionProps) {
  return (
    <section id="download" className="mt-20 max-w-[36rem] scroll-mt-8 sm:mt-24">
      <h2 className="text-[clamp(1.5rem,3vw,1.9rem)] font-normal leading-[1.18] tracking-[-0.01em]">
        Get ReadAware
      </h2>
      <p className="mt-5 text-[1.0625rem] leading-[1.75] text-fg">
        Free and local-first. Bring your own API key; your library and memory
        stay on your device.
        {tag ? ` The latest release is ${tag}.` : ""}
      </p>

      <ul className="mt-8">
        {downloads.map((download, index) => {
          const recommended = download.id === platform;
          const href = download.primary?.url ?? RELEASES_URL;
          const isPage = !download.primary;

          return (
            <li
              key={download.id}
              className={cn(
                "flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4",
                index > 0 && "border-t border-border",
              )}
            >
              <span className="text-[1.0625rem]">
                {download.name}
                {recommended && (
                  <span className="ml-2 text-[0.875rem] text-fg-subtle">
                    — your platform
                  </span>
                )}
              </span>

              {download.comingSoon ? (
                <span className="text-[0.9375rem] italic text-fg-subtle">
                  Coming soon
                </span>
              ) : (
                <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[0.9375rem]">
                  <a
                    href={href}
                    className="underline underline-offset-4 transition-colors hover:text-fg-muted"
                    {...(isPage
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    {download.primary?.label ?? "Download"}
                  </a>
                  {download.extras.map((extra) => (
                    <a
                      key={extra.url}
                      href={extra.url}
                      className="text-fg-subtle underline underline-offset-4 transition-colors hover:text-fg-muted"
                    >
                      {extra.label}
                    </a>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-[0.875rem] italic leading-relaxed text-fg-muted">
        Desktop builds aren't code-signed yet; macOS and Windows may ask you to
        confirm the app on first launch.
      </p>
    </section>
  );
}
