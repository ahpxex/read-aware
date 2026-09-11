// src/types.ts
function assertCapabilities(ctx) {
  if (!ctx.domains.library || !ctx.domains.reading?.commands)
    throw new Error("Jumper requires library:read and reading:write");
}

// src/chapters.ts
function flattenToc(entries) {
  return entries.flatMap((entry) => [entry, ...flattenToc(entry.children)]);
}
function chapterNumber(value) {
  const normalized = value.normalize("NFKC").trim();
  if (/^\d+$/.test(normalized)) {
    const number = Number(normalized);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }
  if (!/^[零〇一二两兩三四五六七八九十百千万萬]+$/.test(normalized))
    return null;
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000, 万: 1e4, 萬: 1e4 };
  if ([...normalized].every((char) => (char in digits))) {
    const number = Number([...normalized].map((char) => digits[char]).join(""));
    return number > 0 && Number.isSafeInteger(number) ? number : null;
  }
  let total = 0, section = 0, digit = 0;
  for (const char of normalized) {
    if (char in digits)
      digit = digits[char];
    else if (units[char] === 1e4) {
      total += (section + digit || 1) * 1e4;
      section = 0;
      digit = 0;
    } else {
      section += (digit || 1) * units[char];
      digit = 0;
    }
  }
  return total + section + digit || null;
}
function printedNumber(label) {
  const text = label.normalize("NFKC").trim();
  const match = text.match(/^第\s*([\d零〇一二两兩三四五六七八九十百千万萬]+)\s*[章节章節回]/u) ?? text.match(/^(?:chapter|chapitre|kapitel|capítulo|глава)\s+(\d+)\b/iu) ?? text.match(/^(\d+)(?:[.)、:\s]|$)/u);
  return match ? chapterNumber(match[1]) : null;
}
function findChapters(entries, query, mode) {
  const all = flattenToc(entries);
  const number = chapterNumber(query);
  if (mode === "ordinal")
    return number === null ? [] : all.filter((entry) => entry.ordinal === number);
  if (number !== null)
    return all.filter((entry) => printedNumber(entry.label) === number);
  const title = query.normalize("NFKC").trim().toLocaleLowerCase();
  return title ? all.filter((entry) => entry.label.normalize("NFKC").toLocaleLowerCase().includes(title)) : [];
}

// src/strings.ts
var locales = ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"];
var strings = {
  searching: ["Searching", "搜索中", "搜尋中", "検索中", "Поиск", "Recherche en cours", "Suche läuft", "Buscando"],
  cancel: ["Cancel", "取消", "取消", "キャンセル", "Отмена", "Annuler", "Abbrechen", "Cancelar"],
  cancelled: ["Search cancelled.", "搜索已取消。", "搜尋已取消。", "検索をキャンセルしました。", "Поиск отменён.", "Recherche annulée.", "Suche abgebrochen.", "Búsqueda cancelada."],
  mode: ["Search in", "查找范围", "查找範圍", "検索対象", "Искать в", "Rechercher dans", "Suchen in", "Buscar en"],
  chapter: ["Chapter", "章节", "章節", "章", "Глава", "Chapitre", "Kapitel", "Capítulo"],
  ordinal: ["TOC order", "目录序号", "目錄序號", "目次の順番", "Порядок оглавления", "Ordre du sommaire", "Inhaltsreihenfolge", "Orden del índice"],
  text: ["Book text", "正文", "正文", "本文", "Текст книги", "Texte du livre", "Buchtext", "Texto del libro"],
  query: ["Number, title, or text", "章节号、标题或文字", "章節號、標題或文字", "番号・見出し・文字列", "Номер, заголовок или текст", "Numéro, titre ou texte", "Nummer, Titel oder Text", "Número, título o texto"],
  search: ["Find", "查找", "查找", "検索", "Найти", "Rechercher", "Suchen", "Buscar"],
  back: ["Go back", "后退", "後退", "戻る", "Назад", "Reculer", "Zurück", "Atrás"],
  forward: ["Go forward", "前进", "前進", "進む", "Вперёд", "Avancer", "Vorwärts", "Adelante"],
  matchCase: ["Match case", "区分大小写", "區分大小寫", "大文字と小文字を区別", "Учитывать регистр", "Respecter la casse", "Groß-/Kleinschreibung", "Distinguir mayúsculas"],
  wholeWords: ["Whole words", "全词匹配", "全詞匹配", "単語全体", "Слова целиком", "Mots entiers", "Ganze Wörter", "Palabras completas"],
  invalid: ["Enter 1 to 500 characters.", "请输入 1 至 500 个字符。", "請輸入 1 至 500 個字元。", "1〜500文字を入力してください。", "Введите от 1 до 500 символов.", "Saisissez de 1 à 500 caractères.", "1 bis 500 Zeichen eingeben.", "Introduce entre 1 y 500 caracteres."],
  missing: ["Chapter not found.", "该章节不存在。", "該章節不存在。", "章が見つかりません。", "Глава не найдена.", "Chapitre introuvable.", "Kapitel nicht gefunden.", "Capítulo no encontrado."],
  unavailable: ["This heading has no reading location.", "此目录标题没有可跳转的位置。", "此目錄標題沒有可跳轉的位置。", "この見出しには移動先がありません。", "У этого заголовка нет позиции для перехода.", "Ce titre n'a pas de destination.", "Diese Überschrift hat kein Sprungziel.", "Este título no tiene destino."],
  noBook: ["No book is open.", "当前没有打开的书籍。", "目前沒有開啟的書籍。", "本が開かれていません。", "Книга не открыта.", "Aucun livre ouvert.", "Kein Buch geöffnet.", "No hay ningún libro abierto."],
  noHits: ["No matches.", "没有匹配结果。", "沒有符合的結果。", "一致する結果はありません。", "Совпадений нет.", "Aucun résultat.", "Keine Treffer.", "Sin coincidencias."],
  more: ["Continue search", "继续搜索", "繼續搜尋", "検索を続ける", "Продолжить поиск", "Continuer la recherche", "Suche fortsetzen", "Continuar búsqueda"],
  pending: ["No matches in this batch.", "本批次没有匹配结果。", "本批次沒有符合的結果。", "この範囲に一致する結果はありません。", "В этой части совпадений нет.", "Aucun résultat dans cette partie.", "Keine Treffer in diesem Abschnitt.", "Sin coincidencias en esta parte."],
  textless: ["This book has no searchable text.", "这本书没有可搜索的文本。", "這本書沒有可搜尋的文字。", "この本には検索可能なテキストがありません。", "В книге нет текста для поиска.", "Ce livre ne contient aucun texte consultable.", "Dieses Buch enthält keinen durchsuchbaren Text.", "Este libro no tiene texto que buscar."],
  unsupported: ["Text search is unavailable for some or all sections.", "部分或全部内容暂不支持文本搜索。", "部分或全部內容暫不支援文字搜尋。", "一部または全部の内容でテキスト検索が利用できません。", "Поиск недоступен для части или всей книги.", "La recherche est indisponible pour tout ou partie du livre.", "Die Textsuche ist für Teile oder das gesamte Buch nicht verfügbar.", "La búsqueda no está disponible en parte o todo el libro."]
};
function tr(locale, key) {
  const exact = locales.findIndex((value) => value.toLowerCase() === locale.toLowerCase());
  const base = locales.findIndex((value) => value === locale.split("-")[0]);
  return strings[key][exact >= 0 ? exact : base >= 0 ? base : 0];
}

// src/text-search.ts
function textSearchView(ctx, input) {
  const controller = new AbortController;
  let channel, revision = 0, started = false, pending = true;
  const retry = {
    id: "retry",
    label: tr(ctx.locale, "search"),
    icon: "magnifying-glass",
    run: () => ({ view: textSearchView(ctx, input), navigation: "replace" })
  };
  const cancelled = () => ({
    kind: "list",
    title: input.query,
    items: [],
    emptyText: tr(ctx.locale, "cancelled"),
    actions: [retry]
  });
  const stop = () => {
    controller.abort();
    if (pending) {
      pending = false;
      current = cancelled();
    }
  };
  let current = { kind: "blocks", title: input.query, blocks: [
    { kind: "progress", value: null, label: tr(ctx.locale, "searching"), cancel: {
      id: "cancel",
      label: tr(ctx.locale, "cancel"),
      run: async () => {
        stop();
        await publish();
      }
    } }
  ] };
  const publish = async () => {
    if (!channel)
      return;
    const target = channel;
    try {
      const receipt = await ctx.services.ui.publishView(target, { revision: ++revision, view: current });
      if (receipt.status === "inactive" && channel === target) {
        channel = undefined;
        stop();
      }
    } catch (error) {
      console.warn("Jumper search view publication failed", error);
      if (channel === target) {
        channel = undefined;
        stop();
      }
    }
  };
  const search = async () => {
    await publish();
    if (controller.signal.aborted)
      return;
    try {
      const page = await ctx.domains.library.queries.books.searchLocations(input, { signal: controller.signal });
      if (controller.signal.aborted)
        return;
      const result = {
        kind: "list",
        title: input.query,
        emptyText: tr(ctx.locale, page.nextCursor ? "pending" : page.textStatus === "textless" ? "textless" : page.textStatus === "unsupported" || page.textStatus === "partial" ? "unsupported" : "noHits"),
        items: page.hits.map((hit) => ({
          id: hit.id,
          title: hit.excerpt.pre + hit.excerpt.match + hit.excerpt.post,
          icon: "magnifying-glass",
          onSelect: async () => {
            await ctx.domains.reading.commands.goTo(hit.location);
            return { close: true };
          }
        })),
        actions: page.nextCursor ? [{ id: "more", label: tr(ctx.locale, "more"), icon: "arrow-right", run: () => ({
          view: textSearchView(ctx, { ...input, contentVersion: page.contentVersion, cursor: page.nextCursor })
        }) }] : []
      };
      current = result;
    } catch (error) {
      if (controller.signal.aborted)
        return;
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "library/content-unavailable";
      const retryable = ["db/locked", "library/text-extraction-failed", "library/text-busy"].includes(code);
      current = { kind: "blocks", title: input.query, blocks: [
        { kind: "error", code },
        ...retryable ? [{ kind: "actions", actions: [retry] }] : []
      ] };
    }
    pending = false;
    await publish();
  };
  return { ...current, onClose: stop, live: { subscribe(next) {
    channel = next;
    if (!started) {
      started = true;
      search();
    } else
      publish();
    return { dispose() {
      if (channel === next) {
        channel = undefined;
        stop();
      }
    } };
  } } };
}

// src/navigation-strings.ts
var en = {
  navigation: "Navigation",
  sections: "Source sections",
  pages: "Book page labels",
  section: "Source section",
  page: "Page label",
  screen: "Screen in this section",
  empty: "No matching targets",
  absent: "Page labels unavailable",
  unlocated: "No reading location",
  number: "Section number",
  jump: "Go",
  invalidSection: "Enter an existing positive section number",
  invalidLabel: "Enter a page label of 1-300 characters",
  findPage: "Find page label",
  refresh: "Refresh",
  nonLinear: "Non-linear section",
  next: "Next screen",
  previous: "Previous screen",
  "next-section": "Next source section",
  "previous-section": "Previous source section",
  "next-chapter": "Next TOC heading",
  "previous-chapter": "Previous TOC heading",
  start: "Start of book",
  end: "End of book"
};
var zh = {
  navigation: "导航",
  sections: "源分节",
  pages: "原书页码",
  section: "源分节",
  page: "页码标签",
  screen: "本分节屏幕页",
  empty: "没有匹配目标",
  absent: "暂无可用的页码标签",
  unlocated: "没有可跳转的位置",
  number: "分节序号",
  jump: "跳转",
  invalidSection: "请输入存在的正整数分节序号",
  invalidLabel: "请输入 1-300 个字符的页码标签",
  findPage: "查找页码标签",
  refresh: "刷新",
  nonLinear: "非线性分节",
  next: "下一屏",
  previous: "上一屏",
  "next-section": "下一源分节",
  "previous-section": "上一源分节",
  "next-chapter": "下一目录标题",
  "previous-chapter": "上一目录标题",
  start: "书首",
  end: "书尾"
};
var navigationWords = (locale) => locale === "zh-Hans" ? zh : en;

// src/navigation.ts
var steps = [
  { id: "previous", icon: "arrow-left" },
  { id: "next", icon: "arrow-right" },
  { id: "previous-section", icon: "skip-back" },
  { id: "next-section", icon: "skip-forward" },
  { id: "previous-chapter", icon: "caret-left" },
  { id: "next-chapter", icon: "caret-right" },
  { id: "start", icon: "arrow-line-left" },
  { id: "end", icon: "arrow-line-right" }
];
async function navigate(ctx, target) {
  await ctx.domains.reading.commands.goTo(target);
  return { close: true };
}
async function navigationView(ctx) {
  const t = navigationWords(ctx.locale), session = await ctx.domains.reading.queries.session();
  if (session.status !== "ready" || !session.bookId || !session.sessionId || !session.location) {
    throw Object.assign(Error("Navigation requires a ready reader"), { code: "reader/unavailable" });
  }
  const source = { bookId: session.bookId, contentVersion: session.location.contentVersion };
  const guard = { bookId: session.bookId, sessionId: session.sessionId };
  const pagination = session.pagination;
  return { kind: "detail", title: t.navigation, content: [
    ...pagination ? [{ kind: "keyValue", rows: [
      { label: t.section, value: `${pagination.section.index + 1} / ${pagination.section.count}` },
      ...pagination.screen ? [{ label: t.screen, value: `${pagination.screen.index + 1} / ${pagination.screen.count}` }] : []
    ] }] : [],
    { kind: "list", items: [
      { id: "sections", title: t.sections, icon: "list-bullets", onSelect: async () => ({ view: await navigationTargets(ctx, source, "sections") }) },
      { id: "pages", title: t.pages, icon: "files", onSelect: async () => ({ view: await navigationTargets(ctx, source, "pages") }) },
      ...steps.map((step) => ({ id: step.id, title: t[step.id], icon: step.icon, onSelect: async () => {
        await ctx.domains.reading.commands.step(step.id, guard);
        return { close: true };
      } }))
    ] }
  ], actions: [{ id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await navigationView(ctx), navigation: "replace" }) }] };
}
async function navigationTargets(ctx, source, kind, offsets = [0], label) {
  const t = navigationWords(ctx.locale);
  const page = await ctx.domains.library.queries.books.listNavigationTargets({
    ...source,
    kind,
    offset: offsets[offsets.length - 1],
    limit: 40,
    ...label === undefined ? {} : { label }
  });
  const go = async (next) => ({ view: await navigationTargets(ctx, source, kind, next, label), navigation: "replace" });
  return {
    kind: "list",
    title: kind === "sections" ? t.sections : t.pages,
    emptyText: page.status === "absent" ? t.absent : t.empty,
    items: page.items.map((item) => ({
      id: String(item.index),
      title: item.label ? `${item.label}${item.labelTruncated ? "..." : ""}` : `${kind === "sections" ? t.section : t.page} ${item.index + 1}`,
      icon: "file-text",
      subtitle: [item.location ? "" : t.unlocated, item.linear === false ? t.nonLinear : ""].filter(Boolean).join(" / "),
      ...item.location ? { onSelect: () => navigate(ctx, item.location) } : {}
    })),
    actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => {
        const toc = await ctx.domains.library.queries.books.getNavigationToc(source.bookId);
        return { view: await navigationTargets(ctx, { bookId: toc.bookId, contentVersion: toc.contentVersion }, kind, [0], label), navigation: "replace" };
      } },
      ...page.status === "available" && (kind === "pages" || page.total > 0) ? [{ id: "find", label: kind === "sections" ? t.number : t.findPage, icon: "magnifying-glass", run: () => ({ view: kind === "sections" ? {
        kind: "form",
        title: t.sections,
        submitLabel: t.jump,
        fields: [{ id: "number", kind: "number", label: t.number, min: 1, max: page.total, step: 1 }],
        onSubmit: async (values) => {
          const number = values.number;
          if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1 || number > page.total)
            return { fieldErrors: { number: t.invalidSection } };
          return navigate(ctx, { ...source, sectionIndex: number - 1 });
        }
      } : {
        kind: "form",
        title: t.findPage,
        submitLabel: t.jump,
        fields: [{ id: "label", kind: "text", label: t.page, value: label ?? "" }],
        onSubmit: async (values) => {
          if (typeof values.label !== "string" || !values.label.trim() || values.label.length > 300)
            return { fieldErrors: { label: t.invalidLabel } };
          return { view: await navigationTargets(ctx, source, "pages", [0], values.label) };
        }
      } }) }] : []
    ],
    pagination: {
      page: offsets.length,
      ...offsets.length > 1 ? { onPrevious: () => go(offsets.slice(0, -1)) } : {},
      ...page.nextOffset === null ? {} : { onNext: () => go([...offsets, page.nextOffset]) }
    }
  };
}

// src/bookmarks.ts
var BOOKMARKS = "bookmarks";
var bookmarkCollection = (ctx) => ctx.services.storage.collection(BOOKMARKS);
var object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
var text = (value, max) => typeof value === "string" && Boolean(value.trim()) && value.length <= max;
function bookmarkName(value) {
  return text(value, 120) ? value.trim() : null;
}
function targetOf(raw) {
  if (!object(raw) || !text(raw.bookId, 512) || !text(raw.contentVersion, 256))
    return null;
  const target = { bookId: raw.bookId, contentVersion: raw.contentVersion };
  if (raw.cfi !== undefined) {
    if (!text(raw.cfi, 8192))
      return null;
    target.cfi = raw.cfi;
  } else if (raw.href !== undefined) {
    if (!text(raw.href, 8192))
      return null;
    target.href = raw.href;
  } else if (typeof raw.fraction === "number" && Number.isFinite(raw.fraction) && raw.fraction >= 0 && raw.fraction <= 1)
    target.fraction = raw.fraction;
  else
    return null;
  if (raw.textQuote !== undefined) {
    const quote = raw.textQuote;
    if (!object(quote) || !text(quote.exact, 12000))
      return null;
    target.textQuote = { exact: quote.exact };
    for (const key of ["prefix", "suffix"])
      if (quote[key] !== undefined) {
        if (typeof quote[key] !== "string" || quote[key].length > 2000)
          return null;
        target.textQuote[key] = quote[key];
      }
  }
  return target;
}
function parseBookmark(value) {
  if (!object(value) || value.version !== 1 || !bookmarkName(value.name) || !text(value.bookTitle, 500) || value.kind !== "location" && value.kind !== "selection")
    return null;
  const target = targetOf(value.target);
  if (!target || value.kind === "selection" && !target.cfi)
    return null;
  return { version: 1, name: bookmarkName(value.name), bookTitle: value.bookTitle, kind: value.kind, target };
}
async function captureBookmark(ctx, kind) {
  const session = await ctx.domains.reading.queries.session();
  if (session.status !== "ready" || !session.bookId || !session.location) {
    throw Object.assign(Error("Bookmark requires a ready reader"), { code: "reader/unavailable" });
  }
  const target = targetOf(kind === "selection" ? session.selection?.range : session.location);
  if (!target || target.bookId !== session.bookId || target.contentVersion !== session.location.contentVersion) {
    throw Object.assign(Error("Bookmark location is unavailable"), { code: "reader/stale-location" });
  }
  const selectionName = session.selection?.text.trim().slice(0, 120);
  const book = await ctx.domains.library.queries.books.get(target.bookId);
  if (!book)
    throw Object.assign(Error("Bookmark book missing"), { code: "library/book-not-found" });
  const bookTitle = book.title.trim().slice(0, 500) || book.id;
  return {
    version: 1,
    name: (kind === "selection" ? selectionName : bookTitle.slice(0, 120)) || bookTitle.slice(0, 120),
    bookTitle,
    kind,
    target
  };
}
async function writeBookmark(ctx, id, data, expectedRevision) {
  return ctx.services.storage.applyDocuments([{
    kind: "put",
    collection: BOOKMARKS,
    id,
    data,
    bookId: data.target.bookId,
    ...data.target.cfi ? { anchor: data.target.cfi } : {},
    expectedRevision
  }]);
}
async function removeBookmark(ctx, doc) {
  return ctx.services.storage.applyDocuments([{ kind: "delete", collection: BOOKMARKS, id: doc.id, expectedRevision: doc.revision }]);
}
async function openBookmark(ctx, bookmark) {
  if (!await ctx.domains.library.queries.books.get(bookmark.target.bookId)) {
    throw Object.assign(Error("Bookmark book missing"), { code: "library/book-not-found" });
  }
  await ctx.domains.reading.commands.goTo(structuredClone(bookmark.target));
  return { close: true };
}

// src/bookmark-strings.ts
var en2 = {
  title: "Bookmarks",
  empty: "No bookmarks",
  name: "Name",
  save: "Save bookmark",
  saved: "Bookmark saved",
  current: "Bookmark current location",
  selection: "Bookmark selection",
  location: "Reading location",
  range: "Selected passage",
  open: "Go to bookmark",
  rename: "Rename",
  renamed: "Bookmark renamed",
  remove: "Delete bookmark",
  removed: "Bookmark deleted",
  confirm: "Delete this bookmark",
  invalidName: "Enter a name of 1-120 characters.",
  required: "Confirm deletion.",
  invalid: "Bookmark data unavailable",
  missing: "Bookmark no longer exists",
  stale: "Bookmarks changed. Refresh the list.",
  conflict: "This bookmark changed. Refresh before trying again.",
  refresh: "Refresh",
  all: "All books",
  thisBook: "Current book",
  version: "Source version",
  book: "Book",
  kind: "Type"
};
var zh2 = {
  title: "书签",
  empty: "暂无书签",
  name: "名称",
  save: "保存书签",
  saved: "书签已保存",
  current: "收藏当前位置",
  selection: "收藏选区",
  location: "阅读位置",
  range: "选中段落",
  open: "跳转到书签",
  rename: "重命名",
  renamed: "书签已重命名",
  remove: "删除书签",
  removed: "书签已删除",
  confirm: "删除这条书签",
  invalidName: "请输入 1-120 个字符的名称。",
  required: "请确认删除。",
  invalid: "书签数据不可用",
  missing: "书签已不存在",
  stale: "书签列表已变化，请刷新。",
  conflict: "这条书签已变化，请刷新后再试。",
  refresh: "刷新",
  all: "全部书籍",
  thisBook: "当前书籍",
  version: "内容版本",
  book: "书籍",
  kind: "类型"
};
var bookmarkCopy = (locale) => locale.startsWith("zh") ? zh2 : en2;

// src/live-bookmarks.ts
async function liveBookmarks(ctx, query, read, render) {
  const failure = (errorCode) => ({
    kind: "detail",
    title: bookmarkCopy(ctx.locale).title,
    content: [{ kind: "error", code: errorCode }],
    actions: [{
      id: "refresh",
      label: bookmarkCopy(ctx.locale).refresh,
      icon: "arrows-clockwise",
      run: async () => ({ view: await liveBookmarks(ctx, query, read, render), navigation: "replace" })
    }]
  });
  const code = (error) => error && typeof error === "object" && ("code" in error) && typeof error.code === "string" ? error.code : "ipc/unknown";
  const content = async (result) => {
    try {
      return await render(result);
    } catch (error) {
      return failure(code(error));
    }
  };
  let initial;
  try {
    initial = await content(await read());
  } catch (error) {
    initial = failure(code(error));
  }
  return { ...initial, live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = ctx.services.storage.observeDocuments(query, async (event) => {
      if (disposed)
        return;
      const view = event.status === "ready" ? await content(event.result) : failure(event.errorCode);
      if (!disposed)
        await ctx.services.ui.publishView(channel, { revision: ++revision, view });
    });
    return { dispose() {
      disposed = true;
      subscription.dispose();
    } };
  } } };
}

// src/bookmark-views.ts
function message(ctx, text2) {
  const t = bookmarkCopy(ctx.locale);
  return { kind: "detail", title: t.title, content: [{ kind: "text", text: text2 }], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await bookmarksView(ctx), navigation: "reset" }) }
  ] };
}
function nameForm(ctx, data, id, expectedRevision) {
  const t = bookmarkCopy(ctx.locale);
  return {
    kind: "form",
    title: data.bookTitle,
    submitLabel: expectedRevision === null ? t.save : t.rename,
    fields: [{ id: "name", kind: "text", label: t.name, value: data.name }],
    onSubmit: async (values) => {
      const name = bookmarkName(values.name);
      if (!name)
        return { fieldErrors: { name: t.invalidName } };
      const receipt = await writeBookmark(ctx, id, { ...data, name }, expectedRevision);
      return { view: message(ctx, receipt.status === "conflict" ? t.conflict : expectedRevision === null ? t.saved : t.renamed), navigation: "replace" };
    }
  };
}
async function saveBookmarkView(ctx, kind) {
  const data = await captureBookmark(ctx, kind), t = bookmarkCopy(ctx.locale);
  return { kind: "blocks", blocks: [
    { kind: "text", text: kind === "selection" ? t.range : t.location },
    nameForm(ctx, data, crypto.randomUUID(), null)
  ] };
}
function deleteForm(ctx, doc) {
  const t = bookmarkCopy(ctx.locale), bookmark = parseBookmark(doc.data);
  return {
    kind: "form",
    title: bookmark?.name ?? t.invalid,
    submitLabel: t.remove,
    fields: [{ id: "confirm", kind: "checkbox", label: t.confirm, value: false }],
    onSubmit: async (values) => {
      if (values.confirm !== true)
        return { fieldErrors: { confirm: t.required } };
      const receipt = await removeBookmark(ctx, doc);
      return { view: message(ctx, receipt.status === "conflict" ? t.conflict : t.removed), navigation: "replace" };
    }
  };
}
async function bookmarkDetail(ctx, id) {
  const t = bookmarkCopy(ctx.locale);
  return liveBookmarks(ctx, { kind: "get", collection: BOOKMARKS, id }, async () => ({ kind: "get", document: await bookmarkCollection(ctx).get(id) }), async (result) => {
    if (result.kind !== "get")
      throw Error("Expected bookmark document");
    const doc = result.document;
    if (!doc)
      return message(ctx, t.missing);
    const bookmark = parseBookmark(doc.data);
    return {
      kind: "detail",
      title: bookmark?.name ?? t.invalid,
      content: bookmark ? [{ kind: "keyValue", rows: [
        { label: t.book, value: bookmark.bookTitle },
        { label: t.kind, value: bookmark.kind === "selection" ? t.range : t.location },
        { label: t.version, value: bookmark.target.contentVersion }
      ] }] : [{ kind: "text", text: t.invalid }],
      actions: [
        ...bookmark ? [
          { id: "open", label: t.open, icon: "arrow-right", run: () => openBookmark(ctx, bookmark) },
          { id: "rename", label: t.rename, icon: "pencil-simple", run: () => ({ view: nameForm(ctx, bookmark, doc.id, doc.revision) }) }
        ] : [],
        { id: "remove", label: t.remove, icon: "trash", run: () => ({ view: deleteForm(ctx, doc) }) },
        { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await bookmarkDetail(ctx, id), navigation: "replace" }) }
      ]
    };
  });
}
async function bookmarksView(ctx, bookId, cursors = [undefined]) {
  const t = bookmarkCopy(ctx.locale);
  const filter = { bookId, limit: 40, cursor: cursors[cursors.length - 1] };
  return liveBookmarks(ctx, { kind: "page", collection: BOOKMARKS, filter }, async () => ({ kind: "page", page: await bookmarkCollection(ctx).page(filter) }), async (result) => {
    if (result.kind !== "page")
      throw Error("Expected bookmark page");
    const page = result.page;
    if (page.status === "stale-cursor")
      return message(ctx, t.stale);
    const session = await ctx.domains.reading.queries.session();
    const ready = session.status === "ready" && session.location && session.bookId;
    const next = async (values) => ({ view: await bookmarksView(ctx, bookId, values), navigation: "replace" });
    return {
      kind: "list",
      title: t.title,
      emptyText: t.empty,
      searchable: true,
      items: page.items.map((doc) => {
        const bookmark = parseBookmark(doc.data);
        return {
          id: doc.id,
          title: bookmark?.name ?? t.invalid,
          subtitle: bookmark?.bookTitle,
          timestamp: doc.updatedAt,
          icon: "book-bookmark",
          onSelect: async () => ({ view: await bookmarkDetail(ctx, doc.id) })
        };
      }),
      actions: [
        { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: () => next([undefined]) },
        ...ready ? [
          { id: "save-location", label: t.current, icon: "plus", run: async () => ({ view: await saveBookmarkView(ctx, "location") }) },
          ...session.selection?.range ? [{ id: "save-selection", label: t.selection, icon: "highlighter", run: async () => ({ view: await saveBookmarkView(ctx, "selection") }) }] : []
        ] : [],
        ...bookId ? [{ id: "all", label: t.all, icon: "books", run: async () => ({ view: await bookmarksView(ctx), navigation: "replace" }) }] : ready ? [{ id: "this-book", label: t.thisBook, icon: "book-open", run: async () => ({ view: await bookmarksView(ctx, session.bookId), navigation: "replace" }) }] : []
      ],
      pagination: {
        page: cursors.length,
        ...cursors.length > 1 ? { onPrevious: () => next(cursors.slice(0, -1)) } : {},
        ...page.nextCursor ? { onNext: () => next([...cursors, page.nextCursor]) } : {}
      }
    };
  });
}

// src/views.ts
async function jump(ctx, location) {
  await ctx.domains.reading.commands.goTo(location);
  return { close: true };
}
function chapterResults(ctx, entries) {
  return { kind: "list", items: entries.map((entry) => ({
    id: entry.id,
    title: entry.label || String(entry.ordinal),
    icon: "book-open",
    subtitle: `${tr(ctx.locale, "ordinal")}: ${entry.ordinal}`,
    ...entry.location ? { onSelect: () => jump(ctx, entry.location) } : { subtitle: tr(ctx.locale, "unavailable") }
  })) };
}
async function jumperView(ctx) {
  const session = await ctx.domains.reading.queries.session();
  if (!session.bookId)
    return { kind: "list", items: [], emptyText: tr(ctx.locale, "noBook") };
  const bookId = session.bookId;
  const form = {
    kind: "form",
    submitLabel: tr(ctx.locale, "search"),
    fields: [
      { kind: "choice", id: "mode", label: tr(ctx.locale, "mode"), value: "chapter", options: [
        { value: "chapter", label: tr(ctx.locale, "chapter"), icon: "book-open" },
        { value: "ordinal", label: tr(ctx.locale, "ordinal"), icon: "list-bullets" },
        { value: "text", label: tr(ctx.locale, "text"), icon: "magnifying-glass" }
      ] },
      { kind: "text", id: "query", label: tr(ctx.locale, "query") },
      { kind: "checkbox", id: "matchCase", label: tr(ctx.locale, "matchCase"), value: false, visibleWhen: { field: "mode", equals: "text" } },
      { kind: "checkbox", id: "wholeWords", label: tr(ctx.locale, "wholeWords"), value: false, visibleWhen: { field: "mode", equals: "text" } }
    ],
    onSubmit: async (values) => {
      const query = String(values.query ?? "").trim();
      if (!query || query.length > 500)
        return { fieldErrors: { query: tr(ctx.locale, "invalid") } };
      if (values.mode === "text")
        return { view: textSearchView(ctx, {
          bookId,
          query,
          limit: 20,
          matchCase: values.matchCase === true,
          wholeWords: values.wholeWords === true
        }) };
      const toc = await ctx.domains.library.queries.books.getNavigationToc(bookId);
      const entries = findChapters(toc.entries, query, values.mode === "ordinal" ? "ordinal" : "chapter");
      if (!entries.length)
        return { fieldErrors: { query: tr(ctx.locale, "missing") } };
      if (entries.length === 1)
        return entries[0].location ? jump(ctx, entries[0].location) : { fieldErrors: { query: tr(ctx.locale, "unavailable") } };
      return { view: chapterResults(ctx, entries) };
    }
  };
  const actions = [];
  const guard = { sessionId: session.sessionId ?? undefined };
  for (const direction of ["back", "forward"]) {
    if (!(direction === "back" ? session.history.canGoBack : session.history.canGoForward))
      continue;
    actions.push({
      id: direction,
      label: tr(ctx.locale, direction),
      icon: direction === "back" ? "arrow-left" : "arrow-right",
      run: async () => {
        await ctx.domains.reading.commands[direction](guard);
        return { close: true };
      }
    });
  }
  return { kind: "blocks", blocks: [
    ...actions.length ? [{ kind: "actions", actions }] : [],
    form,
    { kind: "actions", actions: [
      {
        id: "navigation",
        label: navigationWords(ctx.locale).navigation,
        icon: "list-bullets",
        run: async () => ({ view: await navigationView(ctx) })
      },
      { id: "bookmarks", label: bookmarkCopy(ctx.locale).title, icon: "book-bookmark", run: async () => ({ view: await bookmarksView(ctx) }) }
    ] }
  ] };
}

// src/bookmark-tools.ts
var invalid = () => {
  throw Object.assign(Error("Invalid bookmark tool input"), { code: "plugin/invalid-input" });
};
function fields(params, allowed) {
  if (Object.keys(params).some((key) => !allowed.includes(key)))
    invalid();
}
function text2(value, max = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    return invalid();
  return value;
}
function kind(value) {
  if (value !== "location" && value !== "selection")
    return invalid();
  return value;
}
async function locationToken(bookmark) {
  const bytes = new TextEncoder().encode(JSON.stringify({ kind: bookmark.kind, target: bookmark.target }));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `bm1:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
var string = (maxLength = 512) => ({ type: "string", minLength: 1, maxLength });
function registerBookmarkTools(ctx) {
  if (!ctx.contributions.agentTools)
    throw Error("Jumper requires agent:tools");
  ctx.contributions.agentTools.register({
    name: "list_bookmarks",
    label: "List bookmarks",
    contexts: ["global"],
    description: "List a bounded page of Jumper bookmarks, optionally for an exact bookId. Returns ids and revisions for subsequent approved operations, not source text or raw locators. Keep the same book filter and returned cursor when paging. Any collection write invalidates the cursor: restart on stale-cursor. Invalid entries may be explicitly deleted, not opened or renamed.",
    parameters: { type: "object", properties: { bookId: string(), cursor: string(8192), limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false },
    execute: async (params) => {
      fields(params, ["bookId", "cursor", "limit"]);
      const limit = params.limit ?? 10;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20)
        return invalid();
      const page = await bookmarkCollection(ctx).page({
        limit,
        ...params.bookId === undefined ? {} : { bookId: text2(params.bookId) },
        ...params.cursor === undefined ? {} : { cursor: text2(params.cursor, 8192) }
      });
      if (page.status === "stale-cursor")
        return page;
      return { status: "ready", nextCursor: page.nextCursor, items: page.items.map((doc) => {
        const bookmark = parseBookmark(doc.data);
        return { id: doc.id, revision: doc.revision, valid: Boolean(bookmark), ...bookmark ? {
          name: bookmark.name,
          kind: bookmark.kind,
          bookId: bookmark.target.bookId,
          bookTitle: bookmark.bookTitle.slice(0, 160),
          bookTitleTruncated: bookmark.bookTitle.length > 160
        } : {} };
      }) };
    }
  });
  ctx.contributions.agentTools.register({
    name: "inspect_bookmark_location",
    label: "Inspect bookmark location",
    contexts: ["global"],
    description: "Inspect the current reading location or readable selection before saving a Jumper bookmark. Returns book metadata and an opaque locationToken, not full source text. Does not save or navigate. Pass the unchanged kind, bookId and token to save_bookmark; that operation refuses a changed position or selection. A source may have session-limited validity.",
    parameters: { type: "object", properties: { kind: { type: "string", enum: ["location", "selection"] } }, required: ["kind"], additionalProperties: false },
    execute: async (params) => {
      fields(params, ["kind"]);
      const bookmark = await captureBookmark(ctx, kind(params.kind));
      return {
        kind: bookmark.kind,
        bookId: bookmark.target.bookId,
        bookTitle: bookmark.bookTitle,
        suggestedName: bookmark.name,
        locationToken: await locationToken(bookmark)
      };
    }
  });
  ctx.contributions.agentTools.register({
    name: "save_bookmark",
    label: "Save bookmark",
    contexts: ["global"],
    approval: "required",
    description: "After host approval, save the current reading location or selection previously inspected with inspect_bookmark_location. Pass its exact kind, bookId and locationToken plus the requested name. Rechecks the target before writing and returns stale-location rather than capturing a different position. Saves only a private Jumper bookmark, not an annotation or reading-history event. Does not navigate. Repeated successful calls may create separate bookmarks.",
    parameters: { type: "object", properties: {
      kind: { type: "string", enum: ["location", "selection"] },
      bookId: string(),
      locationToken: { type: "string", pattern: "^bm1:[a-f0-9]{64}$" },
      name: string(120)
    }, required: ["kind", "bookId", "locationToken", "name"], additionalProperties: false },
    execute: async (params) => {
      fields(params, ["kind", "bookId", "locationToken", "name"]);
      const selectedKind = kind(params.kind), bookId = text2(params.bookId), token = text2(params.locationToken, 68), name = bookmarkName(params.name);
      if (!name || !/^bm1:[a-f0-9]{64}$/.test(token))
        return invalid();
      const bookmark = await captureBookmark(ctx, selectedKind);
      if (bookmark.target.bookId !== bookId || await locationToken(bookmark) !== token)
        return { status: "stale-location" };
      const id = crypto.randomUUID(), receipt = await writeBookmark(ctx, id, { ...bookmark, name }, null);
      return receipt.status === "conflict" ? { status: "conflict" } : { status: "saved", id, name, bookId };
    }
  });
  ctx.contributions.agentTools.register({
    name: "manage_bookmark",
    label: "Manage bookmark",
    contexts: ["global"],
    approval: "required",
    description: "Open, rename or permanently delete one Jumper bookmark after host approval. First list_bookmarks and pass the exact id and expectedRevision; a changed document returns conflict. Rename requires name; other actions must omit it. Open uses the stored book and content version through shared navigation, rejects removed/stale sources and never guesses a replacement location. Delete removes only this bookmark, not its book or annotations. Invalid entries can only be deleted.",
    parameters: {
      type: "object",
      properties: { action: { type: "string", enum: ["open", "rename", "delete"] }, id: string(), expectedRevision: string(), name: string(120) },
      required: ["action", "id", "expectedRevision"],
      additionalProperties: false
    },
    execute: async (params) => {
      fields(params, ["action", "id", "expectedRevision", "name"]);
      const id = text2(params.id), expectedRevision = text2(params.expectedRevision);
      if (typeof params.action !== "string" || !["open", "rename", "delete"].includes(params.action))
        return invalid();
      const name = params.action === "rename" ? bookmarkName(params.name) : null;
      if (params.action === "rename" ? !name : params.name !== undefined)
        return invalid();
      const doc = await bookmarkCollection(ctx).get(id);
      if (!doc)
        return { status: "not-found", id };
      if (doc.revision !== expectedRevision)
        return { status: "conflict", id };
      if (params.action === "delete") {
        const receipt = await removeBookmark(ctx, doc);
        return { status: receipt.status === "conflict" ? "conflict" : "deleted", id };
      }
      const bookmark = parseBookmark(doc.data);
      if (!bookmark)
        return { status: "invalid-bookmark", id };
      if (params.action === "rename") {
        const receipt = await writeBookmark(ctx, id, { ...bookmark, name }, expectedRevision);
        return { status: receipt.status === "conflict" ? "conflict" : "renamed", id };
      }
      await openBookmark(ctx, bookmark);
      return { status: "completed", action: "open", id, bookId: bookmark.target.bookId };
    }
  });
}

// src/index.ts
var plugin = {
  activate(ctx) {
    assertCapabilities(ctx);
    registerBookmarkTools(ctx);
    const unavailable = { revision: 0, visible: true, enabled: false };
    const header = ctx.contributions.headerActions.register({
      id: "jumper",
      title: "Jumper",
      icon: "magnifying-glass",
      state: unavailable,
      surface: "reader",
      presentation: "popup",
      view: () => jumperView(ctx)
    });
    const open = ctx.contributions.commands.register({
      id: "open",
      title: "Jumper",
      icon: "magnifying-glass",
      state: unavailable,
      keywords: "jump chapter text search navigation",
      run: async () => ({ view: await jumperView(ctx) })
    });
    ctx.contributions.commands.register({
      id: "bookmarks",
      title: `Jumper: ${bookmarkCopy(ctx.locale).title}`,
      icon: "book-bookmark",
      state: { revision: 0, visible: true, enabled: true },
      keywords: "bookmark saved location passage",
      run: async () => ({ view: await bookmarksView(ctx) })
    });
    const history = ["back", "forward"].map((direction) => ({
      direction,
      registration: ctx.contributions.commands.register({
        id: direction,
        title: `Jumper: ${tr(ctx.locale, direction)}`,
        state: unavailable,
        icon: direction === "back" ? "arrow-left" : "arrow-right",
        defaultShortcut: { key: direction === "back" ? "ArrowLeft" : "ArrowRight", alt: true },
        run: async () => {
          const session = await ctx.domains.reading.queries.session();
          await ctx.domains.reading.commands[direction]({ sessionId: session.sessionId ?? undefined });
        }
      })
    }));
    ctx.domains.reading.events.observeSession(async (session) => {
      const state = { revision: session.revision + 1, visible: true, enabled: session.status === "ready" };
      await Promise.all([header.updateState(state), open.updateState(state), ...history.map(({ direction, registration }) => registration.updateState({ ...state, enabled: state.enabled && (direction === "back" ? session.history.canGoBack : session.history.canGoForward) }))]);
    });
  }
};
var src_default = plugin;
export {
  src_default as default
};
