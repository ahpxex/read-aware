import { createFileRoute } from "@tanstack/react-router";
import { LocalizedDocsPage } from "../../../../components/LocalizedDocsPage";
import { docsPageMeta } from "../../../../i18n";

export const Route = createFileRoute("/es/docs/plugins/publishing")({
  head: ({ match }) => docsPageMeta(match.context.i18n, "pluginsPublishing"),
  component: () => <LocalizedDocsPage page="pluginsPublishing" />,
});
