import type { PluginContext, PluginViewResult } from "@read-aware/plugin-types";
import { assetStrings } from "./assets-strings";
import { bookAssets } from "./book-assets";

export async function importBook(ctx: PluginContext): Promise<PluginViewResult> {
  const library = ctx.domains.library!, resources = ctx.services.resources, t = assetStrings(ctx.locale);
  const formats = await library.queries.books.listFormats();
  const picked = await resources.pick({ multiple: false, extensions: formats.flatMap(format => format.extensions) });
  const resource = picked.resources[0];
  if (!resource) return null;
  let inspection;
  try { inspection = await library.queries.books.inspectResource(resource.id); }
  catch (error) { await resources.release(resource.id); throw error; }
  return { view: { kind: "detail", title: t.import, content: [
    { kind: "keyValue", rows: [
      { label: t.file, value: resource.name }, { label: t.size, value: String(resource.size) },
      { label: t.format, value: inspection.formatHint ?? t.unknown },
      { label: t.inspection, value: t[inspection.status] },
      { label: t.sections, value: inspection.sectionCount === null ? t.unknown : String(inspection.sectionCount) },
    ] },
    ...(inspection.errorCode ? [{ kind: "error" as const, code: inspection.errorCode }] : []),
  ], actions: inspection.status === "parsed" ? [{ id: "import", label: t.confirmImport, icon: "plus", run: async () => {
    const receipt = await library.commands!.books.importResource(resource.id);
    // Once import commits, a detail-query failure must not invite another import.
    return { view: { kind: "detail", title: receipt.book.title,
      content: [{ kind: "text", text: receipt.status === "duplicate" ? t.duplicate : t.imported }],
      actions: [{ id: "details", label: t.details, icon: "book-open", run: async () => ({ view: await bookAssets(ctx, receipt.book) }) }],
    }, navigation: "replace" };
  } }] : [], onClose: () => resources.release(resource.id) } };
}
