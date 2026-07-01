import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "../i18n";
import App from "../App";

export const Route = createFileRoute("/")({
  component: IndexRouteComponent,
  pendingComponent: IndexRoutePending,
});

function IndexRouteComponent() {
  return <App />;
}

function IndexRoutePending() {
  const { t } = useTranslation("nav");

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 text-center text-fg">
      <div className="max-w-sm space-y-4">
        <p className="text-[11px] font-medium text-fg-subtle">
          ReadAware
        </p>
        <h1 className="font-serif text-4xl leading-display">
          {t("loading.title")}
        </h1>
        <p className="text-sm leading-6 text-fg-muted">
          {t("loading.body")}
        </p>
      </div>
    </main>
  );
}
