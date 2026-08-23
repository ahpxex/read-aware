import { createFileRoute } from "@tanstack/react-router";
import { BlogPost } from "../../../components/BlogPost";
import { blogPostMeta } from "../../../i18n";

export const Route = createFileRoute("/zh/blog/local-first")({
  head: ({ match }) => blogPostMeta(match.context.i18n, "local-first"),
  component: () => <BlogPost slug="local-first" locale="zh" />,
});
