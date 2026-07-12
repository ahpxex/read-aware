import {
  AndroidLogo,
  AppleLogo,
  LinuxLogo,
  WindowsLogo,
  type Icon,
} from "@phosphor-icons/react";
import { Body, Caption, Eyebrow, Heading, Stack } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { LinkButton } from "./LinkButton";
import { RELEASES_URL, type PlatformDownload, type PlatformId } from "../lib/releases";

const PLATFORM_ICON: Record<PlatformId, Icon> = {
  macos: AppleLogo,
  ios: AppleLogo,
  windows: WindowsLogo,
  linux: LinuxLogo,
  android: AndroidLogo,
};

type DownloadSectionProps = {
  downloads: PlatformDownload[];
  platform: PlatformId | null;
  tag: string | null;
};

export function DownloadSection({ downloads, platform, tag }: DownloadSectionProps) {
  return (
    <section id="download" className="mx-auto max-w-5xl scroll-mt-20 px-6 py-20 sm:py-24">
      <Stack gap="sm" className="max-w-2xl">
        <Eyebrow>Get the app</Eyebrow>
        <Heading as="h2" size="3xl">
          Download ReadAware
        </Heading>
        <Body className="text-stone-600">
          Free and local-first. Bring your own AI key — your library and memory
          stay on your device.
          {tag ? ` Latest release ${tag}.` : ""}
        </Body>
      </Stack>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {downloads.map((download) => {
          const PlatformIcon = PLATFORM_ICON[download.id];
          const recommended = download.id === platform;
          const href = download.primary?.url ?? RELEASES_URL;
          const isPage = !download.primary;

          return (
            <div
              key={download.id}
              className={cn(
                "flex flex-col gap-4 rounded-lg border p-5",
                recommended
                  ? "border-fg-subtle bg-paper-warm"
                  : "border-border bg-surface",
              )}
            >
              <div className="flex items-center gap-3">
                <PlatformIcon
                  size={22}
                  weight="regular"
                  aria-hidden="true"
                  className="text-stone-700"
                />
                <Heading as="h3" size="xl">
                  {download.name}
                </Heading>
                {recommended && (
                  <Caption className="ml-auto text-stone-500">
                    Your platform
                  </Caption>
                )}
              </div>

              {download.comingSoon ? (
                <Caption className="text-stone-400">Coming soon</Caption>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <LinkButton
                    href={href}
                    variant={recommended ? "solid" : "outline"}
                    size="sm"
                    {...(isPage
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    {download.primary?.label ?? "Download"}
                  </LinkButton>
                  {download.extras.map((extra) => (
                    <a
                      key={extra.url}
                      href={extra.url}
                      className="font-sans text-sm text-stone-500 underline underline-offset-4 transition-colors hover:text-stone-800"
                    >
                      {extra.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Caption className="mt-6 block text-stone-400">
        Desktop builds aren't OS-code-signed yet — macOS and Windows may ask you
        to confirm the app on first launch.
      </Caption>
    </section>
  );
}
