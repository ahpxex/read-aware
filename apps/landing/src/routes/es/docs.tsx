import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "../../components/DocsLayout";

export const Route = createFileRoute("/es/docs")({
  component: () => <DocsLayout locale="es" />,
});
