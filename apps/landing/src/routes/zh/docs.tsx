import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "../../components/DocsLayout";

export const Route = createFileRoute("/zh/docs")({
  component: () => <DocsLayout locale="zh" />,
});
