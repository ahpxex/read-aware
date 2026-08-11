import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../../components/HomePage";
import { HOME } from "../../lib/home-content";

export const Route = createFileRoute("/fr/")({
  head: () => ({
    meta: [
      { title: HOME["fr"].metaTitle },
      { name: "description", content: HOME["fr"].metaDescription },
    ],
  }),
  component: () => <HomePage locale="fr" />,
});
