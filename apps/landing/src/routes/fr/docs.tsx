import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "../../components/DocsLayout";

export const Route = createFileRoute("/fr/docs")({
  component: () => <DocsLayout locale="fr" />,
});
