import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { createAppRouter } from "./router";

/**
 * Mount the React app. Kept in its own module so main.tsx can import it
 * *dynamically*, after `hydrateLocalStore()` resolves — this module's transitive
 * imports (router → routes → `state/ui`) seed Jotai atoms synchronously from the
 * device-local config, so they must not evaluate until the SQLite snapshot is in
 * place. See main.tsx.
 */
export function mountApp(): void {
  const router = createAppRouter();

  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Root element #root not found");
  }

  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
