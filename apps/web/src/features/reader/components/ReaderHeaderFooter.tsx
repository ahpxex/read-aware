import type { CSSProperties, ReactNode } from "react";
import {
  BatteryCharging,
  BatteryEmpty,
  BatteryFull,
  BatteryHigh,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  type Icon,
} from "@phosphor-icons/react";
import { formatPercent, formatTime, useLocale, useTranslation } from "../../../i18n";
import type { ReaderPalette } from "../../settings";
import type { HeaderFooterItem } from "../../../domain/settings/header-footer-settings";
import { READER_STRIP_HEIGHT_PX, type HeaderFooterBand, type HeaderFooterLayout } from "../lib/header-footer-layout";
import { useReaderHeaderFooter } from "../hooks/useReaderHeaderFooter";
import type { BatteryStatus } from "../../../platform/battery";

type ReaderHeaderFooterProps = {
  layout: HeaderFooterLayout;
  /** The reader page palette — the strips paint with the page, not the chrome. */
  palette: ReaderPalette;
  /** The shell's overlay toolbars are up: the strips fade out but keep their
   *  reserved space, so the page never reflows on a chrome toggle. */
  dimmed: boolean;
  bookTitle: string;
  chapterTitle: string | null;
  /** Engine reading fraction, 0..1. */
  progress: number | undefined;
  currentPage: number;
  totalPages: number;
};

function batteryIcon({ level, charging }: BatteryStatus): Icon {
  if (charging) return BatteryCharging;
  if (level >= 0.95) return BatteryFull;
  if (level >= 0.6) return BatteryHigh;
  if (level >= 0.35) return BatteryMedium;
  if (level >= 0.15) return BatteryLow;
  if (level > 0) return BatteryWarning;
  return BatteryEmpty;
}

function StripItem({ children }: { children: ReactNode }) {
  return <span className="min-w-0 truncate">{children}</span>;
}

export function ReaderHeaderFooter({
  layout,
  palette,
  dimmed,
  bookTitle,
  chapterTitle,
  progress,
  currentPage,
  totalPages,
}: ReaderHeaderFooterProps) {
  const { t } = useTranslation("reader");
  // Formatted values follow the app language; subscribing re-renders on switch.
  useLocale();
  const wants = new Set(
    [layout.header, layout.footer].flatMap((band) => (band ? [...band.left, ...band.center, ...band.right] : [])),
  );
  const { now, battery } = useReaderHeaderFooter({ time: wants.has("time"), battery: wants.has("battery") });

  const content = (item: HeaderFooterItem): ReactNode => {
    switch (item) {
      case "chapter":
        return chapterTitle || null;
      case "bookTitle":
        return bookTitle || null;
      case "progress":
        return progress != null ? formatPercent(Math.min(100, Math.max(0, progress * 100))) : null;
      case "pages":
        return totalPages > 0 ? t("headerFooter.pages", { page: currentPage, total: totalPages }) : null;
      case "time":
        return formatTime(now);
      case "battery": {
        if (!battery) return null;
        const BatteryIcon = batteryIcon(battery);
        return (
          <span className="inline-flex items-center gap-1">
            <BatteryIcon size={14} aria-hidden="true" />
            {formatPercent(battery.level * 100)}
          </span>
        );
      }
    }
  };

  const renderBand = (band: HeaderFooterBand, side: "header" | "footer") => (
    <div
      aria-label={side === "header" ? t("headerFooter.headerLabel") : t("headerFooter.footerLabel")}
      className="pointer-events-none absolute inset-x-0 flex items-center font-sans text-caption tabular-nums transition-opacity duration-200"
      style={
        {
          ...(side === "header" ? { top: "var(--ra-safe-top)" } : { bottom: "var(--ra-safe-bottom)" }),
          height: READER_STRIP_HEIGHT_PX,
          paddingLeft: "max(1.25rem, var(--ra-safe-left))",
          paddingRight: "max(1.25rem, var(--ra-safe-right))",
          color: palette.muted,
          opacity: dimmed ? 0 : 1,
        } satisfies CSSProperties
      }
    >
      {(["left", "center", "right"] as const).map((slot) => (
        <div
          key={slot}
          className={`flex items-center ${
            slot === "center"
              ? // Capped, not fixed: a long item shrinks and truncates instead
                // of colliding with the flanks; equal flex-1 flanks keep it centered.
                "min-w-0 max-w-[60%] justify-center"
              : `min-w-0 flex-1 ${slot === "left" ? "justify-start" : "justify-end"}`
          }`}
        >
          {band[slot]
            .map((item) => ({ item, node: content(item) }))
            .filter(({ node }) => node != null)
            .map(({ item, node }, index) => (
              <span key={item} className="flex min-w-0 items-center">
                {index > 0 && (
                  <span aria-hidden="true" className="mx-1.5 shrink-0 opacity-60">
                    ·
                  </span>
                )}
                <StripItem>{node}</StripItem>
              </span>
            ))}
        </div>
      ))}
    </div>
  );

  return (
    <>
      {layout.header && renderBand(layout.header, "header")}
      {layout.footer && renderBand(layout.footer, "footer")}
    </>
  );
}
