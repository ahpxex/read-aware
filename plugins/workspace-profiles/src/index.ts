import type { PluginModule } from "@read-aware/plugin-types";
import { applyProfile, deleteProfile, listProfiles, saveProfile } from "./profiles";
import { copy } from "./strings";
import { profilesView } from "./views";

export default {
  activate(ctx) {
    if (!ctx.contributions.agentTools) throw Error("Workspace Profiles requires agent:tools");
    const title = copy(ctx.locale).title;
    ctx.contributions.headerActions.register({ id: "profiles", title, icon: "cards", surface: "shelf", presentation: "popup", view: () => profilesView(ctx) });
    ctx.contributions.commands.register({ id: "open", title, icon: "cards", run: async () => ({ view: await profilesView(ctx) }) });
    ctx.contributions.agentTools.register({ name: "workspace_profiles", label: title, contexts: ["global", "book"],
      description: "List, save the current workspace as a named preset, apply an existing preset, or delete a preset. Only save/apply/delete when explicitly requested. List first to get the exact ID. Applies device-local shelf layout/group/sort, app theme/motion, and global reading font size/spacing; book overrides are preserved. Never changes books, current selection, AI privacy, credentials or plugin lifecycle.",
      parameters: { type: "object", properties: { operation: { type: "string", enum: ["list", "save", "apply", "delete"] }, id: { type: "string" }, name: { type: "string" } }, required: ["operation"], additionalProperties: false },
      execute: async params => {
        let result: unknown;
        if (params.operation === "list") result = (await listProfiles(ctx)).map(doc => ({ id: doc.id, ...doc.data }));
        else if (params.operation === "save") result = await saveProfile(ctx, typeof params.name === "string" ? params.name : "");
        else if ((params.operation === "apply" || params.operation === "delete") && typeof params.id === "string" && params.id) {
          result = params.operation === "apply" ? await applyProfile(ctx, params.id) : await deleteProfile(ctx, params.id);
        } else throw Error("Invalid workspace profile operation");
        return { gist: result };
      },
    });
  },
} satisfies PluginModule;
