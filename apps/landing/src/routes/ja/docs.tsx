import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "../../components/DocsLayout";

export const Route = createFileRoute("/ja/docs")({
  component: () => <DocsLayout locale="ja" />,
});
