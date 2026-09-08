import type { AnnotationMutation, AnnotationSnapshot, PluginFormView, PluginViewResult } from "@read-aware/plugin-types";
import type { DeskContext, Refresh } from "./types";
import { tr } from "./strings";

export async function commit(ctx: DeskContext, changes: AnnotationMutation[], field: string, refresh: Refresh): Promise<PluginViewResult> {
  try {
    await ctx.domains.annotations.commands.applyChanges(changes);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "annotations/conflict") {
      return { fieldErrors: { [field]: tr(ctx.locale, "conflict") } };
    }
    throw error;
  }
  try {
    return { ...await refresh(), toast: tr(ctx.locale, "saved") };
  } catch {
    // The write already committed. Report the read failure without inviting a
    // repeat mutation or claiming that the successful write was rolled back.
    return { navigation: "reset", toast: tr(ctx.locale, "saved"), view: { kind: "blocks", blocks: [
      { kind: "text", text: tr(ctx.locale, "refreshFailed") },
      { kind: "actions", actions: [{ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: refresh }] },
    ] } };
  }
}

export function colorForm(ctx: DeskContext, snapshots: AnnotationSnapshot[], refresh: Refresh): PluginFormView {
  const first = snapshots[0].annotation;
  const colors = ["yellow", "green", "blue", "pink"] as const;
  const styles = ["highlight", "underline"] as const;
  return { kind: "form", submitLabel: tr(ctx.locale, snapshots.length > 1 ? "recolor" : "save"), fields: [
    { kind: "choice", id: "color", label: tr(ctx.locale, "color"), value: first.kind === "highlight" ? first.color : "yellow",
      options: colors.map(value => ({ value, label: tr(ctx.locale, value) })) },
    { kind: "choice", id: "style", label: tr(ctx.locale, "style"), value: first.kind === "highlight" ? first.style : "highlight",
      options: styles.map(value => ({ value, label: tr(ctx.locale, value) })) },
  ], onSubmit: async values => {
    const color = colors.find(color => color === values.color);
    const style = styles.find(style => style === values.style);
    if (!color || !style) return { fieldErrors: { [!color ? "color" : "style"]: tr(ctx.locale, "invalid") } };
    return commit(ctx, snapshots.map(({ annotation, revision }) => ({ op: "recolorHighlight", annotationId: annotation.id,
      expectedRevision: revision, color, style })), "color", refresh);
  } };
}
