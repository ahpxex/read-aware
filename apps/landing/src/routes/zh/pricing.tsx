import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "../../components/PricingPage";

export const Route = createFileRoute("/zh/pricing")({
  head: () => ({
    meta: [
      { title: "定价 — ReadAware" },
      { name: "description", content: "应用免费且完整;付费方案加的是加密同步和内置 AI。Sync $5、Pro $20、Max $50 每月。" },
    ],
  }),
  component: () => <PricingPage locale="zh" />,
});
