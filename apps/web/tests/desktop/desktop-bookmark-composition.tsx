import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { createRoot, type Root } from "react-dom/client";
import { createLibraryDomain } from "../../src/domain/library";
import { hostWindow } from "../../src/services/window";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { toChatInteractionRequest } from "../../src/features/ai/agent/chat-interaction-request";
import { ChatInteractionPrompt } from "../../src/features/ai/components/ChatInteractionPrompt";
import type { ChatInteractionPart } from "../../src/features/ai/lib/chat-types";
import { interactionFromToolDetails } from "../../../../packages/agent/src/tools/user-interaction";
import { pluginCommandsAtom, installedPluginsAtom } from "../../src/features/plugins/state/plugin-store";
import { runPluginContribution } from "../../src/features/plugins/lib/run-result";
import { pluginDocsList, pluginDocsDelete } from "../../src/features/plugins/runtime/plugin-backend";
import { setPluginEnabled } from "../../src/features/plugins/runtime/plugin-host";

let ownedBook: string | undefined;
const enabled = new Map<string, boolean>();
let originalWindow: Awaited<ReturnType<typeof hostWindow.snapshot>> | undefined;
let root: Root | undefined, container: HTMLElement | undefined, controller: AbortController | undefined;
let work: Promise<void> | undefined, outcome: unknown;

async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated capability-e2e profile required");
}
export async function prepareBookmarkComposition(bookId: string) {
  await isolated();
  if (ownedBook) throw Error("Composition already prepared");
  const book = await createLibraryDomain("user").queries.books.get(bookId);
  if (!book?.title.startsWith("Composition ")) throw Error("Requires an owned composition test book");
  ownedBook = bookId;
  originalWindow = await hostWindow.snapshot();
  for (const id of ["jumper", "workspace-profiles"]) {
    const plugin = getDefaultStore().get(installedPluginsAtom).find(item => item.manifest.id === id);
    if (!plugin?.builtin) throw Error("Requires RepoDist plugins");
    enabled.set(id, plugin.enabled);
    if (!plugin.enabled) await setPluginEnabled(id, true);
  }
  return inspectBookmarkComposition();
}
export async function inspectBookmarkComposition() {
  await isolated();
  return { bookId: ownedBook, window: await hostWindow.snapshot(),
    documents: ownedBook ? await pluginDocsList("jumper", "bookmarks", { bookId: ownedBook, limit: 100 }) : [],
    plugins: getDefaultStore().get(installedPluginsAtom).filter(item => ["jumper", "workspace-profiles"].includes(item.manifest.id))
      .map(item => ({ id: item.manifest.id, enabled: item.enabled, version: item.manifest.version, error: item.error })) };
}
export async function openCompositionCommand(pluginId: "jumper" | "workspace-profiles", id: string) {
  await isolated();
  if (!ownedBook || !enabled.has(pluginId)) throw Error("Prepare composition first");
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === pluginId && item.id === id);
  if (!command) throw Error("Registered command missing");
  await runPluginContribution(pluginId, pluginId, () => command.run(), { presentation: "dialog", owner: command.run });
}
function tool(name: string) {
  const value = buildRuntimeDeps().extraTools!({ kind: "global", threadId: "capability-bookmark-composition" })
    .find(item => item.name === `plugin_jumper_${name}`);
  if (!value) throw Error("Registered Agent tool missing");
  return value;
}
export async function readBookmarkTool(name: "list_bookmarks" | "inspect_bookmark_location", params: Record<string, unknown>) {
  await isolated();
  if (!ownedBook) throw Error("Prepare composition first");
  return tool(name).execute(crypto.randomUUID(), params);
}
export async function beginBookmarkApproval(name: "save_bookmark" | "manage_bookmark", params: Record<string, unknown>) {
  await isolated();
  if (!ownedBook || work) throw Error("Prepare composition and finish prior approval first");
  container = document.createElement("div"); container.dataset.bookmarkApproval = "true";
  Object.assign(container.style, { position: "fixed", zIndex: "10000", inset: "64px 24px auto", maxWidth: "680px", margin: "auto",
    background: "var(--color-paper, white)", padding: "16px", maxHeight: "80vh", overflow: "auto" });
  document.body.append(container); root = createRoot(container); controller = new AbortController(); outcome = { status: "pending" };
  let part: ChatInteractionPart | undefined;
  work = tool(name).execute(crypto.randomUUID(), params, controller.signal, update => {
    const details = interactionFromToolDetails(update.details);
    if (details?.phase === "request") part = { type: "interaction", id: details.request.id, request: toChatInteractionRequest(details.request), state: "pending" };
    if (details?.phase === "response" && part) part = { ...part, state: "answered", answer: details.answer };
    if (part) root?.render(<ChatInteractionPrompt part={part} />);
  }).then(result => { outcome = { status: "done", result }; }, error => {
    outcome = { status: "error", code: error && typeof error === "object" && "code" in error ? error.code : null };
  });
  return { started: true };
}
export function bookmarkApprovalStatus() { return outcome; }
export async function endBookmarkApproval() {
  controller?.abort(); await work; work = undefined; controller = undefined;
  root?.unmount(); root = undefined; container?.remove(); container = undefined;
  return outcome;
}
export async function cleanupBookmarkComposition() {
  await isolated(); await endBookmarkApproval();
  if (ownedBook) for (const doc of await pluginDocsList("jumper", "bookmarks", { bookId: ownedBook, limit: 100 })) {
    await pluginDocsDelete("jumper", "bookmarks", doc.id);
  }
  if (originalWindow?.supported) {
    await hostWindow.control({ action: "restore" });
    if (originalWindow.maximized) await hostWindow.control({ action: "maximize" });
    if (originalWindow.fullscreen) await hostWindow.control({ action: "fullscreen", enabled: true });
    if (originalWindow.minimized) await hostWindow.control({ action: "minimize" });
  }
  for (const [id, wasEnabled] of enabled) if (!wasEnabled) await setPluginEnabled(id, false);
  const result = await inspectBookmarkComposition();
  enabled.clear(); ownedBook = undefined; originalWindow = undefined;
  return result;
}
