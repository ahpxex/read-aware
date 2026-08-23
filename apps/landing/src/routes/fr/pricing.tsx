import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "../../components/PricingPage";
import { sitePageMeta } from "../../i18n";

export const Route = createFileRoute("/fr/pricing")({
  head: ({ match }) => sitePageMeta(match.context.i18n, "pricing"),
  component: () => <PricingPage locale="fr" />,
});
