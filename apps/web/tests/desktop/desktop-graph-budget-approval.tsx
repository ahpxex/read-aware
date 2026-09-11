import { appDataDir } from "@tauri-apps/api/path";
import { createRoot, type Root } from "react-dom/client";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { toChatInteractionRequest } from "../../src/features/ai/agent/chat-interaction-request";
import { ChatInteractionPrompt } from "../../src/features/ai/components/ChatInteractionPrompt";
import type { ChatInteractionPart } from "../../src/features/ai/lib/chat-types";
import { buildBookGraphTaskTool } from "../../../../packages/agent/src/tools/book-graph-task-tool";
import { interactionFromToolDetails } from "../../../../packages/agent/src/tools/user-interaction";

let root: Root | undefined, container: HTMLElement | undefined, controller: AbortController | undefined;
let work: Promise<void> | undefined, outcome: unknown;
export async function beginGraphBudgetApproval(bookId: string, maxChapters: number, taskId?: string) {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated data required");
  if (work) throw Error("Finish the previous approval first");
  container = document.createElement("div"); container.dataset.graphBudgetApproval = "true";
  Object.assign(container.style, { position: "fixed", zIndex: "10000", inset: "80px 24px auto", maxWidth: "640px", margin: "auto", background: "var(--color-paper, white)", padding: "16px", maxHeight: "80vh", overflow: "auto" });
  document.body.append(container); root = createRoot(container); controller = new AbortController(); outcome = { status: "pending" };
  let part: ChatInteractionPart | undefined;
  work = buildBookGraphTaskTool({ kind: "book", bookId }, buildRuntimeDeps()).execute(crypto.randomUUID(), { action: taskId ? "retry" : "rebuild", bookId, maxChapters, ...(taskId ? { taskId } : {}) }, controller.signal, update => {
    const details = interactionFromToolDetails(update.details);
    if (details?.phase === "request") part = { type: "interaction", id: details.request.id, request: toChatInteractionRequest(details.request), state: "pending" };
    if (details?.phase === "response" && part) part = { ...part, state: "answered", answer: details.answer };
    if (part) root?.render(<ChatInteractionPrompt part={part} />);
  }).then(result => { outcome = { status: "done", result }; }, error => { outcome = { status: "error", code: error && typeof error === "object" && "code" in error ? error.code : null }; });
  return { bookId, maxChapters };
}
export function graphBudgetApprovalStatus() { return outcome; }
export async function endGraphBudgetApproval() {
  controller?.abort(); await work; work = undefined; controller = undefined;
  root?.unmount(); root = undefined; container?.remove(); container = undefined;
  return outcome;
}
