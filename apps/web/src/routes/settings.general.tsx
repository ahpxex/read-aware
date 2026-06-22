import { createFileRoute } from "@tanstack/react-router";
import { GeneralPanel } from "../features/settings/sections/GeneralPanel";

export const Route = createFileRoute("/settings/general")({
  component: GeneralPanel,
});
