import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "../../components/PricingPage";

export const Route = createFileRoute("/zh-hant/pricing")({
  head: () => ({
    meta: [
      { title: "定價 — ReadAware" },
      { name: "description", content: "應用免費且完整;付費方案加的是加密同步和內建 AI。Sync $5、Pro $20、Max $50 每月。" },
    ],
  }),
  component: () => <PricingPage locale="zh-hant" />,
});
