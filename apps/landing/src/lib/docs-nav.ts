/**
 * The docs sidebar, in reading order. Adding a documentation page means adding
 * its route file under `src/routes/docs/` and one entry here.
 *
 * `exact` marks section-index pages ("/docs", "/docs/plugins") so they don't
 * light up while one of their children is open.
 */
export const DOCS_NAV = [
  {
    title: "Start",
    items: [
      { to: "/docs", label: "Overview", exact: true },
      { to: "/docs/install", label: "Download & install" },
      { to: "/docs/getting-started", label: "Getting started" },
    ],
  },
  {
    title: "Plugins",
    items: [
      { to: "/docs/plugins", label: "Plugin system", exact: true },
      { to: "/docs/plugins/api", label: "API reference" },
      { to: "/docs/plugins/publishing", label: "Publishing" },
    ],
  },
] as const;
