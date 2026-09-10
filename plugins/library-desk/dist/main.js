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

// src/commands.ts
var translations2 = {
  en: ["Host commands", "Refresh", "Selected", "Permission required", "Workspace unavailable", "Reader control required", "Setting saved; navigation did not complete"],
  "zh-Hans": ["宿主命令", "刷新", "已选中", "需要授权", "工作区不可用", "需要阅读控制权限", "设置已保存，界面切换未完成"],
  "zh-Hant": ["宿主命令", "重新整理", "已選取", "需要授權", "工作區無法使用", "需要閱讀控制權限", "設定已儲存，介面切換未完成"],
  ja: ["ホストコマンド", "更新", "選択済み", "権限が必要", "ワークスペースを利用できません", "読書の操作権限が必要", "設定は保存されましたが、画面の移動は完了しませんでした"],
  de: ["Host-Befehle", "Aktualisieren", "Ausgewählt", "Berechtigung erforderlich", "Arbeitsbereich nicht verfügbar", "Lesesteuerung erforderlich", "Einstellung gespeichert; Ansicht nicht gewechselt"],
  fr: ["Commandes hôte", "Actualiser", "Sélectionné", "Autorisation requise", "Espace indisponible", "Contrôle de lecture requis", "Paramètre enregistré ; navigation non terminée"],
  es: ["Comandos del anfitrión", "Actualizar", "Seleccionado", "Permiso necesario", "Espacio no disponible", "Control de lectura necesario", "Ajuste guardado; navegación incompleta"],
  ru: ["Команды приложения", "Обновить", "Выбрано", "Требуется разрешение", "Рабочая область недоступна", "Требуется управление чтением", "Настройка сохранена; переход не завершён"]
};
var commandStrings = (locale) => translations2[locale] ?? translations2[locale.split("-")[0]] ?? translations2.en;
async function commandsView(ctx) {
  const api = ctx.services.ui.commands, t = commandStrings(ctx.locale);
  let snapshot = await api.list(), failure;
  const refresh = async () => ({ view: await commandsView(ctx), navigation: "replace" });
  const execute = async (command, request, expectedWorkspaceRevision) => {
    const receipt = await api.execute({ ...request, ...expectedWorkspaceRevision === null ? {} : { expectedWorkspaceRevision } });
    if (receipt.status === "completed")
      return { close: true };
    return { view: { kind: "detail", title: command.title, content: [
      { kind: "text", text: t[6] },
      { kind: "error", code: receipt.errorCode ?? "ui/unavailable" }
    ], actions: [{ id: "refresh", label: t[1], icon: "arrows-clockwise", run: refresh }] }, navigation: "replace" };
  };
  const choose = async (command, revision) => {
    if (command.id === "open-book") {
      const books = await ctx.domains.library.queries.books.list();
      return { view: { kind: "list", title: command.title, searchable: true, items: books.map((book) => ({
        id: book.id,
        title: book.title,
        subtitle: book.author,
        icon: "book-open",
        onSelect: () => execute(command, { id: "open-book", args: { bookId: book.id } }, revision)
      })) } };
    }
    if (command.id === "open-collection") {
      const collections = await ctx.domains.library.queries.collections.list();
      return { view: { kind: "list", title: command.title, searchable: true, items: collections.map((collection) => ({
        id: collection.id,
        title: collection.name,
        icon: "books",
        onSelect: () => execute(command, { id: "open-collection", args: { collectionId: collection.id } }, revision)
      })) } };
    }
    return execute(command, { id: command.id }, revision);
  };
  const content = () => {
    const current = snapshot;
    const list = {
      kind: "list",
      searchable: true,
      items: current.commands.map((command) => ({
        id: command.id,
        title: command.title,
        keywords: [command.id],
        subtitle: command.unavailableReason === "permission" ? t[3] : command.unavailableReason === "workspace" ? t[4] : command.unavailableReason === "reader-control" ? t[5] : undefined,
        accessories: command.checked ? [{ kind: "icon", icon: "check", label: t[2] }] : [],
        ...!failure && command.enabled && api.execute ? { onSelect: () => choose(command, current.workspaceRevision) } : {}
      })),
      actions: [{ id: "refresh", label: t[1], icon: "arrows-clockwise", run: refresh }]
    };
    return { kind: "detail", title: t[0], content: [
      { kind: "group", blocks: failure ? [{ kind: "error", code: failure }] : [] },
      list
    ] };
  };
  return { ...content(), live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = api.observe(async (state) => {
      if (disposed)
        return;
      if (state.status === "ready") {
        snapshot = state.snapshot;
        failure = undefined;
      } else
        failure = state.code;
      await ctx.services.ui.publishView(channel, { revision: ++revision, view: content() });
    });
    return { dispose() {
      disposed = true;
      subscription.dispose();
    } };
  } } };
}

// src/workspace.ts
var translations3 = {
  en: ["Workspace", "Shelf", "Context", "Statistics", "Settings", "Search", "Open", "Show selection on shelf", "Selected"],
  "zh-Hans": ["工作区", "书架", "上下文", "统计", "设置", "搜索", "打开", "在书架显示所选书籍", "已选择"],
  "zh-Hant": ["工作區", "書架", "上下文", "統計", "設定", "搜尋", "開啟", "在書架顯示所選書籍", "已選取"],
  ja: ["ワークスペース", "本棚", "コンテキスト", "統計", "設定", "検索", "開く", "選択した本を本棚で表示", "選択済み"],
  de: ["Arbeitsbereich", "Bibliothek", "Kontext", "Statistik", "Einstellungen", "Suchen", "Öffnen", "Auswahl in der Bibliothek zeigen", "Ausgewählt"],
  fr: ["Espace de travail", "Bibliothèque", "Contexte", "Statistiques", "Paramètres", "Rechercher", "Ouvrir", "Afficher la sélection en bibliothèque", "Sélectionné"],
  es: ["Espacio de trabajo", "Biblioteca", "Contexto", "Estadísticas", "Ajustes", "Buscar", "Abrir", "Mostrar selección en la biblioteca", "Seleccionado"],
  ru: ["Рабочая область", "Библиотека", "Контекст", "Статистика", "Настройки", "Поиск", "Открыть", "Показать выбранные книги в библиотеке", "Выбрано"]
};
var workspaceStrings = (locale) => translations3[locale] ?? translations3[locale.split("-")[0]] ?? translations3.en;
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
      { id: "host-commands", label: commandStrings(ctx.locale)[0], icon: "rows", run: async () => ({ view: await commandsView(ctx) }) },
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

// src/assets-strings.ts
var en2 = {
  details: "Book details",
  import: "Import book",
  confirmImport: "Import",
  imported: "Imported",
  duplicate: "Already in library",
  cover: "Cover",
  preview: "Preview cover",
  copy: "Copy cover",
  copied: "Cover copied",
  save: "Save cover",
  export: "Export original file",
  saved: "Saved",
  unavailable: "Not available locally",
  unchecked: "Not checked",
  none: "No cover",
  ready: "Available locally",
  enrichment: "Metadata and cover",
  retry: "Retry enrichment",
  refresh: "Refresh",
  source: "Original file",
  local: "Available locally",
  remote: "Not available locally",
  pending: "Metadata pending",
  complete: "Metadata complete",
  file: "File",
  size: "Bytes",
  format: "Format",
  sections: "Sections",
  inspection: "Parser initialization",
  parsed: "Initialized",
  unsupported: "Unsupported format",
  encrypted: "Encrypted",
  failed: "Failed",
  unknown: "Unknown",
  idle: "Idle",
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  skipped: "Skipped"
};
var zh = {
  details: "书籍详情",
  import: "导入书籍",
  confirmImport: "导入",
  imported: "已导入",
  duplicate: "书库中已存在",
  cover: "封面",
  preview: "预览封面",
  copy: "复制封面",
  copied: "封面已复制",
  save: "保存封面",
  export: "导出原文件",
  saved: "已保存",
  unavailable: "本地不可用",
  unchecked: "尚未检查",
  none: "没有封面",
  ready: "本地可用",
  enrichment: "元数据与封面",
  retry: "重试补齐",
  refresh: "刷新",
  source: "原文件",
  local: "本地可用",
  remote: "本地不可用",
  pending: "元数据待补齐",
  complete: "元数据已完整",
  file: "文件",
  size: "字节",
  format: "格式",
  sections: "章节数",
  inspection: "解析器初始化",
  parsed: "已初始化",
  unsupported: "不支持的格式",
  encrypted: "已加密",
  failed: "失败",
  unknown: "未知",
  idle: "空闲",
  queued: "排队中",
  running: "进行中",
  completed: "已完成",
  skipped: "已跳过"
};
var assetStrings = (locale) => locale === "zh-Hans" || locale === "zh-CN" ? zh : en2;

// src/book-assets.ts
async function bookAssets(ctx, book) {
  const library = ctx.domains.library, resources = ctx.services.resources, t = assetStrings(ctx.locale);
  let snapshot = await library.queries.books.getEnrichment(book.id), failure;
  const unavailable = () => ({ toast: t.unavailable });
  const saveOriginal = async () => {
    const resource = await resources.openBook(book.id);
    if (!resource)
      return unavailable();
    try {
      return (await resources.save(resource.id, resource.name)).saved ? { toast: t.saved } : null;
    } finally {
      await resources.release(resource.id);
    }
  };
  const cover = async () => {
    const resource = await resources.openCover(book.id);
    if (!resource)
      return unavailable();
    return { view: {
      kind: "detail",
      title: book.title,
      content: [{ kind: "image", resourceId: resource.id, alt: book.title, aspectRatio: 2 / 3 }],
      actions: [
        { id: "save-cover", label: t.save, icon: "download-simple", run: async () => (await resources.save(resource.id, resource.name)).saved ? { toast: t.saved } : null },
        { id: "copy-cover", label: t.copy, icon: "copy", run: async () => {
          await ctx.services.clipboard.writeImage(resource.id);
          return { toast: t.copied };
        } }
      ],
      onClose: () => resources.release(resource.id)
    } };
  };
  const content = () => ({
    kind: "detail",
    title: book.title,
    content: [
      { kind: "group", blocks: failure ? [{ kind: "error", code: failure }] : [] },
      { kind: "keyValue", rows: [
        { label: t.cover, value: snapshot.cover.local ? t.ready : snapshot.cover.status === "ready" ? t.unavailable : t[snapshot.cover.status] },
        { label: t.source, value: snapshot.sourceLocal ? t.local : t.remote },
        { label: t.enrichment, value: `${snapshot.metadataPending ? t.pending : t.complete} / ${t[snapshot.job.phase]}` }
      ] },
      ...snapshot.job.errorCode ? [{ kind: "error", code: snapshot.job.errorCode }] : []
    ],
    actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await bookAssets(ctx, book), navigation: "replace" }) },
      ...!failure && snapshot.cover.local ? [{ id: "cover", label: t.preview, icon: "book-bookmark", run: cover }] : [],
      ...!failure && snapshot.sourceLocal ? [{ id: "export", label: t.export, icon: "download-simple", run: saveOriginal }] : [],
      ...!failure && snapshot.supported && snapshot.sourceLocal && snapshot.job.phase !== "queued" && snapshot.job.phase !== "running" && (snapshot.metadataPending || snapshot.cover.status === "unchecked") ? [{ id: "enrich", label: t.retry, icon: "arrows-clockwise", run: async () => {
        await library.commands.books.retryEnrichment(book.id);
        return { view: await bookAssets(ctx, book), navigation: "replace" };
      } }] : []
    ]
  });
  return { ...content(), live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = library.events.observeEnrichment(book.id, async (event) => {
      if (disposed)
        return;
      if (event.status === "ready") {
        snapshot = event.snapshot;
        failure = undefined;
      } else
        failure = event.errorCode;
      await ctx.services.ui.publishView(channel, { revision: ++revision, view: content() });
    });
    return { dispose() {
      disposed = true;
      subscription.dispose();
    } };
  } } };
}

// src/import-book.ts
async function importBook(ctx) {
  const library = ctx.domains.library, resources = ctx.services.resources, t = assetStrings(ctx.locale);
  const formats = await library.queries.books.listFormats();
  const picked = await resources.pick({ multiple: false, extensions: formats.flatMap((format) => format.extensions) });
  const resource = picked.resources[0];
  if (!resource)
    return null;
  let inspection;
  try {
    inspection = await library.queries.books.inspectResource(resource.id);
  } catch (error) {
    await resources.release(resource.id);
    throw error;
  }
  return { view: { kind: "detail", title: t.import, content: [
    { kind: "keyValue", rows: [
      { label: t.file, value: resource.name },
      { label: t.size, value: String(resource.size) },
      { label: t.format, value: inspection.formatHint ?? t.unknown },
      { label: t.inspection, value: t[inspection.status] },
      { label: t.sections, value: inspection.sectionCount === null ? t.unknown : String(inspection.sectionCount) }
    ] },
    ...inspection.errorCode ? [{ kind: "error", code: inspection.errorCode }] : []
  ], actions: inspection.status === "parsed" ? [{ id: "import", label: t.confirmImport, icon: "plus", run: async () => {
    const receipt = await library.commands.books.importResource(resource.id);
    return { view: {
      kind: "detail",
      title: receipt.book.title,
      content: [{ kind: "text", text: receipt.status === "duplicate" ? t.duplicate : t.imported }],
      actions: [{ id: "details", label: t.details, icon: "book-open", run: async () => ({ view: await bookAssets(ctx, receipt.book) }) }]
    }, navigation: "replace" };
  } }] : [], onClose: () => resources.release(resource.id) } };
}

// src/organize-strings.ts
var en3 = {
  organize: "Organize",
  metadata: "Edit title and author",
  title: "Title",
  author: "Author",
  save: "Save",
  required: "Enter a name",
  favorite: "Favorite",
  addFavorite: "Add to favorites",
  removeFavorite: "Remove from favorites",
  done: "Done",
  yes: "Yes",
  no: "No",
  refresh: "Refresh",
  missing: "Book no longer available",
  collections: "Collections",
  create: "New collection",
  rename: "Rename",
  name: "Name",
  remove: "Remove collection",
  confirm: "Confirm",
  deleteWarning: "Remove this collection. Its books will remain in the library.",
  confirmRequired: "Confirm this change first",
  move: "Move selected books",
  ungroup: "No collection",
  destination: "Destination",
  selected: "Selected books",
  duplicates: "Duplicate books",
  noDuplicates: "No duplicates found",
  keep: "Keep",
  merge: "Merge records",
  mergeWarning: "Merge these duplicate records into the retained book. This cannot be undone.",
  merged: "Records merged",
  previous: "Previous",
  next: "Next",
  openKeeper: "Retained book",
  noCollection: "Collection no longer available"
};
var zh2 = {
  organize: "整理书籍",
  metadata: "编辑书名与作者",
  title: "书名",
  author: "作者",
  save: "保存",
  required: "请输入名称",
  favorite: "收藏",
  addFavorite: "加入收藏",
  removeFavorite: "取消收藏",
  done: "完成",
  yes: "是",
  no: "否",
  refresh: "刷新",
  missing: "书籍已不可用",
  collections: "集合",
  create: "新建集合",
  rename: "重命名",
  name: "名称",
  remove: "移除集合",
  confirm: "确认",
  deleteWarning: "移除此集合，书籍仍保留在书库中。",
  confirmRequired: "请先确认此变更",
  move: "移动所选书籍",
  ungroup: "无集合",
  destination: "目标集合",
  selected: "所选书籍",
  duplicates: "重复书籍",
  noDuplicates: "没有重复书籍",
  keep: "保留",
  merge: "合并记录",
  mergeWarning: "将这些重复记录合并到保留书籍中，此操作无法撤销。",
  merged: "记录已合并",
  previous: "上一页",
  next: "下一页",
  openKeeper: "保留书籍",
  noCollection: "集合已不可用"
};
var organizeStrings = (locale) => locale === "zh-Hans" || locale === "zh-CN" ? zh2 : en3;

// src/organize-books.ts
function mutationDone(ctx, reload) {
  const t = organizeStrings(ctx.locale);
  return { view: { kind: "detail", title: t.done, content: [], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await reload(), navigation: "replace" }) }
  ] }, navigation: "replace" };
}
async function organizeBook(ctx, bookId) {
  const library = ctx.domains.library, t = organizeStrings(ctx.locale);
  const book = await library.queries.books.get(bookId);
  if (!book)
    return { kind: "detail", title: t.organize, content: [{ kind: "text", text: t.missing }] };
  const reload = () => organizeBook(ctx, bookId);
  const metadata = () => ({
    kind: "form",
    title: t.metadata,
    fields: [
      { kind: "text", id: "title", label: t.title, value: book.title },
      { kind: "text", id: "author", label: t.author, value: book.author ?? "" }
    ],
    submitLabel: t.save,
    onSubmit: async (values) => {
      const title = typeof values.title === "string" ? values.title.trim() : "";
      const author = typeof values.author === "string" ? values.author.trim() : "";
      if (!title)
        return { fieldErrors: { title: t.required } };
      await library.commands.books.editMetadata(bookId, {
        ...title === book.title ? {} : { title },
        ...author === (book.author ?? "") ? {} : { author }
      });
      return mutationDone(ctx, reload);
    }
  });
  return { kind: "detail", title: book.title, content: [{ kind: "keyValue", rows: [
    { label: t.author, value: book.author ?? "" },
    { label: t.favorite, value: book.starred ? t.yes : t.no }
  ] }], actions: [
    { id: "metadata", label: t.metadata, icon: "note-pencil", run: () => ({ view: metadata() }) },
    { id: "favorite", label: book.starred ? t.removeFavorite : t.addFavorite, icon: "star", run: async () => {
      await library.commands.books.setStarred(bookId, !book.starred);
      return mutationDone(ctx, reload);
    } },
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await reload(), navigation: "replace" }) }
  ] };
}

// src/collections.ts
function nameForm(ctx, collection) {
  const t = organizeStrings(ctx.locale), commands = ctx.domains.library.commands.collections;
  return {
    kind: "form",
    title: collection ? t.rename : t.create,
    fields: [{ kind: "text", id: "name", label: t.name, value: collection?.name ?? "" }],
    submitLabel: t.save,
    onSubmit: async (values) => {
      const name = typeof values.name === "string" ? values.name.trim() : "";
      if (!name)
        return { fieldErrors: { name: t.required } };
      if (collection)
        await commands.rename(collection.id, name);
      else
        await commands.create(name);
      return mutationDone(ctx, () => collectionList(ctx));
    }
  };
}
async function collectionList(ctx) {
  const t = organizeStrings(ctx.locale), collections = await ctx.domains.library.queries.collections.list();
  return {
    kind: "list",
    title: t.collections,
    searchable: true,
    items: collections.map((collection) => ({
      id: collection.id,
      title: collection.name,
      icon: "folder",
      onSelect: async () => ({ view: await collectionDetail(ctx, collection) })
    })),
    actions: [
      { id: "create", label: t.create, icon: "plus", run: () => ({ view: nameForm(ctx) }) },
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await collectionList(ctx), navigation: "replace" }) }
    ]
  };
}
async function collectionDetail(ctx, collection) {
  const t = organizeStrings(ctx.locale), library = ctx.domains.library;
  const members = await library.queries.collections.booksIn(collection.id);
  return {
    kind: "detail",
    title: collection.name,
    content: [{ kind: "metric", label: t.selected, value: String(members.length) }],
    actions: [
      { id: "rename", label: t.rename, icon: "note-pencil", run: () => ({ view: nameForm(ctx, collection) }) },
      { id: "remove", label: t.remove, icon: "trash", variant: "danger", run: () => ({ view: {
        kind: "form",
        title: collection.name,
        fields: [{ kind: "checkbox", id: "confirm", label: t.deleteWarning, value: false }],
        submitLabel: t.remove,
        onSubmit: async (values) => {
          if (values.confirm !== true)
            return { fieldErrors: { confirm: t.confirmRequired } };
          await library.commands.collections.remove(collection.id);
          return mutationDone(ctx, () => collectionList(ctx));
        }
      } }) }
    ]
  };
}
async function moveBooks(ctx, selected) {
  const t = organizeStrings(ctx.locale), library = ctx.domains.library;
  const books = selected.map((book) => ({ id: book.id, title: book.title })), bookIds = books.map((book) => book.id);
  const collections = await library.queries.collections.list();
  const targets = [null, ...collections.map((collection) => collection.id)];
  const form = () => ({ kind: "form", fields: [
    { kind: "select", id: "destination", label: t.destination, value: "", options: [
      { value: "", label: t.destination },
      { value: "0", label: t.ungroup },
      ...collections.map((collection, index) => ({ value: String(index + 1), label: collection.name }))
    ] },
    { kind: "checkbox", id: "confirm", label: `${t.selected}: ${bookIds.length}`, value: false }
  ], submitLabel: t.move, onSubmit: async (values) => {
    if (values.confirm !== true)
      return { fieldErrors: { confirm: t.confirmRequired } };
    const index = targets.findIndex((_, index2) => String(index2) === values.destination);
    if (index < 0)
      return { fieldErrors: { destination: t.required } };
    const target = targets[index];
    if (target !== null && !(await library.queries.collections.list()).some((collection) => collection.id === target)) {
      return { fieldErrors: { destination: t.noCollection } };
    }
    await library.commands.collections.assignBooks([...bookIds], target);
    return mutationDone(ctx, () => collectionList(ctx));
  } });
  const render = (offset) => ({ kind: "detail", title: `${t.move} (${bookIds.length})`, content: [
    {
      kind: "list",
      items: books.slice(offset, offset + 20).map((book) => ({ id: book.id, title: book.title, subtitle: book.id, icon: "book-open" })),
      pagination: {
        page: Math.floor(offset / 20) + 1,
        pageCount: Math.max(1, Math.ceil(bookIds.length / 20)),
        ...offset > 0 ? { onPrevious: () => ({ view: render(offset - 20), navigation: "replace" }) } : {},
        ...offset + 20 < books.length ? { onNext: () => ({ view: render(offset + 20), navigation: "replace" }) } : {}
      }
    },
    form()
  ] });
  return render(0);
}

// src/duplicates.ts
async function duplicateList(ctx, offset = 0) {
  const t = organizeStrings(ctx.locale), page = await ctx.domains.library.queries.books.listDuplicates({ offset, limit: 20 });
  return {
    kind: "list",
    title: t.duplicates,
    emptyText: t.noDuplicates,
    items: page.groups.map((group) => ({
      id: group.bookId,
      title: group.title,
      subtitle: String(group.count),
      icon: "books",
      onSelect: async () => ({ view: await duplicateReview(ctx, group.bookId) })
    })),
    actions: [{ id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await duplicateList(ctx), navigation: "replace" }) }],
    pagination: {
      page: Math.floor(offset / 20) + 1,
      ...offset > 0 ? { onPrevious: async () => ({ view: await duplicateList(ctx, Math.max(0, offset - 20)), navigation: "replace" }) } : {},
      ...page.nextOffset === null ? {} : { onNext: async () => ({ view: await duplicateList(ctx, page.nextOffset), navigation: "replace" }) }
    }
  };
}
async function duplicateReview(ctx, bookId) {
  const preview = await ctx.domains.library.queries.books.previewMerge(bookId);
  if (!preview)
    return duplicateList(ctx);
  const frozen = { revision: preview.revision, keep: { ...preview.keep }, merged: preview.merged.map((member) => ({ ...member })) };
  return reviewPage(ctx, frozen, 0);
}
function reviewPage(ctx, preview, offset) {
  const t = organizeStrings(ctx.locale), bookId = preview.keep.id, expectedRevision = preview.revision;
  return { kind: "detail", title: t.duplicates, content: [
    { kind: "keyValue", rows: [{ label: t.keep, value: `${preview.keep.title}
${preview.keep.author}
${bookId}` }] },
    { kind: "list", title: `${t.merge} (${preview.merged.length})`, items: preview.merged.slice(offset, offset + 20).map((member) => ({
      id: member.id,
      title: member.title,
      subtitle: `${member.author}
${member.id}`,
      icon: "book-open"
    })), pagination: {
      page: Math.floor(offset / 20) + 1,
      pageCount: Math.ceil(preview.merged.length / 20),
      ...offset > 0 ? { onPrevious: () => ({ view: reviewPage(ctx, preview, offset - 20), navigation: "replace" }) } : {},
      ...offset + 20 < preview.merged.length ? { onNext: () => ({ view: reviewPage(ctx, preview, offset + 20), navigation: "replace" }) } : {}
    } }
  ], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await duplicateReview(ctx, bookId), navigation: "replace" }) },
    { id: "merge", label: t.merge, icon: "books", variant: "danger", run: () => ({ view: {
      kind: "form",
      title: `${t.keep}: ${preview.keep.title}`,
      fields: [{ kind: "checkbox", id: "confirm", label: t.mergeWarning, value: false }],
      submitLabel: t.merge,
      onSubmit: async (values) => {
        if (values.confirm !== true)
          return { fieldErrors: { confirm: t.confirmRequired } };
        const receipt = await ctx.domains.library.commands.books.mergeDuplicates({ bookId, expectedRevision });
        return { view: receiptPage(ctx, receipt, 0), navigation: "reset" };
      }
    } }) }
  ] };
}
function receiptPage(ctx, receipt, offset) {
  const t = organizeStrings(ctx.locale);
  return {
    kind: "list",
    title: `${t.merged} (${receipt.redirects.length})`,
    items: receipt.redirects.slice(offset, offset + 20).map((redirect) => ({ id: redirect.from, title: redirect.from, subtitle: redirect.to, icon: "arrow-right" })),
    actions: [
      { id: "keeper", label: t.openKeeper, icon: "book-open", run: async () => {
        const current = await ctx.domains.library.queries.books.resolveId(receipt.keepId);
        return { view: current ? await organizeBook(ctx, current) : { kind: "detail", title: t.openKeeper, content: [{ kind: "text", text: t.missing }] } };
      } },
      { id: "duplicates", label: t.duplicates, icon: "books", run: async () => ({ view: await duplicateList(ctx), navigation: "reset" }) }
    ],
    pagination: {
      page: Math.floor(offset / 20) + 1,
      pageCount: Math.max(1, Math.ceil(receipt.redirects.length / 20)),
      ...offset > 0 ? { onPrevious: () => ({ view: receiptPage(ctx, receipt, offset - 20), navigation: "replace" }) } : {},
      ...offset + 20 < receipt.redirects.length ? { onNext: () => ({ view: receiptPage(ctx, receipt, offset + 20), navigation: "replace" }) } : {}
    }
  };
}

// src/views.ts
async function libraryDesk(ctx) {
  const library = ctx.domains.library, write = library.commands.books, t = strings(ctx.locale);
  const cleanupText = cleanupStrings(ctx.locale);
  const assetsText = assetStrings(ctx.locale);
  const organizeText = organizeStrings(ctx.locale);
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
      { id: "import", label: assetsText.import, icon: "plus", run: () => importBook(ctx) },
      { id: "duplicates", label: organizeText.duplicates, icon: "books", run: async () => ({ view: await duplicateList(ctx) }) },
      { id: "collections", label: organizeText.collections, icon: "folder", run: async () => ({ view: await collectionList(ctx) }) },
      ...selected.size ? [{ id: "move", label: organizeText.move, icon: "folder", run: async () => ({ view: await moveBooks(ctx, books.filter((book) => selected.has(book.id))) }) }] : [],
      ...selected.size === 1 ? [{ id: "organize", label: organizeText.organize, icon: "note-pencil", run: async () => ({ view: await organizeBook(ctx, [...selected][0]) }) }] : [],
      ...selected.size === 1 ? [{ id: "details", label: assetsText.details, icon: "book-open", run: async () => ({ view: await bookAssets(ctx, books.find((book) => selected.has(book.id))) }) }] : [],
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
