import { AppError } from "./errors";
import { normalizeConversationTarget, type ConversationTarget } from "./conversation-control";
import { createContextBundle } from "./context-bundle";

export type ConversationInsightsSnapshot = {
  target: ConversationTarget;
  status: "present" | "absent" | "unavailable";
  summary: string | null;
  revision: string;
};

/** Stored rolling context, not a promise that the latest messages were summarized. */
export async function conversationContextBundle(input: ConversationInsightsSnapshot, expectedTarget: ConversationTarget) {
  const snapshot = structuredClone(input), target = normalizeConversationTarget(expectedTarget);
  if (!snapshot || Object.keys(snapshot).sort().join(",") !== "revision,status,summary,target"
    || !snapshot.target || Object.keys(snapshot.target).sort().join(",") !== "id,kind"
    || snapshot.target.kind !== target.kind || snapshot.target.id !== target.id
    || !["present", "absent", "unavailable"].includes(snapshot.status)
    || (snapshot.status === "present" ? typeof snapshot.summary !== "string" : snapshot.summary !== null)) {
    throw new AppError("memory/invalid-input", "Invalid conversation insights snapshot");
  }
  const bytes = new TextEncoder().encode(JSON.stringify(["conversation-insights", 1, target.kind, target.id, snapshot.status, snapshot.summary]));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const revision = `cins1:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  if (revision !== snapshot.revision) throw new AppError("memory/invalid-input", "Invalid conversation insights revision");
  return createContextBundle({ format: "readaware.context", schemaVersion: 1, recipeVersion: 1,
    kind: "conversation_insights_context", scope: { kind: target.kind === "book" ? "book" : "conversation", id: target.id },
    sourceRevision: revision,
    items: snapshot.status === "present" ? [{ kind: "conversation_insight", id: target.id, revision,
      label: "Stored rolling conversation summary", text: snapshot.summary }] : [],
    omissions: snapshot.status === "unavailable" ? [{ kind: "conversation_insight", reason: "unavailable", count: 1 }] : [] });
}
