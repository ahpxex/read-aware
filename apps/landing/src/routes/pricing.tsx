import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "../components/PricingPage";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — ReadAware" },
      { name: "description", content: "The app is free and complete; paid plans add encrypted sync and built-in AI. Sync $5, Pro $20, Max $50 a month." },
    ],
  }),
  component: () => <PricingPage locale="en" />,
});
