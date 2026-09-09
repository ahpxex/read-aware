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
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: refresh }
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
