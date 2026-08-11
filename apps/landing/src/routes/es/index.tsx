import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../../components/HomePage";
import { HOME } from "../../lib/home-content";

export const Route = createFileRoute("/es/")({
  head: () => ({
    meta: [
      { title: HOME["es"].metaTitle },
      { name: "description", content: HOME["es"].metaDescription },
    ],
  }),
  component: () => <HomePage locale="es" />,
});
