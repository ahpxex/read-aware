import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { createLandingI18n } from "./i18n";
import { localeFromPathname } from "./lib/i18n";
import { createAppRouter } from "./router";
import { startSiteAnalytics } from "./lib/site-analytics";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

async function start(root: HTMLElement) {
  const locale = localeFromPathname(window.location.pathname);
  const i18n = await createLandingI18n(locale);
  const router = createAppRouter({ i18n });
  await router.load();
  startSiteAnalytics(Object.keys(router.routesByPath));

  // The prerendered head carries static copies of tags the router's
  // <HeadContent /> manages at runtime (scripts/prerender.mjs marks them with
  // `data-prerender`). Drop them right before mounting so crawlers and slow
  // connections see the static copy until the router owns the live instance.
  for (const el of document.head.querySelectorAll("[data-prerender]")) {
    el.remove();
  }

  const app = (
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );

  // Hydrate the prerendered DOM in place so the painted hero image and prose
  // are preserved instead of torn down; fall back to client mount in dev or
  // when a query-filtered Capabilities Explorer URL differs from static HTML.
  const queryFilteredExplorer =
    Boolean(window.location.search) && /\/docs\/plugins\/capabilities\/?$/.test(window.location.pathname);
  if (root.hasChildNodes() && !queryFilteredExplorer) {
    hydrateRoot(root, app);
  } else {
    createRoot(root).render(app);
  }
}

void start(rootElement);
