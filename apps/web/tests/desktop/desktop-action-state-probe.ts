import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { headerActionsAtom, pluginCommandsAtom, selectionActionsAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { getPluginAgentTools } from "../../src/features/plugins/runtime/plugin-tools";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";

const id = "capability-action-state";
const store = getDefaultStore();
let worker: SandboxedPlugin | undefined;
let disposables: PluginDisposable[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw Error(message); };
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find(element => element.textContent?.trim() === label || element.getAttribute("aria-label") === label);
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 8_000;
  while (!await check()) {
    if (Date.now() > deadline) throw Error("Action state probe timed out");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
async function isolated() {
  const dataDir = await appDataDir();
  assert(dataDir.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e"), "Use isolated capability-e2e app");
  return dataDir;
}
const command = (name: string) => {
  const found = store.get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === name);
  if (!found) throw Error(`Missing probe command: ${name}`);
  return found;
};
export async function actionStateControl(name: string) { await isolated(); return parseProbeToast((await command(name).run())!.toast!); }
const scope = { kind: "global" as const, threadId: "action-state-probe" };
const tool = () => getPluginAgentTools(scope).find(tool => tool.name === "plugin_capability_action_state_target")!;
async function denied(run: () => unknown) {
  try { await run(); return false; }
  catch (error) { return (error as { code?: string }).code === "plugin/action-disabled"; }
}

/** Exercises real Worker handles, cached Agent tools and the running app's shortcut listener. */
export async function runDesktopActionStateProbe() {
  const dataDir = await isolated(); assert(!worker, "Clean up the previous action probe first");
  disposables = [];
  worker = await startPluginWorker({ id, name: "Action state probe", version: "1.0.0", schemaVersion: 1,
    permissions: ["agent:tools"], requires: { contributions: { commands: "^1.1.0", headerActions: "^1.1.0", selectionActions: "^1.1.0", agentTools: "^1.1.0" } } },
  "0.5.4", disposables, { moduleUrl: new URL("./action-state-probe.ts", import.meta.url).href });
  await worker.checkHealth(); worker.promote();
  try {
    const cached = tool(); assert(cached, "Agent tool did not register");
    const pending = cached.execute("running", { wait: true });
    await until(async () => (await actionStateControl("inspect")).waiting);
    const disabled = await actionStateControl("disable");
    assert(disabled.length === 6 && disabled.every((receipt: { status: string }) => receipt.status === "applied"), "Update receipt mismatch");
    assert(!tool(), "Disabled tool remains in Agent discovery");
    const cachedCommand = command("target");
    const headers = store.get(headerActionsAtom).filter(action => action.pluginId === id);
    const selection = store.get(selectionActionsAtom).find(action => action.pluginId === id)!;
    assert(await denied(() => cached.execute("disabled", {})), "Cached Agent tool bypassed disabled state");
    assert(await denied(cachedCommand.run), "Command bypassed disabled state");
    for (const action of headers) assert(await denied(() => action.view({})), "Header action bypassed disabled state");
    assert(await denied(() => selection.run({ text: "probe" } as never)), "Selection action bypassed disabled state");
    const key = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "u", altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    key();
    assert((await actionStateControl("inspect")).calls === 1, "Disabled shortcut invoked the callback");
    await actionStateControl("finish");
    assert((await pending).content[0]?.type === "text", "Disabling cancelled an already-started operation");
    assert((await actionStateControl("stale")).every((receipt: { status: string }) => receipt.status === "stale"), "Old states were applied");
    await actionStateControl("enable");
    await cached.execute("reenabled", {});
    key(); await until(async () => (await actionStateControl("inspect")).calls === 3);
    await actionStateControl("hide");
    assert(!tool() && await denied(cachedCommand.run), "Hidden contribution still executes");
    await actionStateControl("enable");
    return { dataDir, results: ["six contribution registrations updated through real Worker handles", "cached Agent tool and all four contribution points reject disabled and hidden execution",
      "real shortcut listener blocks disabled and executes enabled command", "in-flight tool survives disable; stale revisions rejected; re-enable works"], preview: true };
  } catch (error) { await cleanupDesktopActionStateProbe(); throw error; }
}

/** Run with the normal shelf overflow open. Uses the actual React-rendered buttons. */
export async function checkActionStateMenu() {
  await isolated();
  await until(() => !!button("State probe popup"));
  const popup = button("State probe popup")!;
  assert(!popup.disabled && popup.getAttribute("aria-pressed") === "true", "Enabled checked state not rendered");
  await actionStateControl("disable");
  await until(() => button("State probe popup")?.disabled === true);
  button("State probe popup")!.click();
  assert((await actionStateControl("inspect")).views === 0, "Disabled menu opened a view");
  await actionStateControl("hide");
  await until(() => !button("State probe popup") && !button("State probe page"));
  await actionStateControl("enable");
  await until(() => !!button("State probe popup"));
  return { enabled: true, disabled: true, checked: true, hidden: true, restored: true };
}

export async function cleanupDesktopActionStateProbe() {
  await isolated();
  try { await worker?.terminate(); }
  finally { for (const disposable of disposables.reverse()) disposable.dispose(); worker = undefined; disposables = []; }
  return { contributions: inspectContributions(id).length };
}
