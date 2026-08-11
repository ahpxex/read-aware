import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../../components/HomePage";
import { HOME } from "../../lib/home-content";

export const Route = createFileRoute("/ru/")({
  head: () => ({
    meta: [
      { title: HOME["ru"].metaTitle },
      { name: "description", content: HOME["ru"].metaDescription },
    ],
  }),
  component: () => <HomePage locale="ru" />,
});
