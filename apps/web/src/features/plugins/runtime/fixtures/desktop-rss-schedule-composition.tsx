import { appDataDir } from "@tauri-apps/api/path";
import { createRoot, type Root } from "react-dom/client";
import { buildScheduleTools } from "../../../../../../../packages/agent/src/tools/schedule-tools";
import { interactionFromToolDetails } from "../../../../../../../packages/agent/src/tools/user-interaction";
import { localKV } from "../../../../platform/local-store";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { toChatInteractionRequest } from "../../../ai/agent/chat-interaction-request";
import { ChatInteractionPrompt } from "../../../ai/components/ChatInteractionPrompt";
import type { ChatInteractionPart } from "../../../ai/lib/chat-types";
import { setPluginEnabled } from "../plugin-host";
import { pluginSchedules } from "../plugin-scheduler";
import { prepareRssComposition, inspectRssComposition, cleanupRssComposition } from "./desktop-rss-composition";

const key = "read-aware-plugin.rss-reader.schedule-state";
let original: { raw: string | null; enabled: boolean } | undefined;
let root: Root | undefined, container: HTMLElement | undefined, controller: AbortController | undefined;
let work: Promise<void> | undefined, outcome: unknown;
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated profile required");
}
function tools() {
  if (!original) throw Error("Prepare RSS schedule composition first");
  return buildScheduleTools({ kind: "global", threadId: "capability-rss-schedule-composition" }, buildRuntimeDeps());
}
export async function prepareRssScheduleComposition() {
  await isolated();
  if (original) throw Error("Already prepared");
  const raw = localKV.getItem(key);
  const prepared = await prepareRssComposition();
  original = { raw, enabled: prepared.wasEnabled };
  return { ...prepared, original, schedules: pluginSchedules.list({ pluginId: "rss-reader" }) };
}
export async function inspectRssScheduleComposition() {
  await isolated(); tools();
  return { schedules: pluginSchedules.list({ pluginId: "rss-reader" }), persisted: localKV.getItem(key),
    feed: await inspectRssComposition() };
}
export async function readRssScheduleTool() {
  await isolated();
  return tools()[0]!.execute(crypto.randomUUID(), { pluginId: "rss-reader" });
}
export async function beginRssScheduleApproval(action: "pause" | "resume" | "run") {
  await isolated();
  if (work) throw Error("Finish prior approval first");
  const target = tools()[1]!;
  container = document.createElement("div"); container.dataset.rssScheduleApproval = "true";
  Object.assign(container.style, { position: "fixed", zIndex: "10000", inset: "64px 24px auto", maxWidth: "680px", margin: "auto",
    background: "var(--color-paper, white)", padding: "16px", maxHeight: "80vh", overflow: "auto" });
  document.body.append(container); root = createRoot(container); controller = new AbortController(); outcome = { status: "pending" };
  let part: ChatInteractionPart | undefined;
  work = target.execute(crypto.randomUUID(), { pluginId: "rss-reader", id: "refresh-feeds", action }, controller.signal, update => {
    const details = interactionFromToolDetails(update.details);
    if (details?.phase === "request") part = { type: "interaction", id: details.request.id, request: toChatInteractionRequest(details.request), state: "pending" };
    if (details?.phase === "response" && part) part = { ...part, state: "answered", answer: details.answer };
    if (part) root?.render(<ChatInteractionPrompt part={part} />);
  }).then(result => { outcome = { status: "done", result }; }, error => {
    outcome = { status: "error", code: error && typeof error === "object" && "code" in error ? error.code : null };
  });
  return { started: true };
}
export function rssScheduleApprovalStatus() { return outcome; }
export async function endRssScheduleApproval() {
  controller?.abort(); await work; work = undefined; controller = undefined;
  root?.unmount(); root = undefined; container?.remove(); container = undefined;
  return outcome;
}
export async function cleanupRssScheduleComposition() {
  await isolated();
  if (!original) throw Error("No owned schedule state");
  await endRssScheduleApproval();
  if (pluginSchedules.list({ pluginId: "rss-reader" }).schedules.some(item => item.running)) throw Error("Wait for the actual schedule run before cleanup");
  const cleanup = await cleanupRssComposition();
  await setPluginEnabled("rss-reader", false);
  await pluginSchedules.drainWrites("rss-reader");
  if (original.raw === null) await localKV.removeItemAsync(key);
  else await localKV.setItemAsync(key, original.raw);
  if (original.enabled) await setPluginEnabled("rss-reader", true);
  const result = { cleanup, restoredSchedule: localKV.getItem(key), original };
  original = undefined;
  return result;
}
