import { createFileRoute } from "@tanstack/react-router";
import { AboutPanel } from "../features/settings/sections/AboutPanel";

export const Route = createFileRoute("/settings/about")({
  component: AboutPanel,
});
