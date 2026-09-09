// src/strings.ts
var locales = ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"];
var labels = {
  observedState: ["Last text state", "最近正文状态", "最近正文狀態", "直近の本文状態", "Последнее состояние текста", "Dernier état du texte", "Letzter Textstatus", "Último estado del texto"],
  failure: ["Failure", "失败原因", "失敗原因", "失敗理由", "Причина сбоя", "Échec", "Fehler", "Error"],
  busy: ["Another preparation is running", "已有正文准备任务正在进行", "已有正文準備工作正在進行", "別の本文準備が実行中です", "Другая подготовка текста уже идёт", "Une autre préparation est en cours", "Eine andere Textaufbereitung läuft", "Otra preparación está en curso"],
  request: ["Request", "请求状态", "請求狀態", "リクエスト", "Запрос", "Demande", "Anfrage", "Solicitud"],
  requests: ["My requests", "我的请求", "我的請求", "自分のリクエスト", "Мои запросы", "Mes demandes", "Meine Anfragen", "Mis solicitudes"],
  noRequests: ["No requests in this plugin session", "本次插件会话尚无请求", "本次外掛工作階段尚無請求", "このプラグインセッションにリクエストはありません", "В этой сессии плагина нет запросов", "Aucune demande dans cette session du plugin", "Keine Anfragen in dieser Plugin-Sitzung", "Sin solicitudes en esta sesión del complemento"],
  mode: ["Operation", "操作", "操作", "操作", "Операция", "Opération", "Vorgang", "Operación"],
  prepare: ["Prepare text", "准备正文", "準備正文", "本文を準備", "Подготовить текст", "Préparer le texte", "Text aufbereiten", "Preparar texto"],
  rebuild: ["Rebuild index", "重建索引", "重建索引", "索引を再構築", "Перестроить индекс", "Reconstruire l'index", "Index neu aufbauen", "Reconstruir índice"],
  cancelRequest: ["Cancel this request", "取消此请求", "取消此請求", "このリクエストをキャンセル", "Отменить этот запрос", "Annuler cette demande", "Diese Anfrage abbrechen", "Cancelar esta solicitud"],
  confirmRebuild: ["Discard the derived index and extract the source again", "清除派生索引并重新抽取源文件", "清除衍生索引並重新擷取來源檔案", "派生索引を削除して元ファイルから再抽出する", "Удалить производный индекс и извлечь текст заново", "Supprimer l'index dérivé et extraire à nouveau la source", "Abgeleiteten Index verwerfen und Quelle erneut auslesen", "Descartar el índice derivado y extraer de nuevo la fuente"],
  confirmRequired: ["Confirm rebuilding first", "请先确认重建", "請先確認重建", "再構築を確認してください", "Подтвердите перестроение", "Confirmez la reconstruction", "Neuaufbau zuerst bestätigen", "Confirme primero la reconstrucción"],
  task_queued: ["Queued", "已排队", "已排入佇列", "待機中", "В очереди", "En attente", "In Warteschlange", "En cola"],
  task_running: ["Running", "进行中", "進行中", "実行中", "Выполняется", "En cours", "Läuft", "En curso"],
  task_completed: ["Completed", "已完成", "已完成", "完了", "Завершён", "Terminée", "Abgeschlossen", "Completada"],
  task_failed: ["Failed", "已失败", "已失敗", "失敗", "Ошибка", "Échec", "Fehlgeschlagen", "Fallida"],
  task_cancelled: ["Request cancelled", "请求已取消", "請求已取消", "リクエストをキャンセル済み", "Запрос отменён", "Demande annulée", "Anfrage abgebrochen", "Solicitud cancelada"],
  title: ["Text Desk", "正文台", "正文台", "本文一覧", "Текст книг", "Textes des livres", "Buchtexte", "Textos de libros"],
  refresh: ["Refresh", "刷新", "重新整理", "更新", "Обновить", "Actualiser", "Aktualisieren", "Actualizar"],
  open: ["Open book", "打开书籍", "開啟書籍", "本を開く", "Открыть книгу", "Ouvrir le livre", "Buch öffnen", "Abrir libro"],
  previous: ["Previous", "上一页", "上一頁", "前へ", "Назад", "Précédent", "Zurück", "Anterior"],
  next: ["Next", "下一页", "下一頁", "次へ", "Далее", "Suivant", "Weiter", "Siguiente"],
  empty: ["No books", "没有书籍", "沒有書籍", "本がありません", "Нет книг", "Aucun livre", "Keine Bücher", "Sin libros"],
  status: ["Preparation", "准备状态", "準備狀態", "準備状態", "Подготовка", "Préparation", "Vorbereitung", "Preparación"],
  unprepared: ["Not prepared", "尚未准备", "尚未準備", "未準備", "Не подготовлен", "Non préparé", "Nicht vorbereitet", "Sin preparar"],
  preparing: ["Preparing", "准备中", "準備中", "準備中", "Подготовка", "En préparation", "In Vorbereitung", "Preparando"],
  ready: ["Prepared", "已准备", "已準備", "準備済み", "Подготовлен", "Prêt", "Vorbereitet", "Preparado"],
  partial: ["Incomplete", "未完成", "未完成", "未完了", "Не завершено", "Incomplet", "Unvollständig", "Incompleto"],
  unsupported: ["Unsupported", "不支持", "不支援", "非対応", "Не поддерживается", "Non pris en charge", "Nicht unterstützt", "No compatible"],
  unavailable: ["Source unavailable", "源文件不可用", "來源檔案無法使用", "元ファイルなし", "Источник недоступен", "Source indisponible", "Quelle nicht verfügbar", "Fuente no disponible"],
  error: ["Preparation failed", "准备失败", "準備失敗", "準備失敗", "Ошибка подготовки", "Échec de préparation", "Vorbereitung fehlgeschlagen", "Error de preparación"],
  queryError: ["Status could not be loaded", "无法读取状态", "無法讀取狀態", "状態を取得できません", "Не удалось загрузить состояние", "État indisponible", "Status konnte nicht geladen werden", "No se pudo cargar el estado"],
  text: ["Text layer", "文本层", "文字層", "テキスト層", "Текстовый слой", "Couche de texte", "Textebene", "Capa de texto"],
  unknown: ["Unknown", "未知", "未知", "不明", "Неизвестно", "Inconnu", "Unbekannt", "Desconocido"],
  available: ["Text found", "有文本", "有文字", "テキストあり", "Текст найден", "Texte trouvé", "Text vorhanden", "Texto disponible"],
  textless: ["No extractable text", "无可抽取文本", "無可擷取文字", "抽出可能な文字なし", "Нет извлекаемого текста", "Aucun texte extractible", "Kein extrahierbarer Text", "Sin texto extraíble"],
  chapters: ["Indexed chapters", "已索引章节", "已索引章節", "索引済みの章", "Глав в индексе", "Chapitres indexés", "Indizierte Kapitel", "Capítulos indexados"],
  sections: ["Read sections", "已读取分节", "已讀取分節", "読取済みセクション", "Прочитанные разделы", "Sections lues", "Gelesene Abschnitte", "Secciones leídas"],
  failed: ["Failed sections", "失败分节", "失敗分節", "失敗したセクション", "Сбои разделов", "Sections en échec", "Fehlgeschlagene Abschnitte", "Secciones fallidas"],
  unsupportedSections: ["Unsupported sections", "不支持的分节", "不支援的分節", "非対応セクション", "Неподдерживаемые разделы", "Sections non prises en charge", "Nicht unterstützte Abschnitte", "Secciones no compatibles"]
};
function tr(locale, key) {
  return labels[key][Math.max(0, locales.indexOf(locale))];
}

// src/task-views.ts
var active = (task) => task.status === "queued" || task.status === "running";
async function requestDetail(ctx, bookId, title, taskId) {
  const task = await ctx.domains.library.queries.books.getTextTask(bookId, taskId);
  return { ...requestSnapshot(ctx, title, task), live: {
    subscribe: (channel) => ctx.domains.library.events.observeTextTask(bookId, taskId, async (current) => {
      await ctx.services.ui.publishView(channel, { revision: current.revision, view: requestSnapshot(ctx, title, current) });
    })
  } };
}
function requestSnapshot(ctx, title, task) {
  const { bookId, taskId } = task;
  const progress = task.textState.progress;
  const rows = [
    { label: tr(ctx.locale, "request"), value: tr(ctx.locale, `task_${task.status}`) },
    { label: tr(ctx.locale, "mode"), value: tr(ctx.locale, task.mode) },
    { label: tr(ctx.locale, "observedState"), value: tr(ctx.locale, task.textState.status) },
    { label: tr(ctx.locale, "text"), value: tr(ctx.locale, task.textState.text) },
    { label: tr(ctx.locale, "chapters"), value: String(task.textState.chapterCount) }
  ];
  if (task.status === "failed")
    rows.push({ label: tr(ctx.locale, "failure"), value: tr(ctx.locale, task.errorCode === "library/text-busy" ? "busy" : task.errorCode === "library/text-unsupported" ? "unsupported" : task.errorCode === "library/content-unavailable" ? "unavailable" : "error") });
  if (progress)
    rows.push({ label: tr(ctx.locale, "sections"), value: `${progress.completed} / ${progress.total}` }, { label: tr(ctx.locale, "failed"), value: String(progress.failed) }, { label: tr(ctx.locale, "unsupportedSections"), value: String(progress.unsupported) });
  return { kind: "detail", title, content: [{ kind: "keyValue", rows }], actions: [
    { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({
      view: await requestDetail(ctx, bookId, title, taskId),
      navigation: "replace"
    }) },
    ...active(task) ? [{ id: "cancel", label: tr(ctx.locale, "cancelRequest"), icon: "stop", run: async () => {
      await ctx.domains.library.commands.books.cancelTextTask(bookId, taskId);
      return { view: await requestDetail(ctx, bookId, title, taskId), navigation: "replace" };
    } }] : [],
    { id: "requests", label: tr(ctx.locale, "requests"), icon: "list-bullets", run: async () => ({ view: await requestList(ctx, bookId, title) }) }
  ] };
}
async function startRequest(ctx, bookId, title, rebuild = false) {
  const task = await ctx.domains.library.commands.books.prepareText(bookId, { rebuild });
  return { view: await requestDetail(ctx, bookId, title, task.taskId) };
}
function rebuildForm(ctx, bookId, title) {
  return {
    kind: "form",
    title,
    fields: [{ kind: "checkbox", id: "confirm", label: tr(ctx.locale, "confirmRebuild"), value: false }],
    submitLabel: tr(ctx.locale, "rebuild"),
    onSubmit: async (values) => {
      if (values.confirm !== true)
        return { fieldErrors: { confirm: tr(ctx.locale, "confirmRequired") } };
      return { ...await startRequest(ctx, bookId, title, true), navigation: "replace" };
    }
  };
}
async function requestList(ctx, bookId, title) {
  const tasks = await ctx.domains.library.queries.books.listTextTasks(bookId);
  return { kind: "list", title, emptyText: tr(ctx.locale, "noRequests"), items: tasks.reverse().map((task) => ({
    id: task.taskId,
    title: tr(ctx.locale, task.mode),
    subtitle: tr(ctx.locale, `task_${task.status}`),
    timestamp: task.createdAt,
    onSelect: async () => ({ view: await requestDetail(ctx, bookId, title, task.taskId) })
  })), actions: [{
    id: "refresh",
    label: tr(ctx.locale, "refresh"),
    icon: "arrows-clockwise",
    run: async () => ({ view: await requestList(ctx, bookId, title), navigation: "replace" })
  }] };
}

// src/views.ts
async function textDetail(ctx, bookId, title) {
  const state = await ctx.domains.library.queries.books.getTextState(bookId);
  const rows = [
    { label: tr(ctx.locale, "status"), value: tr(ctx.locale, state.status) },
    { label: tr(ctx.locale, "text"), value: tr(ctx.locale, state.text) },
    { label: tr(ctx.locale, "chapters"), value: String(state.chapterCount) }
  ];
  if (state.progress)
    rows.push({ label: tr(ctx.locale, "sections"), value: `${state.progress.completed} / ${state.progress.total}` }, { label: tr(ctx.locale, "failed"), value: String(state.progress.failed) }, { label: tr(ctx.locale, "unsupportedSections"), value: String(state.progress.unsupported) });
  return { kind: "detail", title, content: [{ kind: "keyValue", rows }], actions: [
    { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({ view: await textDetail(ctx, bookId, title), navigation: "replace" }) },
    { id: "open", label: tr(ctx.locale, "open"), icon: "book-open", run: async () => {
      await ctx.domains.reading.commands.openBook(bookId);
      return { close: true };
    } },
    { id: "requests", label: tr(ctx.locale, "requests"), icon: "list-bullets", run: async () => ({ view: await requestList(ctx, bookId, title) }) },
    ...state.status !== "unsupported" ? [
      { id: "prepare", label: tr(ctx.locale, "prepare"), icon: "play", run: () => startRequest(ctx, bookId, title) },
      { id: "rebuild", label: tr(ctx.locale, "rebuild"), icon: "arrows-clockwise", run: () => ({ view: rebuildForm(ctx, bookId, title) }) }
    ] : []
  ] };
}
async function textDesk(ctx, page = 0) {
  const books = await ctx.domains.library.queries.books.list();
  const index = Math.min(Math.max(0, page), Math.max(0, Math.ceil(books.length / 20) - 1));
  const items = [];
  for (const book of books.slice(index * 20, (index + 1) * 20)) {
    let label;
    try {
      label = tr(ctx.locale, (await ctx.domains.library.queries.books.getTextState(book.id)).status);
    } catch {
      label = tr(ctx.locale, "queryError");
    }
    items.push({
      id: book.id,
      title: book.title,
      subtitle: `${book.format.toUpperCase()} · ${label}`,
      icon: "book-open",
      onSelect: async () => ({ view: await textDetail(ctx, book.id, book.title) })
    });
  }
  const actions = [{
    id: "refresh",
    label: tr(ctx.locale, "refresh"),
    icon: "arrows-clockwise",
    run: async () => ({ view: await textDesk(ctx, index), navigation: "replace" })
  }];
  for (const direction of [-1, 1])
    if (index + direction >= 0 && (index + direction) * 20 < books.length)
      actions.push({
        id: direction < 0 ? "previous" : "next",
        label: tr(ctx.locale, direction < 0 ? "previous" : "next"),
        icon: direction < 0 ? "arrow-left" : "arrow-right",
        run: async () => ({ view: await textDesk(ctx, index + direction), navigation: "replace" })
      });
  return { kind: "list", title: `${tr(ctx.locale, "title")} · ${index + 1}`, items, actions, emptyText: tr(ctx.locale, "empty") };
}

// src/index.ts
var src_default = {
  activate(ctx) {
    if (!ctx.domains.library?.commands || !ctx.domains.reading?.commands)
      throw Error("Text Desk requires library:write and reading:write");
    const title = tr(ctx.locale, "title");
    ctx.contributions.commands.register({ id: "open", title, icon: "book-open", run: async () => ({ view: await textDesk(ctx) }) });
    ctx.contributions.headerActions.register({ id: "reader", title, icon: "book-open", surface: "reader", presentation: "popup", view: () => textDesk(ctx) });
  }
};
export {
  src_default as default
};
