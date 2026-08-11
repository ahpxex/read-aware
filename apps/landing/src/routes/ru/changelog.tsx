import { createFileRoute } from "@tanstack/react-router";
import { ChangelogPage } from "../../components/ChangelogPage";
import { UI_STRINGS } from "../../lib/i18n";

export const Route = createFileRoute("/ru/changelog")({
  head: () => ({
    meta: [
      { title: `${UI_STRINGS["ru"].changelogTitle} — ReadAware` },
      { name: "description", content: UI_STRINGS["ru"].changelogLead },
    ],
  }),
  component: () => <ChangelogPage locale="ru" />,
});
