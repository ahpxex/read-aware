import { createFileRoute } from "@tanstack/react-router";
import { ShortcutsPanel } from "../features/settings/sections/ShortcutsPanel";

export const Route = createFileRoute("/settings/shortcuts")({
  component: ShortcutsPanel,
});
