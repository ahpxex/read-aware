import { createFileRoute } from "@tanstack/react-router";
import { ChangelogPage } from "../../components/ChangelogPage";
import { UI_STRINGS } from "../../lib/i18n";

export const Route = createFileRoute("/zh-hant/changelog")({
  head: () => ({
    meta: [
      { title: `${UI_STRINGS["zh-hant"].changelogTitle} — ReadAware` },
      { name: "description", content: UI_STRINGS["zh-hant"].changelogLead },
    ],
  }),
  component: () => <ChangelogPage locale="zh-hant" />,
});
