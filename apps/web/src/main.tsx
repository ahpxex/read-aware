import { applyPlatformAttributes, disableNativeContextMenu } from "./platform/environment";
import { syncAndroidSafeArea } from "./platform/safe-area";
import { hydrateLocalStore } from "./platform/local-store";
import { hydrateRoamingPreferences } from "./platform/roaming-preferences";
import { getAppSettings, resolveAppTheme } from "./features/settings/lib/app-settings";
import { bootAppSkin } from "./features/settings/lib/app-skin";
import { getGeneralSettings } from "./features/settings/lib/general-settings";
import { detectInitialLocale } from "./i18n/detect";
import { initI18n } from "./i18n";
import "./index.css";

applyPlatformAttributes();
disableNativeContextMenu();
syncAndroidSafeArea();

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
// TEMPORARY boot-stage beacons — mobile-device boot diagnosis (no console
// access on a phone webview). Fire-and-forget to a dev-machine listener;
// stripped after the investigation. Dev builds only.
const beacon = (stage: string): void => {
  if (!import.meta.env.DEV) return;
  void fetch(`http://${window.location.hostname}:9999/boot/${stage}`).catch(() => {});
};

void (async () => {
  beacon("start");
  await hydrateLocalStore();
  beacon("local-store-done");
  // Overlay roamed preferences (theme, reader typography) from the projection
  // BEFORE anything reads settings — the boot theme below must already see a
  // value another device may have changed.
  await hydrateRoamingPreferences();
  beacon("roaming-done");

  // Stamp the resolved theme before anything renders so a dark-theme boot
  // paints dark from the first React frame (`useAppearance` takes over once
  // mounted and keeps it live). A selected plugin skin replays its cached
  // token CSS the same way — plugins themselves start much later.
  const themePreference = getAppSettings().theme;
  const theme = resolveAppTheme(themePreference);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  bootAppSkin(themePreference);

  // Load the persisted (or auto-detected) locale's catalogs so the first paint
  // is already translated.
  await initI18n(detectInitialLocale(getGeneralSettings().language));
  beacon("i18n-done");

  const { mountApp } = await import("./app-mount");
  beacon("app-mount-imported");
  mountApp();
  beacon("mounted");

  // The agent chat transport reads its config per-send, so registering just
  // after mount is safe — and it keeps the agent runtime (a heavy dependency
  // tree) off the boot-critical path entirely.
  const { registerAgentChatTransport } = await import("./features/ai/agent/register");
  registerAgentChatTransport();
})();
