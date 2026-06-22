import { HeadContent, Outlet, createRootRoute } from "@tanstack/react-router";
import { useAppearance } from "../features/settings/hooks/useAppearance";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        title: "ReadAware",
      },
      {
        name: "description",
        content: "AI-native reading workspace for context-rich EPUB and PDF reading.",
      },
    ],
  }),
  component: RootComponent,
  errorComponent: RootErrorBoundary,
  notFoundComponent: RootNotFound,
});

function RootComponent() {
  useAppearance();

  return (
    <>
      <HeadContent />
      <Outlet />
    </>
  );
}

function RootErrorBoundary() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 text-center">
      <div className="max-w-md space-y-3">
        <p className="text-[11px] font-medium text-fg-subtle">
          ReadAware
        </p>
        <h1 className="font-serif text-3xl leading-display text-fg">
          Something interrupted the reading flow.
        </h1>
        <p className="text-sm leading-6 text-fg-muted">
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
        <p className="text-[11px] font-medium text-fg-subtle">
          ReadAware
        </p>
        <h1 className="font-serif text-3xl leading-display text-fg">
          This page does not exist.
        </h1>
        <p className="text-sm leading-6 text-fg-muted">
          Return to the main reading workspace and pick up where you left off.
        </p>
      </div>
    </div>
  );
}
