import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "../../components/DocsLayout";
import { ensureDocsResources } from "../../i18n";

export const Route = createFileRoute("/de/docs")({
  beforeLoad: ({ context }) => ensureDocsResources(context.i18n, "de"),
  component: () => <DocsLayout locale="de" />,
});
