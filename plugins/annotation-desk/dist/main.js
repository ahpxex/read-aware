// src/strings.ts
var locales = ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"];
var strings = {
  title: ["Annotation Desk", "标注整理器", "標註整理器", "注釈デスク", "Аннотации", "Annotations", "Anmerkungen", "Anotaciones"],
  book: ["Book", "书籍", "書籍", "本", "Книга", "Livre", "Buch", "Libro"],
  allBooks: ["All books", "全部书籍", "全部書籍", "すべての本", "Все книги", "Tous les livres", "Alle Bücher", "Todos los libros"],
  kind: ["Type", "类型", "類型", "種類", "Тип", "Type", "Typ", "Tipo"],
  all: ["All types", "全部类型", "全部類型", "すべての種類", "Все типы", "Tous les types", "Alle Typen", "Todos los tipos"],
  note: ["Note", "笔记", "筆記", "ノート", "Заметка", "Note", "Notiz", "Nota"],
  highlight: ["Highlight", "高亮", "螢光標記", "ハイライト", "Выделение", "Surlignage", "Markierung", "Resaltado"],
  ask: ["Question", "提问", "提問", "質問", "Вопрос", "Question", "Frage", "Pregunta"],
  query: ["Search text", "搜索文字", "搜尋文字", "検索語", "Поиск текста", "Rechercher du texte", "Text suchen", "Buscar texto"],
  filter: ["Apply filters", "筛选", "篩選", "絞り込む", "Применить фильтры", "Filtrer", "Filtern", "Filtrar"],
  invalidQuery: ["Use at most 500 characters.", "最多输入 500 个字符。", "最多輸入 500 個字元。", "500 文字以内で入力してください。", "Не более 500 символов.", "500 caractères maximum.", "Maximal 500 Zeichen.", "Máximo 500 caracteres."],
  invalid: ["Choose a valid option.", "请选择有效选项。", "請選擇有效選項。", "有効な項目を選択してください。", "Выберите допустимый вариант.", "Choisissez une option valide.", "Bitte gültige Option wählen.", "Elige una opción válida."],
  empty: ["No annotations", "暂无标注", "暫無標註", "注釈はありません", "Аннотаций нет", "Aucune annotation", "Keine Anmerkungen", "No hay anotaciones"],
  missing: ["Annotation no longer exists.", "这条标注已不存在。", "這則標註已不存在。", "この注釈は削除されました。", "Аннотация больше не существует.", "Cette annotation n’existe plus.", "Diese Anmerkung existiert nicht mehr.", "Esta anotación ya no existe."],
  missingBook: ["Unavailable book", "书籍不可用", "書籍無法使用", "利用できない本", "Книга недоступна", "Livre indisponible", "Buch nicht verfügbar", "Libro no disponible"],
  refresh: ["Refresh", "刷新", "重新整理", "更新", "Обновить", "Actualiser", "Aktualisieren", "Actualizar"],
  previous: ["Previous page", "上一页", "上一頁", "前のページ", "Предыдущая страница", "Page précédente", "Vorherige Seite", "Página anterior"],
  next: ["Next page", "下一页", "下一頁", "次のページ", "Следующая страница", "Page suivante", "Nächste Seite", "Página siguiente"],
  select: ["Select annotations", "选择标注", "選擇標註", "注釈を選択", "Выбрать аннотации", "Sélectionner les annotations", "Anmerkungen auswählen", "Seleccionar anotaciones"],
  review: ["Review selection", "检查所选项", "檢查所選項", "選択を確認", "Проверить выбор", "Vérifier la sélection", "Auswahl prüfen", "Revisar selección"],
  choose: ["Select at least one annotation.", "请至少选择一条标注。", "請至少選擇一則標註。", "注釈を選択してください。", "Выберите хотя бы одну аннотацию.", "Sélectionnez au moins une annotation.", "Mindestens eine Anmerkung auswählen.", "Selecciona al menos una anotación."],
  pageJson: ["Export this page (JSON)", "导出本页（JSON）", "匯出本頁（JSON）", "このページを出力（JSON）", "Экспорт страницы (JSON)", "Exporter cette page (JSON)", "Diese Seite exportieren (JSON)", "Exportar esta página (JSON)"],
  pageCsv: ["Export this page (CSV)", "导出本页（CSV）", "匯出本頁（CSV）", "このページを出力（CSV）", "Экспорт страницы (CSV)", "Exporter cette page (CSV)", "Diese Seite exportieren (CSV)", "Exportar esta página (CSV)"],
  json: ["Export selection (JSON)", "导出所选项（JSON）", "匯出所選項（JSON）", "選択項目を出力（JSON）", "Экспорт выбранного (JSON)", "Exporter la sélection (JSON)", "Auswahl exportieren (JSON)", "Exportar selección (JSON)"],
  csv: ["Export selection (CSV)", "导出所选项（CSV）", "匯出所選項（CSV）", "選択項目を出力（CSV）", "Экспорт выбранного (CSV)", "Exporter la sélection (CSV)", "Auswahl exportieren (CSV)", "Exportar selección (CSV)"],
  exported: ["Export saved", "导出已保存", "匯出已儲存", "保存しました", "Экспорт сохранён", "Export enregistré", "Export gespeichert", "Exportación guardada"],
  open: ["Open in reader", "在阅读器中打开", "在閱讀器中開啟", "リーダーで開く", "Открыть в читалке", "Ouvrir dans le lecteur", "Im Reader öffnen", "Abrir en el lector"],
  save: ["Save", "保存", "儲存", "保存", "Сохранить", "Enregistrer", "Speichern", "Guardar"],
  saved: ["Changes saved", "修改已保存", "修改已儲存", "変更を保存しました", "Изменения сохранены", "Modifications enregistrées", "Änderungen gespeichert", "Cambios guardados"],
  refreshFailed: ["Changes were saved, but annotations could not be reloaded.", "修改已保存，但无法重新读取标注。", "修改已儲存，但無法重新讀取標註。", "変更は保存されましたが、注釈を再読み込みできませんでした。", "Изменения сохранены, но аннотации не удалось загрузить.", "Les modifications sont enregistrées, mais les annotations n’ont pas pu être rechargées.", "Änderungen gespeichert, aber Anmerkungen konnten nicht neu geladen werden.", "Los cambios se guardaron, pero no se pudieron recargar las anotaciones."],
  body: ["Note text", "笔记内容", "筆記內容", "ノート本文", "Текст заметки", "Texte de la note", "Notiztext", "Texto de la nota"],
  bodyLimit: ["Use at most 100,000 characters.", "笔记不能超过 100,000 个字符。", "筆記不能超過 100,000 個字元。", "100,000 文字以内で入力してください。", "Не более 100 000 символов.", "100 000 caractères maximum.", "Maximal 100.000 Zeichen.", "Máximo 100.000 caracteres."],
  color: ["Color", "颜色", "顏色", "色", "Цвет", "Couleur", "Farbe", "Color"],
  yellow: ["Yellow", "黄色", "黃色", "黄", "Жёлтый", "Jaune", "Gelb", "Amarillo"],
  green: ["Green", "绿色", "綠色", "緑", "Зелёный", "Vert", "Grün", "Verde"],
  blue: ["Blue", "蓝色", "藍色", "青", "Синий", "Bleu", "Blau", "Azul"],
  pink: ["Pink", "粉色", "粉紅色", "ピンク", "Розовый", "Rose", "Rosa", "Rosa"],
  style: ["Style", "样式", "樣式", "スタイル", "Стиль", "Style", "Stil", "Estilo"],
  underline: ["Underline", "下划线", "底線", "下線", "Подчёркивание", "Soulignement", "Unterstreichung", "Subrayado"],
  recolor: ["Apply to selected highlights", "应用到所选高亮", "套用至所選標記", "選択したハイライトに適用", "Применить к выделениям", "Appliquer aux surlignages", "Auf Auswahl anwenden", "Aplicar a los resaltados"],
  remove: ["Delete selected annotations", "删除所选标注", "刪除所選標註", "選択した注釈を削除", "Удалить выбранные аннотации", "Supprimer la sélection", "Auswahl löschen", "Eliminar selección"],
  confirm: ["Confirm deletion of these annotations", "确认删除这些标注", "確認刪除這些標註", "これらの注釈の削除を確認", "Подтвердить удаление этих аннотаций", "Confirmer la suppression de ces annotations", "Löschen dieser Anmerkungen bestätigen", "Confirmar eliminación de estas anotaciones"],
  confirmRequired: ["Confirm deletion first.", "请先确认删除。", "請先確認刪除。", "削除を確認してください。", "Сначала подтвердите удаление.", "Confirmez d’abord la suppression.", "Bitte zuerst das Löschen bestätigen.", "Confirma primero la eliminación."],
  conflict: ["An annotation changed or was removed. Nothing was changed. Refresh before trying again.", "标注已被修改或删除，本次未作更改。请刷新后重新检查。", "標註已被修改或刪除，本次未作變更。請重新整理後檢查。", "注釈が変更または削除されました。変更は保存されていません。更新して確認してください。", "Аннотация изменена или удалена. Ничего не изменено. Обновите и проверьте снова.", "Une annotation a changé ou a été supprimée. Aucune modification. Actualisez avant de réessayer.", "Eine Anmerkung wurde geändert oder gelöscht. Nichts wurde geändert. Bitte aktualisieren.", "Una anotación cambió o se eliminó. No se modificó nada. Actualiza antes de reintentar."]
};
function tr(locale, key) {
  const normalized = locale.toLowerCase();
  let index = locales.findIndex((candidate) => candidate.toLowerCase() === normalized);
  if (index < 0)
    index = normalized.startsWith("zh") ? /hant|tw|hk|mo/.test(normalized) ? 2 : 1 : locales.findIndex((candidate) => candidate === normalized.split("-")[0]);
  return strings[key][index < 0 ? 0 : index];
}

// src/types.ts
function assertCapabilities(ctx) {
  if (!ctx.domains.annotations?.commands || !ctx.domains.reading?.commands || !ctx.domains.library) {
    throw new Error("Annotation Desk requires annotations:write, reading:write and library:read");
  }
}

// src/format.ts
function annotationText(item) {
  return item.kind === "note" ? item.body : item.text;
}
function preview(item) {
  const text = annotationText(item).replace(/\s+/g, " ").trim();
  return text.length > 180 ? `${text.slice(0, 179)}…` : text;
}
function subtitle(ctx, item, books) {
  return `${books.get(item.bookId)?.title ?? tr(ctx.locale, "missingBook")} · ${tr(ctx.locale, item.kind)}`;
}
async function readBooks(ctx, items) {
  const books = new Map;
  for (const id of new Set(items.map((item) => item.bookId)))
    books.set(id, await ctx.domains.library.queries.books.get(id));
  return books;
}

// src/export.ts
function csvCell(input) {
  let value = input == null ? "" : String(input);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value))
    value = `'${value}`;
  return `"${value.replace(/"/g, '""')}"`;
}
function annotationExport(items, books, scope, format, at) {
  if (format === "json")
    return JSON.stringify({
      schemaVersion: 1,
      exportedAt: at.toISOString(),
      scope,
      consistency: "observed-items",
      books: [...books.values()].filter((book) => book !== null),
      annotations: items
    }, null, 2);
  const rows = [
    ["id", "kind", "bookId", "bookTitle", "quotedText", "body", "text", "color", "style", "anchor", "chapterHref", "createdAt", "updatedAt"],
    ...items.map((item) => [
      item.id,
      item.kind,
      item.bookId,
      books.get(item.bookId)?.title,
      item.kind === "note" ? item.quotedText : undefined,
      item.kind === "note" ? item.body : undefined,
      item.kind !== "note" ? item.text : undefined,
      item.kind === "highlight" ? item.color : undefined,
      item.kind === "highlight" ? item.style : undefined,
      item.anchor,
      item.chapterHref,
      item.createdAt,
      item.kind !== "ask" ? item.updatedAt : undefined
    ])
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join(`\r
`)}`;
}
async function exportAnnotations(ctx, items, books, scope, format) {
  const at = new Date;
  const saved = await ctx.services.ui.exportFile({
    filename: `readaware-annotations-${at.toISOString().slice(0, 10)}.${format}`,
    content: annotationExport(items, books, scope, format, at),
    mimeType: format === "json" ? "application/json" : "text/csv;charset=utf-8"
  });
  return saved ? { toast: tr(ctx.locale, "exported") } : undefined;
}

// src/mutations.ts
async function commit(ctx, changes, field, refresh) {
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
    return { navigation: "reset", toast: tr(ctx.locale, "saved"), view: { kind: "blocks", blocks: [
      { kind: "text", text: tr(ctx.locale, "refreshFailed") },
      { kind: "actions", actions: [{ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: refresh }] }
    ] } };
  }
}
function colorForm(ctx, snapshots, refresh) {
  const first = snapshots[0].annotation;
  const colors = ["yellow", "green", "blue", "pink"];
  const styles = ["highlight", "underline"];
  return { kind: "form", submitLabel: tr(ctx.locale, snapshots.length > 1 ? "recolor" : "save"), fields: [
    {
      kind: "choice",
      id: "color",
      label: tr(ctx.locale, "color"),
      value: first.kind === "highlight" ? first.color : "yellow",
      options: colors.map((value) => ({ value, label: tr(ctx.locale, value) }))
    },
    {
      kind: "choice",
      id: "style",
      label: tr(ctx.locale, "style"),
      value: first.kind === "highlight" ? first.style : "highlight",
      options: styles.map((value) => ({ value, label: tr(ctx.locale, value) }))
    }
  ], onSubmit: async (values) => {
    const color = colors.find((color2) => color2 === values.color);
    const style = styles.find((style2) => style2 === values.style);
    if (!color || !style)
      return { fieldErrors: { [!color ? "color" : "style"]: tr(ctx.locale, "invalid") } };
    return commit(ctx, snapshots.map(({ annotation, revision }) => ({
      op: "recolorHighlight",
      annotationId: annotation.id,
      expectedRevision: revision,
      color,
      style
    })), "color", refresh);
  } };
}

// src/batch.ts
async function reviewView(ctx, snapshots, refresh) {
  const items = snapshots.map((snapshot) => snapshot.annotation);
  const books = await readBooks(ctx, items);
  return { kind: "blocks", title: `${tr(ctx.locale, "review")} (${items.length})`, blocks: [
    { kind: "list", items: items.map((item) => ({
      id: item.id,
      title: preview(item) || tr(ctx.locale, item.kind),
      subtitle: subtitle(ctx, item, books),
      icon: item.kind === "highlight" ? "highlighter" : item.kind === "note" ? "note-pencil" : "chat-circle-dots"
    })) },
    { kind: "actions", actions: [
      { id: "json", label: tr(ctx.locale, "json"), icon: "download-simple", run: () => exportAnnotations(ctx, items, books, "selection", "json") },
      { id: "csv", label: tr(ctx.locale, "csv"), icon: "download-simple", run: () => exportAnnotations(ctx, items, books, "selection", "csv") },
      { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: refresh }
    ] },
    ...items.every((item) => item.kind === "highlight") ? [colorForm(ctx, snapshots, refresh)] : [],
    {
      kind: "form",
      title: tr(ctx.locale, "remove"),
      submitLabel: tr(ctx.locale, "remove"),
      fields: [{ kind: "checkbox", id: "confirm", label: tr(ctx.locale, "confirm"), value: false }],
      onSubmit: async (values) => {
        if (values.confirm !== true)
          return { fieldErrors: { confirm: tr(ctx.locale, "confirmRequired") } };
        return commit(ctx, snapshots.map(({ annotation, revision }) => ({
          op: "remove",
          annotationId: annotation.id,
          expectedRevision: revision,
          kind: annotation.kind
        })), "confirm", refresh);
      }
    }
  ] };
}
function selectionView(ctx, items, books, refresh) {
  return {
    kind: "form",
    title: tr(ctx.locale, "select"),
    submitLabel: tr(ctx.locale, "review"),
    fields: items.map((item, index) => ({
      kind: "checkbox",
      id: `item-${index}`,
      label: preview(item) || tr(ctx.locale, item.kind),
      description: subtitle(ctx, item, books),
      value: false
    })),
    onSubmit: async (values) => {
      const selected = items.filter((_, index) => values[`item-${index}`] === true);
      if (!selected.length)
        return { fieldErrors: { "item-0": tr(ctx.locale, "choose") } };
      const snapshots = [];
      for (const item of selected) {
        const snapshot = await ctx.domains.annotations.queries.inspect(item.id);
        if (!snapshot)
          return { fieldErrors: { [`item-${items.indexOf(item)}`]: tr(ctx.locale, "missing") } };
        snapshots.push(snapshot);
      }
      return { view: await reviewView(ctx, snapshots, refresh) };
    }
  };
}

// src/detail.ts
async function detailView(ctx, id, refresh) {
  const snapshot = await ctx.domains.annotations.queries.inspect(id);
  if (!snapshot)
    return { kind: "blocks", blocks: [
      { kind: "text", text: tr(ctx.locale, "missing") },
      { kind: "actions", actions: [{ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: refresh }] }
    ] };
  const item = snapshot.annotation;
  const book = await ctx.domains.library.queries.books.get(item.bookId);
  const content = [];
  if (item.kind === "note") {
    if (item.quotedText)
      content.push({ kind: "quote", text: item.quotedText });
    content.push({
      kind: "form",
      fields: [{ kind: "textarea", id: "body", label: tr(ctx.locale, "body"), value: item.body, rows: 8 }],
      submitLabel: tr(ctx.locale, "save"),
      onSubmit: async (values) => {
        if (typeof values.body !== "string" || values.body.length > 1e5)
          return { fieldErrors: { body: tr(ctx.locale, "bodyLimit") } };
        return commit(ctx, [{ op: "updateNote", annotationId: id, expectedRevision: snapshot.revision, body: values.body }], "body", refresh);
      }
    });
  } else {
    content.push({ kind: "quote", text: item.text });
    if (item.kind === "highlight")
      content.push(colorForm(ctx, [snapshot], refresh));
  }
  return {
    kind: "detail",
    title: tr(ctx.locale, item.kind),
    content,
    metadata: [{ kind: "label", label: tr(ctx.locale, "book"), value: book?.title ?? tr(ctx.locale, "missingBook"), icon: "book-open" }],
    actions: [
      ...book ? [{ id: "open", label: tr(ctx.locale, "open"), icon: "book-open", run: async () => {
        await ctx.domains.reading.commands.goTo({ bookId: item.bookId, cfi: item.anchor, href: item.chapterHref });
        return { close: true };
      } }] : [],
      { id: "review", label: tr(ctx.locale, "review"), icon: "list-bullets", run: async () => ({ view: await reviewView(ctx, [snapshot], refresh) }) },
      { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({ view: await detailView(ctx, id, refresh), navigation: "replace" }) }
    ]
  };
}

// src/live-page.ts
var code = (error) => error && typeof error === "object" && ("code" in error) && typeof error.code === "string" ? error.code : "annotations/observation-failed";
async function liveAnnotationPage(ctx, input, render) {
  const query = structuredClone(input);
  const failure = (errorCode) => ({ kind: "detail", title: tr(ctx.locale, "title"), content: [{ kind: "error", code: errorCode }] });
  const content = async (read) => {
    try {
      return { view: await render(await read()), failed: false };
    } catch (error) {
      return { view: failure(code(error)), failed: true, error };
    }
  };
  return { ...(await content(() => ctx.domains.annotations.queries.page(query))).view, live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = ctx.domains.annotations.events.observe({ kind: "page", query }, async (event) => {
      if (disposed)
        return;
      const result = event.status === "error" ? { view: failure(event.errorCode), failed: false } : await content(async () => {
        if (event.result.kind !== "page")
          throw Error("Expected annotation page observation");
        return event.result.page;
      });
      if (disposed)
        return;
      await ctx.services.ui.publishView(channel, { revision: ++revision, view: result.view });
      if (result.failed)
        throw result.error;
    });
    return { dispose() {
      disposed = true;
      subscription.dispose();
    } };
  } } };
}

// src/views.ts
async function filterView(ctx, state) {
  const books = await ctx.domains.library.queries.books.list();
  const kinds = ["highlight", "note", "ask"];
  return { kind: "form", title: tr(ctx.locale, "filter"), submitLabel: tr(ctx.locale, "filter"), fields: [
    {
      kind: "select",
      id: "bookId",
      label: tr(ctx.locale, "book"),
      value: state.bookId ?? "",
      options: [{ value: "", label: tr(ctx.locale, "allBooks") }, ...books.map((book) => ({ value: book.id, label: book.title }))]
    },
    {
      kind: "select",
      id: "kind",
      label: tr(ctx.locale, "kind"),
      value: state.kind ?? "",
      options: [{ value: "", label: tr(ctx.locale, "all") }, ...kinds.map((value) => ({ value, label: tr(ctx.locale, value) }))]
    },
    { kind: "text", id: "query", label: tr(ctx.locale, "query"), value: state.query ?? "" }
  ], onSubmit: async (values) => {
    if (typeof values.query !== "string" || values.query.length > 500)
      return { fieldErrors: { query: tr(ctx.locale, "invalidQuery") } };
    const bookId = String(values.bookId ?? "");
    if (bookId && !books.some((book) => book.id === bookId))
      return { fieldErrors: { bookId: tr(ctx.locale, "invalid") } };
    const kind = kinds.find((kind2) => kind2 === values.kind);
    if (values.kind && !kind)
      return { fieldErrors: { kind: tr(ctx.locale, "invalid") } };
    return { view: await deskView(ctx, { bookId: bookId || undefined, kind, query: values.query.trim() || undefined, previous: [] }), navigation: "reset" };
  } };
}
async function deskView(ctx, state = { previous: [] }) {
  state = structuredClone(state);
  const { previous, ...query } = state;
  return liveAnnotationPage(ctx, { ...query, limit: 20 }, async (page) => {
    const books = await readBooks(ctx, page.items);
    if (state.bookId && !books.has(state.bookId))
      books.set(state.bookId, await ctx.domains.library.queries.books.get(state.bookId));
    const refresh = async () => ({ view: await deskView(ctx, { ...state, cursor: undefined, previous: [] }), navigation: "reset" });
    const actions = [
      { id: "filter", label: tr(ctx.locale, "filter"), icon: "magnifying-glass", run: async () => ({ view: await filterView(ctx, state) }) },
      { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: refresh }
    ];
    if (page.items.length)
      actions.push({ id: "select", label: tr(ctx.locale, "select"), icon: "check", run: () => ({ view: selectionView(ctx, page.items, books, refresh) }) }, ...["json", "csv"].map((format) => ({
        id: format,
        label: tr(ctx.locale, format === "json" ? "pageJson" : "pageCsv"),
        icon: "download-simple",
        run: () => exportAnnotations(ctx, page.items, books, "page", format)
      })));
    if (previous.length)
      actions.push({ id: "previous", label: tr(ctx.locale, "previous"), icon: "arrow-left", run: async () => ({
        view: await deskView(ctx, { ...state, cursor: previous[previous.length - 1], previous: previous.slice(0, -1) }),
        navigation: "replace"
      }) });
    if (page.nextCursor)
      actions.push({ id: "next", label: tr(ctx.locale, "next"), icon: "arrow-right", run: async () => ({
        view: await deskView(ctx, { ...state, cursor: page.nextCursor, previous: [...previous, state.cursor] }),
        navigation: "replace"
      }) });
    return {
      kind: "list",
      title: [
        state.bookId ? books.get(state.bookId)?.title ?? tr(ctx.locale, "missingBook") : tr(ctx.locale, "allBooks"),
        state.kind ? tr(ctx.locale, state.kind) : undefined,
        state.query,
        String(previous.length + 1)
      ].filter(Boolean).join(" · "),
      actions,
      emptyText: tr(ctx.locale, "empty"),
      items: page.items.map((item) => ({
        id: item.id,
        title: preview(item) || tr(ctx.locale, item.kind),
        subtitle: subtitle(ctx, item, books),
        timestamp: item.createdAt,
        icon: item.kind === "highlight" ? "highlighter" : item.kind === "note" ? "note-pencil" : "chat-circle-dots",
        onSelect: async () => ({ view: await detailView(ctx, item.id, refresh) })
      }))
    };
  });
}

// src/index.ts
var plugin = {
  activate(ctx) {
    assertCapabilities(ctx);
    const title = tr(ctx.locale, "title");
    ctx.contributions.headerActions.register({
      id: "shelf",
      title,
      icon: "note-pencil",
      surface: "shelf",
      presentation: "page",
      view: () => deskView(ctx)
    });
    ctx.contributions.headerActions.register({
      id: "reader",
      title,
      icon: "note-pencil",
      surface: "reader",
      presentation: "popup",
      view: (input) => deskView(ctx, { bookId: input.book?.id, previous: [] })
    });
    ctx.contributions.commands.register({
      id: "open",
      title,
      icon: "note-pencil",
      keywords: "annotation note highlight organize export",
      run: async () => {
        const session = await ctx.domains.reading.queries.session();
        return { view: await deskView(ctx, { bookId: session.bookId ?? undefined, previous: [] }) };
      }
    });
  }
};
var src_default = plugin;
export {
  src_default as default
};
