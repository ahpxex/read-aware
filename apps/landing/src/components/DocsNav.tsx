import { Link } from "@tanstack/react-router";
import { DOCS_NAV } from "../lib/docs-nav";

/**
 * The docs section navigation: a sticky sidebar on wide screens, a compact
 * row of sections above the article on narrow ones.
 */
export function DocsNav() {
  return (
    <aside className="md:sticky md:top-8 md:self-start">
      <nav
        aria-label="Documentation"
        className="flex flex-wrap gap-x-10 gap-y-5 md:flex-col md:gap-y-7"
      >
        {DOCS_NAV.map((section) => (
          <div key={section.title}>
            <div className="text-[0.75rem] uppercase tracking-[0.08em] text-fg-subtle">
              {section.title}
            </div>
            <ul className="mt-2.5 flex flex-col gap-1.5 text-[0.9375rem]">
              {section.items.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    activeOptions={{ exact: "exact" in item && item.exact }}
                    activeProps={{ className: "text-fg" }}
                    inactiveProps={{ className: "text-fg-muted" }}
                    className="transition-colors hover:text-fg"
                  >
                    {item.label}
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
