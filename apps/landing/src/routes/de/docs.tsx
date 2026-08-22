import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout } from "../../components/DocsLayout";

export const Route = createFileRoute("/de/docs")({
  component: () => <DocsLayout locale="de" />,
});
