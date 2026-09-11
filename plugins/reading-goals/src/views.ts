import type { PluginContext, PluginFormView, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { readGoalState, writeGoal } from "./goals";
import { copy } from "./strings";
import { readingTimeView } from "./time-view";
import { timeCopy } from "./time-strings";

function receiptView(ctx: PluginContext, bookId: string, text: string): PluginView {
  const t = copy(ctx.locale);
  return { kind: "detail", title: t.title, content: [{ kind: "text", text }], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await goalsView(ctx, bookId), navigation: "replace" }) },
  ] };
}

export async function goalsView(ctx: PluginContext, bookId?: string): Promise<PluginView> {
  const t = copy(ctx.locale);
  const target = bookId ?? (await ctx.domains.reading!.queries.session()).bookId;
  if (!target) return { kind: "blocks", blocks: [{ kind: "text", text: t.noBook }] };
  const book = await ctx.domains.library!.queries.books.get(target);
  if (!book) return { kind: "blocks", blocks: [{ kind: "text", text: t.noBook }] };
  const { goal, revision } = await readGoalState(ctx, target);
  const setting = await ctx.domains.settings.queries.read("ai.preferences.buildMemory");
  const refresh = async () => ({ view: await goalsView(ctx, target), navigation: "replace" as const });
  const goalForm: PluginFormView = {
    kind: "form", title: book.title, submitLabel: t.save,
    fields: [
      { kind: "textarea", id: "goal", label: t.goal, value: goal?.text ?? "", rows: 4 },
      { kind: "checkbox", id: "suggestMemory", label: t.remember, value: goal?.suggestMemory ?? false },
    ],
    onSubmit: async (values): Promise<PluginViewResult> => {
      const text = typeof values.goal === "string" ? values.goal.trim() : "";
      if (!text || text.length > 500) return { fieldErrors: { goal: t.invalid } };
      if (typeof values.suggestMemory !== "boolean") return { fieldErrors: { suggestMemory: t.invalid } };
      const result = await writeGoal(ctx, target, { text, suggestMemory: values.suggestMemory }, revision);
      return { view: receiptView(ctx, target, result.status === "saved" ? t.saved : t.conflict), navigation: "replace" };
    },
  };
  const policyForm: PluginFormView = {
    kind: "form", title: "ReadAware", submitLabel: t.apply,
    fields: [{ kind: "toggle", id: "enabled", label: t.memory, value: setting.value === true }],
    onSubmit: async values => {
      if (typeof values.enabled !== "boolean") throw new Error("Invalid memory preference");
      await ctx.domains.settings.commands.update([{ path: "ai.preferences.buildMemory", value: values.enabled }]);
      return refresh();
    },
  };
  return { kind: "blocks", blocks: [{ kind: "text", text: book.title }, goalForm,
    { kind: "text", text: "ReadAware" }, policyForm, { kind: "actions", actions: [
    ...(goal ? [{ id: "clear", label: t.clear, icon: "trash", run: () => ({ view: {
      kind: "form", title: book.title, submitLabel: t.clear,
      fields: [{ kind: "checkbox", id: "confirm", label: t.confirm, value: false }],
      onSubmit: async values => {
        if (values.confirm !== true) return { fieldErrors: { confirm: t.required } };
        const result = await writeGoal(ctx, target, null, revision);
        return { view: receiptView(ctx, target, result.status === "cleared" ? t.cleared : t.conflict), navigation: "replace" };
      },
    } satisfies PluginFormView }) }] : []),
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: refresh },
    { id: "time", label: timeCopy(ctx.locale).title, icon: "clock", run: async () => ({ view: await readingTimeView(ctx, { bookId: target }) }) },
  ] }] };
}
