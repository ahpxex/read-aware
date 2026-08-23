import { createFileRoute } from "@tanstack/react-router";
import { ChangelogPage } from "../components/ChangelogPage";
import { sitePageMeta } from "../i18n";

export const Route = createFileRoute("/changelog")({
  head: ({ match }) => sitePageMeta(match.context.i18n, "changelog"),
  component: () => <ChangelogPage locale="en" />,
});
