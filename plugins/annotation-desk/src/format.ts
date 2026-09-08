import type { PluginAnnotation, PluginBook } from "@read-aware/plugin-types";
import { tr } from "./strings";
import type { DeskContext } from "./types";

export type Books = Map<string, PluginBook | null>;
export function annotationText(item: PluginAnnotation): string {
  return item.kind === "note" ? item.body : item.text;
}
export function preview(item: PluginAnnotation): string {
  const text = annotationText(item).replace(/\s+/g, " ").trim();
  return text.length > 180 ? `${text.slice(0, 179)}…` : text;
}
export function subtitle(ctx: DeskContext, item: PluginAnnotation, books: Books): string {
  return `${books.get(item.bookId)?.title ?? tr(ctx.locale, "missingBook")} · ${tr(ctx.locale, item.kind)}`;
}
export async function readBooks(ctx: DeskContext, items: PluginAnnotation[]): Promise<Books> {
  const books: Books = new Map();
  for (const id of new Set(items.map(item => item.bookId))) books.set(id, await ctx.domains.library.queries.books.get(id));
  return books;
}
