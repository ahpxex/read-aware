import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../../components/HomePage";
import { HOME } from "../../lib/home-content";

export const Route = createFileRoute("/de/")({
  head: () => ({
    meta: [
      { title: HOME["de"].metaTitle },
      { name: "description", content: HOME["de"].metaDescription },
    ],
  }),
  component: () => <HomePage locale="de" />,
});
