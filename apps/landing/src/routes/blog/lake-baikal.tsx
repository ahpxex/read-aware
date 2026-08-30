import { createFileRoute } from "@tanstack/react-router";
import { BlogPost } from "../../components/BlogPost";
import { blogPostMeta } from "../../i18n";

export const Route = createFileRoute("/blog/lake-baikal")({
  head: ({ match }) => blogPostMeta(match.context.i18n, "lake-baikal"),
  component: () => <BlogPost slug="lake-baikal" />,
});
