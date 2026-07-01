import { HeadContent, Outlet, createRootRoute, useRouter } from "@tanstack/react-router";
import { Button } from "@read-aware/ui";
import { i18n, useTranslation } from "../i18n";
import { useAppearance } from "../features/settings/hooks/useAppearance";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        title: "ReadAware",
      },
      {
        name: "description",
        content: i18n.t("nav:meta.description"),
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
  const { t } = useTranslation(["nav", "common"]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 text-center">
      <div className="max-w-md space-y-3">
        <p className="text-[11px] font-medium text-fg-subtle">
          ReadAware
        </p>
        <h1 className="font-serif text-3xl leading-display text-fg">
          {t("error.title")}
        </h1>
        <p className="text-sm leading-6 text-fg-muted">
          {t("error.body")}
        </p>
        <div className="pt-2">
          <Button size="sm" onClick={() => { window.location.assign("/"); }}>
            {t("common:actions.backToLibrary")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RootNotFound() {
  const router = useRouter();
  const { t } = useTranslation(["nav", "common"]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 text-center">
      <div className="max-w-md space-y-3">
        <p className="text-[11px] font-medium text-fg-subtle">
          ReadAware
        </p>
        <h1 className="font-serif text-3xl leading-display text-fg">
          {t("notFound.title")}
        </h1>
        <p className="text-sm leading-6 text-fg-muted">
          {t("notFound.body")}
        </p>
        <div className="pt-2">
          <Button size="sm" onClick={() => { void router.navigate({ to: "/" }); }}>
            {t("common:actions.backToLibrary")}
          </Button>
        </div>
      </div>
    </div>
  );
}
