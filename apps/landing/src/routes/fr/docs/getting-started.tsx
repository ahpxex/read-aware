import { createFileRoute } from "@tanstack/react-router";
import { LocalizedDocsPage } from "../../../components/LocalizedDocsPage";
import { docsPageMeta } from "../../../i18n";

export const Route = createFileRoute("/fr/docs/getting-started")({
  head: ({ match }) => docsPageMeta(match.context.i18n, "gettingStarted"),
  component: () => <LocalizedDocsPage page="gettingStarted" />,
});
