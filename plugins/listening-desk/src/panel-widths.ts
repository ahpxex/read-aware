import type { PluginContext, PluginFormView, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { monitorCopy } from "./monitor-strings";
import { tr } from "./strings";

export async function panelWidths(ctx: PluginContext, signal: AbortSignal): Promise<PluginView> {
  signal.throwIfAborted();
  const t = monitorCopy(ctx.locale), reader = ctx.services.ui.reader;
  const session = await ctx.domains.reading!.queries.session();
  const panels = await reader!.snapshot();
  signal.throwIfAborted();
  if (session.status !== "ready" || !panels || session.sessionId !== panels.sessionId || session.bookId !== panels.bookId) {
    throw Object.assign(Error("Reader panel session unavailable"), { code: "reader/unavailable" });
  }
  const guard = { sessionId: panels.sessionId, bookId: panels.bookId };
  return { kind: "list", title: t.layout, items: (["toc", "chat"] as const).map(panel => ({
    id: panel, title: tr(ctx.locale, panel), subtitle: `${panels.sizes[panel]} px`,
    ...(reader?.setWidth ? { onSelect: () => ({ view: {
      kind: "form", title: tr(ctx.locale, panel), submitLabel: tr(ctx.locale, "apply"),
      fields: [{ kind: "number", id: "width", label: t.width, value: panels.sizes[panel], min: 240, max: 640, step: 1 }],
      onSubmit: async (values): Promise<PluginViewResult> => {
        if (typeof values.width !== "number" || !Number.isInteger(values.width) || values.width < 240 || values.width > 640) {
          return { fieldErrors: { width: t.invalidWidth } };
        }
        signal.throwIfAborted();
        const receipt = await reader.setWidth!(panel, values.width, guard);
        signal.throwIfAborted();
        return { view: { kind: "detail", title: t.saved, content: [{ kind: "keyValue", rows: [
          { label: tr(ctx.locale, panel), value: `${receipt.snapshot.sizes[panel]} px` },
        ] }], actions: [{ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise",
          run: async () => ({ view: await panelWidths(ctx, signal), navigation: "replace" }) }],
        }, navigation: "replace" };
      },
    } satisfies PluginFormView }) } : {}),
  })), actions: [{ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise",
    run: async () => ({ view: await panelWidths(ctx, signal), navigation: "replace" }) }],
  };
}
