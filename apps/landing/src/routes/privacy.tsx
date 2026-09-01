import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPage } from "../components/PrivacyPage";
import { docsPageMeta, ensureDocsResources } from "../i18n";

export const Route = createFileRoute("/privacy")({
  beforeLoad: ({ context }) => ensureDocsResources(context.i18n, "en"),
  head: ({ match }) => docsPageMeta(match.context.i18n, "privacy"),
  component: () => <PrivacyPage locale="en" />,
});
