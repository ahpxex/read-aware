// src/strings.ts
var en = ["Memory Desk", "Personal memory", "Cross-book memory", "Books", "Chapter graph", "Book memory", "Search", "Refresh", "No memories found", "Memory is unavailable at this reading position", "No visible chapter digest", "No chapter memory yet", "Entity names", "Chapter number", "Enter one to eight names, or a positive chapter number", "Open source", "Chapters", "Relations", "No matching entities", "Results limited", "Previous", "Next", "Query", "Chapter"];
var locales = {
  en,
  "zh-Hans": ["记忆台", "个人记忆", "跨书记忆", "书籍", "章节图谱", "本书记忆", "搜索", "刷新", "没有匹配的记忆", "当前阅读位置无法提供记忆", "没有可见的章节摘要", "尚无章节记忆", "实体名称", "章节号", "请输入一至八个名称，或正整数章节号", "打开原文", "章节", "关系", "没有匹配的实体", "结果已截断", "上一页", "下一页", "查询", "章节"],
  "zh-Hant": ["記憶台", "個人記憶", "跨書記憶", "書籍", "章節圖譜", "本書記憶", "搜尋", "重新整理", "沒有符合的記憶", "目前閱讀位置無法提供記憶", "沒有可見的章節摘要", "尚無章節記憶", "實體名稱", "章節號", "請輸入一至八個名稱，或正整數章節號", "開啟原文", "章節", "關係", "沒有符合的實體", "結果已截斷", "上一頁", "下一頁", "查詢", "章節"],
  ja: ["記憶デスク", "個人の記憶", "書籍横断の記憶", "書籍", "章グラフ", "本の記憶", "検索", "更新", "記憶が見つかりません", "現在の読書位置では記憶を表示できません", "表示可能な章要約がありません", "章の記憶はまだありません", "エンティティ名", "章番号", "1〜8件の名前、または正の章番号を入力してください", "原文を開く", "章", "関係", "一致するエンティティはありません", "結果は制限されています", "前へ", "次へ", "クエリ", "章"],
  de: ["Gedächtnis", "Persönliche Erinnerungen", "Buchübergreifende Erinnerungen", "Bücher", "Kapitelgraph", "Bucherinnerungen", "Suchen", "Aktualisieren", "Keine Erinnerungen gefunden", "An dieser Leseposition nicht verfügbar", "Keine sichtbare Kapitelzusammenfassung", "Noch keine Kapitelerinnerungen", "Entitätsnamen", "Kapitelnummer", "Ein bis acht Namen oder eine positive Kapitelnummer eingeben", "Quelle öffnen", "Kapitel", "Beziehungen", "Keine passenden Entitäten", "Ergebnisse begrenzt", "Zurück", "Weiter", "Suchbegriff", "Kapitel"],
  fr: ["Mémoire", "Souvenirs personnels", "Souvenirs interlivres", "Livres", "Graphe des chapitres", "Mémoire du livre", "Rechercher", "Actualiser", "Aucun souvenir trouvé", "Mémoire indisponible à cette position de lecture", "Aucun résumé de chapitre visible", "Aucune mémoire de chapitre", "Noms des entités", "Numéro du chapitre", "Saisissez un à huit noms ou un numéro de chapitre positif", "Ouvrir la source", "Chapitres", "Relations", "Aucune entité correspondante", "Résultats limités", "Précédent", "Suivant", "Recherche", "Chapitre"],
  es: ["Memoria", "Recuerdos personales", "Recuerdos entre libros", "Libros", "Grafo de capítulos", "Memoria del libro", "Buscar", "Actualizar", "No hay recuerdos", "Memoria no disponible en esta posición de lectura", "No hay resumen de capítulo visible", "Aún no hay memoria de capítulos", "Nombres de entidades", "Número de capítulo", "Introduce de uno a ocho nombres o un número de capítulo positivo", "Abrir fuente", "Capítulos", "Relaciones", "No hay entidades coincidentes", "Resultados limitados", "Anterior", "Siguiente", "Consulta", "Capítulo"],
  ru: ["Память", "Личные воспоминания", "Межкнижные воспоминания", "Книги", "Граф глав", "Память книги", "Поиск", "Обновить", "Воспоминания не найдены", "Память недоступна на этой позиции чтения", "Нет доступного резюме главы", "Памяти глав пока нет", "Имена сущностей", "Номер главы", "Введите от одного до восьми имён или положительный номер главы", "Открыть источник", "Главы", "Связи", "Сущности не найдены", "Результаты ограничены", "Назад", "Далее", "Запрос", "Глава"]
};
var strings = (locale) => locales[locale] ?? locales[locale.split("-")[0]] ?? en;

// src/graph.ts
function graphSearch(ctx, bookId) {
  const t = strings(ctx.locale);
  return { kind: "form", title: t[6], fields: [
    { id: "names", kind: "textarea", label: t[12], value: "" },
    { id: "chapter", kind: "text", label: t[13], value: "" }
  ], onSubmit: async (values) => {
    const names = String(values.names ?? "").split(`
`).map((name) => name.trim()).filter(Boolean), chapter = String(values.chapter ?? "").trim();
    if (names.length && chapter || names.length > 8 || names.some((name) => name.length > 256) || chapter && (!/^\d+$/.test(chapter) || !Number.isSafeInteger(Number(chapter)) || Number(chapter) < 1)) {
      return { fieldErrors: { names: t[14], chapter: t[14] } };
    }
    return { view: await graphView(ctx, bookId, chapter ? { chapterIndex: Number(chapter) - 1 } : names.length ? { names } : {}) };
  } };
}
async function graphView(ctx, bookId, query = {}) {
  const t = strings(ctx.locale), graph = await ctx.domains.memory.queries.bookGraph(bookId, query);
  const actions = [
    { id: "refresh", label: t[7], icon: "arrows-clockwise", run: async () => ({ view: await graphView(ctx, bookId, query), navigation: "replace" }) },
    { id: "search", label: t[6], icon: "magnifying-glass", run: () => ({ view: graphSearch(ctx, bookId) }) }
  ];
  if (graph.graph === "chapter") {
    return { kind: "detail", title: `${t[23]} ${graph.chapterIndex + 1}`, content: [
      { kind: "text", text: graph.summary },
      { kind: "keyValue", rows: graph.entities.map((entity) => ({ label: entity.name, value: entity.note ?? entity.aliases?.join(", ") ?? "" })) },
      { kind: "keyValue", rows: graph.relations.map((edge) => ({ label: `${edge.from} / ${edge.to}`, value: `${edge.kind}${edge.note ? `: ${edge.note}` : ""}` })) }
    ], actions: [...actions, { id: "source", label: t[15], icon: "book-open", run: async () => {
      const current = await ctx.domains.memory.queries.bookGraph(bookId, { chapterIndex: graph.chapterIndex });
      if (current.graph !== "chapter")
        return { view: await graphView(ctx, bookId, { chapterIndex: graph.chapterIndex }), navigation: "replace" };
      if (!current.chapterHref)
        return { view: { kind: "detail", title: t[15], content: [{ kind: "error", code: "reader/target-not-found" }] } };
      await ctx.domains.reading.commands.goTo({ bookId, href: current.chapterHref });
      return { close: true };
    } }] };
  }
  if (graph.graph === "overview") {
    const list = {
      kind: "list",
      title: t[4],
      searchable: true,
      actions,
      items: graph.entities.map((entity) => ({
        id: entity.name,
        title: entity.name,
        subtitle: `${t[16]}: ${entity.chapters}`,
        icon: "brain",
        onSelect: async () => ({ view: await graphView(ctx, bookId, { names: [entity.name] }) })
      })),
      emptyText: t[11]
    };
    return graph.truncated ? { kind: "detail", title: t[4], actions, content: [
      { kind: "text", text: t[19] },
      { ...list, actions: undefined }
    ] } : list;
  }
  if (graph.graph === "profiles") {
    const items = graph.profiles.map((profile) => ({
      id: profile.name,
      title: profile.name,
      subtitle: profile.note,
      icon: "brain",
      onSelect: () => ({ view: { kind: "detail", title: profile.name, content: [
        { kind: "text", text: profile.aliases?.join(", ") ?? "" },
        { kind: "text", text: profile.note ?? "" },
        { kind: "list", title: t[16], items: profile.appearsInChapters.map((index) => ({
          id: String(index),
          title: `${t[23]} ${index + 1}`,
          icon: "book-open",
          onSelect: async () => ({ view: await graphView(ctx, bookId, { chapterIndex: index }) })
        })) },
        { kind: "keyValue", rows: profile.relations.map((edge) => ({ label: `${edge.from} / ${edge.to}`, value: `${edge.kind} (${t[23]} ${edge.establishedAt + 1})` })) },
        ...profile.relationsTruncated ? [{ kind: "text", text: t[19] }] : []
      ] } })
    }));
    return { kind: "detail", title: t[4], actions, content: [
      { kind: "list", searchable: true, items, emptyText: t[18] },
      ...graph.notFound.length ? [{ kind: "text", text: `${t[18]}: ${graph.notFound.join(", ")}` }] : [],
      ...graph.truncated ? [{ kind: "text", text: t[19] }] : []
    ] };
  }
  return { kind: "detail", title: t[4], actions, content: [{ kind: "text", text: t[graph.graph === "unavailable" ? 9 : graph.graph === "miss" ? 10 : 11] }] };
}

// src/views.ts
async function memoryDesk(ctx) {
  const t = strings(ctx.locale);
  return { kind: "list", title: t[0], items: [
    { id: "user", title: t[1], icon: "brain", onSelect: async () => ({ view: await memories(ctx, "user") }) },
    { id: "global", title: t[2], icon: "brain", onSelect: async () => ({ view: await memories(ctx, "global") }) },
    { id: "books", title: t[3], icon: "books", onSelect: async () => ({ view: await booksView(ctx) }) }
  ] };
}
async function booksView(ctx, page = 0) {
  const t = strings(ctx.locale), books = await ctx.domains.library.queries.books.list();
  const current = Math.min(Math.max(page, 0), Math.max(0, Math.ceil(books.length / 40) - 1));
  return {
    kind: "list",
    title: t[3],
    searchable: true,
    items: books.slice(current * 40, (current + 1) * 40).map((book) => ({
      id: book.id,
      title: book.title,
      subtitle: book.author,
      icon: "book-open",
      onSelect: async () => ({ view: { kind: "list", title: book.title, items: [
        { id: "graph", title: t[4], icon: "brain", onSelect: async () => ({ view: await graphView(ctx, book.id) }) },
        { id: "memory", title: t[5], icon: "brain", onSelect: async () => ({ view: await memories(ctx, `book:${book.id}`) }) }
      ] } })
    })),
    actions: [
      { id: "refresh", label: t[7], icon: "arrows-clockwise", run: async () => ({ view: await booksView(ctx, current), navigation: "replace" }) },
      ...[-1, 1].filter((direction) => current + direction >= 0 && (current + direction) * 40 < books.length).map((direction) => ({
        id: direction < 0 ? "previous" : "next",
        label: t[direction < 0 ? 20 : 21],
        icon: direction < 0 ? "arrow-left" : "arrow-right",
        run: async () => ({ view: await booksView(ctx, current + direction), navigation: "replace" })
      }))
    ]
  };
}
async function memories(ctx, scope, query) {
  const t = strings(ctx.locale), rows = await ctx.domains.memory.queries.search({ scopes: [scope], query, limit: 100 });
  return {
    kind: "list",
    title: t[scope === "user" ? 1 : scope === "global" ? 2 : 5],
    searchable: true,
    emptyText: t[8],
    items: rows.map((row) => ({ id: row.id, title: row.content, subtitle: row.updatedAt, icon: "brain", onSelect: () => ({ view: {
      kind: "detail",
      title: t[5],
      content: [{ kind: "text", text: row.content }, { kind: "keyValue", rows: [
        { label: "ID", value: row.id },
        { label: t[22], value: row.scope }
      ] }]
    } }) })),
    actions: [
      { id: "refresh", label: t[7], icon: "arrows-clockwise", run: async () => ({ view: await memories(ctx, scope, query), navigation: "replace" }) },
      { id: "search", label: t[6], icon: "magnifying-glass", run: () => ({ view: { kind: "form", title: t[6], fields: [
        { id: "query", kind: "text", label: t[22], value: query ?? "" }
      ], onSubmit: async (values) => {
        const value = String(values.query ?? "");
        if (value.length > 2000)
          return { fieldErrors: { query: t[19] } };
        return { view: await memories(ctx, scope, value) };
      } } }) }
    ]
  };
}

// src/index.ts
var src_default = {
  activate(ctx) {
    if (!ctx.domains.memory || !ctx.domains.library || !ctx.domains.reading?.commands)
      throw Error("Memory Desk requires memory:read, library:read and reading:write");
    const title = strings(ctx.locale)[0];
    ctx.contributions.commands.register({ id: "open", title, icon: "brain", run: async () => ({ view: await memoryDesk(ctx) }) });
    for (const surface of ["shelf", "reader"])
      ctx.contributions.headerActions.register({ id: surface, title, icon: "brain", surface, presentation: "popup", view: () => memoryDesk(ctx) });
  }
};
export {
  src_default as default
};
