import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "../components/DocsLayout";

export const Route = createFileRoute("/docs")({
  component: () => <DocsLayout locale="en" />,
});
