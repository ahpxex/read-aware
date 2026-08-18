import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "../../components/PricingPage";

export const Route = createFileRoute("/fr/pricing")({
  head: () => ({
    meta: [
      { title: "Tarifs — ReadAware" },
      { name: "description", content: "L'application est gratuite et complète ; les offres payantes ajoutent la synchronisation chiffrée et l'IA intégrée. Sync 5 $, Pro 20 $, Max 50 $ par mois." },
    ],
  }),
  component: () => <PricingPage locale="fr" />,
});
