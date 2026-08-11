import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../../components/HomePage";
import { HOME } from "../../lib/home-content";

export const Route = createFileRoute("/zh/")({
  head: () => ({
    meta: [
      { title: HOME.zh.metaTitle },
      { name: "description", content: HOME.zh.metaDescription },
    ],
  }),
  component: () => <HomePage locale="zh" />,
});
