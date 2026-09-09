// src/strings.ts
var locales = ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"];
var labels = {
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
    } }
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
    if (!ctx.domains.library || !ctx.domains.reading?.commands)
      throw Error("Text Desk requires library:read and reading:write");
    const title = tr(ctx.locale, "title");
    ctx.contributions.commands.register({ id: "open", title, icon: "book-open", run: async () => ({ view: await textDesk(ctx) }) });
    ctx.contributions.headerActions.register({ id: "reader", title, icon: "book-open", surface: "reader", presentation: "popup", view: () => textDesk(ctx) });
  }
};
export {
  src_default as default
};
