import { createFileRoute } from "@tanstack/react-router";
import { BlogIndexPage } from "../../../components/BlogIndexPage";
import { blogIndexMeta } from "../../../i18n";

export const Route = createFileRoute("/zh/blog/")({
  head: ({ match }) => blogIndexMeta(match.context.i18n),
  component: () => <BlogIndexPage locale="zh" />,
});
