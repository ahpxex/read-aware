import type { PluginContext } from "@read-aware/plugin-types";
import { applyProfile, captureProfile, deleteProfile, listProfiles, parseProfile, profileCollection, profileName, profileToken, saveProfile } from "./profiles";

const invalid = (): never => { throw Object.assign(Error("Invalid workspace tool input"), { code: "plugin/invalid-input" }); };
function fields(params: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(params).some(key => !allowed.includes(key))) invalid();
}
function text(value: unknown, max = 512): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) return invalid();
  return value;
}
const string = (maxLength = 512) => ({ type: "string", minLength: 1, maxLength });

export function registerProfileTools(ctx: PluginContext) {
  if (!ctx.contributions.agentTools) throw Error("Workspace Profiles requires agent:tools");
  ctx.contributions.agentTools.register({ name: "workspace_profiles", label: "Inspect workspace profiles", contexts: ["global", "book"],
    description: "Read-only workspace presets. List returns a bounded page of names, IDs and revisions; continue with nextCursor, restart on stale-cursor. Inspect requires an exact id and returns the preset values and revision for manage_workspace_profile. Current returns the ten global preset settings and workspaceToken for save_workspace_profile. Does not change settings, select a profile or save. Invalid entries may only be deleted.",
    parameters: { type: "object", properties: { operation: { type: "string", enum: ["list", "inspect", "current"] }, id: string(), cursor: string(8192), limit: { type: "integer", minimum: 1, maximum: 20 } }, required: ["operation"], additionalProperties: false },
    execute: async params => {
      if (params.operation === "list") {
        fields(params, ["operation", "cursor", "limit"]);
        const limit = params.limit ?? 10;
        if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20) return invalid();
        const page = await listProfiles(ctx, params.cursor === undefined ? undefined : text(params.cursor, 8192), limit);
        if (page.status === "stale-cursor") return page;
        return { status: "ready", nextCursor: page.nextCursor, items: page.items.map(doc => {
          const profile = parseProfile(doc.data);
          return { id: doc.id, revision: doc.revision, valid: Boolean(profile), ...(profile ? { name: profile.name, version: profile.version } : {}) };
        }) };
      }
      if (params.operation === "current") {
        fields(params, ["operation"]);
        const profile = await captureProfile(ctx, "Current workspace");
        return { changes: profile.changes, workspaceToken: await profileToken(profile) };
      }
      if (params.operation === "inspect") {
        fields(params, ["operation", "id"]);
        const id = text(params.id), doc = await profileCollection(ctx).get(id);
        if (!doc) return { status: "not-found", id };
        const profile = parseProfile(doc.data);
        return { status: profile ? "ready" : "invalid-profile", id, revision: doc.revision, ...(profile ? { profile } : {}) };
      }
      return invalid();
    },
  });
  ctx.contributions.agentTools.register({ name: "save_workspace_profile", label: "Save workspace profile", contexts: ["global", "book"], approval: "required",
    description: "After host approval, save a named copy of the global workspace previously inspected using workspace_profiles(current). Requires its unchanged workspaceToken; returns stale-workspace if those ten values changed. Captures shelf layout/group/sort, app theme/motion, global reader font size/spacing/font and independent content font/follow-reader. No host settings are changed. Does not overwrite an existing profile; repeated successful calls may create separate presets.",
    parameters: { type: "object", properties: { name: string(80), workspaceToken: { type: "string", pattern: "^wp1:[a-f0-9]{64}$" } }, required: ["name", "workspaceToken"], additionalProperties: false },
    execute: async params => {
      fields(params, ["name", "workspaceToken"]);
      const name = profileName(params.name), token = text(params.workspaceToken, 68);
      if (!/^wp1:[a-f0-9]{64}$/.test(token)) return invalid();
      return saveProfile(ctx, name, token);
    },
  });
  ctx.contributions.agentTools.register({ name: "manage_workspace_profile", label: "Manage workspace profile", contexts: ["global", "book"], approval: "required",
    description: "Apply or permanently delete an exact workspace preset after host approval. First inspect it with workspace_profiles(inspect), then pass the exact id and expectedRevision. Changed documents return conflict. Apply submits the inspected preset values in one host settings update, preserving per-book overrides; version 1 changes seven fields and leaves fonts unchanged, version 2 changes ten. Delete conditionally removes only the preset. No book data, selection, AI privacy, credentials or plugin lifecycle changes. Application is not a transaction with private profile storage or a font-rendering completion receipt.",
    parameters: { type: "object", properties: { action: { type: "string", enum: ["apply", "delete"] }, id: string(), expectedRevision: string() }, required: ["action", "id", "expectedRevision"], additionalProperties: false },
    execute: async params => {
      fields(params, ["action", "id", "expectedRevision"]);
      const id = text(params.id), revision = text(params.expectedRevision);
      if (params.action === "delete") return deleteProfile(ctx, id, revision);
      if (params.action !== "apply") return invalid();
      const result = await applyProfile(ctx, id, revision);
      return result.status === "conflict" ? result : { status: result.status, id, name: result.name,
        changed: result.changed, preservedBookOverrides: result.overrides.length };
    },
  });
}
