import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "../../components/DocsLayout";
import { ensureDocsResources } from "../../i18n";

export const Route = createFileRoute("/fr/docs")({
  beforeLoad: ({ context }) => ensureDocsResources(context.i18n, "fr"),
  component: () => <DocsLayout locale="fr" />,
});
