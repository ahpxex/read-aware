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

// src/live-memory.ts
async function liveMemoryView(ctx, query, title, render, recovery = []) {
  const memory = ctx.domains.memory;
  let sample, failure;
  try {
    sample = query.kind === "search" ? { kind: query.kind, memories: await memory.queries.search(query.query) } : query.kind === "page" ? { kind: query.kind, page: await memory.queries.page(query.query) } : query.kind === "profile" ? { kind: query.kind, profile: await memory.queries.profile(query.query) } : query.kind === "inspect" ? { kind: query.kind, snapshot: await memory.queries.inspect(query.memoryId) } : query.kind === "classification" ? { kind: query.kind, snapshot: await memory.queries.classification(query.bookId) } : query.kind === "graphTasks" ? { kind: query.kind, tasks: await memory.queries.listGraphTasks(query.bookId) } : query.kind === "graphTask" ? { kind: query.kind, task: await memory.queries.getGraphTask(query.bookId, query.taskId) } : { kind: query.kind, graph: await memory.queries.bookGraph(query.bookId, query.query) };
  } catch (error) {
    failure = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "memory/observation-failed";
  }
  const content = () => failure || !sample ? { kind: "detail", title, content: [{ kind: "error", code: failure ?? "memory/observation-failed" }], ...recovery.length ? { actions: recovery } : {} } : render(sample);
  return { ...content(), live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = memory.events.observe(query, async (event) => {
      if (disposed)
        return;
      if (event.status === "ready") {
        sample = event.result;
        failure = undefined;
      } else {
        sample = undefined;
        failure = event.errorCode;
      }
      await ctx.services.ui.publishView(channel, { revision: ++revision, view: content() });
    });
    return { dispose() {
      disposed = true;
      subscription.dispose();
    } };
  } } };
}

// src/task-budget.ts
var copies = {
  en: { limit: "Maximum chapter attempts", invalid: "Enter a whole number from 1 to 1000", note: "Empty and failed chapters count. Classification may add a model request; this is not a token or spending limit.", reached: "Chapter limit reached", boundary: "Reading boundary is unknown", toc: "No chapter directory is available", classification: "Book classification is still pending", empty: "Empty chapters", chapter: "Chapter" },
  "zh-Hans": { limit: "最多尝试章节数", invalid: "请输入 1 到 1000 的整数", note: "空章和失败章节也计入。分类可能额外调用模型；这不是 token 或费用上限。", reached: "已达章节上限", boundary: "尚无法确定阅读边界", toc: "没有可用的章节目录", classification: "书籍分类尚未完成", empty: "空章节", chapter: "章节" },
  "zh-Hant": { limit: "最多嘗試章節數", invalid: "請輸入 1 到 1000 的整數", note: "空章與失敗章節也計入。分類可能額外呼叫模型；這不是 token 或費用上限。", reached: "已達章節上限", boundary: "尚無法確定閱讀邊界", toc: "沒有可用的章節目錄", classification: "書籍分類尚未完成", empty: "空章節", chapter: "章節" },
  ja: { limit: "章の試行数の上限", invalid: "1 から 1000 の整数を入力してください", note: "空の章や失敗した章も数えます。分類で追加のモデル呼び出しが発生する場合があります。トークン数や料金の上限ではありません。", reached: "章の上限に達しました", boundary: "読書範囲が不明です", toc: "章の目次がありません", classification: "書籍の分類は未完了です", empty: "空の章", chapter: "章" },
  de: { limit: "Maximale Kapitelversuche", invalid: "Ganze Zahl von 1 bis 1000 eingeben", note: "Leere und fehlgeschlagene Kapitel zählen. Die Klassifizierung kann einen weiteren Modellaufruf benötigen; kein Token- oder Kostenlimit.", reached: "Kapitellimit erreicht", boundary: "Lesegrenze unbekannt", toc: "Kein Kapitelverzeichnis verfügbar", classification: "Buchklassifizierung noch ausstehend", empty: "Leere Kapitel", chapter: "Kapitel" },
  fr: { limit: "Nombre maximal de tentatives", invalid: "Saisissez un entier de 1 à 1000", note: "Les chapitres vides ou en échec comptent. La classification peut ajouter un appel au modèle ; aucune limite de jetons ou de dépenses.", reached: "Limite de chapitres atteinte", boundary: "Limite de lecture inconnue", toc: "Aucun sommaire disponible", classification: "Classification du livre en attente", empty: "Chapitres vides", chapter: "Chapitre" },
  es: { limit: "Máximo de intentos de capítulos", invalid: "Introduce un entero de 1 a 1000", note: "Cuentan los capítulos vacíos o fallidos. La clasificación puede añadir una llamada al modelo; no es un límite de tokens ni de gasto.", reached: "Límite de capítulos alcanzado", boundary: "Límite de lectura desconocido", toc: "No hay índice de capítulos", classification: "Clasificación del libro pendiente", empty: "Capítulos vacíos", chapter: "Capítulo" },
  ru: { limit: "Максимум попыток обработки глав", invalid: "Введите целое число от 1 до 1000", note: "Пустые и неудачные главы учитываются. Классификация может добавить запрос к модели; это не лимит токенов или расходов.", reached: "Достигнут лимит глав", boundary: "Граница чтения неизвестна", toc: "Оглавление недоступно", classification: "Классификация книги ещё не завершена", empty: "Пустые главы", chapter: "Глава" }
};
var taskBudgetWords = (locale) => copies[locale] ?? copies[locale.split("-")[0]] ?? copies.en;

// src/tasks.ts
var words = {
  en: ["Graph tasks", "Fill missing chapters", "Rebuild", "Retry", "Cancel", "Refresh", "No tasks", "I approve sending chapter text to my configured model; charges may apply", "Required", "Status", "Attempted", "Saved", "Remaining", "Queued", "Running", "Cancelling", "Cancelled", "Completed", "Partial", "Unavailable", "Failed"],
  "zh-Hans": ["图谱任务", "补齐章节", "重建", "重试", "取消", "刷新", "暂无任务", "同意将章节正文发送给已配置的模型，可能产生费用", "必填", "状态", "已尝试", "已保存", "剩余", "排队中", "运行中", "取消中", "已取消", "已完成", "部分完成", "不可用", "失败"],
  "zh-Hant": ["圖譜工作", "補齊章節", "重建", "重試", "取消", "重新整理", "尚無工作", "同意將章節正文傳送給已設定的模型，可能產生費用", "必填", "狀態", "已嘗試", "已儲存", "剩餘", "排隊中", "執行中", "取消中", "已取消", "已完成", "部分完成", "無法使用", "失敗"],
  ja: ["グラフのタスク", "不足する章を補完", "再構築", "再試行", "キャンセル", "更新", "タスクなし", "章本文を設定済みモデルに送信することに同意します。料金が発生する場合があります", "必須", "状態", "試行済み", "保存済み", "残り", "待機中", "実行中", "キャンセル中", "キャンセル済み", "完了", "一部完了", "利用不可", "失敗"],
  de: ["Graph-Aufgaben", "Fehlende Kapitel ergänzen", "Neu aufbauen", "Erneut versuchen", "Abbrechen", "Aktualisieren", "Keine Aufgaben", "Ich stimme dem Senden von Kapiteltext an mein Modell zu; es können Kosten entstehen", "Erforderlich", "Status", "Versucht", "Gespeichert", "Verbleibend", "Wartend", "Läuft", "Wird abgebrochen", "Abgebrochen", "Abgeschlossen", "Teilweise", "Nicht verfügbar", "Fehlgeschlagen"],
  fr: ["Tâches du graphe", "Compléter les chapitres", "Reconstruire", "Réessayer", "Annuler", "Actualiser", "Aucune tâche", "J'autorise l'envoi du texte au modèle configuré ; des frais sont possibles", "Obligatoire", "État", "Tentés", "Enregistrés", "Restants", "En attente", "En cours", "Annulation", "Annulée", "Terminée", "Partielle", "Indisponible", "Échec"],
  es: ["Tareas del grafo", "Completar capítulos", "Reconstruir", "Reintentar", "Cancelar", "Actualizar", "Sin tareas", "Autorizo enviar el texto al modelo configurado; puede generar costes", "Obligatorio", "Estado", "Intentados", "Guardados", "Pendientes", "En cola", "En curso", "Cancelando", "Cancelada", "Completada", "Parcial", "No disponible", "Fallida"],
  ru: ["Задачи графа", "Дополнить главы", "Перестроить", "Повторить", "Отменить", "Обновить", "Задач нет", "Разрешаю отправить текст глав настроенной модели; возможны расходы", "Обязательно", "Статус", "Попыток", "Сохранено", "Осталось", "В очереди", "Выполняется", "Отменяется", "Отменено", "Завершено", "Частично", "Недоступно", "Ошибка"]
};
var graphTaskWords = (locale) => words[locale] ?? words[locale.split("-")[0]] ?? words.en;
var states = ["queued", "running", "cancelling", "cancelled", "completed", "partial", "unavailable", "failed"];
function approve(ctx, bookId, mode, retryId, maxChapters = 20) {
  const t = graphTaskWords(ctx.locale), budget = taskBudgetWords(ctx.locale), title = t[retryId ? 3 : mode === "rebuild" ? 2 : 1];
  return {
    kind: "form",
    title,
    submitLabel: title,
    fields: [
      { id: "maxChapters", kind: "number", label: budget.limit, value: maxChapters, min: 1, max: 1000, step: 1, helperText: budget.note },
      { id: "confirm", kind: "checkbox", label: t[7], value: false }
    ],
    onSubmit: async (values) => {
      const limit = values.maxChapters;
      if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
        return { fieldErrors: { maxChapters: budget.invalid } };
      if (values.confirm !== true)
        return { fieldErrors: { confirm: t[8] } };
      const commands = ctx.domains.memory.commands;
      const task = retryId ? await commands.retryGraphTask(bookId, retryId, { maxChapters: limit }) : await commands.startGraphTask(bookId, mode, { maxChapters: limit });
      return { view: await graphTaskView(ctx, bookId, task.taskId), navigation: "replace" };
    }
  };
}
async function graphTasksView(ctx, bookId) {
  const t = graphTaskWords(ctx.locale);
  return liveMemoryView(ctx, { kind: "graphTasks", bookId }, t[0], (result) => {
    if (result.kind !== "graphTasks")
      throw Error("Unexpected graph tasks observation");
    const actions = [{ id: "refresh", label: t[5], icon: "arrows-clockwise", run: async () => ({ view: await graphTasksView(ctx, bookId), navigation: "replace" }) }];
    if (ctx.domains.memory.commands)
      actions.push({ id: "start", label: t[1], icon: "play", run: () => ({ view: approve(ctx, bookId, "catch-up") }) }, { id: "rebuild", label: t[2], icon: "arrows-clockwise", run: () => ({ view: approve(ctx, bookId, "rebuild") }) });
    return { kind: "list", title: t[0], actions, emptyText: t[6], items: [...result.tasks].reverse().map((task) => ({
      id: task.taskId,
      title: t[task.mode === "rebuild" ? 2 : 1],
      subtitle: `${t[13 + states.indexOf(task.status)]} · ${task.createdAt}`,
      icon: "brain",
      onSelect: async () => ({ view: await graphTaskView(ctx, bookId, task.taskId) })
    })) };
  });
}
async function graphTaskView(ctx, bookId, taskId) {
  const t = graphTaskWords(ctx.locale), budget = taskBudgetWords(ctx.locale);
  return liveMemoryView(ctx, { kind: "graphTask", bookId, taskId }, t[0], (result) => {
    if (result.kind !== "graphTask")
      throw Error("Unexpected graph task observation");
    const task = result.task, report = task.report;
    const actions = [{ id: "refresh", label: t[5], icon: "arrows-clockwise", run: async () => ({ view: await graphTaskView(ctx, bookId, taskId), navigation: "replace" }) }];
    const cancel = ctx.domains.memory.commands && ["queued", "running"].includes(task.status) ? { id: taskId, label: t[4], run: async () => {
      await ctx.domains.memory.commands.cancelGraphTask(bookId, taskId);
      return { view: await graphTaskView(ctx, bookId, taskId), navigation: "replace" };
    } } : undefined;
    if (ctx.domains.memory.commands && ["failed", "cancelled", "partial", "unavailable"].includes(task.status))
      actions.push({ id: "retry", label: t[3], icon: "arrows-clockwise", run: () => ({ view: approve(ctx, bookId, task.mode, taskId, task.maxChapters) }) });
    return { kind: "detail", title: t[task.mode === "rebuild" ? 2 : 1], actions, content: [
      ...["queued", "running", "cancelling"].includes(task.status) ? [{ kind: "progress", value: null, label: t[13 + states.indexOf(task.status)], cancel }] : [],
      { kind: "keyValue", rows: [
        { label: t[9], value: t[13 + states.indexOf(task.status)] },
        { label: "ID", value: taskId },
        { label: budget.limit, value: String(task.maxChapters) },
        ...report ? [{ label: t[10], value: String(report.attempted) }, { label: t[11], value: String(report.digested) }, { label: t[12], value: String(report.remaining) }] : []
      ] },
      ...report?.reason ? [{ kind: "text", text: { "chapter-limit": budget.reached, "boundary-unknown": budget.boundary, "no-toc": budget.toc, "classification-pending": budget.classification }[report.reason] }] : [],
      ...report?.emptyChapters.length ? [{ kind: "keyValue", rows: [{ label: budget.empty, value: report.emptyChapters.map((index) => index + 1).join(", ") }] }] : [],
      ...task.errorCode ? [{ kind: "error", code: task.errorCode }] : [],
      ...report?.failures.flatMap((failure) => [{ kind: "heading", text: `${budget.chapter} ${failure.chapterIndex + 1}` }, { kind: "error", code: failure.errorCode }]) ?? []
    ] };
  });
}

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
async function graphView(ctx, bookId, query = {}, profileName) {
  const t = strings(ctx.locale);
  return liveMemoryView(ctx, { kind: "bookGraph", bookId, query }, t[4], (result) => {
    if (result.kind !== "bookGraph")
      throw Error("Unexpected memory observation result");
    const graph = result.graph;
    const actions = [
      { id: "tasks", label: graphTaskWords(ctx.locale)[0], icon: "list", run: async () => ({ view: await graphTasksView(ctx, bookId) }) },
      { id: "refresh", label: t[7], icon: "arrows-clockwise", run: async () => ({ view: await graphView(ctx, bookId, query, profileName), navigation: "replace" }) },
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
      if (profileName) {
        const profile = graph.profiles.find((item) => item.name === profileName);
        if (!profile)
          return { kind: "detail", title: profileName, content: [{ kind: "text", text: t[18] }], actions };
        return { kind: "detail", title: profile.name, content: [
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
        ], actions };
      }
      const items = graph.profiles.map((profile) => ({
        id: profile.name,
        title: profile.name,
        subtitle: profile.note,
        icon: "brain",
        onSelect: async () => ({ view: await graphView(ctx, bookId, { names: [profile.name] }, profile.name) })
      }));
      return { kind: "detail", title: t[4], actions, content: [
        { kind: "list", searchable: true, items, emptyText: t[18] },
        ...graph.notFound.length ? [{ kind: "text", text: `${t[18]}: ${graph.notFound.join(", ")}` }] : [],
        ...graph.truncated ? [{ kind: "text", text: t[19] }] : []
      ] };
    }
    return { kind: "detail", title: t[4], actions, content: [{ kind: "text", text: t[graph.graph === "unavailable" ? 9 : graph.graph === "miss" ? 10 : 11] }] };
  });
}

// src/management.ts
var words2 = {
  en: ["Memory", "Refresh", "Correct", "Pin", "Unpin", "Forget", "Content", "Confirm forgetting this memory", "Required", "Scope"],
  "zh-Hans": ["记忆", "刷新", "纠正", "置顶", "取消置顶", "遗忘", "内容", "确认遗忘这条记忆", "必填", "范围"],
  "zh-Hant": ["記憶", "重新整理", "更正", "置頂", "取消置頂", "遺忘", "內容", "確認遺忘這條記憶", "必填", "範圍"],
  ja: ["記憶", "更新", "修正", "固定", "固定解除", "忘却", "内容", "この記憶を忘れることを確認", "必須", "範囲"],
  de: ["Erinnerung", "Aktualisieren", "Korrigieren", "Anheften", "Lösen", "Vergessen", "Inhalt", "Vergessen dieser Erinnerung bestätigen", "Erforderlich", "Bereich"],
  fr: ["Souvenir", "Actualiser", "Corriger", "Épingler", "Désépingler", "Oublier", "Contenu", "Confirmer l'oubli de ce souvenir", "Obligatoire", "Portée"],
  es: ["Recuerdo", "Actualizar", "Corregir", "Fijar", "Desfijar", "Olvidar", "Contenido", "Confirmar que se olvide este recuerdo", "Obligatorio", "Alcance"],
  ru: ["Память", "Обновить", "Исправить", "Закрепить", "Открепить", "Забыть", "Содержание", "Подтвердить забывание этой записи", "Обязательно", "Область"]
};
async function memoryDetail(ctx, id, removed) {
  const t = words2[ctx.locale] ?? words2[ctx.locale.split("-")[0]] ?? words2.en;
  return liveMemoryView(ctx, { kind: "inspect", memoryId: id }, t[0], (result) => {
    if (result.kind !== "inspect")
      throw Error("Unexpected memory observation result");
    const snapshot = result.snapshot;
    if (!snapshot)
      return { kind: "detail", title: t[0], content: [{ kind: "error", code: "memory/not-found" }] };
    const { memory, revision } = snapshot;
    const refresh = () => memoryDetail(ctx, id, removed);
    const apply = (change) => ctx.domains.memory.commands.mutate(change);
    const base = { memoryId: id, expectedRevision: revision };
    return { kind: "detail", title: t[0], content: [
      { kind: "text", text: memory.content },
      { kind: "keyValue", rows: [{ label: "ID", value: id }, { label: t[9], value: memory.scope }] }
    ], actions: [
      { id: "refresh", label: t[1], icon: "arrows-clockwise", run: async () => ({ view: await refresh(), navigation: "replace" }) },
      ...ctx.domains.memory.commands ? [
        { id: "pin", label: t[memory.pinned ? 4 : 3], icon: "push-pin", run: async () => {
          await apply({ ...base, op: "setPinned", pinned: !memory.pinned });
          return { view: await refresh(), navigation: "replace" };
        } },
        { id: "correct", label: t[2], icon: "pencil-simple", run: () => ({ view: { kind: "form", title: t[2], fields: [
          { id: "content", kind: "textarea", label: t[6], value: memory.content }
        ], onSubmit: async (values) => {
          const content = values.content;
          if (typeof content !== "string" || !content.trim() || content.length > 16000)
            return { fieldErrors: { content: t[8] } };
          await apply({ ...base, op: "correct", content });
          return { view: await refresh(), navigation: "replace" };
        } } }) },
        { id: "forget", label: t[5], icon: "trash", run: () => ({ view: { kind: "form", title: t[5], fields: [
          { id: "content", kind: "textarea", label: t[6], value: memory.content, disabled: true },
          { id: "confirm", kind: "checkbox", label: t[7], value: false }
        ], onSubmit: async (values) => {
          if (values.confirm !== true)
            return { fieldErrors: { confirm: t[8] } };
          await apply({ ...base, op: "forget" });
          return { view: await removed(), navigation: "replace" };
        } } }) }
      ] : []
    ] };
  });
}

// src/classification.ts
var words3 = {
  en: ["Book classification", "Narrative", "Expository", "Unclassified", "Change classification", "Current classification", "I confirm the classification and spoiler-boundary change", "Expository books have no chapter spoiler boundary. Existing digests rebuild gradually; past answers and in-flight work are not undone.", "Required", "Refresh"],
  "zh-Hans": ["书籍分类", "叙事性", "说明性", "未分类", "更改分类", "当前分类", "确认更改分类及剧透边界", "说明性书籍不设章节剧透边界。旧摘要会逐步重建；历史答复和在途任务不会撤销。", "必填", "刷新"],
  "zh-Hant": ["書籍分類", "敘事性", "說明性", "未分類", "變更分類", "目前分類", "確認變更分類及劇透邊界", "說明性書籍不設章節劇透邊界。舊摘要會逐步重建；歷史回覆和進行中的工作不會撤銷。", "必填", "重新整理"],
  ja: ["本の分類", "物語", "解説文", "未分類", "分類を変更", "現在の分類", "分類とネタバレ境界の変更を確認", "解説文には章のネタバレ境界がありません。既存の要約は順次再生成され、過去の回答や進行中の処理は取り消されません。", "必須", "更新"],
  de: ["Buchklassifizierung", "Erzählung", "Sachtext", "Nicht klassifiziert", "Klassifizierung ändern", "Aktuelle Klassifizierung", "Änderung der Klassifizierung und Spoilergrenze bestätigen", "Sachtexte haben keine kapitelbezogene Spoilergrenze. Zusammenfassungen werden schrittweise erneuert; frühere Antworten und laufende Vorgänge bleiben bestehen.", "Erforderlich", "Aktualisieren"],
  fr: ["Classification du livre", "Narratif", "Explicatif", "Non classé", "Modifier la classification", "Classification actuelle", "Confirmer la classification et la limite de divulgation", "Les livres explicatifs n'ont pas de limite de divulgation par chapitre. Les résumés sont renouvelés progressivement ; les réponses passées et les opérations en cours ne sont pas annulées.", "Obligatoire", "Actualiser"],
  es: ["Clasificación del libro", "Narrativo", "Expositivo", "Sin clasificar", "Cambiar clasificación", "Clasificación actual", "Confirmar la clasificación y el límite de spoilers", "Los libros expositivos no tienen límite de spoilers por capítulo. Los resúmenes se renuevan gradualmente; las respuestas anteriores y las tareas en curso no se deshacen.", "Obligatorio", "Actualizar"],
  ru: ["Классификация книги", "Повествование", "Изложение", "Не определена", "Изменить классификацию", "Текущая классификация", "Подтверждаю изменение классификации и границы спойлеров", "Изложение не ограничивает спойлеры по главам. Резюме обновляются постепенно; прошлые ответы и текущие операции не отменяются.", "Обязательно", "Обновить"]
};
var classificationWords = (locale) => words3[locale] ?? words3[locale.split("-")[0]] ?? words3.en;
async function classificationView(ctx, bookId) {
  const t = classificationWords(ctx.locale), refresh = () => classificationView(ctx, bookId);
  return liveMemoryView(ctx, { kind: "classification", bookId }, t[0], (result) => {
    if (result.kind !== "classification")
      throw Error("Unexpected classification observation");
    const snapshot = result.snapshot;
    if (!snapshot)
      return { kind: "detail", title: t[0], content: [{ kind: "error", code: "reader/book-not-found" }] };
    const { revision, narrativity } = snapshot;
    return { kind: "detail", title: t[0], content: [{ kind: "keyValue", rows: [
      { label: "ID", value: bookId },
      { label: t[5], value: t[snapshot.narrativity === "narrative" ? 1 : snapshot.narrativity === "expository" ? 2 : 3] }
    ] }], actions: [
      { id: "refresh", label: t[9], icon: "arrows-clockwise", run: async () => ({ view: await refresh(), navigation: "replace" }) },
      ...ctx.domains.memory.commands ? [{ id: "classify", label: t[4], icon: "pencil-simple", run: () => ({ view: {
        kind: "form",
        title: t[4],
        submitLabel: t[4],
        fields: [
          { id: "narrativity", kind: "select", label: t[0], value: narrativity ?? "narrative", options: [{ value: "narrative", label: t[1] }, { value: "expository", label: t[2] }] },
          { id: "confirm", kind: "checkbox", label: t[6], description: t[7], value: false }
        ],
        onSubmit: async (values) => {
          if (values.narrativity !== "narrative" && values.narrativity !== "expository")
            return { fieldErrors: { narrativity: t[8] } };
          if (values.confirm !== true)
            return { fieldErrors: { confirm: t[8] } };
          await ctx.domains.memory.commands.classify({ bookId, narrativity: values.narrativity, expectedRevision: revision });
          return { view: await refresh(), navigation: "replace" };
        }
      } }) }] : []
    ] };
  });
}

// src/context-strings.ts
var en2 = {
  profile: "User profile",
  edit: "Edit profile",
  summary: "Summary",
  save: "Save",
  confirm: "Confirm replacing the profile, including clearing it if empty",
  required: "Confirm this change first",
  tooLong: "Maximum 16,000 characters",
  absent: "No profile yet",
  empty: "Empty profile",
  saved: "Profile saved",
  unchanged: "Profile unchanged",
  refresh: "Refresh",
  previous: "Previous",
  next: "Next",
  conversations: "Conversation summaries",
  noThreads: "No conversations",
  untitled: "Untitled conversation",
  noSummary: "No stored summary",
  emptySummary: "Empty summary",
  bookSummary: "Conversation summary",
  local: "Device-local"
};
var zh = {
  profile: "用户画像",
  edit: "编辑画像",
  summary: "摘要",
  save: "保存",
  confirm: "确认替换画像；内容为空时清空画像",
  required: "请先确认此修改",
  tooLong: "最多 16,000 个字符",
  absent: "尚无画像",
  empty: "画像为空",
  saved: "画像已保存",
  unchanged: "画像未变化",
  refresh: "刷新",
  previous: "上一页",
  next: "下一页",
  conversations: "对话摘要",
  noThreads: "暂无对话",
  untitled: "未命名对话",
  noSummary: "尚无已存摘要",
  emptySummary: "摘要为空",
  bookSummary: "对话摘要",
  local: "仅本机"
};
var contextWords = (locale) => locale === "zh-Hans" ? zh : en2;

// src/context-pagination.ts
function pageActions(locale, offsets, nextOffset, load) {
  const t = contextWords(locale);
  const go = async (next) => ({ view: await load(next), navigation: "replace" });
  return [
    ...offsets.length > 1 ? [{ id: "previous", label: t.previous, icon: "arrow-left", run: () => go(offsets.slice(0, -1)) }] : [],
    ...nextOffset === null ? [] : [{ id: "next", label: t.next, icon: "arrow-right", run: () => go([...offsets, nextOffset]) }]
  ];
}
function textPage(text, start) {
  let end = Math.min(text.length, start + 4000);
  if (end < text.length && text.charCodeAt(end - 1) >= 55296 && text.charCodeAt(end - 1) <= 56319 && text.charCodeAt(end) >= 56320 && text.charCodeAt(end) <= 57343)
    --end;
  return { text: text.slice(start, end), nextOffset: end < text.length ? end : null };
}

// src/profile.ts
async function profileView(ctx, offsets = [0], expectedRevision) {
  const t = contextWords(ctx.locale), memory = ctx.domains.memory;
  const page = await memory.queries.profile({ offset: offsets[offsets.length - 1], limit: 4000, expectedRevision });
  return { kind: "detail", title: t.profile, content: [
    { kind: "text", text: page.text || (page.exists ? t.empty : t.absent) },
    { kind: "text", variant: "caption", text: `${page.totalLength ? page.offset + 1 : 0}-${page.offset + page.text.length} / ${page.totalLength}` }
  ], metadata: [{ kind: "label", label: t.profile, value: t.local }], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await profileView(ctx), navigation: "replace" }) },
    ...pageActions(ctx.locale, offsets, page.nextOffset, (next) => profileView(ctx, next, page.revision)),
    ...memory.commands && page.totalLength <= 16000 ? [{
      id: "edit",
      label: t.edit,
      icon: "pencil-simple",
      run: async () => ({ view: await editProfile(ctx, page.revision) })
    }] : []
  ] };
}
async function editProfile(ctx, expectedRevision) {
  const t = contextWords(ctx.locale), memory = ctx.domains.memory;
  const page = await memory.queries.profile({ limit: 16000, expectedRevision });
  if (page.nextOffset !== null)
    throw Object.assign(Error("Cannot edit an incomplete profile"), { code: "memory/invalid-input" });
  return { kind: "form", title: t.edit, submitLabel: t.save, fields: [
    { id: "summary", kind: "textarea", label: t.summary, value: page.text },
    { id: "confirm", kind: "checkbox", label: t.confirm, value: false }
  ], onSubmit: async (values) => {
    if (typeof values.summary !== "string" || values.summary.length > 16000)
      return { fieldErrors: { summary: t.tooLong } };
    if (values.confirm !== true)
      return { fieldErrors: { confirm: t.required } };
    const receipt = await memory.commands.updateProfile({ summary: values.summary, expectedRevision: page.revision });
    return { navigation: "replace", view: {
      kind: "detail",
      title: t.profile,
      content: [{ kind: "text", text: receipt.changed ? t.saved : t.unchanged }],
      actions: [{
        id: "refresh",
        label: t.refresh,
        icon: "arrows-clockwise",
        run: async () => ({ view: await profileView(ctx), navigation: "replace" })
      }]
    } };
  } };
}

// src/conversation-control-strings.ts
var en3 = {
  controls: "Conversation controls",
  current: "Selected global conversation",
  newDraft: "New global draft",
  selected: "Conversation selected",
  draftSelected: "New draft selected",
  select: "Select conversation",
  refresh: "Refresh",
  requests: "My turn requests",
  noRequests: "No retained requests",
  cancel: "Cancel request",
  draft: "Propose draft",
  send: "Request send",
  retry: "Request retry",
  text: "Message",
  invalidText: "Enter 1-65,536 characters",
  stop: "Stop conversation",
  stopped: "Stop completed",
  clear: "Clear conversation",
  cleared: "Conversation cleared",
  confirmClear: "Clear this conversation and its summary; keep long-term memories and event history",
  confirmRetry: "Retry the existing user message",
  confirm: "Confirm this action first",
  target: "Target",
  state: "State",
  messages: "Messages",
  inactive: "Not mounted",
  loading: "Loading",
  streaming: "Generating",
  idle: "Idle",
  pending: "Awaiting host confirmation",
  adopted: "Draft adopted",
  started: "Turn started",
  dismissed: "Dismissed",
  cancelled: "Cancelled",
  stale: "Conversation changed",
  failed: "Failed",
  expired: "Expired"
};
var zh2 = {
  controls: "对话控制",
  current: "当前选中的全局对话",
  newDraft: "新建全局草稿",
  selected: "已选择对话",
  draftSelected: "已选择新草稿",
  select: "选择对话",
  refresh: "刷新",
  requests: "我的回合请求",
  noRequests: "暂无保留请求",
  cancel: "取消请求",
  draft: "提交草稿",
  send: "请求发送",
  retry: "请求重试",
  text: "消息",
  invalidText: "请输入 1-65,536 个字符",
  stop: "停止对话",
  stopped: "停止操作已完成",
  clear: "清空对话",
  cleared: "对话已清空",
  confirmClear: "清空此对话及其摘要，保留长期记忆和事件历史",
  confirmRetry: "重试已有用户消息",
  confirm: "请先确认此操作",
  target: "目标",
  state: "状态",
  messages: "消息数",
  inactive: "未挂载",
  loading: "加载中",
  streaming: "生成中",
  idle: "空闲",
  pending: "等待宿主确认",
  adopted: "已采用草稿",
  started: "回合已开始",
  dismissed: "已拒绝",
  cancelled: "已取消",
  stale: "对话已变化",
  failed: "失败",
  expired: "已过期"
};
var conversationWords = (locale) => locale === "zh-Hans" ? zh2 : en3;

// src/turn-requests.ts
function requestDetail(ctx, request) {
  const t = conversationWords(ctx.locale);
  return { kind: "detail", title: t[request.action], content: [{ kind: "keyValue", rows: [
    { label: t.target, value: `${request.target.kind}:${request.target.id}` },
    { label: t.state, value: t[request.status] }
  ] }], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => {
      const current = (await ctx.domains.conversations.queries.turnRequests()).find((r) => r.id === request.id);
      if (!current)
        throw Object.assign(Error("Retained request missing"), { code: "ui/invalid-target" });
      return { view: requestDetail(ctx, current), navigation: "replace" };
    } },
    ...request.status === "pending" && ctx.domains.conversations.commands ? [{ id: "cancel", label: t.cancel, icon: "x", run: async () => {
      const receipt = await ctx.domains.conversations.commands.cancelTurnRequest(request.id);
      return { view: requestDetail(ctx, receipt), navigation: "replace" };
    } }] : []
  ] };
}
async function turnRequestsView(ctx, target, page = 0) {
  const t = conversationWords(ctx.locale);
  const requests = (await ctx.domains.conversations.queries.turnRequests()).filter((r) => !target || r.target.kind === target.kind && r.target.id === target.id).sort((a, b) => b.createdAt - a.createdAt);
  const current = Math.min(Math.max(0, page), Math.max(0, Math.ceil(requests.length / 40) - 1));
  return {
    kind: "list",
    title: t.requests,
    emptyText: t.noRequests,
    items: requests.slice(current * 40, (current + 1) * 40).map((r) => ({
      id: r.id,
      title: t[r.action],
      subtitle: `${t[r.status]} / ${r.target.kind}:${r.target.id}`,
      icon: "chat-circle",
      onSelect: () => ({ view: requestDetail(ctx, r) })
    })),
    actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await turnRequestsView(ctx, target, current), navigation: "replace" }) }
    ],
    pagination: {
      page: current + 1,
      ...current > 0 ? { onPrevious: async () => ({ view: await turnRequestsView(ctx, target, current - 1), navigation: "replace" }) } : {},
      ...(current + 1) * 40 < requests.length ? { onNext: async () => ({ view: await turnRequestsView(ctx, target, current + 1), navigation: "replace" }) } : {}
    }
  };
}

// src/conversation-controls.ts
function controlReceipt(ctx, target, title, status) {
  const t = conversationWords(ctx.locale);
  return {
    kind: "detail",
    title,
    content: [{ kind: "text", text: status }, { kind: "keyValue", rows: [{ label: t.target, value: `${target.kind}:${target.id}` }] }],
    actions: [{
      id: "refresh",
      label: t.refresh,
      icon: "arrows-clockwise",
      run: async () => ({ view: await conversationControls(ctx, target, title), navigation: "replace" })
    }]
  };
}
function proposal(ctx, target, action) {
  const t = conversationWords(ctx.locale);
  return {
    kind: "form",
    title: t[action],
    submitLabel: t[action],
    fields: action === "retry" ? [{ id: "confirm", kind: "checkbox", label: t.confirmRetry, value: false }] : [{ id: "text", kind: "textarea", label: t.text, value: "" }],
    onSubmit: async (values) => {
      if (action === "retry" && values.confirm !== true)
        return { fieldErrors: { confirm: t.confirm } };
      if (action !== "retry" && (typeof values.text !== "string" || !values.text.trim() || values.text.length > 65536))
        return { fieldErrors: { text: t.invalidText } };
      const receipt = await ctx.domains.conversations.commands.requestTurn(action === "retry" ? { target, action } : { target, action, text: values.text });
      return { close: true, toast: t[receipt.status] };
    }
  };
}
async function conversationControls(ctx, input, title) {
  const target = { ...input }, t = conversationWords(ctx.locale), domain = ctx.domains.conversations;
  const render = (runtime) => {
    const session = runtime.sessions.find((s) => s.kind === target.kind && s.id === target.id);
    const ready = session && !session.loading && !session.streaming;
    return { kind: "detail", title: `${title} / ${t.controls}`, content: [{ kind: "keyValue", rows: [
      { label: t.target, value: `${target.kind}:${target.id}` },
      { label: t.state, value: !session ? t.inactive : session.loading ? t.loading : session.streaming ? t.streaming : t.idle },
      ...session ? [{ label: t.messages, value: String(session.messageCount) }] : []
    ] }], actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await conversationControls(ctx, target, title), navigation: "replace" }) },
      { id: "requests", label: t.requests, icon: "list", run: async () => ({ view: await turnRequestsView(ctx, target) }) },
      ...domain.commands ? [
        ...target.kind === "global" ? [{ id: "select", label: t.select, icon: "chat-circle", run: async () => {
          const receipt = await domain.commands.selectThread(target.id);
          return { view: controlReceipt(ctx, receipt.target, title, t.selected), navigation: "replace" };
        } }] : [],
        ...ready ? ["draft", "send", ...session.messageCount > 0 ? ["retry"] : []].map((action) => ({
          id: action,
          label: t[action],
          icon: action === "retry" ? "arrow-clockwise" : "paper-plane-tilt",
          run: () => ({ view: proposal(ctx, target, action) })
        })) : [],
        { id: "stop", label: t.stop, icon: "stop", run: async () => {
          const receipt = await domain.commands.stop(target);
          return { view: controlReceipt(ctx, receipt.target, title, t.stopped), navigation: "replace" };
        } },
        { id: "clear", label: t.clear, icon: "trash", run: () => ({ view: {
          kind: "form",
          title: `${title} / ${t.clear}`,
          submitLabel: t.clear,
          fields: [
            { id: "confirm", kind: "checkbox", label: t.confirmClear, description: `${target.kind}:${target.id}`, value: false }
          ],
          onSubmit: async (values) => {
            if (values.confirm !== true)
              return { fieldErrors: { confirm: t.confirm } };
            const receipt = await domain.commands.clear(target);
            return { view: controlReceipt(ctx, receipt.target, title, t.cleared), navigation: "replace" };
          }
        } }) }
      ] : []
    ] };
  };
  const initial = await domain.queries.runtime();
  return { ...render(initial), live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = domain.events.observeRuntime(async (state) => {
      if (!disposed)
        await ctx.services.ui.publishView(channel, { revision: ++revision, view: render(state) });
    });
    return { dispose() {
      disposed = true;
      subscription.dispose();
    } };
  } } };
}

// src/conversation-summaries.ts
async function conversationSummaries(ctx, page = 0) {
  const t = contextWords(ctx.locale), threads = await ctx.domains.conversations.queries.listThreads();
  const c = conversationWords(ctx.locale), domain = ctx.domains.conversations;
  const current = Math.min(Math.max(page, 0), Math.max(0, Math.ceil(threads.length / 40) - 1));
  return {
    kind: "list",
    title: t.conversations,
    searchable: true,
    emptyText: t.noThreads,
    items: threads.slice(current * 40, (current + 1) * 40).map((thread) => ({
      id: thread.id,
      title: thread.title || t.untitled,
      subtitle: thread.updatedAt,
      icon: "chat-circle",
      onSelect: async () => ({ view: await conversationSummary(ctx, { kind: "global", id: thread.id }, thread.title || t.untitled) })
    })),
    actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await conversationSummaries(ctx, current), navigation: "replace" }) },
      { id: "current", label: c.current, icon: "chat-circle", run: async () => {
        const state = await domain.queries.runtime();
        return { view: await conversationControls(ctx, { kind: "global", id: state.selectedGlobalThreadId }, c.current) };
      } },
      { id: "requests", label: c.requests, icon: "list", run: async () => ({ view: await turnRequestsView(ctx) }) },
      ...domain.commands ? [{ id: "new", label: c.newDraft, icon: "plus", run: async () => {
        const receipt = await domain.commands.createThread();
        return { view: controlReceipt(ctx, receipt.target, c.newDraft, c.draftSelected) };
      } }] : []
    ],
    pagination: {
      page: current + 1,
      pageCount: Math.max(1, Math.ceil(threads.length / 40)),
      ...current ? { onPrevious: async () => ({ view: await conversationSummaries(ctx, current - 1), navigation: "replace" }) } : {},
      ...(current + 1) * 40 < threads.length ? { onNext: async () => ({ view: await conversationSummaries(ctx, current + 1), navigation: "replace" }) } : {}
    }
  };
}
async function conversationSummary(ctx, target, title) {
  const summary = await ctx.domains.conversations.queries.getInsights(target);
  const t = contextWords(ctx.locale);
  const render = (offsets) => {
    const offset = offsets[offsets.length - 1];
    const page = textPage(summary ?? "", offset);
    return { kind: "detail", title: `${title} / ${t.bookSummary}`, content: [
      { kind: "text", text: summary === null ? t.noSummary : summary === "" ? t.emptySummary : page.text },
      { kind: "text", variant: "caption", text: `${summary?.length ? offset + 1 : 0}-${offset + page.text.length} / ${summary?.length ?? 0}` }
    ], actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await conversationSummary(ctx, target, title), navigation: "replace" }) },
      ...pageActions(ctx.locale, offsets, page.nextOffset, render),
      {
        id: "controls",
        label: conversationWords(ctx.locale).controls,
        icon: "chat-circle",
        run: async () => ({ view: await conversationControls(ctx, target, title) })
      }
    ] };
  };
  return render([0]);
}

// src/views.ts
async function memoryDesk(ctx) {
  const t = strings(ctx.locale);
  return { kind: "list", title: t[0], items: [
    { id: "profile", title: contextWords(ctx.locale).profile, icon: "user", onSelect: async () => ({ view: await profileView(ctx) }) },
    { id: "user", title: t[1], icon: "brain", onSelect: async () => ({ view: await memories(ctx, "user") }) },
    { id: "global", title: t[2], icon: "brain", onSelect: async () => ({ view: await memories(ctx, "global") }) },
    { id: "books", title: t[3], icon: "books", onSelect: async () => ({ view: await booksView(ctx) }) },
    ...ctx.domains.conversations ? [{
      id: "conversations",
      title: contextWords(ctx.locale).conversations,
      icon: "chat-circle",
      onSelect: async () => ({ view: await conversationSummaries(ctx) })
    }] : []
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
        { id: "memory", title: t[5], icon: "brain", onSelect: async () => ({ view: await memories(ctx, `book:${book.id}`) }) },
        { id: "classification", title: classificationWords(ctx.locale)[0], icon: "book-open", onSelect: async () => ({ view: await classificationView(ctx, book.id) }) },
        ...ctx.domains.conversations ? [{
          id: "summary",
          title: contextWords(ctx.locale).bookSummary,
          icon: "chat-circle",
          onSelect: async () => ({ view: await conversationSummary(ctx, { kind: "book", id: book.id }, book.title) })
        }] : []
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
async function memories(ctx, scope, query, offsets = [0], expectedRevision) {
  const t = strings(ctx.locale), title = t[scope === "user" ? 1 : scope === "global" ? 2 : 5];
  const refresh = { id: "refresh", label: t[7], icon: "arrows-clockwise", run: async () => ({ view: await memories(ctx, scope, query), navigation: "replace" }) };
  return liveMemoryView(ctx, { kind: "page", query: {
    scopes: [scope],
    query,
    limit: 20,
    offset: offsets[offsets.length - 1],
    ...expectedRevision === undefined ? {} : { expectedRevision }
  } }, title, (result) => {
    if (result.kind !== "page")
      throw Error("Unexpected memory observation result");
    const page = result.page, rows = page.items;
    const go = async (next) => ({ view: await memories(ctx, scope, query, next, page.revision), navigation: "replace" });
    return {
      kind: "list",
      title,
      emptyText: t[8],
      pagination: {
        page: offsets.length,
        pageCount: Math.max(1, Math.ceil(page.total / 20)),
        ...offsets.length > 1 ? { onPrevious: () => go(offsets.slice(0, -1)) } : {},
        ...page.nextOffset === null ? {} : { onNext: () => go([...offsets, page.nextOffset]) }
      },
      items: rows.map((row) => ({
        id: row.id,
        title: row.content,
        subtitle: row.updatedAt,
        icon: "brain",
        onSelect: async () => ({ view: await memoryDetail(ctx, row.id, () => memories(ctx, scope, query)) })
      })),
      actions: [
        refresh,
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
  }, [refresh]);
}

// src/index.ts
var src_default = {
  activate(ctx) {
    if (!ctx.domains.memory || !ctx.domains.library || !ctx.domains.conversations || !ctx.domains.reading?.commands)
      throw Error("Memory Desk requires memory:read, library:read, conversations:read and reading:write");
    const title = strings(ctx.locale)[0];
    ctx.contributions.commands.register({ id: "open", title, icon: "brain", run: async () => ({ view: await memoryDesk(ctx) }) });
    for (const surface of ["shelf", "reader"])
      ctx.contributions.headerActions.register({ id: surface, title, icon: "brain", surface, presentation: "popup", view: () => memoryDesk(ctx) });
    ctx.contributions.headerActions.register({ id: "agent", title, icon: "brain", surface: "agent", view: (input) => {
      if (!input.thread)
        throw Object.assign(Error("Agent header target missing"), { code: "ui/unavailable" });
      return conversationControls(ctx, input.thread, title);
    } });
  }
};
export {
  src_default as default
};
