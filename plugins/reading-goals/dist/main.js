// src/goals.ts
var key = (bookId) => `goal:${bookId}`;
var invalid = () => {
  throw Object.assign(Error("Invalid reading goal"), { code: "plugin/invalid-input" });
};
function goalBookId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 512)
    return invalid();
  return value;
}
function parseGoal(value) {
  if (!value || typeof value !== "object")
    return invalid();
  const goal = value;
  if (typeof goal.text !== "string" || !goal.text.trim() || goal.text.trim().length > 500 || typeof goal.suggestMemory !== "boolean")
    return invalid();
  return { text: goal.text.trim(), suggestMemory: goal.suggestMemory };
}
async function readGoalState(ctx, input) {
  const bookId = goalBookId(input), storage = ctx.services.storage, collection = storage.collection("goals");
  let doc = await collection.get(bookId);
  if (!doc) {
    await storage.flush();
    const legacy = storage.get(key(bookId));
    if (legacy !== null) {
      const goal2 = parseGoal(legacy);
      await storage.applyDocuments([{
        kind: "put",
        collection: "goals",
        id: bookId,
        bookId,
        data: { version: 1, goal: goal2 },
        expectedRevision: null
      }]);
      doc = await collection.get(bookId);
      if (!doc)
        throw Object.assign(Error("Goal promotion disappeared"), { code: "plugin/unavailable" });
    }
  }
  if (!doc)
    return { bookId, goal: null, revision: null };
  if (doc.data?.version !== 1)
    return invalid();
  const goal = doc.data.goal === null ? null : parseGoal(doc.data.goal);
  if (storage.get(key(bookId)) !== null)
    await storage.remove(key(bookId));
  return { bookId, goal, revision: doc.revision };
}
async function readGoal(ctx, bookId) {
  return (await readGoalState(ctx, bookId)).goal;
}
async function writeGoal(ctx, input, goal, expectedRevision) {
  const bookId = goalBookId(input), value = goal === null ? null : parseGoal(goal);
  if (expectedRevision !== null && (typeof expectedRevision !== "string" || !expectedRevision.trim() || expectedRevision.length > 512))
    return invalid();
  if (value !== null && !await ctx.domains.library.queries.books.get(bookId)) {
    throw Object.assign(Error("Goal book is no longer available"), { code: "library/book-not-found" });
  }
  const receipt = await ctx.services.storage.applyDocuments([{
    kind: "put",
    collection: "goals",
    id: bookId,
    bookId,
    data: { version: 1, goal: value },
    expectedRevision
  }]);
  return { status: receipt.status === "conflict" ? "conflict" : value === null ? "cleared" : "saved", bookId };
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
var feedbackEn = { saved: "Goal saved", cleared: "Goal cleared", conflict: "The goal changed. Refresh before trying again.", confirm: "Clear this reading goal", required: "Confirm clearing first." };
var feedback = {
  en: feedbackEn,
  "zh-Hans": { saved: "目标已保存", cleared: "目标已清除", conflict: "目标已变化，请刷新后再试。", confirm: "清除此阅读目标", required: "请先确认清除。" },
  "zh-Hant": { saved: "目標已儲存", cleared: "目標已清除", conflict: "目標已變更，請重新整理後再試。", confirm: "清除此閱讀目標", required: "請先確認清除。" },
  ja: { saved: "目標を保存しました", cleared: "目標を削除しました", conflict: "目標が変更されました。更新してから再試行してください。", confirm: "この読書目標を削除", required: "削除を確認してください。" },
  de: { saved: "Ziel gespeichert", cleared: "Ziel gelöscht", conflict: "Das Ziel wurde geändert. Bitte zuerst aktualisieren.", confirm: "Dieses Leseziel löschen", required: "Bitte das Löschen bestätigen." },
  fr: { saved: "Objectif enregistré", cleared: "Objectif effacé", conflict: "L'objectif a changé. Actualisez avant de réessayer.", confirm: "Effacer cet objectif de lecture", required: "Confirmez d'abord la suppression." },
  es: { saved: "Objetivo guardado", cleared: "Objetivo borrado", conflict: "El objetivo ha cambiado. Actualiza antes de reintentar.", confirm: "Borrar este objetivo de lectura", required: "Confirma primero el borrado." },
  ru: { saved: "Цель сохранена", cleared: "Цель удалена", conflict: "Цель изменилась. Сначала обновите данные.", confirm: "Удалить эту цель чтения", required: "Сначала подтвердите удаление." }
};
function copy(locale) {
  return { ...copies[locale] ?? copies[locale.split("-")[0]] ?? en, ...feedback[locale] ?? feedback[locale.split("-")[0]] ?? feedbackEn };
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

// src/time-format.ts
function timeDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// src/insights-strings.ts
var en3 = {
  title: "Reading trends",
  period: "Period",
  week: "Last 7 days",
  month: "Last 30 days",
  year: "Last 365 days",
  all: "All time",
  open: "Show trends",
  total: "Reading time",
  days: "Active days",
  books: "Books read",
  average: "Per active day",
  change: "Change",
  none: "Not available",
  dates: "Date totals",
  hours: "Reading hours (all time)",
  achievements: "Milestones (all time)",
  streak: "Current streak",
  longest: "Longest streak",
  best: "Best day",
  next: "Next milestone",
  reference: "Reference day",
  refresh: "Refresh"
};
var copies3 = {
  en: en3,
  "zh-Hans": { title: "阅读趋势", period: "时间范围", week: "最近 7 天", month: "最近 30 天", year: "最近 365 天", all: "全部时间", open: "查看趋势", total: "阅读时长", days: "活跃天数", books: "阅读书数", average: "每活跃日", change: "变化", none: "暂无", dates: "按日期汇总", hours: "阅读时段（全部时间）", achievements: "里程碑（全部时间）", streak: "当前连续天数", longest: "最长连续天数", best: "最佳阅读日", next: "下一里程碑", reference: "参考日期", refresh: "刷新" },
  "zh-Hant": { title: "閱讀趨勢", period: "時間範圍", week: "最近 7 天", month: "最近 30 天", year: "最近 365 天", all: "全部時間", open: "查看趨勢", total: "閱讀時間", days: "活躍天數", books: "閱讀書數", average: "每活躍日", change: "變化", none: "暫無", dates: "按日期彙總", hours: "閱讀時段（全部時間）", achievements: "里程碑（全部時間）", streak: "目前連續天數", longest: "最長連續天數", best: "最佳閱讀日", next: "下一里程碑", reference: "參考日期", refresh: "重新整理" },
  ja: { title: "読書傾向", period: "期間", week: "過去7日", month: "過去30日", year: "過去365日", all: "全期間", open: "傾向を表示", total: "読書時間", days: "読書日数", books: "読んだ本", average: "読書日あたり", change: "変化", none: "なし", dates: "日付別合計", hours: "読書時間帯（全期間）", achievements: "到達点（全期間）", streak: "現在の連続日数", longest: "最長連続日数", best: "最も読んだ日", next: "次の到達点", reference: "基準日", refresh: "更新" },
  de: { title: "Lesetrends", period: "Zeitraum", week: "Letzte 7 Tage", month: "Letzte 30 Tage", year: "Letzte 365 Tage", all: "Gesamte Zeit", open: "Trends anzeigen", total: "Lesezeit", days: "Aktive Tage", books: "Gelesene Bücher", average: "Pro aktivem Tag", change: "Änderung", none: "Nicht verfügbar", dates: "Datumssummen", hours: "Lesezeiten (gesamt)", achievements: "Meilensteine (gesamt)", streak: "Aktuelle Serie", longest: "Längste Serie", best: "Bester Tag", next: "Nächster Meilenstein", reference: "Referenztag", refresh: "Aktualisieren" },
  fr: { title: "Tendances de lecture", period: "Période", week: "7 derniers jours", month: "30 derniers jours", year: "365 derniers jours", all: "Toute la période", open: "Voir les tendances", total: "Temps de lecture", days: "Jours actifs", books: "Livres lus", average: "Par jour actif", change: "Évolution", none: "Indisponible", dates: "Totaux par date", hours: "Heures de lecture (total)", achievements: "Jalons (total)", streak: "Série actuelle", longest: "Plus longue série", best: "Meilleur jour", next: "Prochain jalon", reference: "Jour de référence", refresh: "Actualiser" },
  es: { title: "Tendencias de lectura", period: "Período", week: "Últimos 7 días", month: "Últimos 30 días", year: "Últimos 365 días", all: "Todo el tiempo", open: "Ver tendencias", total: "Tiempo de lectura", days: "Días activos", books: "Libros leídos", average: "Por día activo", change: "Cambio", none: "No disponible", dates: "Totales por fecha", hours: "Horas de lectura (total)", achievements: "Hitos (total)", streak: "Racha actual", longest: "Mayor racha", best: "Mejor día", next: "Próximo hito", reference: "Día de referencia", refresh: "Actualizar" },
  ru: { title: "Тенденции чтения", period: "Период", week: "Последние 7 дней", month: "Последние 30 дней", year: "Последние 365 дней", all: "Всё время", open: "Показать тенденции", total: "Время чтения", days: "Активные дни", books: "Книг прочитано", average: "За активный день", change: "Изменение", none: "Нет данных", dates: "Итоги по датам", hours: "Часы чтения (всё время)", achievements: "Рубежи (всё время)", streak: "Текущая серия", longest: "Лучшая серия", best: "Лучший день", next: "Следующий рубеж", reference: "Опорная дата", refresh: "Обновить" }
};
function insightsCopy(locale) {
  return copies3[locale] ?? copies3[locale.split("-")[0]] ?? en3;
}

// src/insights-view.ts
var periods = ["week", "month", "year", "all"];
function readingInsightsForm(ctx, bookId) {
  const t = insightsCopy(ctx.locale);
  return { kind: "form", title: t.title, submitLabel: t.open, fields: [
    { kind: "choice", id: "period", label: t.period, value: "week", options: periods.map((value) => ({ value, label: t[value] })) }
  ], onSubmit: async (values) => ({ view: await readingInsightsView(ctx, { bookId, period: values.period }) }) };
}
async function readingInsightsView(ctx, query) {
  const t = insightsCopy(ctx.locale), reading = ctx.domains.reading;
  let sample = await reading.queries.stats.insights(query);
  const detail = (data, code) => ({ kind: "detail", title: t.title, content: [
    { kind: "text", text: t[data.period] },
    ...code ? [{ kind: "error", code }, { kind: "text", text: timeCopy(ctx.locale).lastSuccessful }] : [],
    { kind: "metric", label: t.total, value: timeDuration(data.totalMs) },
    { kind: "keyValue", rows: [
      { label: t.reference, value: data.asOfDay },
      { label: t.days, value: String(data.daysRead) },
      { label: t.books, value: String(data.booksRead) },
      { label: t.average, value: timeDuration(data.avgPerDayMs) },
      { label: t.change, value: data.deltaRatio === null ? t.none : `${(data.deltaRatio * 100).toFixed(1)}%` }
    ] }
  ], actions: [
    { id: "dates", label: t.dates, icon: "calendar", run: () => ({ view: {
      kind: "list",
      title: t.dates,
      items: data.bars.map((bar) => ({ id: bar.key, title: bar.key, accessories: [{ kind: "text", text: timeDuration(bar.ms) }] }))
    } }) },
    { id: "hours", label: t.hours, icon: "clock", run: () => ({ view: {
      kind: "list",
      title: t.hours,
      items: data.allTimeHourlyMs.map((ms, hour) => ({
        id: String(hour),
        title: `${String(hour).padStart(2, "0")}:00`,
        accessories: [{ kind: "text", text: timeDuration(ms) }]
      }))
    } }) },
    { id: "achievements", label: t.achievements, icon: "chart-line-up", run: () => ({ view: {
      kind: "detail",
      title: t.achievements,
      content: [{ kind: "keyValue", rows: [
        { label: t.total, value: timeDuration(data.achievements.totalMs) },
        { label: t.streak, value: String(data.achievements.currentStreak) },
        { label: t.longest, value: String(data.achievements.longestStreak) },
        { label: t.best, value: data.achievements.bestDayKey ? `${data.achievements.bestDayKey}: ${timeDuration(data.achievements.bestDayMs)}` : t.none },
        { label: t.next, value: data.achievements.nextMilestoneMs === null ? t.none : timeDuration(data.achievements.nextMilestoneMs) }
      ] }]
    } }) },
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await readingInsightsView(ctx, query), navigation: "replace" }) }
  ] });
  return { ...detail(sample), live: { subscribe(channel) {
    let disposed = false, revision = 0, dirty = false, running;
    const refresh = () => {
      dirty = true;
      if (running)
        return running;
      running = (async () => {
        while (dirty && !disposed) {
          dirty = false;
          let code;
          try {
            sample = await reading.queries.stats.insights(query);
          } catch (error) {
            code = typeof error?.code === "string" ? error.code : "reading/stats-unavailable";
          }
          if (!disposed)
            await ctx.services.ui.publishView(channel, { revision: ++revision, view: detail(sample, code) });
        }
      })().catch((error) => {
        console.warn("Reading trends publication failed", error);
      }).finally(() => {
        running = undefined;
      });
      return running;
    };
    const subscriptions = ["book.sessionRecorded", "book.timeRecorded"].map((type) => reading.events.subscribe(type, (event) => {
      if (!query.bookId || event.payload.bookId === query.bookId)
        refresh();
    }));
    refresh();
    return { dispose() {
      disposed = true;
      subscriptions.forEach((subscription) => subscription.dispose());
    } };
  } } };
}

// src/time-view.ts
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
    { id: "insights", label: insightsCopy(ctx.locale).title, icon: "chart-line-up", run: () => ({ view: readingInsightsForm(ctx, query.bookId) }) },
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
function receiptView(ctx, bookId, text) {
  const t = copy(ctx.locale);
  return { kind: "detail", title: t.title, content: [{ kind: "text", text }], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await goalsView(ctx, bookId), navigation: "replace" }) }
  ] };
}
async function goalsView(ctx, bookId) {
  const t = copy(ctx.locale);
  const target = bookId ?? (await ctx.domains.reading.queries.session()).bookId;
  if (!target)
    return { kind: "blocks", blocks: [{ kind: "text", text: t.noBook }] };
  const book = await ctx.domains.library.queries.books.get(target);
  if (!book)
    return { kind: "blocks", blocks: [{ kind: "text", text: t.noBook }] };
  const { goal, revision } = await readGoalState(ctx, target);
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
      const result = await writeGoal(ctx, target, { text, suggestMemory: values.suggestMemory }, revision);
      return { view: receiptView(ctx, target, result.status === "saved" ? t.saved : t.conflict), navigation: "replace" };
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
      ...goal ? [{ id: "clear", label: t.clear, icon: "trash", run: () => ({ view: {
        kind: "form",
        title: book.title,
        submitLabel: t.clear,
        fields: [{ kind: "checkbox", id: "confirm", label: t.confirm, value: false }],
        onSubmit: async (values) => {
          if (values.confirm !== true)
            return { fieldErrors: { confirm: t.required } };
          const result = await writeGoal(ctx, target, null, revision);
          return { view: receiptView(ctx, target, result.status === "cleared" ? t.cleared : t.conflict), navigation: "replace" };
        }
      } }) }] : [],
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: refresh },
      { id: "time", label: timeCopy(ctx.locale).title, icon: "clock", run: async () => ({ view: await readingTimeView(ctx, { bookId: target }) }) }
    ] }
  ] };
}

// src/tools.ts
var invalid2 = () => {
  throw Object.assign(Error("Invalid reading goal tool input"), { code: "plugin/invalid-input" });
};
function fields(params, allowed) {
  if (Object.keys(params).some((key2) => !allowed.includes(key2)))
    invalid2();
}
var bookIdSchema = { type: "string", minLength: 1, maxLength: 512 };
var revisionSchema = { anyOf: [bookIdSchema, { type: "null" }] };
function revision(value) {
  if (value === null)
    return null;
  if (typeof value !== "string" || !value.trim() || value.length > 512)
    return invalid2();
  return value;
}
function registerGoalTools(ctx) {
  if (!ctx.contributions.agentTools)
    throw Error("Reading Goals requires agent:tools");
  const t = copy(ctx.locale);
  ctx.contributions.agentTools.register({
    name: "get_reading_goal",
    label: t.title,
    contexts: ["book", "global"],
    description: "Read this plugin's saved goal and revision for an exact bookId, independent of the currently open reader. A null goal means no active goal; preserve its returned revision, including null, for subsequent writes. Legacy goals are promoted into versioned private documents on first access. Does not retrieve book text or create user memory.",
    parameters: { type: "object", properties: { bookId: bookIdSchema }, required: ["bookId"], additionalProperties: false },
    execute: async (params) => {
      fields(params, ["bookId"]);
      return readGoalState(ctx, goalBookId(params.bookId));
    }
  });
  ctx.contributions.agentTools.register({
    name: "set_reading_goal",
    label: t.save,
    contexts: ["book", "global"],
    approval: "required",
    description: "Save or replace a book's private reading goal after host approval of the exact text, bookId and suggestMemory flag. First get_reading_goal and pass its expectedRevision (null only for an absent record). Changed records return conflict. Text is 1..500 characters. suggestMemory must be explicit: true only opts this goal into the existing host-reviewed memory-candidate pipeline; it does not directly write memory or enable Build memory. The goal supplies context on subsequent book turns. Never edits the book, reading history, privacy settings or existing memories.",
    parameters: { type: "object", properties: { bookId: bookIdSchema, text: { type: "string", minLength: 1, maxLength: 500 }, suggestMemory: { type: "boolean" }, expectedRevision: revisionSchema }, required: ["bookId", "text", "suggestMemory", "expectedRevision"], additionalProperties: false },
    execute: async (params) => {
      fields(params, ["bookId", "text", "suggestMemory", "expectedRevision"]);
      const bookId = goalBookId(params.bookId), expectedRevision = revision(params.expectedRevision);
      const goal = parseGoal({ text: params.text, suggestMemory: params.suggestMemory });
      await readGoalState(ctx, bookId);
      return writeGoal(ctx, bookId, goal, expectedRevision);
    }
  });
  ctx.contributions.agentTools.register({
    name: "clear_reading_goal",
    label: t.clear,
    contexts: ["book", "global"],
    approval: "required",
    description: "Clear one private reading goal after host approval. First get_reading_goal and pass its exact expectedRevision; conflicts do not erase newer edits. A cleared record retains a versioned tombstone to prevent legacy goal resurrection. Stops future goal context/candidates but does not retract memory already accepted by the host or cancel a running turn. Can clear an orphaned goal after its book has been removed. Does not remove the book or change memory policy.",
    parameters: { type: "object", properties: { bookId: bookIdSchema, expectedRevision: revisionSchema }, required: ["bookId", "expectedRevision"], additionalProperties: false },
    execute: async (params) => {
      fields(params, ["bookId", "expectedRevision"]);
      const bookId = goalBookId(params.bookId), expectedRevision = revision(params.expectedRevision);
      await readGoalState(ctx, bookId);
      return writeGoal(ctx, bookId, null, expectedRevision);
    }
  });
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
    ctx.contributions.commands.register({ id: "insights", title: insightsCopy(ctx.locale).title, icon: "chart-line-up", run: () => ({ view: readingInsightsForm(ctx) }) });
    registerGoalTools(ctx);
    agentContextProviders.register({ id: "reading-goal", contexts: ["book"], provide: async ({ scope }) => {
      const goal = scope.kind === "book" ? await readGoal(ctx, scope.bookId) : null;
      return goal ? [{ title, content: goal.text }] : [];
    } });
    memoryCandidateProviders.register({ id: "reading-goal", contexts: ["book"], propose: async ({ scope }) => {
      const goal = scope.kind === "book" ? await readGoal(ctx, scope.bookId) : null;
      return goal?.suggestMemory ? [{ scope: "book", kind: "preference", content: goal.text }] : [];
    } });
  },
  migrate(_ctx, migration) {
    if (migration.direction !== "upgrade" || migration.fromVersion > 1 || migration.toVersion !== 2)
      throw Error("Unsupported Reading Goals schema migration");
  }
};
export {
  src_default as default
};
