import type { PluginContext, PluginFormView, PluginAction, PluginViewResult } from "@read-aware/plugin-types";
import { liveMemoryView, type MemoryDeskView } from "./live-memory";
import { taskBudgetWords } from "./task-budget";

const words: Record<string, readonly string[]> = {
  en: ["Graph tasks", "Fill missing chapters", "Rebuild", "Retry", "Cancel", "Refresh", "No tasks", "I approve sending chapter text to my configured model; charges may apply", "Required", "Status", "Attempted", "Saved", "Remaining", "Queued", "Running", "Cancelling", "Cancelled", "Completed", "Partial", "Unavailable", "Failed"],
  "zh-Hans": ["图谱任务", "补齐章节", "重建", "重试", "取消", "刷新", "暂无任务", "同意将章节正文发送给已配置的模型，可能产生费用", "必填", "状态", "已尝试", "已保存", "剩余", "排队中", "运行中", "取消中", "已取消", "已完成", "部分完成", "不可用", "失败"],
  "zh-Hant": ["圖譜工作", "補齊章節", "重建", "重試", "取消", "重新整理", "尚無工作", "同意將章節正文傳送給已設定的模型，可能產生費用", "必填", "狀態", "已嘗試", "已儲存", "剩餘", "排隊中", "執行中", "取消中", "已取消", "已完成", "部分完成", "無法使用", "失敗"],
  ja: ["グラフのタスク", "不足する章を補完", "再構築", "再試行", "キャンセル", "更新", "タスクなし", "章本文を設定済みモデルに送信することに同意します。料金が発生する場合があります", "必須", "状態", "試行済み", "保存済み", "残り", "待機中", "実行中", "キャンセル中", "キャンセル済み", "完了", "一部完了", "利用不可", "失敗"],
  de: ["Graph-Aufgaben", "Fehlende Kapitel ergänzen", "Neu aufbauen", "Erneut versuchen", "Abbrechen", "Aktualisieren", "Keine Aufgaben", "Ich stimme dem Senden von Kapiteltext an mein Modell zu; es können Kosten entstehen", "Erforderlich", "Status", "Versucht", "Gespeichert", "Verbleibend", "Wartend", "Läuft", "Wird abgebrochen", "Abgebrochen", "Abgeschlossen", "Teilweise", "Nicht verfügbar", "Fehlgeschlagen"],
  fr: ["Tâches du graphe", "Compléter les chapitres", "Reconstruire", "Réessayer", "Annuler", "Actualiser", "Aucune tâche", "J'autorise l'envoi du texte au modèle configuré ; des frais sont possibles", "Obligatoire", "État", "Tentés", "Enregistrés", "Restants", "En attente", "En cours", "Annulation", "Annulée", "Terminée", "Partielle", "Indisponible", "Échec"],
  es: ["Tareas del grafo", "Completar capítulos", "Reconstruir", "Reintentar", "Cancelar", "Actualizar", "Sin tareas", "Autorizo enviar el texto al modelo configurado; puede generar costes", "Obligatorio", "Estado", "Intentados", "Guardados", "Pendientes", "En cola", "En curso", "Cancelando", "Cancelada", "Completada", "Parcial", "No disponible", "Fallida"],
  ru: ["Задачи графа", "Дополнить главы", "Перестроить", "Повторить", "Отменить", "Обновить", "Задач нет", "Разрешаю отправить текст глав настроенной модели; возможны расходы", "Обязательно", "Статус", "Попыток", "Сохранено", "Осталось", "В очереди", "Выполняется", "Отменяется", "Отменено", "Завершено", "Частично", "Недоступно", "Ошибка"],
};
export const graphTaskWords = (locale: string) => words[locale] ?? words[locale.split("-")[0]] ?? words.en!;
const states = ["queued", "running", "cancelling", "cancelled", "completed", "partial", "unavailable", "failed"];

function approve(ctx: PluginContext, bookId: string, mode: "catch-up" | "rebuild", retryId?: string, maxChapters = 20): PluginFormView {
  const t = graphTaskWords(ctx.locale), budget = taskBudgetWords(ctx.locale), title = t[retryId ? 3 : mode === "rebuild" ? 2 : 1]!;
  return { kind: "form", title, submitLabel: title,
    fields: [{ id: "maxChapters", kind: "number", label: budget.limit, value: maxChapters, min: 1, max: 1000, step: 1, helperText: budget.note },
      { id: "confirm", kind: "checkbox", label: t[7]!, value: false }], onSubmit: async (values): Promise<PluginViewResult> => {
      const limit = values.maxChapters;
      if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) return { fieldErrors: { maxChapters: budget.invalid } };
      if (values.confirm !== true) return { fieldErrors: { confirm: t[8]! } };
      const commands = ctx.domains.memory!.commands!;
      const task = retryId ? await commands.retryGraphTask(bookId, retryId, { maxChapters: limit }) : await commands.startGraphTask(bookId, mode, { maxChapters: limit });
      return { view: await graphTaskView(ctx, bookId, task.taskId), navigation: "replace" };
    } };
}

export async function graphTasksView(ctx: PluginContext, bookId: string): Promise<MemoryDeskView> {
  const t = graphTaskWords(ctx.locale);
  return liveMemoryView(ctx, { kind: "graphTasks", bookId }, t[0]!, result => {
    if (result.kind !== "graphTasks") throw Error("Unexpected graph tasks observation");
    const actions: PluginAction[] = [{ id: "refresh", label: t[5]!, icon: "arrows-clockwise", run: async () => ({ view: await graphTasksView(ctx, bookId), navigation: "replace" }) }];
    if (ctx.domains.memory!.commands) actions.push(
      { id: "start", label: t[1]!, icon: "play", run: () => ({ view: approve(ctx, bookId, "catch-up") }) },
      { id: "rebuild", label: t[2]!, icon: "arrows-clockwise", run: () => ({ view: approve(ctx, bookId, "rebuild") }) });
    return { kind: "list", title: t[0]!, actions, emptyText: t[6]!, items: [...result.tasks].reverse().map(task => ({
      id: task.taskId, title: t[task.mode === "rebuild" ? 2 : 1]!, subtitle: `${t[13 + states.indexOf(task.status)]} · ${task.createdAt}`,
      icon: "brain", onSelect: async () => ({ view: await graphTaskView(ctx, bookId, task.taskId) }),
    })) };
  });
}

export async function graphTaskView(ctx: PluginContext, bookId: string, taskId: string): Promise<MemoryDeskView> {
  const t = graphTaskWords(ctx.locale), budget = taskBudgetWords(ctx.locale);
  return liveMemoryView(ctx, { kind: "graphTask", bookId, taskId }, t[0]!, result => {
    if (result.kind !== "graphTask") throw Error("Unexpected graph task observation");
    const task = result.task, report = task.report;
    const actions: PluginAction[] = [{ id: "refresh", label: t[5]!, icon: "arrows-clockwise", run: async () => ({ view: await graphTaskView(ctx, bookId, taskId), navigation: "replace" }) }];
    const cancel = ctx.domains.memory!.commands && ["queued", "running"].includes(task.status) ? { id: taskId, label: t[4]!, run: async () => {
      await ctx.domains.memory!.commands!.cancelGraphTask(bookId, taskId); return { view: await graphTaskView(ctx, bookId, taskId), navigation: "replace" };
    } } satisfies PluginAction : undefined;
    if (ctx.domains.memory!.commands && ["failed", "cancelled", "partial", "unavailable"].includes(task.status)) actions.push({ id: "retry", label: t[3]!, icon: "arrows-clockwise", run: () => ({ view: approve(ctx, bookId, task.mode, taskId, task.maxChapters) }) });
    return { kind: "detail", title: t[task.mode === "rebuild" ? 2 : 1]!, actions, content: [
      ...(["queued", "running", "cancelling"].includes(task.status) ? [{ kind: "progress" as const, value: null, label: t[13 + states.indexOf(task.status)]!, cancel }] : []),
      { kind: "keyValue", rows: [{ label: t[9]!, value: t[13 + states.indexOf(task.status)]! }, { label: "ID", value: taskId },
        { label: budget.limit, value: String(task.maxChapters) },
        ...(report ? [{ label: t[10]!, value: String(report.attempted) }, { label: t[11]!, value: String(report.digested) }, { label: t[12]!, value: String(report.remaining) }] : [])] },
      ...(report?.reason ? [{ kind: "text" as const, text: { "chapter-limit": budget.reached, "boundary-unknown": budget.boundary, "no-toc": budget.toc, "classification-pending": budget.classification }[report.reason] }] : []),
      ...(report?.emptyChapters.length ? [{ kind: "keyValue" as const, rows: [{ label: budget.empty, value: report.emptyChapters.map(index => index + 1).join(", ") }] }] : []),
      ...(task.errorCode ? [{ kind: "error" as const, code: task.errorCode }] : []),
      ...(report?.failures.flatMap(failure => [{ kind: "heading" as const, text: `${budget.chapter} ${failure.chapterIndex + 1}` }, { kind: "error" as const, code: failure.errorCode }]) ?? []),
    ] };
  });
}
