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

// src/views.ts
async function libraryDesk(ctx) {
  const library = ctx.domains.library, write = library.commands.books, t = strings(ctx.locale);
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
