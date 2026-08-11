import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../components/HomePage";

export const Route = createFileRoute("/")({
  component: () => <HomePage locale="en" />,
});
