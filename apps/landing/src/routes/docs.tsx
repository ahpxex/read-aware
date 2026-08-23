import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "../components/DocsLayout";
import { ensureDocsResources } from "../i18n";

export const Route = createFileRoute("/docs")({
  beforeLoad: ({ context }) => ensureDocsResources(context.i18n, "en"),
  component: () => <DocsLayout locale="en" />,
});
