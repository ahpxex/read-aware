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
  return { kind: "blocks", blocks: [...actions.length ? [{ kind: "actions", actions }] : [], form] };
}

// src/index.ts
var plugin = {
  activate(ctx) {
    assertCapabilities(ctx);
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
