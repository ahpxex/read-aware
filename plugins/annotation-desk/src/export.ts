import type { PluginAnnotation } from "@read-aware/plugin-types";
import type { Books } from "./format";
import type { DeskContext } from "./types";
import { tr } from "./strings";

export function csvCell(input: unknown): string {
  let value = input == null ? "" : String(input);
  // Spreadsheet programs may evaluate formulas even in quoted cells.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value)) value = `'${value}`;
  return `"${value.replace(/"/g, '""')}"`;
}

export function annotationExport(items: PluginAnnotation[], books: Books, scope: "page" | "selection", format: "json" | "csv", at: Date): string {
  if (format === "json") return JSON.stringify({ schemaVersion: 1, exportedAt: at.toISOString(), scope,
    consistency: "observed-items", books: [...books.values()].filter(book => book !== null), annotations: items }, null, 2);
  const rows = [
    ["id", "kind", "bookId", "bookTitle", "quotedText", "body", "text", "color", "style", "anchor", "chapterHref", "createdAt", "updatedAt"],
    ...items.map(item => [item.id, item.kind, item.bookId, books.get(item.bookId)?.title,
      item.kind === "note" ? item.quotedText : undefined, item.kind === "note" ? item.body : undefined,
      item.kind !== "note" ? item.text : undefined, item.kind === "highlight" ? item.color : undefined,
      item.kind === "highlight" ? item.style : undefined, item.anchor, item.chapterHref, item.createdAt,
      item.kind !== "ask" ? item.updatedAt : undefined]),
  ];
  return `\uFEFF${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}`;
}

export async function exportAnnotations(ctx: DeskContext, items: PluginAnnotation[], books: Books, scope: "page" | "selection", format: "json" | "csv") {
  const at = new Date();
  const saved = await ctx.services.ui.exportFile({ filename: `readaware-annotations-${at.toISOString().slice(0, 10)}.${format}`,
    content: annotationExport(items, books, scope, format, at), mimeType: format === "json" ? "application/json" : "text/csv;charset=utf-8" });
  return saved ? { toast: tr(ctx.locale, "exported") } : undefined;
}
