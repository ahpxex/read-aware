import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { createAppRouter } from "./router";
import "./index.css";

// The prerendered head carries static copies of tags the router's
// <HeadContent /> manages at runtime (scripts/prerender.mjs marks them with
// `data-prerender`). Drop them before mounting so crawlers see the static
// copy while the live document keeps exactly one, router-owned instance.
for (const el of document.head.querySelectorAll("[data-prerender]")) {
  el.remove();
}

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
