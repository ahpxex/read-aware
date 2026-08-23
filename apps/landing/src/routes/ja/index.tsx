import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../../components/HomePage";
import { sitePageMeta } from "../../i18n";

export const Route = createFileRoute("/ja/")({
  head: ({ match }) => sitePageMeta(match.context.i18n, "home"),
  component: () => <HomePage locale="ja" />,
});
