import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "../../components/PricingPage";

export const Route = createFileRoute("/ru/pricing")({
  head: () => ({
    meta: [
      { title: "Тарифы — ReadAware" },
      { name: "description", content: "Приложение бесплатно и самодостаточно; платные тарифы добавляют зашифрованную синхронизацию и встроенный ИИ. Sync $5, Pro $20, Max $50 в месяц." },
    ],
  }),
  component: () => <PricingPage locale="ru" />,
});
