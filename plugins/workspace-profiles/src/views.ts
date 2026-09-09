import type { PluginContext, PluginFormView, PluginView } from "@read-aware/plugin-types";
import { applyProfile, deleteProfile, listProfiles, profileName, readProfile, saveProfile } from "./profiles";
import { copy, settingLabel } from "./strings";
import { shortcutView } from "./shortcut";

function saveView(ctx: PluginContext): PluginFormView {
  const t = copy(ctx.locale);
  return { kind: "form", title: t.save, submitLabel: t.save, fields: [{ kind: "text", id: "name", label: t.name, value: "" }],
    onSubmit: async values => {
      let name: string;
      try { name = profileName(values.name); } catch { return { fieldErrors: { name: t.invalid } }; }
      await saveProfile(ctx, name);
      return { toast: t.saved, view: await profilesView(ctx), navigation: "reset" };
    } };
}
async function profileView(ctx: PluginContext, id: string): Promise<PluginView> {
  const doc = await readProfile(ctx, id);
  const t = copy(ctx.locale);
  return { kind: "blocks", blocks: [
    { kind: "heading", text: doc.data.name },
    ...doc.data.changes.map(change => ({ kind: "text" as const, text: `${settingLabel(ctx.locale, change.path)}: ${String(change.value)}` })),
    { kind: "actions", actions: [
      { id: "apply", label: t.apply, icon: "check", run: async () => { await applyProfile(ctx, id); return { toast: t.applied, close: true }; } },
      { id: "delete", label: t.remove, icon: "trash", run: async () => { await deleteProfile(ctx, id); return { view: await profilesView(ctx), navigation: "reset" }; } },
    ] },
  ] };
}
export async function profilesView(ctx: PluginContext): Promise<PluginView> {
  const t = copy(ctx.locale);
  const profiles = await listProfiles(ctx);
  return { kind: "list", title: t.title, emptyText: t.empty, actions: [
    { id: "save", label: t.save, icon: "plus", run: () => ({ view: saveView(ctx) }) },
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await profilesView(ctx), navigation: "replace" }) },
    { id: "shortcut", label: t.shortcut, icon: "rows", run: async () => ({ view: await shortcutView(ctx) }) },
  ], items: profiles.map(doc => ({ id: doc.id, title: doc.data.name, timestamp: doc.updatedAt, icon: "cards",
    onSelect: async () => ({ view: await profileView(ctx, doc.id) }) })) };
}
