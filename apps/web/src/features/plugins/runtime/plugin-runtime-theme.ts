import { AppError } from "@read-aware/core";
import type { PluginManifest, PluginRuntimeTheme } from "@read-aware/plugin-types";
import { invoke } from "../../../platform/ipc";
import type { NativeResource, ResourceOwner } from "../../../services/resource-owner";
import { validateThemeContributions, toPluginRef } from "../lib/plugin-theme";
import type { PluginLifecycleController } from "./plugin-lifecycle";

/** Decode before publishing, so invalid bytes never replace a working theme.
 * Only this plugin's immutable asset revision can supply bytes. Reading during
 * activation is safe: publication and URL allocation wait for promotion. */
export async function prepareRuntimeTheme(
  input: PluginRuntimeTheme,
  manifest: PluginManifest,
  lifecycle: PluginLifecycleController,
  resources: ResourceOwner,
) {
  const theme = validateThemeContributions([input], new Set(manifest.fonts?.map((font) => font.id)))[0];
  const family = theme.reader?.typography?.fontFamily;
  if (family?.startsWith("plugin:") && theme.reader?.typography) {
    theme.reader.typography.fontFamily = toPluginRef(manifest.id, family.slice(7));
  }
  const background = input.readerBackground;
  if (!background) return { theme };
  if (
    !theme.reader ||
    typeof background.assetKey !== "string" ||
    typeof background.assetRevision !== "string" ||
    !/^[a-zA-Z0-9._:-]{1,128}$/.test(background.assetKey) ||
    !/^[a-f0-9]{32}$/.test(background.assetRevision) ||
    ![background.opacity, background.dim].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
  ) {
    throw new AppError("plugin/invalid-argument", "Invalid reader background");
  }
  const { assetKey, assetRevision, opacity, dim } = background;
  const blob = await lifecycle.read(
    "themes.register",
    async () => {
      const resource = await resources.importAsset(
        () =>
          invoke<NativeResource>("resource_open_plugin_asset", {
            pluginId: manifest.id,
            key: assetKey,
            expectedRevision: assetRevision,
          }),
        lifecycle.signal,
      );
      try {
        return await resources.imagePreview(resource.id, lifecycle.signal);
      } finally {
        await resources.release(resource.id);
      }
    },
    lifecycle.signal,
  );
  return { theme, background: { blob, opacity, dim } };
}
