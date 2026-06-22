import { createFileRoute } from "@tanstack/react-router";
import { AppearancePanel } from "../features/settings/sections/AppearancePanel";

export const Route = createFileRoute("/settings/appearance")({
  component: AppearancePanel,
});
