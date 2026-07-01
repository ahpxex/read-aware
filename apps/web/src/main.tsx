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
  const { mountApp } = await import("./app-mount");
  mountApp();
})();
