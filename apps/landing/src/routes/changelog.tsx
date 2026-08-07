import { createFileRoute } from "@tanstack/react-router";
import { ChangelogPage } from "../components/ChangelogPage";

export const Route = createFileRoute("/changelog")({
  head: () => ({
    meta: [
      { title: "Changelog — ReadAware" },
      { name: "description", content: "What changed in each ReadAware release, written for the people using it." },
    ],
  }),
  component: () => <ChangelogPage locale="en" />,
});
