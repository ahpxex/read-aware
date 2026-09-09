// src/strings.ts
var locales = ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"];
var labels = {
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

// src/views.ts
async function listeningView(ctx, boundary) {
  const reading = ctx.domains.reading;
  if (!reading?.commands)
    throw new Error("Listening Desk requires reading:write");
  const state = await reading.queries.session();
  const environment = await ctx.services.session.environment();
  const playback = state.playback;
  const guard = { sessionId: state.sessionId ?? undefined, bookId: state.bookId ?? undefined };
  const refresh = async () => ({ view: await listeningView(ctx), navigation: "replace" });
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
    if (mode.requestedActive && ["ready", "empty"].includes(mode.status)) {
      for (const direction of ["previous", "next"])
        actions.push({
          id: `${direction}-unit`,
          label: tr(ctx.locale, direction === "next" ? "nextUnit" : "previousUnit"),
          icon: direction === "next" ? "arrow-right" : "arrow-left",
          run: async () => {
            const result = await reading.commands.stepMode(direction, guard);
            return { view: await listeningView(ctx, result.outcome === "moved" ? undefined : result.outcome), navigation: "replace" };
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
var src_default = {
  activate(ctx) {
    if (!ctx.domains.reading?.commands)
      throw new Error("Listening Desk requires reading:write");
    const title = tr(ctx.locale, "title");
    ctx.contributions.headerActions.register({ id: "reader", title, icon: "speaker", surface: "reader", presentation: "popup", view: () => listeningView(ctx) });
    ctx.contributions.commands.register({ id: "open", title, icon: "speaker", run: async () => ({ view: await listeningView(ctx) }) });
    for (const action of ["start", "stop"])
      ctx.contributions.commands.register({
        id: action,
        title: `${title}: ${tr(ctx.locale, action)}`,
        icon: action === "start" ? "play" : "stop",
        run: async () => {
          const session = await ctx.domains.reading.queries.session();
          if (!session.sessionId)
            throw new Error("No active reading session");
          await ctx.domains.reading.commands.controlPlayback(action, { sessionId: session.sessionId });
        }
      });
  }
};
export {
  src_default as default
};
