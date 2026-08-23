import { createFileRoute } from "@tanstack/react-router";
import { LocalizedDocsPage } from "../../../components/LocalizedDocsPage";
import { docsPageMeta } from "../../../i18n";

export const Route = createFileRoute("/es/docs/")({
  head: ({ match }) => docsPageMeta(match.context.i18n, "overview"),
  component: () => <LocalizedDocsPage page="overview" />,
});
