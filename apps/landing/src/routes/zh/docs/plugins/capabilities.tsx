import { createFileRoute } from "@tanstack/react-router";
import { PluginCapabilitiesPage } from "../../../../components/PluginCapabilitiesPage";
import { docsPageMeta } from "../../../../i18n";

export const Route = createFileRoute("/zh/docs/plugins/capabilities")({
  head: ({ match }) => docsPageMeta(match.context.i18n, "pluginsCapabilities"),
  component: PluginCapabilitiesPage,
});
