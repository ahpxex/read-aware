import { cn } from "@read-aware/ui/cn";
import { useSiteCopy } from "../i18n/use-site-copy";
import { useDocumentLang } from "../hooks/useDocumentLang";
import { LOCALE_LANG, type Locale } from "../lib/i18n";
import { REPO_URL } from "../lib/releases";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/**
 * The shared changelog renderer. Every locale reads the same resource shape,
 * so a new release changes content only and never adds route implementation.
 */
type ChangelogGroupKind = "new" | "improved" | "fixed";

export function ChangelogPage({ locale }: { locale: Locale }) {
  useDocumentLang(locale);
  const strings = useSiteCopy("chrome");
  const copy = useSiteCopy("changelog");

  const groupHeading: Record<ChangelogGroupKind, string> = {
    new: strings.changelogNew,
    improved: strings.changelogImproved,
    fixed: strings.changelogFixed,
  };

  return (
    <div className="min-h-screen bg-paper text-fg">
      <div className="mx-auto max-w-3xl px-6">
        <SiteHeader locale={locale} />
        <main className="max-w-[40rem] pb-12 pt-6 sm:pt-8">
          <h1 className="text-[2rem] font-medium tracking-tight">
            {strings.changelogTitle}
          </h1>
          <p className="mt-3 text-[1.0625rem] leading-relaxed text-fg-muted">
            {strings.changelogLead}
          </p>

          {copy.entries.map((entry) => {
            return (
              <section key={entry.version} className="mt-14">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-3">
                  <h2 className="text-[1.375rem] font-medium tracking-tight">
                    {entry.version}
                    {entry.codename && (
                      <span className="ml-2 font-serif italic text-fg-muted">
                        {entry.codename}
                      </span>
                    )}
                  </h2>
                  {/* The date is machine-readable for feeds and crawlers, and
                      rendered in the reader's own locale conventions. */}
                  <time
                    dateTime={entry.date}
                    className="text-[0.9375rem] text-fg-subtle"
                  >
                    {new Date(`${entry.date}T00:00:00Z`).toLocaleDateString(
                      LOCALE_LANG[locale],
                      { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
                    )}
                  </time>
                  <a
                    href={`${REPO_URL}/releases/tag/v${entry.version}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[0.9375rem] text-fg-subtle transition-colors hover:text-fg"
                  >
                    {strings.changelogRelease} →
                  </a>
                </div>

                <p className="mt-5 leading-relaxed text-fg-muted">
                  {entry.summary}
                </p>

                {entry.groups.map((group) => (
                  <div key={group.kind} className="mt-8">
                    <h3 className="text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-fg-muted">
                      {groupHeading[group.kind as ChangelogGroupKind]}
                    </h3>
                    {/* Markers matter more than they look like they should:
                        without them every entry runs into the next and the
                        release reads as one wall of prose. `pl` on the list
                        plus `pl` on the item gives a hanging indent, so a
                        wrapped line aligns under its own text rather than
                        under the bullet. (A flex column here would suppress
                        ::marker entirely — that is how they went missing.) */}
                    <ul
                      className={cn(
                        "mt-3 list-disc pl-[1.15em] marker:text-fg-subtle",
                        // Headline items carry a title and run longer, so they
                        // need more air between them than one-line fixes do.
                        group.kind === "new" ? "space-y-4" : "space-y-2.5",
                      )}
                    >
                      {group.items.map((item, index) => (
                        <li
                          key={index}
                          className="pl-[0.15em] leading-relaxed text-fg-muted"
                        >
                          {"title" in item && item.title && (
                            <strong className="font-medium text-fg">
                              {item.title}
                              {copy.leadIn}
                            </strong>
                          )}
                          {item.body}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            );
          })}

          <p className="mt-14 border-t border-border pt-6">
            <a
              href={`${REPO_URL}/releases`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fg-muted transition-colors hover:text-fg"
            >
              {strings.changelogOlder}
            </a>
          </p>
        </main>
        <SiteFooter locale={locale} />
      </div>
    </div>
  );
}
