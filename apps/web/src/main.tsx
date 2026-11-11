// First import, always: fills ES2023/ES2024 built-ins that older WebViews lack
// before any module — ours or a dependency's — can evaluate against them.
import { installedPolyfills } from "./platform/polyfills";
import { applyPlatformAttributes, disableNativeContextMenu } from "./platform/environment";
import { syncAndroidSafeArea } from "./platform/safe-area";
import { recoverPluginUpdates } from "./platform/plugin-update-recovery";
import { hydrateLocalStore } from "./platform/local-store";
import { hydrateAppIdentity } from "./platform/app-identity";
import { hydrateRoamingPreferences } from "./platform/roaming-preferences";
import { installGlobalErrorLogging } from "./platform/global-error-log";
import { createLogger } from "./platform/logger";
import {
  applyDisplayAttributes,
  getAppSettings,
  isEinkActive,
  resolveAppTheme,
} from "./features/settings/lib/app-settings";
import { hydrateDisplayProfile } from "./platform/display-profile";
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

// Native setup restores interrupted plugin updates before admitting IPC.
// Boot then checks unresolved owners before any local config is consumed:
//
// 0. `recoverPluginUpdates()` reads native status and quarantines failed owners.
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
  // An engine that needed filling is the first thing to know from a device
  // report; a modern engine logs nothing here.
  if (installedPolyfills.length) log.info(`polyfilled ${installedPolyfills.join(", ")}`);
  await recoverPluginUpdates();
  log.info("plugin updates recovered");
  await hydrateLocalStore();
  log.info("local store hydrated");
  // Which bundle is this (dev vs production identifier)? The sync layer's
  // relay default depends on it; one IPC roundtrip, before any consumer.
  await hydrateAppIdentity();
  log.info("app identity hydrated");
  // Overlay roamed preferences (theme, reader typography) from the projection
  // BEFORE anything reads settings — the boot theme below must already see a
  // value another device may have changed.
  await hydrateRoamingPreferences();
  log.info("roaming preferences hydrated");

  // Whether this is an e-ink panel seeds the `auto` e-ink preference, which
  // decides the theme and motion stamped below.
  await hydrateDisplayProfile();

  // Stamp the resolved theme before anything renders so a dark-theme boot
  // paints dark from the first React frame (`useAppearance` takes over once
  // mounted and keeps it live). A selected plugin skin replays its cached
  // token CSS the same way — plugins themselves start much later. E-ink mode
  // and reduced motion are stamped alongside, so the first frame already
  // holds still on an e-ink panel.
  const appSettings = getAppSettings();
  const theme = resolveAppTheme(appSettings);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  applyDisplayAttributes(document.documentElement, appSettings);
  if (!isEinkActive(appSettings)) bootAppSkin(appSettings.theme);

  // Load the persisted (or auto-detected) locale's catalogs so the first paint
  // is already translated.
  await initI18n(detectInitialLocale(getGeneralSettings().language));
  log.info("i18n ready");

  const { mountApp } = await import("./app-mount");
  mountApp();
  log.info("mounted");

  // Bookmarks the retired Jumper plugin kept on this device move into the
  // library once (idempotent; a failure retries next launch).
  void import("./domain/bookmark-adoption")
    .then(({ adoptRetiredJumperBookmarks }) => adoptRetiredJumperBookmarks())
    .then((moved) => {
      if (moved) log.info(`moved ${moved} Jumper bookmarks into the library`);
    })
    .catch((error) => log.error("Jumper bookmark migration failed; will retry next launch", error));

  void import("./platform/local-api")
    .then(({ startLocalApiBridge }) => startLocalApiBridge())
    .catch((error) => log.error("Local API initialization failed", error));

  // Coordinated close/quit: the native close button and app exit wait for reading
  // traces, plugin quiescence, dispatched events and the KV queue before the window goes.
  const [{ registerShutdownOwners }, { installNativeCloseCoordination }] = await Promise.all([
    import("./platform/shutdown-owners"),
    import("./platform/window-close"),
  ]);
  registerShutdownOwners();
  await installNativeCloseCoordination();
  log.info("shutdown coordination installed");

  // The agent chat transport reads its config per-send, so registering just
  // after mount is safe — and it keeps the agent runtime (a heavy dependency
  // tree) off the boot-critical path entirely.
  const { registerAgentChatTransport } = await import("./features/ai/agent/register");
  registerAgentChatTransport();
  const { recoverAgentJobs } = await import("./features/ai/agent/ports/jobs-port");
  void recoverAgentJobs().catch((error) => log.error("saved Agent task recovery failed", error));
})().catch((error: unknown) => {
  // A failed boot used to be the worst diagnostic hole in the app: React
  // never mounts, the router's error boundary never renders, and the user
  // sits behind the splash forever. Log it, then replace the splash with a
  // copyable failure notice.
  log.error("boot failed", error);
  showBootFailure(error);
});
