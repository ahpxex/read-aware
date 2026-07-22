import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/**
 * The browser SPA calls this bare; the prerender entry (entry-server.tsx)
 * passes a memory history to render a specific URL server-side.
 */
export function createAppRouter(options?: { history?: RouterHistory }) {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    history: options?.history,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
