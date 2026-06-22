import { createFileRoute } from "@tanstack/react-router";
import { AIPanel } from "../features/settings/sections/AIPanel";

export const Route = createFileRoute("/settings/ai")({
  component: AIPanel,
});
