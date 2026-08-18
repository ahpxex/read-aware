import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "../../components/PricingPage";

export const Route = createFileRoute("/de/pricing")({
  head: () => ({
    meta: [
      { title: "Preise — ReadAware" },
      { name: "description", content: "Die App ist kostenlos und vollständig; Bezahltarife fügen verschlüsselte Synchronisation und integrierte KI hinzu. Sync 5 $, Pro 20 $, Max 50 $ im Monat." },
    ],
  }),
  component: () => <PricingPage locale="de" />,
});
