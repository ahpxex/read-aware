import type { PluginContext } from "@read-aware/plugin-types";
import { goalBookId, parseGoal, readGoalState, writeGoal } from "./goals";
import { copy } from "./strings";

const invalid = (): never => { throw Object.assign(Error("Invalid reading goal tool input"), { code: "plugin/invalid-input" }); };
function fields(params: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(params).some(key => !allowed.includes(key))) invalid();
}
const bookIdSchema = { type: "string", minLength: 1, maxLength: 512 };
const revisionSchema = { anyOf: [bookIdSchema, { type: "null" }] };
function revision(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > 512) return invalid();
  return value;
}

export function registerGoalTools(ctx: PluginContext) {
  if (!ctx.contributions.agentTools) throw Error("Reading Goals requires agent:tools");
  const t = copy(ctx.locale);
  ctx.contributions.agentTools.register({ name: "get_reading_goal", label: t.title, contexts: ["book", "global"],
    description: "Read this plugin's saved goal and revision for an exact bookId, independent of the currently open reader. A null goal means no active goal; preserve its returned revision, including null, for subsequent writes. Legacy goals are promoted into versioned private documents on first access. Does not retrieve book text or create user memory.",
    parameters: { type: "object", properties: { bookId: bookIdSchema }, required: ["bookId"], additionalProperties: false },
    execute: async params => { fields(params, ["bookId"]); return readGoalState(ctx, goalBookId(params.bookId)); },
  });
  ctx.contributions.agentTools.register({ name: "set_reading_goal", label: t.save, contexts: ["book", "global"], approval: "required",
    description: "Save or replace a book's private reading goal after host approval of the exact text, bookId and suggestMemory flag. First get_reading_goal and pass its expectedRevision (null only for an absent record). Changed records return conflict. Text is 1..500 characters. suggestMemory must be explicit: true only opts this goal into the existing host-reviewed memory-candidate pipeline; it does not directly write memory or enable Build memory. The goal supplies context on subsequent book turns. Never edits the book, reading history, privacy settings or existing memories.",
    parameters: { type: "object", properties: { bookId: bookIdSchema, text: { type: "string", minLength: 1, maxLength: 500 }, suggestMemory: { type: "boolean" }, expectedRevision: revisionSchema }, required: ["bookId", "text", "suggestMemory", "expectedRevision"], additionalProperties: false },
    execute: async params => {
      fields(params, ["bookId", "text", "suggestMemory", "expectedRevision"]);
      const bookId = goalBookId(params.bookId), expectedRevision = revision(params.expectedRevision);
      const goal = parseGoal({ text: params.text, suggestMemory: params.suggestMemory });
      // Promote any legacy record before comparing null, so it cannot be overwritten unseen.
      await readGoalState(ctx, bookId);
      return writeGoal(ctx, bookId, goal, expectedRevision);
    },
  });
  ctx.contributions.agentTools.register({ name: "clear_reading_goal", label: t.clear, contexts: ["book", "global"], approval: "required",
    description: "Clear one private reading goal after host approval. First get_reading_goal and pass its exact expectedRevision; conflicts do not erase newer edits. A cleared record retains a versioned tombstone to prevent legacy goal resurrection. Stops future goal context/candidates but does not retract memory already accepted by the host or cancel a running turn. Can clear an orphaned goal after its book has been removed. Does not remove the book or change memory policy.",
    parameters: { type: "object", properties: { bookId: bookIdSchema, expectedRevision: revisionSchema }, required: ["bookId", "expectedRevision"], additionalProperties: false },
    execute: async params => {
      fields(params, ["bookId", "expectedRevision"]);
      const bookId = goalBookId(params.bookId), expectedRevision = revision(params.expectedRevision);
      await readGoalState(ctx, bookId);
      return writeGoal(ctx, bookId, null, expectedRevision);
    },
  });
}
