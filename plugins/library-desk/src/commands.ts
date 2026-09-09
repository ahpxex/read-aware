import type { HostCommandDescriptor, HostCommandRequest, PluginContext, PluginDetailView, PluginListView, PluginView, PluginViewResult } from "@read-aware/plugin-types";

const translations: Record<string, string[]> = {
  en: ["Host commands", "Refresh", "Selected", "Permission required", "Workspace unavailable", "Reader control required", "Setting saved; navigation did not complete"],
  "zh-Hans": ["宿主命令", "刷新", "已选中", "需要授权", "工作区不可用", "需要阅读控制权限", "设置已保存，界面切换未完成"],
  "zh-Hant": ["宿主命令", "重新整理", "已選取", "需要授權", "工作區無法使用", "需要閱讀控制權限", "設定已儲存，介面切換未完成"],
  ja: ["ホストコマンド", "更新", "選択済み", "権限が必要", "ワークスペースを利用できません", "読書の操作権限が必要", "設定は保存されましたが、画面の移動は完了しませんでした"],
  de: ["Host-Befehle", "Aktualisieren", "Ausgewählt", "Berechtigung erforderlich", "Arbeitsbereich nicht verfügbar", "Lesesteuerung erforderlich", "Einstellung gespeichert; Ansicht nicht gewechselt"],
  fr: ["Commandes hôte", "Actualiser", "Sélectionné", "Autorisation requise", "Espace indisponible", "Contrôle de lecture requis", "Paramètre enregistré ; navigation non terminée"],
  es: ["Comandos del anfitrión", "Actualizar", "Seleccionado", "Permiso necesario", "Espacio no disponible", "Control de lectura necesario", "Ajuste guardado; navegación incompleta"],
  ru: ["Команды приложения", "Обновить", "Выбрано", "Требуется разрешение", "Рабочая область недоступна", "Требуется управление чтением", "Настройка сохранена; переход не завершён"],
};
export const commandStrings = (locale: string) => translations[locale] ?? translations[locale.split("-")[0]] ?? translations.en;

export async function commandsView(ctx: PluginContext): Promise<PluginView & PluginDetailView> {
  const api = ctx.services.ui.commands!, t = commandStrings(ctx.locale);
  let snapshot = await api.list(), failure: string | undefined;
  const refresh = async (): Promise<PluginViewResult> => ({ view: await commandsView(ctx), navigation: "replace" });
  const execute = async (command: HostCommandDescriptor, request: HostCommandRequest, expectedWorkspaceRevision: number | null): Promise<PluginViewResult> => {
    const receipt = await api.execute!({ ...request, ...(expectedWorkspaceRevision === null ? {} : { expectedWorkspaceRevision }) });
    if (receipt.status === "completed") return { close: true };
    return { view: { kind: "detail", title: command.title, content: [
      { kind: "text", text: t[6] }, { kind: "error", code: receipt.errorCode ?? "ui/unavailable" },
    ], actions: [{ id: "refresh", label: t[1], icon: "arrows-clockwise", run: refresh }] }, navigation: "replace" };
  };
  const choose = async (command: HostCommandDescriptor, revision: number | null): Promise<PluginViewResult> => {
    if (command.id === "open-book") {
      const books = await ctx.domains.library!.queries.books.list();
      return { view: { kind: "list", title: command.title, searchable: true, items: books.map(book => ({
        id: book.id, title: book.title, subtitle: book.author, icon: "book-open",
        onSelect: () => execute(command, { id: "open-book", args: { bookId: book.id } }, revision),
      })) } };
    }
    if (command.id === "open-collection") {
      const collections = await ctx.domains.library!.queries.collections.list();
      return { view: { kind: "list", title: command.title, searchable: true, items: collections.map(collection => ({
        id: collection.id, title: collection.name, icon: "books",
        onSelect: () => execute(command, { id: "open-collection", args: { collectionId: collection.id } }, revision),
      })) } };
    }
    return execute(command, { id: command.id }, revision);
  };
  const content = (): PluginDetailView => {
    const current = snapshot;
    const list: PluginListView = { kind: "list", searchable: true,
      items: current.commands.map(command => ({ id: command.id, title: command.title, keywords: [command.id],
        subtitle: command.unavailableReason === "permission" ? t[3] : command.unavailableReason === "workspace" ? t[4]
          : command.unavailableReason === "reader-control" ? t[5] : undefined,
        accessories: command.checked ? [{ kind: "icon", icon: "check", label: t[2] }] : [],
        ...(!failure && command.enabled && api.execute ? { onSelect: () => choose(command, current.workspaceRevision) } : {}),
      })),
      actions: [{ id: "refresh", label: t[1], icon: "arrows-clockwise", run: refresh }],
    };
    // Keep the nested list's structural path stable when the error changes.
    return { kind: "detail", title: t[0], content: [
      { kind: "group", blocks: failure ? [{ kind: "error", code: failure }] : [] }, list,
    ] };
  };
  return { ...content(), live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = api.observe(async state => {
      if (disposed) return;
      if (state.status === "ready") { snapshot = state.snapshot; failure = undefined; }
      else failure = state.code;
      await ctx.services.ui.publishView(channel, { revision: ++revision, view: content() });
    });
    return { dispose() { disposed = true; subscription.dispose(); } };
  } } };
}
