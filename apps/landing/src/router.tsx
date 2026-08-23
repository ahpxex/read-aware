import { createRouter, type RouterHistory } from "@tanstack/react-router";
import type { LandingRouterContext } from "./i18n";
import { routeTree } from "./routeTree.gen";

/**
 * Every browser or SSR render receives an isolated locale instance. The
 * prerender entry additionally passes memory history for the requested URL.
 */
export function createAppRouter(
  options: LandingRouterContext & { history?: RouterHistory },
) {
  return createRouter({
    routeTree,
    context: { i18n: options.i18n },
    defaultPreload: "intent",
    scrollRestoration: true,
    history: options.history,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
