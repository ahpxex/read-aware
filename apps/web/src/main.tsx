import { applyPlatformAttributes, disableNativeContextMenu } from "./platform/environment";
import { hydrateLocalStore } from "./platform/local-store";
import "./index.css";

applyPlatformAttributes();
disableNativeContextMenu();

// Hydrate the device-local config snapshot (SQLite on desktop; no-op in the
// browser) BEFORE importing the app — its module graph seeds Jotai atoms
// synchronously from that config, so it must not evaluate until the snapshot is
// ready. `app-mount` is therefore a dynamic import.
void (async () => {
  await hydrateLocalStore();
  // Initialize i18n before the app renders: read the persisted language (or
  // auto-detect on first run) and load that locale's catalogs, so the first
  // paint is already translated. Dynamic imports keep the app's atom-seeding
  // module graph from evaluating before the config snapshot is in place.
  const { getGeneralSettings } = await import(
    "./features/settings/lib/general-settings"
  );
  const { detectInitialLocale } = await import("./i18n/detect");
  const { initI18n } = await import("./i18n");
  await initI18n(detectInitialLocale(getGeneralSettings().language));

  const { mountApp } = await import("./app-mount");
  mountApp();

  // 真 agent 后端接上 ChatTransport seam；无 BYOK 配置时逐轮回退 mock。
  // 挂载后再动态引入，pi 及其 provider 依赖不进首屏 chunk。
  const { registerAgentChatTransport } = await import("./features/ai/agent/register");
  registerAgentChatTransport();
})();
