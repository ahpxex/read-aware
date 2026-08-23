import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "../../components/DocsLayout";
import { ensureDocsResources } from "../../i18n";

export const Route = createFileRoute("/zh-hant/docs")({
  beforeLoad: ({ context }) => ensureDocsResources(context.i18n, "zh-hant"),
  component: () => <DocsLayout locale="zh-hant" />,
});
