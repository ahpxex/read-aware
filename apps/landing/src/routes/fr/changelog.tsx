import { createFileRoute } from "@tanstack/react-router";
import { ChangelogPage } from "../../components/ChangelogPage";
import { UI_STRINGS } from "../../lib/i18n";

export const Route = createFileRoute("/fr/changelog")({
  head: () => ({
    meta: [
      { title: `${UI_STRINGS["fr"].changelogTitle} — ReadAware` },
      { name: "description", content: UI_STRINGS["fr"].changelogLead },
    ],
  }),
  component: () => <ChangelogPage locale="fr" />,
});
