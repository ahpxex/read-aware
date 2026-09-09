// src/strings.ts
var en = ["Library Desk", "Review selection", "Remove permanently", "This removes the selected books and their source files. This cannot be undone.", "Books removed", "Local files still need cleanup", "Retry file cleanup", "Refresh", "Selected", "Select at most 1000 books", "File cleanup complete", "Books"];
var translations = {
  en,
  "zh-Hans": ["书库工作台", "核对所选书籍", "永久移除", "将移除所选书籍及其源文件。此操作无法撤销。", "书籍已移除", "本地文件仍待清理", "重试文件清理", "刷新", "已选择", "最多选择 1000 本书", "文件清理完成", "书籍"],
  "zh-Hant": ["書庫工作台", "核對所選書籍", "永久移除", "將移除所選書籍及其來源檔案。此操作無法復原。", "書籍已移除", "本機檔案仍待清理", "重試檔案清理", "重新整理", "已選取", "最多選擇 1000 本書", "檔案清理完成", "書籍"],
  ja: ["書庫デスク", "選択を確認", "完全に削除", "選択した本と元のファイルを削除します。この操作は取り消せません。", "本を削除しました", "ローカルファイルの削除が未完了です", "ファイル削除を再試行", "更新", "選択済み", "最大1000冊まで選択できます", "ファイル削除完了", "本"],
  de: ["Bibliotheksverwaltung", "Auswahl prüfen", "Dauerhaft entfernen", "Die ausgewählten Bücher und Quelldateien werden unwiderruflich entfernt.", "Bücher entfernt", "Lokale Dateien müssen noch bereinigt werden", "Dateibereinigung wiederholen", "Aktualisieren", "Ausgewählt", "Höchstens 1000 Bücher auswählen", "Dateibereinigung abgeschlossen", "Bücher"],
  fr: ["Gestion de bibliothèque", "Vérifier la sélection", "Supprimer définitivement", "Les livres sélectionnés et leurs fichiers sources seront supprimés. Cette action est irréversible.", "Livres supprimés", "Des fichiers locaux restent à supprimer", "Réessayer le nettoyage", "Actualiser", "Sélectionné", "Sélectionnez au maximum 1000 livres", "Nettoyage terminé", "Livres"],
  es: ["Gestión de biblioteca", "Revisar selección", "Eliminar permanentemente", "Los libros seleccionados y sus archivos de origen se eliminarán. Esta acción no se puede deshacer.", "Libros eliminados", "Quedan archivos locales por limpiar", "Reintentar limpieza", "Actualizar", "Seleccionado", "Selecciona un máximo de 1000 libros", "Limpieza completada", "Libros"],
  ru: ["Управление библиотекой", "Проверить выбор", "Удалить навсегда", "Выбранные книги и их исходные файлы будут удалены. Это действие нельзя отменить.", "Книги удалены", "Локальные файлы ещё требуют очистки", "Повторить очистку файлов", "Обновить", "Выбрано", "Выберите не более 1000 книг", "Очистка файлов завершена", "Книги"]
};
function strings(locale) {
  return translations[locale] ?? translations[locale.split("-")[0]] ?? en;
}
var cleanup = {
  en: ["Pending file cleanup", "Next page"],
  "zh-Hans": ["待清理文件", "下一页"],
  "zh-Hant": ["待清理檔案", "下一頁"],
  ja: ["未完了のファイル削除", "次のページ"],
  de: ["Ausstehende Dateibereinigung", "Nächste Seite"],
  fr: ["Nettoyage en attente", "Page suivante"],
  es: ["Limpieza pendiente", "Página siguiente"],
  ru: ["Ожидающая очистка файлов", "Следующая страница"]
};
function cleanupStrings(locale) {
  return cleanup[locale] ?? cleanup[locale.split("-")[0]] ?? cleanup.en;
}

// src/workspace.ts
var translations2 = {
  en: ["Workspace", "Shelf", "Context", "Statistics", "Settings", "Search", "Open", "Show selection on shelf", "Selected"],
  "zh-Hans": ["工作区", "书架", "上下文", "统计", "设置", "搜索", "打开", "在书架显示所选书籍", "已选择"],
  "zh-Hant": ["工作區", "書架", "上下文", "統計", "設定", "搜尋", "開啟", "在書架顯示所選書籍", "已選取"],
  ja: ["ワークスペース", "本棚", "コンテキスト", "統計", "設定", "検索", "開く", "選択した本を本棚で表示", "選択済み"],
  de: ["Arbeitsbereich", "Bibliothek", "Kontext", "Statistik", "Einstellungen", "Suchen", "Öffnen", "Auswahl in der Bibliothek zeigen", "Ausgewählt"],
  fr: ["Espace de travail", "Bibliothèque", "Contexte", "Statistiques", "Paramètres", "Rechercher", "Ouvrir", "Afficher la sélection en bibliothèque", "Sélectionné"],
  es: ["Espacio de trabajo", "Biblioteca", "Contexto", "Estadísticas", "Ajustes", "Buscar", "Abrir", "Mostrar selección en la biblioteca", "Seleccionado"],
  ru: ["Рабочая область", "Библиотека", "Контекст", "Статистика", "Настройки", "Поиск", "Открыть", "Показать выбранные книги в библиотеке", "Выбрано"]
};
var workspaceStrings = (locale) => translations2[locale] ?? translations2[locale.split("-")[0]] ?? translations2.en;
async function workspaceView(ctx, selected) {
  const api = ctx.services.ui.workspace, library = ctx.domains.library, t = workspaceStrings(ctx.locale);
  const collections = await library.queries.collections.list();
  let state = await api.snapshot({ limit: 1 }), channel, revision = 0;
  const open = async (target) => {
    await api.navigate(target);
    return { close: true };
  };
  const groups = [null, ...collections.map((c) => c.id)].map((collectionId) => ({
    collectionId,
    title: collections.find((c) => c.id === collectionId)?.name ?? t[1],
    books: selected?.filter((b) => (b.collectionId ?? null) === collectionId)
  })).filter((group) => !selected || group.books.length > 0);
  const content = () => ({
    kind: "list",
    title: selected ? t[7] : `${t[0]} · ${t[8]}: ${state.selection.total}`,
    searchable: true,
    items: groups.map((group, index) => ({
      id: `collection-${index}`,
      title: group.title,
      subtitle: group.books ? String(group.books.length) : undefined,
      icon: "books",
      onSelect: () => open({
        surface: "shelf",
        collectionId: group.collectionId,
        ...group.books ? { selection: { active: true, bookIds: group.books.map((book) => book.id) } } : {}
      })
    })),
    actions: selected ? [] : [
      { id: "agent", label: t[2], icon: "chat-circle-dots", run: () => open({ surface: "agent" }) },
      { id: "stats", label: t[3], icon: "chart-line-up", run: () => open({ surface: "stats" }) },
      { id: "settings", label: t[4], icon: "rows", run: () => open({ surface: "settings", section: "general" }) },
      { id: "search", label: t[5], icon: "magnifying-glass", run: () => ({ view: {
        kind: "form",
        title: t[5],
        submitLabel: t[6],
        fields: [{ kind: "text", id: "query", label: t[5], value: state.search.query }],
        onSubmit: (values) => open({ surface: "search", query: String(values.query ?? "") })
      } }) }
    ]
  });
  return { ...content(), live: { subscribe: async (next) => {
    channel = next;
    const subscription = api.observe({ limit: 1 }, async (snapshot) => {
      if (!snapshot || channel?.id !== next.id)
        return;
      state = snapshot;
      await ctx.services.ui.publishView(next, { revision: ++revision, view: content() });
    });
    return { dispose() {
      subscription.dispose();
      if (channel?.id === next.id)
        channel = undefined;
    } };
  } } };
}

// src/views.ts
async function libraryDesk(ctx) {
  const library = ctx.domains.library, write = library.commands.books, t = strings(ctx.locale);
  const cleanupText = cleanupStrings(ctx.locale);
  let books = await library.queries.books.list(), channel, revision = 0, refreshGeneration = 0;
  const selected = new Set;
  const refresh = async () => {
    const generation = ++refreshGeneration;
    const refreshed = await library.queries.books.list();
    if (generation !== refreshGeneration)
      return null;
    books = refreshed;
    const present = new Set(books.map((book) => book.id));
    for (const id of selected)
      if (!present.has(id))
        selected.delete(id);
    if (channel)
      await ctx.services.ui.publishView(channel, { revision: ++revision, view: content() });
    return null;
  };
  const result = (receipt, removed) => ({
    kind: "detail",
    title: removed ? t[4] : receipt.files.status === "released" ? t[10] : t[5],
    content: [{ kind: "text", text: receipt.files.status === "released" ? t[10] : t[5] }],
    actions: [
      ...receipt.files.status === "pending" ? [{ id: "retry", label: t[6], icon: "arrows-clockwise", run: async () => ({
        view: result(await write.retryRemovalCleanup(receipt.bookIds), false),
        navigation: "replace"
      }) }] : [],
      { id: "library", label: t[11], icon: "books", run: async () => ({ view: await libraryDesk(ctx), navigation: "reset" }) }
    ]
  });
  const review = (chosen) => {
    const ids = chosen.map((book) => book.id);
    return { kind: "detail", title: `${t[1]} (${ids.length})`, content: [
      { kind: "text", text: t[3] },
      ...chosen.map((book, index) => ({ kind: "text", text: `${index + 1}. ${book.title}
${book.author ?? ""}` }))
    ], actions: [{ id: "remove", label: t[2], icon: "trash", variant: "danger", run: async () => {
      const receipt = await write.removeMany(ids);
      selected.clear();
      return { view: result(receipt, true), navigation: "reset" };
    } }] };
  };
  const pendingCleanup = async (after) => {
    const page = await library.queries.books.listRemovalCleanup({ limit: 50, ...after ? { after } : {} });
    return {
      kind: "list",
      title: cleanupText[0],
      searchable: true,
      items: page.items.map((item) => ({
        id: item.bookId,
        title: item.title,
        subtitle: item.bookId,
        icon: "file-text",
        onSelect: () => ({ view: { kind: "detail", title: cleanupText[0], content: [
          { kind: "text", text: item.title },
          { kind: "text", text: item.bookId }
        ], actions: [{ id: "retry", label: t[6], icon: "arrows-clockwise", run: async () => ({
          view: result(await write.retryRemovalCleanup([item.bookId]), false),
          navigation: "replace"
        }) }] } })
      })),
      actions: [
        { id: "refresh", label: t[7], icon: "arrows-clockwise", run: async () => ({ view: await pendingCleanup(after), navigation: "replace" }) },
        ...page.nextCursor ? [{ id: "next", label: cleanupText[1], icon: "arrow-right", run: async () => ({ view: await pendingCleanup(page.nextCursor) }) }] : []
      ]
    };
  };
  const content = () => ({
    kind: "list",
    title: `${t[0]} (${selected.size})`,
    searchable: true,
    items: books.map((book) => ({
      id: book.id,
      title: book.title,
      subtitle: book.author,
      icon: "book-open",
      accessories: selected.has(book.id) ? [{ kind: "icon", icon: "check", label: t[8] }] : [],
      onSelect: async () => {
        if (selected.has(book.id))
          selected.delete(book.id);
        else if (selected.size < 1000)
          selected.add(book.id);
        else
          return { toast: t[9] };
        if (channel)
          await ctx.services.ui.publishView(channel, { revision: ++revision, view: content() });
        return null;
      }
    })),
    actions: [
      { id: "refresh", label: t[7], icon: "arrows-clockwise", run: refresh },
      { id: "workspace", label: workspaceStrings(ctx.locale)[0], icon: "books", run: async () => ({ view: await workspaceView(ctx) }) },
      ...selected.size ? [{ id: "show-selection", label: workspaceStrings(ctx.locale)[7], icon: "arrow-right", run: async () => ({ view: await workspaceView(ctx, books.filter((book) => selected.has(book.id))) }) }] : [],
      { id: "cleanup", label: cleanupText[0], icon: "arrows-clockwise", run: async () => ({ view: await pendingCleanup() }) },
      ...selected.size ? [{ id: "review", label: `${t[1]} (${selected.size})`, icon: "trash", run: () => ({ view: review(books.filter((book) => selected.has(book.id))) }) }] : []
    ]
  });
  return { ...content(), live: { subscribe: async (next) => {
    channel = next;
    await refresh();
    return { dispose() {
      if (channel?.id === next.id) {
        channel = undefined;
        ++refreshGeneration;
      }
    } };
  } } };
}

// src/index.ts
var src_default = {
  activate(ctx) {
    if (!ctx.domains.library?.commands)
      throw Error("Library Desk requires library:write");
    const title = strings(ctx.locale)[0];
    ctx.contributions.commands.register({ id: "open", title, icon: "books", run: async () => ({ view: await libraryDesk(ctx) }) });
    ctx.contributions.headerActions.register({ id: "shelf", title, icon: "books", surface: "shelf", presentation: "popup", view: () => libraryDesk(ctx) });
  }
};
export {
  src_default as default
};
