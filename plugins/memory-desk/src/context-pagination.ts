import type { PluginAction, PluginView } from "@read-aware/plugin-types";
import { contextWords } from "./context-strings";

/** Preserve exact page starts rather than subtracting a fixed UTF-16 length. */
export function pageActions(locale: string, offsets: number[], nextOffset: number | null,
  load: (offsets: number[]) => Promise<PluginView> | PluginView): PluginAction[] {
  const t = contextWords(locale);
  const go = async (next: number[]) => ({ view: await load(next), navigation: "replace" as const });
  return [
    ...(offsets.length > 1 ? [{ id: "previous", label: t.previous, icon: "arrow-left", run: () => go(offsets.slice(0, -1)) }] : []),
    ...(nextOffset === null ? [] : [{ id: "next", label: t.next, icon: "arrow-right", run: () => go([...offsets, nextOffset]) }]),
  ];
}

export function textPage(text: string, start: number) {
  let end = Math.min(text.length, start + 4000);
  if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff
    && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) --end;
  return { text: text.slice(start, end), nextOffset: end < text.length ? end : null };
}
