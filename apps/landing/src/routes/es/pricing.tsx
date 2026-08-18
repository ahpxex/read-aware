import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "../../components/PricingPage";

export const Route = createFileRoute("/es/pricing")({
  head: () => ({
    meta: [
      { title: "Precios — ReadAware" },
      { name: "description", content: "La aplicación es gratuita y completa; los planes de pago añaden sincronización cifrada e IA integrada. Sync $5, Pro $20, Max $50 al mes." },
    ],
  }),
  component: () => <PricingPage locale="es" />,
});
