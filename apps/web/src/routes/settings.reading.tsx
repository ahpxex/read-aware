import { createFileRoute } from "@tanstack/react-router";
import { ReadingPanel } from "../features/settings/sections/ReadingPanel";

export const Route = createFileRoute("/settings/reading")({
  component: ReadingPanel,
});
