import { createFileRoute } from "@tanstack/react-router";
import { LocalizedDocsPage } from "../../../../components/LocalizedDocsPage";
import { docsPageMeta } from "../../../../i18n";

export const Route = createFileRoute("/de/docs/plugins/api")({
  head: ({ match }) => docsPageMeta(match.context.i18n, "pluginsApi"),
  component: () => <LocalizedDocsPage page="pluginsApi" />,
});
