import type { PluginContext, PluginDetailView, PluginFormView, PluginViewResult } from "@read-aware/plugin-types";
import { contextWords } from "./context-strings";
import { pageActions } from "./context-pagination";

export async function profileView(ctx: PluginContext, offsets = [0], expectedRevision?: string): Promise<PluginDetailView> {
  const t = contextWords(ctx.locale), memory = ctx.domains.memory!;
  const page = await memory.queries.profile({ offset: offsets[offsets.length - 1], limit: 4000, expectedRevision });
  return { kind: "detail", title: t.profile, content: [
    { kind: "text", text: page.text || (page.exists ? t.empty : t.absent) },
    { kind: "text", variant: "caption", text: `${page.totalLength ? page.offset + 1 : 0}-${page.offset + page.text.length} / ${page.totalLength}` },
  ], metadata: [{ kind: "label", label: t.profile, value: t.local }], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await profileView(ctx), navigation: "replace" }) },
    ...pageActions(ctx.locale, offsets, page.nextOffset, next => profileView(ctx, next, page.revision)),
    ...(memory.commands && page.totalLength <= 16000 ? [{ id: "edit", label: t.edit, icon: "pencil-simple",
      run: async () => ({ view: await editProfile(ctx, page.revision) }) }] : []),
  ] };
}

async function editProfile(ctx: PluginContext, expectedRevision: string): Promise<PluginFormView> {
  const t = contextWords(ctx.locale), memory = ctx.domains.memory!;
  const page = await memory.queries.profile({ limit: 16000, expectedRevision });
  if (page.nextOffset !== null) throw Object.assign(Error("Cannot edit an incomplete profile"), { code: "memory/invalid-input" });
  return { kind: "form", title: t.edit, submitLabel: t.save, fields: [
    { id: "summary", kind: "textarea", label: t.summary, value: page.text },
    { id: "confirm", kind: "checkbox", label: t.confirm, value: false },
  ], onSubmit: async (values): Promise<PluginViewResult> => {
    if (typeof values.summary !== "string" || values.summary.length > 16000) return { fieldErrors: { summary: t.tooLong } };
    if (values.confirm !== true) return { fieldErrors: { confirm: t.required } };
    const receipt = await memory.commands!.updateProfile({ summary: values.summary, expectedRevision: page.revision });
    // A successful write must not become an apparent failure because a following read fails.
    return { navigation: "replace", view: { kind: "detail", title: t.profile,
      content: [{ kind: "text", text: receipt.changed ? t.saved : t.unchanged }],
      actions: [{ id: "refresh", label: t.refresh, icon: "arrows-clockwise",
        run: async () => ({ view: await profileView(ctx), navigation: "replace" }) }],
    } };
  } };
}
