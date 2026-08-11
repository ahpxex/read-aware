import { createFileRoute } from "@tanstack/react-router";
import { ChangelogPage } from "../../components/ChangelogPage";
import { UI_STRINGS } from "../../lib/i18n";

export const Route = createFileRoute("/de/changelog")({
  head: () => ({
    meta: [
      { title: `${UI_STRINGS["de"].changelogTitle} — ReadAware` },
      { name: "description", content: UI_STRINGS["de"].changelogLead },
    ],
  }),
  component: () => <ChangelogPage locale="de" />,
});
