// src/strings.ts
var locales = ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"];
var labels = {
  openPanel: ["Open:", "打开：", "開啟：", "開く：", "Открыть:", "Ouvrir :", "Öffnen:", "Abrir:"],
  closePanel: ["Close:", "关闭：", "關閉：", "閉じる：", "Закрыть:", "Fermer :", "Schließen:", "Cerrar:"],
  toc: ["Contents", "目录", "目錄", "目次", "Оглавление", "Sommaire", "Inhaltsverzeichnis", "Índice"],
  annotations: ["Annotations", "标注", "標註", "注釈", "Аннотации", "Annotations", "Anmerkungen", "Anotaciones"],
  appearance: ["Appearance", "外观", "外觀", "表示", "Оформление", "Apparence", "Darstellung", "Apariencia"],
  chat: ["Chat", "聊天", "聊天", "チャット", "Чат", "Discussion", "Chat", "Chat"],
  showControls: ["Show reader controls", "显示阅读工具栏", "顯示閱讀工具列", "読書ツールバーを表示", "Показать панель чтения", "Afficher les commandes de lecture", "Lesesteuerung anzeigen", "Mostrar controles de lectura"],
  hideControls: ["Hide reader controls", "隐藏阅读工具栏", "隱藏閱讀工具列", "読書ツールバーを隠す", "Скрыть панель чтения", "Masquer les commandes de lecture", "Lesesteuerung ausblenden", "Ocultar controles de lectura"],
  offline: ["System reports offline", "系统报告离线", "系統回報離線", "システムはオフラインと報告", "Система сообщает об отсутствии сети", "Le système indique un état hors ligne", "System meldet offline", "El sistema indica que no hay conexión"],
  provider: ["Reading mode provider", "阅读模式提供者", "閱讀模式提供者", "読書モードの提供元", "Поставщик режима чтения", "Fournisseur du mode de lecture", "Lesemodus-Anbieter", "Proveedor del modo de lectura"],
  title: ["Listening Desk", "朗读台", "朗讀台", "読み上げ", "Чтение вслух", "Lecture audio", "Vorlesen", "Lectura en voz alta"],
  start: ["Start", "开始", "開始", "開始", "Начать", "Démarrer", "Starten", "Iniciar"],
  stop: ["Stop", "停止", "停止", "停止", "Остановить", "Arrêter", "Stoppen", "Detener"],
  refresh: ["Refresh", "刷新", "重新整理", "更新", "Обновить", "Actualiser", "Aktualisieren", "Actualizar"],
  back: ["Back", "后退", "返回", "戻る", "Назад", "Retour", "Zurück", "Atrás"],
  forward: ["Forward", "前进", "前進", "進む", "Вперёд", "Suivant", "Vorwärts", "Adelante"],
  enabled: ["Enabled", "启用", "啟用", "有効", "Включено", "Activé", "Aktiviert", "Activado"],
  unit: ["Unit", "单位", "單位", "単位", "Единица", "Unité", "Einheit", "Unidad"],
  apply: ["Apply", "应用", "套用", "適用", "Применить", "Appliquer", "Anwenden", "Aplicar"],
  returnToUnit: ["Current passage", "回到当前段落", "回到目前段落", "現在の文章へ", "Текущий отрывок", "Passage actuel", "Aktueller Abschnitt", "Pasaje actual"],
  nextUnit: ["Next unit", "下一单元", "下一單元", "次の単位", "Следующая единица", "Unité suivante", "Nächste Einheit", "Unidad siguiente"],
  previousUnit: ["Previous unit", "上一单元", "上一單元", "前の単位", "Предыдущая единица", "Unité précédente", "Vorherige Einheit", "Unidad anterior"],
  "start-of-book": ["Start of book", "已到书首", "已到書首", "本の先頭", "Начало книги", "Début du livre", "Buchanfang", "Inicio del libro"],
  "end-of-book": ["End of book", "已到书尾", "已到書尾", "本の末尾", "Конец книги", "Fin du livre", "Buchende", "Fin del libro"],
  invalid: ["Choose a valid value", "请选择有效值", "請選擇有效值", "有効な値を選択", "Выберите допустимое значение", "Choisissez une valeur valide", "Gültigen Wert wählen", "Elige un valor válido"],
  unavailable: ["Unavailable", "不可用", "無法使用", "利用不可", "Недоступно", "Indisponible", "Nicht verfügbar", "No disponible"],
  stopped: ["Stopped", "已停止", "已停止", "停止中", "Остановлено", "Arrêtée", "Gestoppt", "Detenida"],
  preparing: ["Preparing audio", "正在准备音频", "正在準備音訊", "音声を準備中", "Подготовка звука", "Préparation audio", "Audio wird vorbereitet", "Preparando audio"],
  playing: ["Playing", "正在朗读", "正在朗讀", "読み上げ中", "Воспроизведение", "En cours", "Wiedergabe", "Reproduciendo"],
  advancing: ["Next passage", "下一段", "下一段", "次の文章", "Следующий отрывок", "Passage suivant", "Nächster Abschnitt", "Siguiente pasaje"],
  error: ["Playback failed", "朗读失败", "朗讀失敗", "読み上げ失敗", "Ошибка воспроизведения", "Échec audio", "Wiedergabe fehlgeschlagen", "Error de reproducción"],
  system: ["System voice", "系统声音", "系統聲音", "システム音声", "Системный голос", "Voix système", "Systemstimme", "Voz del sistema"],
  plugin: ["Plugin voice", "插件声音", "外掛聲音", "プラグイン音声", "Голос плагина", "Voix du plugin", "Plugin-Stimme", "Voz del complemento"],
  fallback: ["System fallback", "系统声音回退", "系統聲音備援", "システム音声に切替", "Резервный системный голос", "Repli sur la voix système", "Systemstimme als Ersatz", "Voz del sistema de respaldo"],
  "no-session": ["No open book", "尚未打开书籍", "尚未開啟書籍", "本が開いていません", "Книга не открыта", "Aucun livre ouvert", "Kein Buch geöffnet", "Ningún libro abierto"],
  "mode-inactive": ["Text-unit mode is inactive", "句段阅读模式未开启", "句段閱讀模式未開啟", "文章単位モードは無効", "Режим отрывков выключен", "Mode par passage inactif", "Abschnittsmodus ist inaktiv", "Modo por pasajes inactivo"],
  "no-voice": ["No voice available", "没有可用声音", "沒有可用聲音", "音声を利用できません", "Нет доступного голоса", "Aucune voix disponible", "Keine Stimme verfügbar", "No hay voz disponible"],
  "no-unit": ["No current passage", "当前没有段落", "目前沒有段落", "現在の文章なし", "Нет текущего отрывка", "Aucun passage actuel", "Kein aktueller Abschnitt", "Sin pasaje actual"]
};
function tr(locale, key) {
  return labels[key][Math.max(0, locales.indexOf(locale))];
}

// src/monitor-strings.ts
var en = {
  title: "Live reading status",
  layout: "Panel widths",
  width: "Preferred width for all books (CSS px)",
  saved: "Panel width saved",
  invalidWidth: "Enter a whole number from 240 to 640.",
  layoutMode: "Panel layout",
  docked: "Docked",
  exclusive: "Exclusive",
  unknown: "Unavailable",
  reader: "Reader",
  idle: "No open book",
  loading: "Loading",
  ready: "Ready",
  error: "Reader failed",
  mode: "Text-unit mode",
  modeError: "Text-unit mode failed",
  inactive: "Inactive",
  preparing: "Preparing",
  empty: "No units",
  progress: "Current section unit",
  panels: "Panels",
  open: "Open",
  closed: "Closed",
  visible: "Visible",
  hidden: "Hidden",
  network: "System network hint",
  online: "Online",
  offline: "Offline",
  networkUnknown: "Unknown"
};
var zh = {
  title: "实时阅读状态",
  layout: "面板宽度",
  width: "所有书籍的首选宽度（CSS 像素）",
  saved: "面板宽度已保存",
  invalidWidth: "请输入 240 到 640 之间的整数。",
  layoutMode: "面板布局",
  docked: "并排",
  exclusive: "互斥",
  unknown: "不可用",
  reader: "阅读器",
  idle: "尚未打开书籍",
  loading: "正在加载",
  ready: "已就绪",
  error: "阅读器出错",
  mode: "句段模式",
  modeError: "句段模式出错",
  inactive: "未启用",
  preparing: "正在准备",
  empty: "没有单元",
  progress: "当前分节单元",
  panels: "面板",
  open: "已打开",
  closed: "已关闭",
  visible: "可见",
  hidden: "隐藏",
  network: "系统网络提示",
  online: "在线",
  offline: "离线",
  networkUnknown: "未知"
};
var monitorCopy = (locale) => locale.startsWith("zh") ? zh : en;

// src/panel-widths.ts
async function panelWidths(ctx, signal) {
  signal.throwIfAborted();
  const t = monitorCopy(ctx.locale), reader = ctx.services.ui.reader;
  const session = await ctx.domains.reading.queries.session();
  const panels = await reader.snapshot();
  signal.throwIfAborted();
  if (session.status !== "ready" || !panels || session.sessionId !== panels.sessionId || session.bookId !== panels.bookId) {
    throw Object.assign(Error("Reader panel session unavailable"), { code: "reader/unavailable" });
  }
  const guard = { sessionId: panels.sessionId, bookId: panels.bookId };
  return {
    kind: "list",
    title: t.layout,
    items: ["toc", "chat"].map((panel) => ({
      id: panel,
      title: tr(ctx.locale, panel),
      subtitle: `${panels.sizes[panel]} px`,
      ...reader?.setWidth ? { onSelect: () => ({ view: {
        kind: "form",
        title: tr(ctx.locale, panel),
        submitLabel: tr(ctx.locale, "apply"),
        fields: [{ kind: "number", id: "width", label: t.width, value: panels.sizes[panel], min: 240, max: 640, step: 1 }],
        onSubmit: async (values) => {
          if (typeof values.width !== "number" || !Number.isInteger(values.width) || values.width < 240 || values.width > 640) {
            return { fieldErrors: { width: t.invalidWidth } };
          }
          signal.throwIfAborted();
          const receipt = await reader.setWidth(panel, values.width, guard);
          signal.throwIfAborted();
          return { view: {
            kind: "detail",
            title: t.saved,
            content: [{ kind: "keyValue", rows: [
              { label: tr(ctx.locale, panel), value: `${receipt.snapshot.sizes[panel]} px` }
            ] }],
            actions: [{
              id: "refresh",
              label: tr(ctx.locale, "refresh"),
              icon: "arrows-clockwise",
              run: async () => ({ view: await panelWidths(ctx, signal), navigation: "replace" })
            }]
          }, navigation: "replace" };
        }
      } }) } : {}
    })),
    actions: [{
      id: "refresh",
      label: tr(ctx.locale, "refresh"),
      icon: "arrows-clockwise",
      run: async () => ({ view: await panelWidths(ctx, signal), navigation: "replace" })
    }]
  };
}

// src/monitor.ts
async function readingMonitor(ctx, signal) {
  signal.throwIfAborted();
  const reading = ctx.domains.reading, reader = ctx.services.ui.reader, t = monitorCopy(ctx.locale);
  let session = await reading.queries.session();
  let environment = await ctx.services.session.environment();
  let panels = await reader.snapshot();
  signal.throwIfAborted();
  const render = () => {
    const { playback, mode } = session;
    const matching = panels?.sessionId === session.sessionId && panels?.bookId === session.bookId ? panels : null;
    const errors = [...new Set([session.errorCode, mode.errorCode, playback.errorCode].filter((code) => Boolean(code)))];
    const content = [
      ...errors.map((code) => ({ kind: "error", code })),
      { kind: "keyValue", rows: [
        { label: t.reader, value: t[session.status] },
        { label: t.mode, value: mode.status === "unavailable" ? t.unknown : mode.status === "error" ? t.modeError : t[mode.status] },
        { label: tr(ctx.locale, "title"), value: tr(ctx.locale, playback.status) },
        { label: t.network, value: environment.networkHint === "unknown" ? t.networkUnknown : t[environment.networkHint] },
        { label: t.layoutMode, value: matching ? t[matching.layout] : t.unknown }
      ] },
      ...playback.unavailableReason ? [{ kind: "text", text: tr(ctx.locale, playback.unavailableReason) }] : [],
      ...playback.backend ? [{ kind: "text", text: tr(ctx.locale, playback.fallback ? "fallback" : playback.backend) }] : []
    ];
    if (["preparing", "advancing"].includes(playback.status))
      content.push({ kind: "progress", value: null, label: tr(ctx.locale, playback.status) });
    if (mode.progress && mode.progress.total > 0)
      content.push({ kind: "keyValue", rows: [{ label: t.progress, value: `${mode.progress.ordinal + 1} / ${mode.progress.total}` }] });
    if (matching)
      content.push({ kind: "heading", text: t.panels }, {
        kind: "keyValue",
        rows: ["toc", "chat", "annotations", "appearance"].map((panel) => ({
          label: tr(ctx.locale, panel),
          value: `${matching.panels[panel].open ? t.open : t.closed} / ${matching.panels[panel].visible ? t.visible : t.hidden}`
        }))
      });
    const busy = ["preparing", "playing", "advancing"].includes(playback.status);
    const ready = session.status === "ready" && session.sessionId && session.bookId;
    const guard = { sessionId: session.sessionId ?? undefined, bookId: session.bookId ?? undefined };
    const action = busy ? "stop" : "start";
    return { kind: "detail", title: t.title, content, actions: [
      ...ready && reading.commands && (busy || !playback.unavailableReason) ? [{
        id: action,
        label: tr(ctx.locale, action),
        icon: busy ? "stop" : "play",
        run: async () => {
          signal.throwIfAborted();
          await reading.commands.controlPlayback(action, guard, { signal });
        }
      }] : [],
      ...ready && matching && reader.setWidth ? [{ id: "widths", label: t.layout, icon: "rows", run: async () => ({ view: await panelWidths(ctx, signal) }) }] : [],
      { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({ view: await readingMonitor(ctx, signal), navigation: "replace" }) }
    ] };
  };
  return { ...render(), live: { subscribe(channel) {
    signal.throwIfAborted();
    let active = true, revision = 0;
    const subscriptions = [];
    const dispose = () => {
      if (!active)
        return;
      active = false;
      signal.removeEventListener("abort", dispose);
      for (const subscription of subscriptions)
        subscription.dispose();
    };
    const publish = async () => {
      if (!active || signal.aborted)
        return;
      try {
        await ctx.services.ui.publishView(channel, { revision: ++revision, view: render() });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "ipc/unknown";
        try {
          await ctx.services.logging.write({ level: "warn", event: "listening-view-publish-failed", errorCode: code });
        } catch {}
      }
    };
    try {
      subscriptions.push(reading.events.observeSession((value) => {
        session = value;
        return publish();
      }));
      subscriptions.push(ctx.services.session.observeEnvironment((value) => {
        environment = value;
        return publish();
      }));
      subscriptions.push(reader.observe((value) => {
        panels = value;
        return publish();
      }));
      signal.addEventListener("abort", dispose, { once: true });
      if (signal.aborted)
        dispose();
      return { dispose };
    } catch (error) {
      dispose();
      throw error;
    }
  } } };
}

// src/views.ts
async function listeningView(ctx, boundary, signal = new AbortController().signal) {
  signal.throwIfAborted();
  const reading = ctx.domains.reading;
  if (!reading?.commands)
    throw new Error("Listening Desk requires reading:write");
  const state = await reading.queries.session();
  const environment = await ctx.services.session.environment();
  const panels = await ctx.services.ui?.reader?.snapshot();
  signal.throwIfAborted();
  const playback = state.playback;
  const guard = { sessionId: state.sessionId ?? undefined, bookId: state.bookId ?? undefined };
  const refresh = async () => ({ view: await listeningView(ctx, undefined, signal), navigation: "replace" });
  const actions = [];
  const mode = state.mode;
  const providerForm = state.status === "ready" && state.sessionId && mode.availableModes.length > 0 && mode.unavailableReason !== "unsupported-format" && (mode.availableModes.length > 1 || !mode.availableModes.some((provider) => provider.key === mode.modeKey)) ? {
    kind: "form",
    submitLabel: tr(ctx.locale, "apply"),
    fields: [
      {
        kind: "select",
        id: "selectModeKey",
        label: tr(ctx.locale, "provider"),
        value: mode.modeKey ?? undefined,
        options: mode.availableModes.map((provider) => ({ value: provider.key, label: provider.label }))
      }
    ],
    onSubmit: async (values) => {
      if (typeof values.selectModeKey !== "string" || !mode.availableModes.some((provider) => provider.key === values.selectModeKey)) {
        return { fieldErrors: { selectModeKey: tr(ctx.locale, "invalid") } };
      }
      await reading.commands.configureMode({ active: mode.requestedActive, modeKey: mode.modeKey ?? undefined, selectModeKey: values.selectModeKey }, guard);
      return refresh();
    }
  } : null;
  const modeForm = state.status === "ready" && state.sessionId && mode.modeKey && !mode.unavailableReason ? {
    kind: "form",
    title: mode.label ?? undefined,
    submitLabel: tr(ctx.locale, "apply"),
    fields: [
      { kind: "toggle", id: "active", label: tr(ctx.locale, "enabled"), value: mode.requestedActive },
      {
        kind: "choice",
        id: "unitId",
        label: tr(ctx.locale, "unit"),
        value: mode.unitId ?? undefined,
        options: mode.units.map((unit) => ({ value: unit.id, label: unit.label }))
      }
    ],
    onSubmit: async (values) => {
      if (typeof values.active !== "boolean")
        return { fieldErrors: { active: tr(ctx.locale, "invalid") } };
      if (typeof values.unitId !== "string" || !mode.units.some((unit) => unit.id === values.unitId)) {
        return { fieldErrors: { unitId: tr(ctx.locale, "invalid") } };
      }
      await reading.commands.configureMode({ active: values.active, unitId: values.unitId, modeKey: mode.modeKey }, guard);
      return refresh();
    }
  } : null;
  if (state.status === "ready" && state.sessionId) {
    if (panels?.sessionId === state.sessionId && panels.bookId === state.bookId && ctx.services.ui.reader?.setPanel) {
      for (const panel of ["toc", "annotations", "appearance", "chat"]) {
        const open = !panels.panels[panel].open;
        actions.push({
          id: `panel-${panel}`,
          icon: "rows",
          label: `${tr(ctx.locale, open ? "openPanel" : "closePanel")} ${tr(ctx.locale, panel)}`,
          run: async () => {
            await ctx.services.ui.reader.setPanel(panel, open, { sessionId: panels.sessionId, bookId: panels.bookId });
            return { close: true };
          }
        });
      }
    }
    if (state.controls) {
      const visible = !state.controls.visible;
      actions.push({
        id: "reader-controls",
        label: tr(ctx.locale, visible ? "showControls" : "hideControls"),
        icon: "rows",
        run: async () => {
          await reading.commands.setControls(visible, guard);
          return { close: true };
        }
      });
    }
    if (mode.requestedActive && ["ready", "empty"].includes(mode.status)) {
      for (const direction of ["previous", "next"])
        actions.push({
          id: `${direction}-unit`,
          label: tr(ctx.locale, direction === "next" ? "nextUnit" : "previousUnit"),
          icon: direction === "next" ? "arrow-right" : "arrow-left",
          run: async () => {
            const result = await reading.commands.stepMode(direction, guard);
            return { view: await listeningView(ctx, result.outcome === "moved" ? undefined : result.outcome, signal), navigation: "replace" };
          }
        });
    }
    if (mode.requestedActive && mode.position)
      actions.push({
        id: "return-to-unit",
        label: tr(ctx.locale, "returnToUnit"),
        icon: "book-bookmark",
        run: async () => {
          await reading.commands.returnToMode(guard);
          return refresh();
        }
      });
    if (["preparing", "playing", "advancing"].includes(playback.status)) {
      actions.push({ id: "stop", label: tr(ctx.locale, "stop"), icon: "stop", run: async () => {
        await reading.commands.controlPlayback("stop", guard);
        return refresh();
      } });
    } else if (!playback.unavailableReason) {
      actions.push({ id: "start", label: tr(ctx.locale, "start"), icon: "play", run: async () => {
        await reading.commands.controlPlayback("start", guard);
        return refresh();
      } });
    }
    for (const direction of ["back", "forward"]) {
      if (!(direction === "back" ? state.history.canGoBack : state.history.canGoForward))
        continue;
      actions.push({ id: direction, label: tr(ctx.locale, direction), icon: direction === "back" ? "arrow-left" : "arrow-right", run: async () => {
        await reading.commands[direction](guard);
        return refresh();
      } });
    }
  }
  const labels2 = monitorCopy(ctx.locale);
  if (ctx.services.ui?.reader)
    actions.push({
      id: "monitor",
      label: labels2.title,
      icon: "speaker",
      run: async () => ({ view: await readingMonitor(ctx, signal) })
    });
  if (state.status === "ready" && panels?.sessionId === state.sessionId && panels.bookId === state.bookId && ctx.services.ui.reader?.setWidth) {
    actions.push({ id: "widths", label: labels2.layout, icon: "rows", run: async () => ({ view: await panelWidths(ctx, signal) }) });
  }
  actions.push({ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: refresh });
  return { kind: "blocks", blocks: [
    ...providerForm ? [providerForm] : [],
    ...modeForm ? [modeForm] : [],
    ...boundary ? [{ kind: "text", text: tr(ctx.locale, boundary) }] : [],
    { kind: "text", text: tr(ctx.locale, playback.status) },
    ...environment.networkHint === "offline" ? [{ kind: "text", text: tr(ctx.locale, "offline") }] : [],
    ...playback.unavailableReason ? [{ kind: "text", text: tr(ctx.locale, playback.unavailableReason) }] : [],
    ...playback.backend ? [{ kind: "text", text: tr(ctx.locale, playback.fallback ? "fallback" : playback.backend) }] : [],
    { kind: "actions", actions }
  ] };
}

// src/index.ts
var lifetime;
var src_default = {
  activate(ctx) {
    if (!ctx.domains.reading?.commands)
      throw new Error("Listening Desk requires reading:write");
    lifetime?.abort();
    const current = new AbortController;
    lifetime = current;
    const title = tr(ctx.locale, "title");
    ctx.contributions.headerActions.register({ id: "reader", title, icon: "speaker", surface: "reader", presentation: "popup", view: () => listeningView(ctx, undefined, current.signal) });
    ctx.contributions.commands.register({ id: "open", title, icon: "speaker", run: async () => ({ view: await listeningView(ctx, undefined, current.signal) }) });
    for (const action of ["start", "stop"])
      ctx.contributions.commands.register({
        id: action,
        title: `${title}: ${tr(ctx.locale, action)}`,
        icon: action === "start" ? "play" : "stop",
        run: async () => {
          current.signal.throwIfAborted();
          const session = await ctx.domains.reading.queries.session();
          if (!session.sessionId)
            throw new Error("No active reading session");
          await ctx.domains.reading.commands.controlPlayback(action, { sessionId: session.sessionId, bookId: session.bookId ?? undefined }, { signal: current.signal });
        }
      });
  },
  deactivate() {
    lifetime?.abort();
    lifetime = undefined;
  }
};
export {
  src_default as default
};
