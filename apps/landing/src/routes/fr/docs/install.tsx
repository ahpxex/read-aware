import { createFileRoute } from "@tanstack/react-router";
import { LocalizedDocsPage } from "../../../components/LocalizedDocsPage";
import { docsPageMeta } from "../../../i18n";

export const Route = createFileRoute("/fr/docs/install")({
  head: ({ match }) => docsPageMeta(match.context.i18n, "install"),
  component: () => <LocalizedDocsPage page="install" />,
});
