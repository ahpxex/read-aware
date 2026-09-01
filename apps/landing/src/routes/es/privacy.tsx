import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPage } from "../../components/PrivacyPage";
import { docsPageMeta, ensureDocsResources } from "../../i18n";

export const Route = createFileRoute("/es/privacy")({
  beforeLoad: ({ context }) => ensureDocsResources(context.i18n, "es"),
  head: ({ match }) => docsPageMeta(match.context.i18n, "privacy"),
  component: () => <PrivacyPage locale="es" />,
});
