import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { createRoot, type Root } from "react-dom/client";
import type { Id, SettingChange } from "@read-aware/core";
import { PROFILE_PATHS } from "../../../../plugins/workspace-profiles/src/profiles";
import { interactionFromToolDetails } from "../../../../packages/agent/src/tools/user-interaction";
import { createLibraryDomain } from "../../src/domain/library";
import { createSettingsDomain } from "../../src/domain/settings/domain";
import { localKV } from "../../src/platform/local-store";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { toChatInteractionRequest } from "../../src/features/ai/agent/chat-interaction-request";
import { ChatInteractionPrompt } from "../../src/features/ai/components/ChatInteractionPrompt";
import type { ChatInteractionPart } from "../../src/features/ai/lib/chat-types";
import { installedPluginsAtom, pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { runPluginContribution } from "../../src/features/plugins/lib/run-result";
import { pluginDocsDelete, pluginDocsGet, pluginDocsList } from "../../src/features/plugins/runtime/plugin-backend";
import { getPluginAgentContext, getPluginMemoryCandidates } from "../../src/features/plugins/runtime/plugin-tools";
import { setPluginEnabled } from "../../src/features/plugins/runtime/plugin-host";

type Plugin = "workspace-profiles" | "reading-goals";
let bookId: Id | undefined, profileName: string | undefined;
let original: SettingChange[] = [];
const enabled = new Map<Plugin, boolean>();
let root: Root | undefined, container: HTMLElement | undefined, controller: AbortController | undefined;
let work: Promise<void> | undefined, outcome: unknown;

async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated capability-e2e profile required");
}
function ownedBook() {
  if (!bookId) throw Error("Prepare composition first");
  return bookId;
}
function legacyKey() { return `read-aware-plugin.reading-goals.goal:${ownedBook()}`; }
async function profiles() {
  const rows = await pluginDocsList("workspace-profiles", "profiles", { limit: 1000 });
  return rows.filter(row => JSON.parse(row.json).name === profileName);
}
export async function prepareProfileGoalComposition(id: string) {
  await isolated();
  if (bookId || enabled.size) throw Error("Composition already prepared");
  const book = await createLibraryDomain("user").queries.books.get(id);
  if (!book?.title.startsWith("Composition ")) throw Error("Requires an owned composition test book");
  if (await pluginDocsGet("reading-goals", "goals", id)) throw Error("Test book already has a goal");
  bookId = book.id; profileName = `${book.title} workspace`;
  const snapshot = await createSettingsDomain("user").queries.snapshot({ target: { kind: "global" } });
  original = PROFILE_PATHS.map(path => {
    const setting = snapshot.settings.find(item => item.path === path);
    if (!setting) throw Error(`Missing profile setting ${path}`);
    return { path, value: setting.value, target: { kind: "global" } };
  });
  // Seed an owned legacy record before Worker activation; the real plugin promotes it.
  await localKV.setItemAsync(legacyKey(), JSON.stringify({ text: "Composition legacy goal", suggestMemory: false }));
  for (const pluginId of ["workspace-profiles", "reading-goals"] as const) {
    const plugin = getDefaultStore().get(installedPluginsAtom).find(item => item.manifest.id === pluginId);
    if (!plugin?.builtin) throw Error("Requires RepoDist plugins");
    enabled.set(pluginId, plugin.enabled);
    if (plugin.enabled) await setPluginEnabled(pluginId, false);
    await setPluginEnabled(pluginId, true);
  }
  return inspectProfileGoalComposition();
}
export async function inspectProfileGoalComposition() {
  await isolated();
  return { bookId: ownedBook(), profileName, original,
    layout: await createSettingsDomain("user").queries.read("shelf.layout"),
    goal: await pluginDocsGet("reading-goals", "goals", ownedBook()), legacy: localKV.getItem(legacyKey()),
    profiles: await profiles(), plugins: getDefaultStore().get(installedPluginsAtom)
      .filter(item => enabled.has(item.manifest.id as Plugin))
      .map(item => ({ id: item.manifest.id, enabled: item.enabled, version: item.manifest.version, error: item.error })) };
}
export async function changeCompositionLayout() {
  await isolated(); ownedBook();
  const old = original.find(item => item.path === "shelf.layout")!.value;
  return createSettingsDomain("user").commands.update([{ path: "shelf.layout", value: old === "grid" ? "list" : "grid" }]);
}
async function tool(pluginId: Plugin, name: string, params: Record<string, unknown>) {
  await isolated(); ownedBook();
  const allowed = pluginId === "reading-goals" ? ["get_reading_goal", "set_reading_goal", "clear_reading_goal"]
    : ["workspace_profiles", "save_workspace_profile", "manage_workspace_profile"];
  if (!allowed.includes(name) || !enabled.has(pluginId)) throw Error("Unowned tool");
  if (pluginId === "reading-goals" && params.bookId !== bookId) throw Error("Unowned goal");
  if (name === "save_workspace_profile" && params.name !== profileName) throw Error("Unowned profile name");
  if (params.id !== undefined && !(await profiles()).some(row => row.id === params.id)) throw Error("Unowned profile");
  const result = buildRuntimeDeps().extraTools!({ kind: "global", threadId: "capability-profile-goal-composition" })
    .find(item => item.name === `plugin_${pluginId.replaceAll("-", "_")}_${name}`);
  if (!result) throw Error("Registered Agent tool missing");
  return result;
}
export async function readCompositionTool(pluginId: Plugin, name: "get_reading_goal" | "workspace_profiles", params: Record<string, unknown>) {
  return (await tool(pluginId, name, params)).execute(crypto.randomUUID(), params);
}
export async function beginCompositionApproval(pluginId: Plugin, name: string, params: Record<string, unknown>) {
  const target = await tool(pluginId, name, params);
  if (work) throw Error("Finish prior approval first");
  container = document.createElement("div"); container.dataset.profileGoalApproval = "true";
  Object.assign(container.style, { position: "fixed", zIndex: "10000", inset: "64px 24px auto", maxWidth: "680px", margin: "auto",
    background: "var(--color-paper, white)", padding: "16px", maxHeight: "80vh", overflow: "auto" });
  document.body.append(container); root = createRoot(container); controller = new AbortController(); outcome = { status: "pending" };
  let part: ChatInteractionPart | undefined;
  work = target.execute(crypto.randomUUID(), params, controller.signal, update => {
    const details = interactionFromToolDetails(update.details);
    if (details?.phase === "request") part = { type: "interaction", id: details.request.id, request: toChatInteractionRequest(details.request), state: "pending" };
    if (details?.phase === "response" && part) part = { ...part, state: "answered", answer: details.answer };
    if (part) root?.render(<ChatInteractionPrompt part={part} />);
  }).then(result => { outcome = { status: "done", result }; }, error => {
    outcome = { status: "error", code: error && typeof error === "object" && "code" in error ? error.code : null };
  });
  return { started: true };
}
export function compositionApprovalStatus() { return outcome; }
export async function endCompositionApproval() {
  controller?.abort(); await work; work = undefined; controller = undefined;
  root?.unmount(); root = undefined; container?.remove(); container = undefined;
  return outcome;
}
export async function openProfileGoalCommand(pluginId: Plugin) {
  await isolated(); ownedBook();
  if (!enabled.has(pluginId)) throw Error("Unowned plugin");
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === pluginId && item.id === "open");
  if (!command) throw Error("Registered command missing");
  await runPluginContribution(pluginId, pluginId, () => command.run(), { presentation: "dialog", owner: command.run });
}
export async function profileGoalContext() {
  await isolated();
  const scope = { kind: "book" as const, bookId: ownedBook() };
  return { context: await getPluginAgentContext({ scope, userText: "Composition test" }),
    candidates: await getPluginMemoryCandidates({ scope, userText: "Composition test", assistantText: "Synthetic answer" }) };
}
export async function cleanupProfileGoalComposition() {
  await isolated(); await endCompositionApproval();
  if (bookId) {
    await createSettingsDomain("user").commands.update(original);
    for (const row of await profiles()) await pluginDocsDelete("workspace-profiles", "profiles", row.id);
    await localKV.removeItemAsync(legacyKey());
    await pluginDocsDelete("reading-goals", "goals", bookId);
  }
  for (const [id, wasEnabled] of enabled) if (!wasEnabled) await setPluginEnabled(id, false);
  const result = await inspectProfileGoalComposition();
  enabled.clear(); bookId = undefined; profileName = undefined; original = [];
  return result;
}
