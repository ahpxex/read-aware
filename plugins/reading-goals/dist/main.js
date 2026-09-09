// src/goals.ts
var key = (bookId) => `goal:${bookId}`;
function readGoal(ctx, bookId) {
  const value = ctx.services.storage.get(key(bookId));
  if (value === null)
    return null;
  if (typeof value.text !== "string" || typeof value.suggestMemory !== "boolean")
    throw new Error("Invalid stored reading goal");
  return value;
}
function saveGoal(ctx, bookId, goal) {
  return ctx.services.storage.set(key(bookId), goal);
}
function clearGoal(ctx, bookId) {
  return ctx.services.storage.remove(key(bookId));
}

// src/strings.ts
var en = {
  title: "Reading Goals",
  goal: "Reading goal",
  remember: "Suggest this goal as book memory",
  save: "Save goal",
  clear: "Clear goal",
  memory: "Build long-term memory",
  apply: "Apply",
  noBook: "No book is open.",
  invalid: "Enter a goal of 1 to 500 characters.",
  refresh: "Refresh"
};
var copies = {
  en,
  "zh-Hans": { title: "阅读目标", goal: "阅读目标", remember: "将此目标作为本书记忆候选", save: "保存目标", clear: "清除目标", memory: "构建长期记忆", apply: "应用", noBook: "当前没有打开的书籍。", invalid: "请输入 1 至 500 个字符的目标。", refresh: "刷新" },
  "zh-Hant": { title: "閱讀目標", goal: "閱讀目標", remember: "將此目標作為本書記憶候選", save: "儲存目標", clear: "清除目標", memory: "建立長期記憶", apply: "套用", noBook: "目前沒有開啟的書籍。", invalid: "請輸入 1 至 500 個字元的目標。", refresh: "重新整理" },
  ja: { title: "読書目標", goal: "読書目標", remember: "この目標を本のメモリ候補にする", save: "目標を保存", clear: "目標を削除", memory: "長期メモリを作成", apply: "適用", noBook: "本が開かれていません。", invalid: "1〜500文字の目標を入力してください。", refresh: "更新" },
  de: { title: "Leseziele", goal: "Leseziel", remember: "Dieses Ziel als Buchgedächtnis vorschlagen", save: "Ziel speichern", clear: "Ziel löschen", memory: "Langzeitgedächtnis aufbauen", apply: "Anwenden", noBook: "Kein Buch geöffnet.", invalid: "Gib ein Ziel mit 1 bis 500 Zeichen ein.", refresh: "Aktualisieren" },
  fr: { title: "Objectifs de lecture", goal: "Objectif de lecture", remember: "Proposer cet objectif comme mémoire du livre", save: "Enregistrer", clear: "Effacer l'objectif", memory: "Créer une mémoire à long terme", apply: "Appliquer", noBook: "Aucun livre ouvert.", invalid: "Saisissez un objectif de 1 à 500 caractères.", refresh: "Actualiser" },
  es: { title: "Objetivos de lectura", goal: "Objetivo de lectura", remember: "Proponer este objetivo como memoria del libro", save: "Guardar objetivo", clear: "Borrar objetivo", memory: "Crear memoria a largo plazo", apply: "Aplicar", noBook: "No hay ningún libro abierto.", invalid: "Escribe un objetivo de entre 1 y 500 caracteres.", refresh: "Actualizar" },
  ru: { title: "Цели чтения", goal: "Цель чтения", remember: "Предложить цель для памяти книги", save: "Сохранить цель", clear: "Удалить цель", memory: "Создавать долговременную память", apply: "Применить", noBook: "Книга не открыта.", invalid: "Введите цель длиной от 1 до 500 символов.", refresh: "Обновить" }
};
function copy(locale) {
  return copies[locale] ?? copies[locale.split("-")[0]] ?? en;
}

// src/time-strings.ts
var en2 = {
  title: "Reading time",
  allBooks: "All books",
  active: "Active reading",
  settled: "Settled",
  pending: "Pending sessions",
  sampledAt: "Sampled at (UTC)",
  day: "Calendar day",
  empty: "No pending sessions",
  refresh: "Refresh",
  next: "Next page",
  lastActivity: "Last activity (UTC)",
  positionAt: "Position observed (UTC)",
  noPosition: "No position",
  lastSuccessful: "Last successful sample",
  allTime: "All time",
  today: "Today"
};
var copies2 = {
  en: en2,
  "zh-Hans": { title: "阅读时长", allBooks: "全部书籍", active: "有效阅读", settled: "已结算", pending: "待结算会话", sampledAt: "采样时间（UTC）", day: "日期", empty: "没有待结算会话", refresh: "刷新", next: "下一页", lastActivity: "最近活动（UTC）", positionAt: "位置观测（UTC）", noPosition: "无位置", lastSuccessful: "上次成功的采样", allTime: "全部时间", today: "今天" },
  "zh-Hant": { title: "閱讀時間", allBooks: "全部書籍", active: "有效閱讀", settled: "已結算", pending: "待結算工作階段", sampledAt: "取樣時間（UTC）", day: "日期", empty: "沒有待結算工作階段", refresh: "重新整理", next: "下一頁", lastActivity: "最近活動（UTC）", positionAt: "位置觀測（UTC）", noPosition: "無位置", lastSuccessful: "上次成功的取樣", allTime: "全部時間", today: "今天" },
  ja: { title: "読書時間", allBooks: "すべての本", active: "実読書時間", settled: "確定済み", pending: "未確定セッション", sampledAt: "取得時刻（UTC）", day: "日付", empty: "未確定セッションなし", refresh: "更新", next: "次のページ", lastActivity: "最終活動（UTC）", positionAt: "位置の観測（UTC）", noPosition: "位置なし", lastSuccessful: "最後に取得した値", allTime: "全期間", today: "今日" },
  de: { title: "Lesezeit", allBooks: "Alle Bücher", active: "Aktive Lesezeit", settled: "Abgeschlossen", pending: "Offene Sitzungen", sampledAt: "Erfasst (UTC)", day: "Kalendertag", empty: "Keine offenen Sitzungen", refresh: "Aktualisieren", next: "Nächste Seite", lastActivity: "Letzte Aktivität (UTC)", positionAt: "Position erfasst (UTC)", noPosition: "Keine Position", lastSuccessful: "Letzte erfolgreiche Messung", allTime: "Gesamter Zeitraum", today: "Heute" },
  fr: { title: "Temps de lecture", allBooks: "Tous les livres", active: "Lecture active", settled: "Consolidé", pending: "Sessions en attente", sampledAt: "Relevé (UTC)", day: "Jour", empty: "Aucune session en attente", refresh: "Actualiser", next: "Page suivante", lastActivity: "Dernière activité (UTC)", positionAt: "Position observée (UTC)", noPosition: "Aucune position", lastSuccessful: "Dernier relevé réussi", allTime: "Toute la période", today: "Aujourd’hui" },
  es: { title: "Tiempo de lectura", allBooks: "Todos los libros", active: "Lectura activa", settled: "Consolidado", pending: "Sesiones pendientes", sampledAt: "Muestra (UTC)", day: "Día", empty: "Sin sesiones pendientes", refresh: "Actualizar", next: "Página siguiente", lastActivity: "Última actividad (UTC)", positionAt: "Posición observada (UTC)", noPosition: "Sin posición", lastSuccessful: "Última muestra válida", allTime: "Todo el tiempo", today: "Hoy" },
  ru: { title: "Время чтения", allBooks: "Все книги", active: "Активное чтение", settled: "Учтено", pending: "Открытые сеансы", sampledAt: "Замер (UTC)", day: "День", empty: "Нет открытых сеансов", refresh: "Обновить", next: "Следующая страница", lastActivity: "Активность (UTC)", positionAt: "Позиция (UTC)", noPosition: "Нет позиции", lastSuccessful: "Последний успешный замер", allTime: "Всё время", today: "Сегодня" }
};
function timeCopy(locale) {
  return copies2[locale] ?? copies2[locale.split("-")[0]] ?? en2;
}

// src/time-view.ts
function timeDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function today() {
  const now = new Date;
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
async function readingTimeView(ctx, query = {}) {
  const reading = ctx.domains.reading, t = timeCopy(ctx.locale);
  let sample = await reading.queries.stats.time({ ...query, limit: 10 });
  const book = query.bookId ? await ctx.domains.library.queries.books.get(query.bookId) : null;
  const title = book?.title ?? t.allBooks;
  const pendingView = async (after) => {
    const page = await reading.queries.stats.time({ ...query, after, limit: 25 });
    return {
      kind: "list",
      title: t.pending,
      emptyText: t.empty,
      items: page.pending.map((bucket) => ({
        id: `${bucket.bookId}/${bucket.localDay}/${bucket.localHour}`,
        title: `${bucket.localDay} ${String(bucket.localHour).padStart(2, "0")}:00`,
        subtitle: bucket.bookId,
        accessories: [{ kind: "text", text: timeDuration(bucket.ms) }],
        onSelect: () => ({ view: { kind: "detail", title: t.pending, content: [
          { kind: "text", text: bucket.bookId },
          { kind: "keyValue", rows: [
            { label: t.pending, value: timeDuration(bucket.ms) },
            { label: t.lastActivity, value: new Date(bucket.lastAt).toISOString() },
            { label: t.positionAt, value: bucket.positionAt === null ? t.noPosition : new Date(bucket.positionAt).toISOString() }
          ] }
        ] } })
      })),
      actions: [
        { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await pendingView(after), navigation: "replace" }) },
        ...page.nextCursor ? [{ id: "next", label: t.next, icon: "arrow-right", run: async () => ({ view: await pendingView(page.nextCursor) }) }] : []
      ]
    };
  };
  const content = (snapshot, failure) => ({ kind: "detail", title: t.title, content: [
    { kind: "text", text: title },
    ...failure ? [{ kind: "error", code: failure }, { kind: "text", text: t.lastSuccessful }] : [],
    { kind: "metric", label: t.active, value: timeDuration(snapshot.totalMs) },
    { kind: "keyValue", rows: [
      { label: t.settled, value: timeDuration(snapshot.settledMs) },
      { label: t.pending, value: timeDuration(snapshot.pendingMs) },
      { label: t.sampledAt, value: new Date(snapshot.observedAtEpochMs).toISOString() },
      { label: t.day, value: query.localDay ?? t.allTime }
    ] }
  ], actions: [
    { id: "pending", label: t.pending, icon: "clock", run: async () => ({ view: await pendingView() }) },
    { id: "today", label: t.today, icon: "calendar", run: async () => ({ view: await readingTimeView(ctx, { bookId: query.bookId, localDay: today() }), navigation: "replace" }) },
    { id: "all-time", label: t.allTime, icon: "clock", run: async () => ({ view: await readingTimeView(ctx, { bookId: query.bookId }), navigation: "replace" }) },
    ...query.bookId ? [{ id: "all-books", label: t.allBooks, icon: "books", run: async () => ({ view: await readingTimeView(ctx, { localDay: query.localDay }) }) }] : []
  ] });
  return { ...content(sample), live: { subscribe(channel) {
    let revision = 0;
    return reading.events.observeTime({ ...query, limit: 10 }, async (event) => {
      if (event.status === "ready")
        sample = event.snapshot;
      await ctx.services.ui.publishView(channel, { revision: ++revision, view: content(sample, event.status === "error" ? event.errorCode : undefined) });
    });
  } } };
}

// src/views.ts
async function goalsView(ctx, bookId) {
  const t = copy(ctx.locale);
  const target = bookId ?? (await ctx.domains.reading.queries.session()).bookId;
  if (!target)
    return { kind: "blocks", blocks: [{ kind: "text", text: t.noBook }] };
  const book = await ctx.domains.library.queries.books.get(target);
  if (!book)
    return { kind: "blocks", blocks: [{ kind: "text", text: t.noBook }] };
  const goal = readGoal(ctx, target);
  const setting = await ctx.domains.settings.queries.read("ai.preferences.buildMemory");
  const refresh = async () => ({ view: await goalsView(ctx, target), navigation: "replace" });
  const goalForm = {
    kind: "form",
    title: book.title,
    submitLabel: t.save,
    fields: [
      { kind: "textarea", id: "goal", label: t.goal, value: goal?.text ?? "", rows: 4 },
      { kind: "checkbox", id: "suggestMemory", label: t.remember, value: goal?.suggestMemory ?? false }
    ],
    onSubmit: async (values) => {
      const text = typeof values.goal === "string" ? values.goal.trim() : "";
      if (!text || text.length > 500)
        return { fieldErrors: { goal: t.invalid } };
      if (typeof values.suggestMemory !== "boolean")
        return { fieldErrors: { suggestMemory: t.invalid } };
      if (!await ctx.domains.library.queries.books.get(target))
        throw new Error("Goal book is no longer available");
      await saveGoal(ctx, target, { text, suggestMemory: values.suggestMemory });
      return refresh();
    }
  };
  const policyForm = {
    kind: "form",
    title: "ReadAware",
    submitLabel: t.apply,
    fields: [{ kind: "toggle", id: "enabled", label: t.memory, value: setting.value === true }],
    onSubmit: async (values) => {
      if (typeof values.enabled !== "boolean")
        throw new Error("Invalid memory preference");
      await ctx.domains.settings.commands.update([{ path: "ai.preferences.buildMemory", value: values.enabled }]);
      return refresh();
    }
  };
  return { kind: "blocks", blocks: [
    { kind: "text", text: book.title },
    goalForm,
    { kind: "text", text: "ReadAware" },
    policyForm,
    { kind: "actions", actions: [
      ...goal ? [{ id: "clear", label: t.clear, icon: "trash", run: async () => {
        await clearGoal(ctx, target);
        return refresh();
      } }] : [],
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: refresh },
      { id: "time", label: timeCopy(ctx.locale).title, icon: "clock", run: async () => ({ view: await readingTimeView(ctx, { bookId: target }) }) }
    ] }
  ] };
}

// src/index.ts
var src_default = {
  activate(ctx) {
    const { agentContextProviders, memoryCandidateProviders } = ctx.contributions;
    if (!ctx.domains.reading || !ctx.domains.library || !agentContextProviders || !memoryCandidateProviders)
      throw new Error("Reading Goals capabilities unavailable");
    const title = copy(ctx.locale).title;
    ctx.contributions.headerActions.register({ id: "goals", title, icon: "notebook", surface: "reader", presentation: "popup", view: () => goalsView(ctx) });
    ctx.contributions.commands.register({ id: "open", title, icon: "notebook", run: async () => ({ view: await goalsView(ctx) }) });
    ctx.contributions.headerActions.register({ id: "reading-time", title: timeCopy(ctx.locale).title, icon: "clock", surface: "shelf", presentation: "popup", view: () => readingTimeView(ctx) });
    ctx.contributions.commands.register({ id: "time", title: timeCopy(ctx.locale).title, icon: "clock", run: async () => ({ view: await readingTimeView(ctx) }) });
    agentContextProviders.register({ id: "reading-goal", contexts: ["book"], provide: ({ scope }) => {
      const goal = scope.kind === "book" ? readGoal(ctx, scope.bookId) : null;
      return goal ? [{ title, content: goal.text }] : [];
    } });
    memoryCandidateProviders.register({ id: "reading-goal", contexts: ["book"], propose: ({ scope }) => {
      const goal = scope.kind === "book" ? readGoal(ctx, scope.bookId) : null;
      return goal?.suggestMemory ? [{ scope: "book", kind: "preference", content: goal.text }] : [];
    } });
  }
};
export {
  src_default as default
};
