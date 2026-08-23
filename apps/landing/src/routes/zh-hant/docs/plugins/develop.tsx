import { createFileRoute } from "@tanstack/react-router";
import { LocalizedDocsPage } from "../../../../components/LocalizedDocsPage";
import { docsPageMeta } from "../../../../i18n";

export const Route = createFileRoute("/zh-hant/docs/plugins/develop")({
  head: ({ match }) => docsPageMeta(match.context.i18n, "pluginsDevelop"),
  component: () => <LocalizedDocsPage page="pluginsDevelop" />,
});
