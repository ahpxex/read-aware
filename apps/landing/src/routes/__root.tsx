import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { I18nextProvider } from "react-i18next";
import { sitePageMeta, type LandingRouterContext } from "../i18n";

// The default head is the English homepage's — routes with their own head()
// override it. Keep index.html's static <title>/<meta> in step with HOME.en.
export const Route = createRootRouteWithContext<LandingRouterContext>()({
  head: ({ match }) => sitePageMeta(match.context.i18n, "home"),
  component: RootComponent,
});

function RootComponent() {
  const { i18n } = Route.useRouteContext();

  return (
    <I18nextProvider i18n={i18n}>
      <HeadContent />
      <Outlet />
    </I18nextProvider>
  );
}
