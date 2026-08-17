import { applyPlatformAttributes, disableNativeContextMenu } from "./platform/environment";
import { syncAndroidSafeArea } from "./platform/safe-area";
import { hydrateLocalStore } from "./platform/local-store";
import { hydrateRoamingPreferences } from "./platform/roaming-preferences";
import { installGlobalErrorLogging } from "./platform/global-error-log";
import { createLogger } from "./platform/logger";
import { getAppSettings, resolveAppTheme } from "./features/settings/lib/app-settings";
import { bootAppSkin } from "./features/settings/lib/app-skin";
import { getGeneralSettings } from "./features/settings/lib/general-settings";
import { detectInitialLocale } from "./i18n/detect";
import { initI18n } from "./i18n";
import { showBootFailure } from "./boot-failure";
import "./index.css";

applyPlatformAttributes();
disableNativeContextMenu();
syncAndroidSafeArea();
// Before anything can fail: uncaught errors and unhandled rejections must
// reach the file log even when they happen mid-boot.
installGlobalErrorLogging();

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
// Boot stages land in the file log (the successor to the temporary HTTP
// beacons this replaced): a boot that dies or stalls shows exactly which
// stage it reached, on devices with no console access.
const log = createLogger("boot");

void (async () => {
  log.info("start");
  await hydrateLocalStore();
  log.info("local store hydrated");
  // Overlay roamed preferences (theme, reader typography) from the projection
  // BEFORE anything reads settings — the boot theme below must already see a
  // value another device may have changed.
  await hydrateRoamingPreferences();
  log.info("roaming preferences hydrated");

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
  log.info("i18n ready");

  const { mountApp } = await import("./app-mount");
  mountApp();
  log.info("mounted");

  // The agent chat transport reads its config per-send, so registering just
  // after mount is safe — and it keeps the agent runtime (a heavy dependency
  // tree) off the boot-critical path entirely.
  const { registerAgentChatTransport } = await import("./features/ai/agent/register");
  registerAgentChatTransport();
})().catch((error: unknown) => {
  // A failed boot used to be the worst diagnostic hole in the app: React
  // never mounts, the router's error boundary never renders, and the user
  // sits behind the splash forever. Log it, then replace the splash with a
  // copyable failure notice.
  log.error("boot failed", error);
  showBootFailure(error);
});
