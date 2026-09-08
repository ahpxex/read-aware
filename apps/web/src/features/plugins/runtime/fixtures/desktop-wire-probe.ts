import { getDefaultStore } from "jotai";
import { appDataDir } from "@tauri-apps/api/path";
import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { invoke } from "../../../../platform/ipc";
import { localKV } from "../../../../platform/local-store";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { startPluginWorker } from "../plugin-worker-host";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";

/** Invoked only by the desktop E2E driver; refuses the user's real app data. */
export async function runDesktopWireProbe(scenario: "request-storage" | "pre-abort" | "live-abort" | "stop") {
  const dataDir = await appDataDir();
  if (!dataDir.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) {
    throw new Error("Run this probe in the isolated capability-e2e Tauri configuration");
  }
  const id = `capability-wire-${scenario}`;
  const prefix = `read-aware-plugin.${id}.`;
  await localKV.setItemAsync(prefix + "endpoint", JSON.stringify(`http://127.0.0.1:18884/${scenario === "live-abort" || scenario === "stop" ? "slow" : "echo"}`));
  await localKV.setItemAsync(prefix + "abortAfterMs", "250");
  const manifest: PluginManifest = {
    id, name: "Capability wire probe", description: scenario, version: "1.0.0", schemaVersion: 1,
    permissions: ["service:network"], requires: { services: { storage: "^2.0.0", network: "^1.0.0" } },
  };
  const disposables: PluginDisposable[] = [];
  const worker = await startPluginWorker(manifest, "0.5.4", disposables, {
    moduleUrl: new URL("./wire-probe.ts", import.meta.url).href,
  });
  try {
    await worker.checkHealth(); worker.promote();
    const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === id);
    if (!command) throw new Error("Probe command did not register in the real host");
    let result;
    if (scenario === "stop") {
      const before = (await (await nativeFetch("http://127.0.0.1:18884/evidence")).json() as unknown[]).length;
      const pending = Promise.resolve(command.run()).then(value => ({ value }), error => ({ code: error?.code }));
      const deadline = Date.now() + 3000;
      while ((await (await nativeFetch("http://127.0.0.1:18884/evidence")).json() as unknown[]).length === before) {
        if (Date.now() > deadline) throw new Error("Native request never reached the probe server");
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await worker.terminate();
      result = await pending;
    } else result = await command.run();
    const disk = await invoke<Record<string, string>>("load_kv_all");
    return { scenario, result, durableResult: disk[prefix + "result"] ?? null, dataDir };
  } finally {
    try { await worker.terminate(); }
    finally { for (const disposable of disposables.reverse()) disposable.dispose(); }
    if (inspectContributions(id).length) throw new Error("Probe left registered contributions behind");
  }
}
