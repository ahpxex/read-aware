import { createFileRoute } from "@tanstack/react-router";
import { BlogLayout } from "../../components/BlogLayout";

export const Route = createFileRoute("/ja/blog")({
  component: () => <BlogLayout locale="ja" />,
});
