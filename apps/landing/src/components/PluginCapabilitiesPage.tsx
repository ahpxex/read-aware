import { LocalizedDocsPage } from "./LocalizedDocsPage";
import { CapabilityBrowserSlot, PermissionPreviewSlot } from "./PluginDocTools";

export function PluginCapabilitiesPage() {
  return (
    <LocalizedDocsPage
      page="pluginsCapabilities"
      slots={{
        capabilityBrowser: <CapabilityBrowserSlot />,
        permissionPreview: <PermissionPreviewSlot />,
      }}
    />
  );
}
