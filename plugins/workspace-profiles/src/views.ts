import type { PluginContext, PluginDocument, PluginFormView, PluginListView, PluginView } from "@read-aware/plugin-types";
import { applyProfile, deleteProfile, listProfiles, parseProfile, profileCollection, profileName, saveProfile } from "./profiles";
import { copy, settingLabel } from "./strings";
import { shortcutView } from "./shortcut";
import { currentWorkspaceView } from "./current";
import { fontsView } from "./fonts";
import { windowCopy, windowView } from "./window";

function message(ctx: PluginContext, text: string): PluginView {
  const t = copy(ctx.locale);
  return { kind: "detail", title: t.title, content: [{ kind: "text", text }], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await profilesView(ctx), navigation: "reset" }) },
  ] };
}

function saveView(ctx: PluginContext): PluginFormView {
  const t = copy(ctx.locale);
  return { kind: "form", title: t.save, submitLabel: t.save, fields: [{ kind: "text", id: "name", label: t.name, value: "" }],
    onSubmit: async values => {
      let name: string;
      try { name = profileName(values.name); } catch { return { fieldErrors: { name: t.invalid } }; }
      const result = await saveProfile(ctx, name);
      return { view: message(ctx, result.status === "saved" ? t.saved : t.conflict), navigation: "replace" };
    } };
}

function deleteForm(ctx: PluginContext, doc: PluginDocument): PluginFormView {
  const t = copy(ctx.locale);
  return { kind: "form", title: parseProfile(doc.data)?.name ?? t.invalidProfile, submitLabel: t.remove,
    fields: [{ id: "confirm", kind: "checkbox", label: t.confirmDelete, value: false }], onSubmit: async values => {
      if (values.confirm !== true) return { fieldErrors: { confirm: t.confirmRequired } };
      const result = await deleteProfile(ctx, doc.id, doc.revision);
      return { view: message(ctx, result.status === "deleted" ? t.deleted : t.conflict), navigation: "replace" };
    } };
}

export async function profileView(ctx: PluginContext, id: string): Promise<PluginView> {
  const doc = await profileCollection(ctx).get(id);
  const t = copy(ctx.locale);
  if (!doc) return message(ctx, t.missing);
  const profile = parseProfile(doc.data);
  return { kind: "blocks", blocks: [
    { kind: "heading", text: profile?.name ?? t.invalidProfile },
    ...(profile?.changes ?? []).map(change => ({ kind: "text" as const, text: `${settingLabel(ctx.locale, change.path)}: ${change.value === null ? t.appDefault : String(change.value)}` })),
    { kind: "actions", actions: [
      ...(profile ? [{ id: "apply", label: t.apply, icon: "check", run: async () => {
        const result = await applyProfile(ctx, id, doc.revision);
        return result.status === "applied" ? { toast: t.applied, close: true } : { view: message(ctx, t.conflict), navigation: "replace" as const };
      } }] : []),
      { id: "delete", label: t.remove, icon: "trash", run: () => ({ view: deleteForm(ctx, doc) }) },
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await profileView(ctx, id), navigation: "replace" }) },
    ] },
  ] };
}
export async function profilesView(ctx: PluginContext, cursors: (string | undefined)[] = [undefined]): Promise<PluginView> {
  const t = copy(ctx.locale);
  const page = await listProfiles(ctx, cursors[cursors.length - 1]);
  if (page.status === "stale-cursor") return message(ctx, t.stalePage);
  const go = async (next: (string | undefined)[]) => ({ view: await profilesView(ctx, next), navigation: "replace" as const });
  return { kind: "list", title: t.title, emptyText: t.empty, actions: [
    { id: "save", label: t.save, icon: "plus", run: () => ({ view: saveView(ctx) }) },
    { id: "current", label: t.current, icon: "rows", run: async () => ({ view: await currentWorkspaceView(ctx) }) },
    { id: "fonts", label: t.fonts, icon: "text-aa", run: async () => ({ view: await fontsView(ctx) }) },
    { id: "window", label: windowCopy(ctx.locale).title, icon: "rows", run: async () => ({ view: await windowView(ctx) }) },
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await profilesView(ctx), navigation: "replace" }) },
    { id: "shortcut", label: t.shortcut, icon: "rows", run: async () => ({ view: await shortcutView(ctx) }) },
  ], items: page.items.map(doc => ({ id: doc.id, title: parseProfile(doc.data)?.name ?? t.invalidProfile, timestamp: doc.updatedAt, icon: "cards",
    onSelect: async () => ({ view: await profileView(ctx, doc.id) }) })),
    pagination: { page: cursors.length,
      ...(cursors.length > 1 ? { onPrevious: () => go(cursors.slice(0, -1)) } : {}),
      ...(page.nextCursor ? { onNext: () => go([...cursors, page.nextCursor!]) } : {}),
    },
  } satisfies PluginListView;
}
