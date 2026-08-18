import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "../../components/PricingPage";

export const Route = createFileRoute("/ja/pricing")({
  head: () => ({
    meta: [
      { title: "料金 — ReadAware" },
      { name: "description", content: "アプリは無料で完結。有料プランは暗号化同期と内蔵 AI を追加します。Sync $5、Pro $20、Max $50 / 月。" },
    ],
  }),
  component: () => <PricingPage locale="ja" />,
});
