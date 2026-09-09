import type { PluginContext, PluginFormView } from "@read-aware/plugin-types";
import { copy } from "./strings";

export async function shortcutView(ctx: PluginContext): Promise<PluginFormView> {
  const t = copy(ctx.locale);
  const path = `shortcuts.plugin.${encodeURIComponent(`${ctx.manifest.id}:open`)}`;
  const entry = (await ctx.domains.settings.queries.snapshot({ section: "shortcuts" })).settings.find(setting => setting.path === path);
  if (!entry?.writable) throw Error("Workspace shortcut is unavailable");
  const tokens = Array.isArray(entry.value) ? entry.value : [];
  const modifiers = tokens.slice(0, -1);
  return { kind: "form", title: t.shortcut, submitLabel: t.apply, fields: [
    { kind: "select", id: "mode", label: t.binding, value: entry.shortcut?.overridden ? "custom" : "default",
      options: [{ value: "default", label: t.defaultBinding }, { value: "custom", label: t.customBinding }] },
    { kind: "toggle", id: "mod", label: "Command / Ctrl", value: modifiers.includes("mod") },
    { kind: "toggle", id: "alt", label: "Alt / Option", value: modifiers.includes("alt") },
    { kind: "toggle", id: "shift", label: "Shift", value: modifiers.includes("shift") },
    { kind: "text", id: "key", label: t.key, value: tokens[tokens.length - 1] ?? "" },
  ], onSubmit: async values => {
    const value = values.mode === "default" ? null : [...(values.mod ? ["mod"] : []), ...(values.alt ? ["alt"] : []), ...(values.shift ? ["shift"] : []), String(values.key ?? "")];
    await ctx.domains.settings.commands.update([{ path, value }]);
    return { toast: t.shortcutSaved, close: true };
  } };
}
