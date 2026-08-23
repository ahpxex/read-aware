import { ArrowSquareOut } from "@phosphor-icons/react";
import { Body, Button, Dialog, Heading, Skeleton } from "@read-aware/ui";
import { useLocale, useTranslation } from "../../../i18n";
import { openExternalUrl } from "../../../platform/external-link";
import type { ChangelogGroupKind, WhatsNewEntry } from "../lib/changelog-feed";
import { changelogUrlForLocale } from "../lib/whats-new";

/**
 * The post-upgrade notice, as a dialog instead of the old header chip: a
 * one-time announcement has no business living in the header, where it
 * competed with (and on phones overlapped) the primary navigation. The
 * release notes render right here — the same hand-written registry the
 * website changelog serves — with the series codename beside the version,
 * mirroring the site's typography. Versions the site hasn't curated
 * (pre-releases) fall back to one line plus the external link; closing the
 * dialog — either button, Escape, or the backdrop — dismisses it for good.
 * Users who dislike it can turn it off in Settings → General.
 *
 * Presentation only. Which version to announce, and fetching its notes, is the
 * container's job (`WhatsNewDialog`) — which is what lets the loading, curated
 * and uncurated bodies each be rendered on their own.
 */

/** What separates a run-in title from its sentence, per script — the site
 *  renders the same map (ChangelogPage); titles in the registry carry no
 *  trailing punctuation by contract, so the dialog supplies it. */
const LEAD_IN: Record<string, string> = {
  en: ". ",
  de: ". ",
  ru: ". ",
  es: ". ",
  fr: " : ",
  "zh-Hans": "：",
  "zh-Hant": "：",
  ja: "：",
};

const GROUP_ORDER: ChangelogGroupKind[] = ["new", "improved", "fixed"];

type WhatsNewDialogViewProps = {
  /** The version being announced; null renders nothing. */
  version: string | null;
  /** The release's series codename, shown beside the version. */
  codename: string | null;
  /** The curated notes, or null when the site has none for this version. */
  entry: WhatsNewEntry | null;
  /** The notes are still in flight; the body renders as skeletons. */
  loading: boolean;
  close: () => void;
};

export function WhatsNewDialogView({
  version,
  codename,
  entry,
  loading,
  close,
}: WhatsNewDialogViewProps) {
  const { t } = useTranslation("nav");
  const locale = useLocale();

  if (version === null) return null;

  const leadIn = LEAD_IN[locale] ?? LEAD_IN.en;
  const groupLabel: Record<ChangelogGroupKind, string> = {
    new: t("update.whatsNewNew"),
    improved: t("update.whatsNewImproved"),
    fixed: t("update.whatsNewFixed"),
  };

  return (
    <Dialog
      open
      onClose={close}
      aria-label={t("update.whatsNewTitle", { version })}
      // p-0: the scrolling body spans the panel's full width, so its
      // scrollbar hugs the panel edge instead of floating 32px inside the
      // padding — each section below carries its own padding instead.
      className="max-w-md p-0"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-8 pb-3 pt-8">
        <Heading as="h2" size="xl">
            {t("update.whatsNewTitle", { version })}
            {codename && (
              <span className="ml-2 font-serif italic font-normal tracking-normal text-fg-muted">
                {codename}
              </span>
            )}
          </Heading>
          {entry?.date && (
            <time
              dateTime={entry.date}
              className="text-xs leading-relaxed text-fg-subtle"
            >
              {new Date(`${entry.date}T00:00:00Z`).toLocaleDateString(locale, {
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: "UTC",
              })}
            </time>
          )}
        </div>

        {loading ? (
          // Skeletons echo the filled layout's shape — a summary paragraph,
          // a group heading, list items — so the swap-in doesn't reflow.
          <div className="max-h-[46vh] space-y-5 px-8 py-5">
            <Skeleton lines={3} className="w-full" />
            <div className="space-y-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton lines={4} className="w-full" />
            </div>
          </div>
        ) : entry ? (
          <div className="max-h-[46vh] space-y-5 overflow-y-auto px-8 py-5">
            <Body as="p">{entry.text.summary}</Body>
            {GROUP_ORDER.map((kind) => {
              const group = entry.text.groups.find((g) => g.kind === kind);
              if (!group) return null;
              return (
                <div key={kind}>
                  <h3 className="text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-fg-muted">
                    {groupLabel[kind]}
                  </h3>
                  <ul
                    className={`mt-3 list-disc pl-[1.15em] marker:text-fg-subtle ${
                      kind === "new" ? "space-y-4" : "space-y-2.5"
                    }`}
                  >
                    {group.items.map((item, index) => (
                      <li
                        key={index}
                        className="pl-[0.15em] text-sm leading-relaxed text-fg-muted"
                      >
                        {item.title && (
                          <strong className="font-medium text-fg">
                            {item.title}
                            {leadIn}
                          </strong>
                        )}
                        {item.body}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : (
          <Body as="p" className="px-8 py-5">
            {t("update.whatsNewBody")}
          </Body>
        )}

        <div className="flex justify-end gap-2 px-8 pb-8 pt-5">
          <Button
            variant="ghost"
            onClick={() => {
              // webview 吞 target=_blank——外链必须走 opener 插件
              void openExternalUrl(changelogUrlForLocale(locale));
              close();
            }}
          >
            {t("update.whatsNewChangelog")}
            <ArrowSquareOut size={14} weight="regular" aria-hidden="true" />
          </Button>
          <Button onClick={close}>{t("update.whatsNewDone")}</Button>
        </div>
    </Dialog>
  );
}
