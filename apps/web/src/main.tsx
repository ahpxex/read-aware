import { applyPlatformAttributes, disableNativeContextMenu } from "./platform/environment";
import { hydrateLocalStore } from "./platform/local-store";
import { getAppSettings, resolveAppTheme } from "./features/settings/lib/app-settings";
import { getGeneralSettings } from "./features/settings/lib/general-settings";
import { detectInitialLocale } from "./i18n/detect";
import { initI18n } from "./i18n";
import "./index.css";

applyPlatformAttributes();
disableNativeContextMenu();

// Boot order matters, but only ONE await gates on IPC and only ONE dynamic
// import remains on the critical path:
//
// 1. `hydrateLocalStore()` loads the device-local config snapshot (SQLite on
//    desktop) — everything below reads settings through it.
// 2. The settings/i18n helpers above are STATIC imports: they are pure at
//    module scope (no `localKV` reads until called), so bundling them into the
//    entry chunk is safe and removes what used to be three sequential dynamic
//    imports.
// 3. `app-mount` stays a dynamic import — its module graph (router → routes →
//    `state/ui`) seeds Jotai atoms synchronously from the config snapshot, so
//    it must not evaluate until hydration resolves.
void (async () => {
  await hydrateLocalStore();

  // Stamp the resolved theme before anything renders so a dark-theme boot
  // paints dark from the first React frame (`useAppearance` takes over once
  // mounted and keeps it live).
  const theme = resolveAppTheme(getAppSettings().theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  // Load the persisted (or auto-detected) locale's catalogs so the first paint
  // is already translated.
  await initI18n(detectInitialLocale(getGeneralSettings().language));

  const { mountApp } = await import("./app-mount");
  mountApp();

  // The agent chat transport reads its config per-send, so registering just
  // after mount is safe — and it keeps the agent runtime (a heavy dependency
  // tree) off the boot-critical path entirely.
  const { registerAgentChatTransport } = await import("./features/ai/agent/register");
  registerAgentChatTransport();
})();
