import type { PluginBook, PluginContext, PluginListView, PluginView, PluginViewChannel, WorkspaceSnapshot, WorkspaceTarget } from "@read-aware/plugin-types";

const translations: Record<string, string[]> = {
  en: ["Workspace", "Shelf", "Context", "Statistics", "Settings", "Search", "Open", "Show selection on shelf", "Selected"],
  "zh-Hans": ["工作区", "书架", "上下文", "统计", "设置", "搜索", "打开", "在书架显示所选书籍", "已选择"],
  "zh-Hant": ["工作區", "書架", "上下文", "統計", "設定", "搜尋", "開啟", "在書架顯示所選書籍", "已選取"],
  ja: ["ワークスペース", "本棚", "コンテキスト", "統計", "設定", "検索", "開く", "選択した本を本棚で表示", "選択済み"],
  de: ["Arbeitsbereich", "Bibliothek", "Kontext", "Statistik", "Einstellungen", "Suchen", "Öffnen", "Auswahl in der Bibliothek zeigen", "Ausgewählt"],
  fr: ["Espace de travail", "Bibliothèque", "Contexte", "Statistiques", "Paramètres", "Rechercher", "Ouvrir", "Afficher la sélection en bibliothèque", "Sélectionné"],
  es: ["Espacio de trabajo", "Biblioteca", "Contexto", "Estadísticas", "Ajustes", "Buscar", "Abrir", "Mostrar selección en la biblioteca", "Seleccionado"],
  ru: ["Рабочая область", "Библиотека", "Контекст", "Статистика", "Настройки", "Поиск", "Открыть", "Показать выбранные книги в библиотеке", "Выбрано"],
};
export const workspaceStrings = (locale: string) => translations[locale] ?? translations[locale.split("-")[0]] ?? translations.en;

export async function workspaceView(ctx: PluginContext, selected?: PluginBook[]): Promise<PluginView> {
  const api = ctx.services.ui.workspace!, library = ctx.domains.library!, t = workspaceStrings(ctx.locale);
  const collections = await library.queries.collections.list();
  let state = await api.snapshot({ limit: 1 }), channel: PluginViewChannel | undefined, revision = 0;
  const open = async (target: WorkspaceTarget) => { await api.navigate!(target); return { close: true }; };
  const groups = [null, ...collections.map(c => c.id)].map(collectionId => ({ collectionId,
    title: collections.find(c => c.id === collectionId)?.name ?? t[1],
    books: selected?.filter(b => (b.collectionId ?? null) === collectionId),
  })).filter(group => !selected || group.books!.length > 0);
  const content = (): PluginListView => ({ kind: "list", title: selected ? t[7] : `${t[0]} · ${t[8]}: ${state.selection.total}`, searchable: true,
    items: groups.map((group, index) => ({ id: `collection-${index}`, title: group.title,
      subtitle: group.books ? String(group.books.length) : undefined, icon: "books",
      onSelect: () => open({ surface: "shelf", collectionId: group.collectionId,
        ...(group.books ? { selection: { active: true, bookIds: group.books.map(book => book.id) } } : {}) }),
    })),
    actions: selected ? [] : [
      { id: "agent", label: t[2], icon: "chat-circle-dots", run: () => open({ surface: "agent" }) },
      { id: "stats", label: t[3], icon: "chart-line-up", run: () => open({ surface: "stats" }) },
      { id: "settings", label: t[4], icon: "rows", run: () => open({ surface: "settings", section: "general" }) },
      { id: "search", label: t[5], icon: "magnifying-glass", run: () => ({ view: { kind: "form", title: t[5], submitLabel: t[6],
        fields: [{ kind: "text", id: "query", label: t[5], value: state.search.query }],
        onSubmit: values => open({ surface: "search", query: String(values.query ?? "") }),
      } }) },
    ],
  });
  return { ...content(), live: { subscribe: async next => {
    channel = next;
    const subscription = api.observe({ limit: 1 }, async (snapshot: WorkspaceSnapshot | null) => {
      if (!snapshot || channel?.id !== next.id) return;
      state = snapshot;
      await ctx.services.ui.publishView(next, { revision: ++revision, view: content() });
    });
    return { dispose() { subscription.dispose(); if (channel?.id === next.id) channel = undefined; } };
  } } };
}
