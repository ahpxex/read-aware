import { appDataDir } from "@tauri-apps/api/path";
import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import manifest from "../../../../plugins/webdav-sync/manifest.json";
import { localKV } from "../../src/platform/local-store";
import { deletePluginSecret, setPluginSecret } from "../../src/platform/secret-store";
import { findSyncTransport } from "../../src/platform/sync/transport-registry";
import { startPluginWorker } from "../../src/features/plugins/runtime/plugin-worker-host";

type RequestEvidence = { path: string; aborted: boolean; completed: boolean };
const evidence = async () => await (await nativeFetch("http://127.0.0.1:18884/evidence")).json() as RequestEvidence[];
async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 4_000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error("Transport probe condition timed out");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

/** Runs the actual bundled WebDAV provider in an isolated real WebKit Worker. */
export async function runDesktopTransportProbe() {
  const dataDir = await appDataDir();
  if (!dataDir.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) {
    throw new Error("Run this probe in the isolated capability-e2e Tauri configuration");
  }
  const id = "capability-session-webdav";
  await localKV.setItemAsync(`read-aware-plugin.${id}.settings`, JSON.stringify({
    serverUrl: "http://127.0.0.1:18884/slow", username: "probe", basePath: "dav",
  }));
  const disposables: PluginDisposable[] = [];
  const worker = await startPluginWorker({ ...manifest, id } as PluginManifest, "0.5.4", disposables, {
    moduleUrl: new URL("../../../../plugins/webdav-sync/dist/main.js", import.meta.url).href,
  });
  const start = (await evidence()).length;
  const results: { mode: string; codes: string[]; requests: number }[] = [];
  try {
    await worker.checkHealth(); worker.promote();
    const provider = findSyncTransport(`plugin:${id}:webdav`);
    if (!provider) throw new Error("Bundled WebDAV provider failed to register");
    for (const mode of ["close", "settings", "secret", "terminate"]) {
      const session = await provider.open();
      const before = (await evidence()).length;
      const pending = ["one", "two"].map(name => session.getMeta(name).then(
        () => "unexpected-success", error => (error as { code?: string }).code ?? "uncoded",
      ));
      await until(async () => (await evidence()).length === before + 2);
      if (mode === "close") { await session.close(); await session.close(); }
      else if (mode === "settings") {
        await localKV.setItemAsync(`read-aware-plugin.${id}.settings`, JSON.stringify({
          serverUrl: "http://127.0.0.1:18884/slow", username: "probe", basePath: "changed",
        }));
        const replacement = await provider.open();
        if (!replacement.endpointId.endsWith("/changed")) throw new Error("New session used stale settings");
        await replacement.close();
      }
      else if (mode === "secret") await setPluginSecret(id, "password", "credential-free-probe");
      else await worker.terminate();
      const codes = await Promise.all(pending);
      if (codes.some(code => code !== "plugin/unavailable" && code !== "plugin/cancelled")) throw new Error(`Unexpected transport result: ${codes}`);
      await until(async () => (await evidence()).slice(before).every(row => row.aborted && !row.completed));
      let stale = "";
      try { await session.getMeta("stale"); } catch (error) { stale = (error as { code?: string }).code ?? ""; }
      if (stale !== "plugin/unavailable" || (await evidence()).length !== before + 2) throw new Error("Closed session dispatched new network work");
      results.push({ mode, codes, requests: 2 });
    }
    if (findSyncTransport(provider.ref)) throw new Error("Stopped plugin left a provider registered");
    let retired = "";
    try { await provider.open(); } catch (error) { retired = (error as { code?: string }).code ?? ""; }
    if (retired !== "plugin/unavailable") throw new Error("Retired provider reopened");
    return { dataDir, pluginVersion: manifest.version, results, requests: (await evidence()).slice(start), retired, cleanupOwners: disposables.length };
  } finally {
    try { await worker.terminate(); }
    finally {
      for (const disposable of disposables.reverse()) disposable.dispose();
      await deletePluginSecret(id, "password");
    }
  }
}
