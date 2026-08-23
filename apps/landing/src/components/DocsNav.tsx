import { Link } from "@tanstack/react-router";
import { useSiteCopy } from "../i18n/use-site-copy";
import { localizePath, type DocsLocale } from "../lib/i18n";

const NAV_SECTIONS = [
  {
    title: "startTitle" as const,
    items: [
      { to: "/docs", label: "overview" as const, exact: true },
      { to: "/docs/install", label: "install" as const },
      { to: "/docs/getting-started", label: "gettingStarted" as const },
    ],
  },
  {
    title: "pluginsTitle" as const,
    items: [
      { to: "/docs/plugins", label: "pluginsOverview" as const, exact: true },
      { to: "/docs/plugins/develop", label: "pluginsDevelop" as const },
      {
        to: "/docs/plugins/capabilities",
        label: "pluginsCapabilities" as const,
      },
      { to: "/docs/plugins/api", label: "pluginsApi" as const },
      {
        to: "/docs/plugins/publishing",
        label: "pluginsPublishing" as const,
      },
    ],
  },
] as const;

/**
 * The docs section navigation: a sticky sidebar on wide screens, a compact
 * row of sections above the article on narrow ones.
 */
export function DocsNav({ locale }: { locale: DocsLocale }) {
  const copy = useSiteCopy("docsNav");

  return (
    <aside className="md:sticky md:top-8 md:self-start">
      <nav
        aria-label={copy.ariaLabel}
        className="flex flex-wrap gap-x-10 gap-y-5 md:flex-col md:gap-y-7"
      >
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="text-[0.75rem] uppercase tracking-[0.08em] text-fg-subtle">
              {copy[section.title]}
            </div>
            <ul className="mt-2.5 flex flex-col gap-1.5 text-[0.9375rem]">
              {section.items.map((item) => (
                <li key={item.to}>
                  <Link
                    to={localizePath(item.to, locale) as never}
                    activeOptions={{ exact: "exact" in item && item.exact }}
                    activeProps={{ className: "text-fg" }}
                    inactiveProps={{ className: "text-fg-muted" }}
                    className="transition-colors hover:text-fg"
                  >
                    {copy.labels[item.label]}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
