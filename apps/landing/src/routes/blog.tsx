import { createFileRoute } from "@tanstack/react-router";
import { BlogLayout } from "../components/BlogLayout";

export const Route = createFileRoute("/blog")({
  component: () => <BlogLayout locale="en" />,
});
