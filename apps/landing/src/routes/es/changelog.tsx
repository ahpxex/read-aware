import { createFileRoute } from "@tanstack/react-router";
import { ChangelogPage } from "../../components/ChangelogPage";
import { UI_STRINGS } from "../../lib/i18n";

export const Route = createFileRoute("/es/changelog")({
  head: () => ({
    meta: [
      { title: `${UI_STRINGS["es"].changelogTitle} — ReadAware` },
      { name: "description", content: UI_STRINGS["es"].changelogLead },
    ],
  }),
  component: () => <ChangelogPage locale="es" />,
});
