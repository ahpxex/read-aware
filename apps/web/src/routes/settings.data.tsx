import { createFileRoute } from "@tanstack/react-router";
import { DataSyncPanel } from "../features/settings/sections/DataSyncPanel";

export const Route = createFileRoute("/settings/data")({
  component: DataSyncPanel,
});
