import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "../../components/DocsLayout";
import { ensureDocsResources } from "../../i18n";

export const Route = createFileRoute("/ja/docs")({
  beforeLoad: ({ context }) => ensureDocsResources(context.i18n, "ja"),
  component: () => <DocsLayout locale="ja" />,
});
