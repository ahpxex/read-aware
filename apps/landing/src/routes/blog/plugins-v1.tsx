import { createFileRoute } from "@tanstack/react-router";
import { BlogPost } from "../../components/BlogPost";
import { blogPostMeta } from "../../i18n";

export const Route = createFileRoute("/blog/plugins-v1")({
  head: ({ match }) => blogPostMeta(match.context.i18n, "plugins-v1"),
  component: () => <BlogPost slug="plugins-v1" />,
});
