import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../../components/HomePage";
import { HOME } from "../../lib/home-content";

export const Route = createFileRoute("/ja/")({
  head: () => ({
    meta: [
      { title: HOME.ja.metaTitle },
      { name: "description", content: HOME.ja.metaDescription },
    ],
  }),
  component: () => <HomePage locale="ja" />,
});
