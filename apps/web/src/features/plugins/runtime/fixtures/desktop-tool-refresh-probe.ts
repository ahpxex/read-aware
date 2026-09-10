import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { runToolRefreshLoop } from "@read-aware/agent/testing/tool-refresh-probe";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { getPluginAgentTools } from "../plugin-tools";
import { startPluginWorker } from "../plugin-worker-host";

const id = "capability-tool-refresh";
const target = "plugin_capability_tool_refresh_target";
const arm = "plugin_capability_tool_refresh_arm";
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }

/** Actual Tauri Worker and product Agent loop; scripted inference and isolated in-memory conversation ports. */
export async function runDesktopToolRefreshProbe() {
  const dataDir = await appDataDir();
  assert(dataDir.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e"), "Use isolated capability-e2e app");
  const disposables: PluginDisposable[] = [];
  const worker = await startPluginWorker({ id, name: "Tool refresh probe", version: "1.0.0", schemaVersion: 1,
    permissions: ["agent:tools"], requires: { contributions: { commands: "^1.1.0", agentTools: "^1.1.0" } } },
  "0.5.4", disposables, { moduleUrl: new URL("./tool-refresh-probe.ts", import.meta.url).href });
  const runCommand = async (name: string) => {
    const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === name);
    assert(command, `Missing command: ${name}`);
    return command.run();
  };
  try {
    await worker.checkHealth(); worker.promote();
    const { snapshots, ends } = await runToolRefreshLoop({
      extraTools: getPluginAgentTools, arm, target,
      beforeResponse: async request => {
        if (request === 3) await runCommand("disable");
        if (request === 7) await runCommand("replace");
      },
    });
    assert(!snapshots[0]!.tools.includes(target), "Disabled initial tool advertised");
    assert(snapshots[1]!.tools.includes(target), "Armed tool missing from next request");
    assert(ends[1]!.isError === false, "Armed tool failed execution");
    assert(ends[2]!.isError === true, "Outstanding response bypassed disabled registration");
    assert(!snapshots[3]!.tools.includes(target), "Disabled tool remained on next request");
    assert(snapshots[4]!.tools.includes(target) && ends[4]!.isError === false, "Re-enabled tool unavailable in same turn");
    assert(ends[5]!.isError === true, "Old callback dispatched to replacement");
    assert(ends[6]!.isError === false && ends[6]!.output?.includes('"generation":2'), "Replacement not callable on next request");
    assert(snapshots[6]!.messages.includes("First result."), "Tool changes discarded prior conversation");
    const state = parseProbeToast((await runCommand("inspect"))!.toast!);
    assert(state.calls === 3 && state.generation === 2, "Unexpected target side effects");
    return { dataDir, modelRequests: snapshots.length, state, ends,
      targetDiscovery: snapshots.map(snapshot => snapshot.tools.includes(target)),
      priorConversationRetained: true, inference: "scripted stream transport", storage: "in-memory test ports" };
  } finally {
    try { await worker.terminate(); }
    finally { for (const disposable of disposables.reverse()) disposable.dispose(); }
    assert(inspectContributions(id).length === 0, "Retired probe left registrations");
  }
}
