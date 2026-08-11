import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../../components/HomePage";
import { HOME } from "../../lib/home-content";

export const Route = createFileRoute("/zh-hant/")({
  head: () => ({
    meta: [
      { title: HOME["zh-hant"].metaTitle },
      { name: "description", content: HOME["zh-hant"].metaDescription },
    ],
  }),
  component: () => <HomePage locale="zh-hant" />,
});
