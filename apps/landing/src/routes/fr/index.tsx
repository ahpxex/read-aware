import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../../components/HomePage";
import { sitePageMeta } from "../../i18n";

export const Route = createFileRoute("/fr/")({
  head: ({ match }) => sitePageMeta(match.context.i18n, "home"),
  component: () => <HomePage locale="fr" />,
});
