import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "../../components/DocsLayout";

export const Route = createFileRoute("/ru/docs")({
  component: () => <DocsLayout locale="ru" />,
});
