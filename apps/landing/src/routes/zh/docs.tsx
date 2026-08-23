import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "../../components/DocsLayout";
import { ensureDocsResources } from "../../i18n";

export const Route = createFileRoute("/zh/docs")({
  beforeLoad: ({ context }) => ensureDocsResources(context.i18n, "zh"),
  component: () => <DocsLayout locale="zh" />,
});
