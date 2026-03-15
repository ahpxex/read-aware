import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import appCss from "../index.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "RadAware",
      },
      {
        name: "description",
        content: "AI-native reading workspace for context-rich EPUB and PDF reading.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap",
      },
    ],
  }),
  component: RootComponent,
  errorComponent: RootErrorBoundary,
  notFoundComponent: RootNotFound,
  shellComponent: RootDocument,
});

function RootComponent() {
  return <Outlet />;
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootErrorBoundary() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 text-center">
      <div className="max-w-md space-y-3">
        <p className="text-[10px] font-medium tracking-eyebrow text-stone-400 uppercase">
          RadAware
        </p>
        <h1 className="font-serif text-3xl leading-display text-stone-950">
          Something interrupted the reading flow.
        </h1>
        <p className="text-sm leading-6 text-stone-600">
          Refresh the page to continue. If the problem persists, reopen the book from your shelf.
        </p>
      </div>
    </div>
  );
}

function RootNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 text-center">
      <div className="max-w-md space-y-3">
        <p className="text-[10px] font-medium tracking-eyebrow text-stone-400 uppercase">
          RadAware
        </p>
        <h1 className="font-serif text-3xl leading-display text-stone-950">
          This page does not exist.
        </h1>
        <p className="text-sm leading-6 text-stone-600">
          Return to the main reading workspace and pick up where you left off.
        </p>
      </div>
    </div>
  );
}
