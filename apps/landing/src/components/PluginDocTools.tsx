import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DocsResource } from "../i18n";
import {
  PluginCapabilityBrowser,
  type PluginCapabilityBrowserCopy,
} from "./PluginCapabilityBrowser";
import {
  PluginPermissionPreview,
  type PluginPermissionPreviewCopy,
} from "./PluginPermissionPreview";

type BrowserResource = DocsResource["capabilityBrowser"];
type PreviewResource = DocsResource["permissionPreview"];

function capabilityDescriptions(
  descriptions: BrowserResource["descriptions"],
): PluginCapabilityBrowserCopy["descriptions"] {
  return Object.fromEntries(
    Object.entries(descriptions).map(([key, value]) => [key.replace("__", ":"), value]),
  ) as PluginCapabilityBrowserCopy["descriptions"];
}

function permissionDescriptions(
  descriptions: PreviewResource["permissionDescriptions"],
): PluginPermissionPreviewCopy["permissionDescriptions"] {
  return Object.fromEntries(
    Object.entries(descriptions).map(([key, value]) => [key.replace("__", ":"), value]),
  ) as PluginPermissionPreviewCopy["permissionDescriptions"];
}

export function CapabilityBrowserSlot() {
  const { t, i18n } = useTranslation("docs");
  const copy = useMemo(() => {
    const resource = i18n.getResource(
      i18n.resolvedLanguage ?? i18n.language,
      "docs",
      "capabilityBrowser",
    ) as BrowserResource;
    return {
      ...resource,
      descriptions: capabilityDescriptions(resource.descriptions),
      result: (count: number) => t("capabilityBrowser.result", { count }),
    } satisfies PluginCapabilityBrowserCopy;
  }, [i18n, t]);

  return <PluginCapabilityBrowser copy={copy} />;
}

export function PermissionPreviewSlot() {
  const { t, i18n } = useTranslation("docs");
  const copy = useMemo(() => {
    const resource = i18n.getResource(
      i18n.resolvedLanguage ?? i18n.language,
      "docs",
      "permissionPreview",
    ) as PreviewResource;
    return {
      ...resource,
      permissionDescriptions: permissionDescriptions(resource.permissionDescriptions),
      schedules: (count: number) => t("permissionPreview.schedules", { count }),
      themes: (count: number) => t("permissionPreview.themes", { count }),
      fonts: (count: number) => t("permissionPreview.fonts", { count }),
      unknownPermission: (value: string) =>
        t("permissionPreview.unknownPermission", { value }),
      missingField: (value: string) => t("permissionPreview.missingField", { value }),
      unknownSettingsOperation: (value: string) =>
        t("permissionPreview.unknownSettingsOperation", { value }),
      invalidSettingsGrant: (value: string) =>
        t("permissionPreview.invalidSettingsGrant", { value }),
      sectionGrantWarning: (value: string) =>
        t("permissionPreview.sectionGrantWarning", { value }),
    } satisfies PluginPermissionPreviewCopy;
  }, [i18n, t]);
  const sampleManifest = t("sampleManifest");

  return <PluginPermissionPreview copy={copy} sampleManifest={sampleManifest} />;
}
