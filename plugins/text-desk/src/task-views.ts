import type { BookTextTaskSnapshot, PluginContext, PluginDetailView, PluginFormView, PluginListView } from "@read-aware/plugin-types";
import { tr } from "./strings";

const active = (task: BookTextTaskSnapshot) => task.status === "queued" || task.status === "running";

export async function requestDetail(ctx: PluginContext, bookId: string, title: string, taskId: string): Promise<PluginDetailView> {
  const task = await ctx.domains.library!.queries.books.getTextTask(bookId, taskId);
  const progress = task.textState.progress;
  const rows = [
    { label: tr(ctx.locale, "request"), value: tr(ctx.locale, `task_${task.status}`) },
    { label: tr(ctx.locale, "mode"), value: tr(ctx.locale, task.mode) },
    { label: tr(ctx.locale, "observedState"), value: tr(ctx.locale, task.textState.status) },
    { label: tr(ctx.locale, "text"), value: tr(ctx.locale, task.textState.text) },
    { label: tr(ctx.locale, "chapters"), value: String(task.textState.chapterCount) },
  ];
  if (task.status === "failed") rows.push({ label: tr(ctx.locale, "failure"), value: tr(ctx.locale,
    task.errorCode === "library/text-busy" ? "busy" : task.errorCode === "library/text-unsupported" ? "unsupported"
      : task.errorCode === "library/content-unavailable" ? "unavailable" : "error") });
  if (progress) rows.push(
    { label: tr(ctx.locale, "sections"), value: `${progress.completed} / ${progress.total}` },
    { label: tr(ctx.locale, "failed"), value: String(progress.failed) },
    { label: tr(ctx.locale, "unsupportedSections"), value: String(progress.unsupported) },
  );
  return { kind: "detail", title, content: [{ kind: "keyValue", rows }], actions: [
    { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({
      view: await requestDetail(ctx, bookId, title, taskId), navigation: "replace",
    }) },
    ...(active(task) ? [{ id: "cancel", label: tr(ctx.locale, "cancelRequest"), icon: "stop", run: async () => {
      await ctx.domains.library!.commands!.books.cancelTextTask(bookId, taskId);
      return { view: await requestDetail(ctx, bookId, title, taskId), navigation: "replace" as const };
    } }] : []),
    { id: "requests", label: tr(ctx.locale, "requests"), icon: "list-bullets", run: async () => ({ view: await requestList(ctx, bookId, title) }) },
  ] };
}

export async function startRequest(ctx: PluginContext, bookId: string, title: string, rebuild = false) {
  const task = await ctx.domains.library!.commands!.books.prepareText(bookId, { rebuild });
  return { view: await requestDetail(ctx, bookId, title, task.taskId) };
}

export function rebuildForm(ctx: PluginContext, bookId: string, title: string): PluginFormView {
  return { kind: "form", title, fields: [{ kind: "checkbox", id: "confirm", label: tr(ctx.locale, "confirmRebuild"), value: false }],
    submitLabel: tr(ctx.locale, "rebuild"), onSubmit: async values => {
      if (values.confirm !== true) return { fieldErrors: { confirm: tr(ctx.locale, "confirmRequired") } };
      return { ...await startRequest(ctx, bookId, title, true), navigation: "replace" };
    } };
}

export async function requestList(ctx: PluginContext, bookId: string, title: string): Promise<PluginListView> {
  const tasks = await ctx.domains.library!.queries.books.listTextTasks(bookId);
  return { kind: "list", title, emptyText: tr(ctx.locale, "noRequests"), items: tasks.reverse().map(task => ({
    id: task.taskId, title: tr(ctx.locale, task.mode), subtitle: tr(ctx.locale, `task_${task.status}`), timestamp: task.createdAt,
    onSelect: async () => ({ view: await requestDetail(ctx, bookId, title, task.taskId) }),
  })), actions: [{ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise",
    run: async () => ({ view: await requestList(ctx, bookId, title), navigation: "replace" }) }] };
}
