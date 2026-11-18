import { ArrowSquareOut, DiscordLogo, Star, WechatLogo } from "@phosphor-icons/react";
import { Body, Button, buttonClassName, Dialog, Heading, QrCode, Skeleton } from "@read-aware/ui";
import { useExternalLink } from "../../../hooks/useExternalLink";
import { useLocale, useTranslation } from "../../../i18n";
import { PROJECT_DISCORD_URL, PROJECT_REPOSITORY_URL } from "../../../platform/site-url";
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
 * dialog — Continue reading, Escape, or the backdrop — dismisses it for good.
 * Community links stay available while the notes load and leave the dialog
 * open, so opening GitHub does not consume the invitation to join Discord.
 * Where WeChat is the community's home — the container decides for whom — the
 * group's invitation sits beside that text as a code to scan: WeChat groups
 * are joined from a phone, and a link would only open a page asking for one.
 * It shares the row with the text instead of taking one of its own, because
 * this section does not scroll and every line it grows is taken from the notes.
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
  /** Missing search credentials; opens the existing AI settings page. */
  configureSearch?: () => void;
  /** The WeChat group's invitation, when this reader should be offered it. */
  wechatGroupUrl?: string | null;
};

export function WhatsNewDialogView({
  version,
  codename,
  entry,
  loading,
  close,
  configureSearch,
  wechatGroupUrl,
}: WhatsNewDialogViewProps) {
  const { t } = useTranslation(["nav", "common", "settings"]);
  const locale = useLocale();
  const openLink = useExternalLink();
  const openChangelog = useExternalLink(close);

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
      className="max-w-lg p-0"
    >
      <div className="flex max-h-[calc(100dvh-4rem)] flex-col">
        <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-6 pb-3 pt-6 sm:px-8 sm:pt-8">
          <Heading as="h2" size="xl">
            {t("update.whatsNewTitle", { version })}
            {codename && (
              <span className="ml-2 font-serif italic font-normal tracking-normal text-fg-muted"> {codename}</span>
            )}
          </Heading>
          {entry?.date && (
            <time dateTime={entry.date} className="text-xs leading-relaxed text-fg-subtle">
              {new Date(`${entry.date}T00:00:00Z`).toLocaleDateString(locale, {
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: "UTC",
              })}
            </time>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto">
          {configureSearch && (
            <section className="border-b border-border px-6 py-5 sm:px-8">
              <h3 className="font-sans text-sm font-medium text-fg">{t("settings:search.title")}</h3>
              <Body as="p" className="mt-1.5">
                {t("settings:search.keyHint")}
              </Body>
              <Button className="mt-3" variant="outline" size="sm" onClick={configureSearch}>
                {t("settings:search.keyPlaceholder")}
              </Button>
            </section>
          )}
          {loading ? (
            // Skeletons echo the filled layout's shape — a summary paragraph,
            // a group heading, list items — so the swap-in doesn't reflow.
            <div className="space-y-5 px-6 py-5 sm:px-8">
              <Skeleton lines={3} className="w-full" />
              <div className="space-y-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton lines={4} className="w-full" />
              </div>
            </div>
          ) : entry ? (
            <div className="space-y-5 px-6 py-5 sm:px-8">
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
                        <li key={index} className="pl-[0.15em] text-sm leading-relaxed text-fg-muted">
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
            <Body as="p" className="px-6 py-5 sm:px-8">
              {t("update.whatsNewBody")}
            </Body>
          )}
        </div>

        <section className="shrink-0 border-t border-border px-6 pb-4 pt-5 sm:px-8">
          <div className="flex items-start gap-5">
            <div className="min-w-0 flex-1">
              <h3 className="font-sans text-sm font-medium text-fg">{t("common:community.title")}</h3>
              <Body as="p" className="mt-1.5">
                {t("common:community.description")}
              </Body>
            </div>
            {wechatGroupUrl && (
              <figure className="shrink-0">
                <QrCode value={wechatGroupUrl} label={t("common:community.wechatQrLabel")} size={112} />
                <figcaption className="mt-1.5 flex items-center justify-center gap-1 text-caption text-fg-muted">
                  <WechatLogo size={14} aria-hidden="true" />
                  {t("common:community.wechatCaption")}
                </figcaption>
              </figure>
            )}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <a
              href={PROJECT_REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={openLink}
              className={buttonClassName()}
            >
              <Star size={16} aria-hidden="true" />
              {t("common:community.star")}
            </a>
            <a
              href={PROJECT_DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={openLink}
              className={buttonClassName({ variant: "outline" })}
            >
              <DiscordLogo size={18} aria-hidden="true" />
              {t("common:community.discord")}
            </a>
          </div>
        </section>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-6 pb-6 sm:px-8">
          <a
            href={changelogUrlForLocale(locale)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={openChangelog}
            className={buttonClassName({ variant: "link", size: "sm" })}
          >
            {t("update.whatsNewChangelog")}
            <ArrowSquareOut size={14} weight="regular" aria-hidden="true" />
          </a>
          <Button variant="ghost" size="sm" onClick={close}>
            {t("update.whatsNewDone")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
