import { createFileRoute } from "@tanstack/react-router";
import { BlogLayout } from "../../components/BlogLayout";

export const Route = createFileRoute("/zh/blog")({
  component: () => <BlogLayout locale="zh" />,
});
