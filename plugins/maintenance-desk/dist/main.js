// src/strings.ts
var en = {
  title: "Maintenance Desk",
  catalog: "Model catalog",
  provider: "Catalog provider",
  search: "Search models",
  browse: "Browse",
  refresh: "Refresh from provider",
  reload: "Reload cached catalog",
  filters: "Change filters",
  empty: "No matching models",
  invalidSearch: "Use at most 120 characters.",
  invalidProvider: "Choose a catalog provider.",
  metadata: "Catalog status",
  checked: "Last checked",
  never: "Not checked",
  refreshing: "Refreshing",
  yes: "Yes",
  no: "No",
  matches: "Matching models",
  context: "Context window",
  output: "Maximum output tokens",
  input: "Input",
  reasoning: "Reasoning",
  connection: "Test AI connection",
  backupExport: "Export library backup (v1)",
  backupImport: "Import library backup (v1)",
  reportExport: "Export diagnostic report",
  reportSend: "Send diagnostic report",
  verify: "Verify local projections",
  continue: "Continue",
  results: "Recent operations",
  noResults: "No operations in this session",
  pending: "Awaiting host result",
  cancelling: "Cancelling wait",
  cancel: "Cancel wait",
  cancelled: "Wait cancelled; started operations may continue",
  busy: "An operation is still awaiting a result.",
  complete: "Completed",
  failed: "Failed",
  clear: "Clear finished operations",
  back: "Maintenance Desk",
  responded: "Non-empty test response",
  emptyResponse: "Empty test response",
  exported: "Exported",
  imported: "Imported",
  sent: "Report endpoint acknowledged receipt",
  consistent: "Projections consistent",
  drifted: "Projection differences found",
  events: "Events replayed",
  tables: "Drifted tables",
  liveRows: "Rows only in live projections",
  replayRows: "Rows only in replayed projections",
  connectionReview: "The native Test connection button uses the current primary-model configuration. A test may incur provider charges. A response does not verify saved settings or every model feature.",
  backupReview: "Library backup v1 includes books, local original files, collections, annotations and local KV settings. It is not a full backup of chats, memory, plugin documents, credentials or the event log. KV may contain personal data.",
  importReview: "Import can overwrite records and may partially apply before failure. It cannot be undone by cancelling this wait. A restart can discard this session's result.",
  reportReview: "Diagnostic reports may contain personal data. The host provides the report preview and final export or send confirmation. A sent receipt does not mean a developer has reviewed it.",
  verifyReview: "Checks event-log projections on this device only. This does not repair data or verify backups and other devices."
};
var zh = {
  title: "维护工作台",
  catalog: "模型目录",
  provider: "目录提供者",
  search: "搜索模型",
  browse: "查看",
  refresh: "从提供者刷新",
  reload: "重新读取缓存目录",
  filters: "修改筛选",
  empty: "没有匹配的模型",
  invalidSearch: "最多输入 120 个字符。",
  invalidProvider: "请选择目录提供者。",
  metadata: "目录状态",
  checked: "上次检查",
  never: "尚未检查",
  refreshing: "正在刷新",
  yes: "是",
  no: "否",
  matches: "匹配模型数",
  context: "上下文窗口",
  output: "最大输出 token",
  input: "输入类型",
  reasoning: "推理支持",
  connection: "测试 AI 连接",
  backupExport: "导出书库备份（v1）",
  backupImport: "导入书库备份（v1）",
  reportExport: "导出诊断报告",
  reportSend: "发送诊断报告",
  verify: "校验本机投影",
  continue: "继续",
  results: "近期操作",
  noResults: "本次会话暂无操作",
  pending: "等待宿主结果",
  cancelling: "正在取消等待",
  cancel: "取消等待",
  cancelled: "等待已取消；已开始的操作可能继续",
  busy: "仍有操作在等待结果。",
  complete: "已完成",
  failed: "失败",
  clear: "清除已结束的记录",
  back: "维护工作台",
  responded: "测试返回了非空回复",
  emptyResponse: "测试返回了空回复",
  exported: "已导出",
  imported: "已导入",
  sent: "报告接口已确认收件",
  consistent: "投影一致",
  drifted: "发现投影差异",
  events: "重放事件数",
  tables: "差异表数",
  liveRows: "仅存在于当前投影的行数",
  replayRows: "仅存在于重放投影的行数",
  connectionReview: "原生连接测试使用当前主模型配置，可能产生提供者费用。收到回复不代表配置已保存或全部模型功能可用。",
  backupReview: "书库备份 v1 包含书籍、本机原文件、收藏集、标注及本机 KV 设置，不是聊天、记忆、插件文档、凭据或事件日志的全量备份。KV 可能含个人数据。",
  importReview: "导入可能覆盖记录，也可能在部分写入后失败。取消等待不能撤销导入；重启可能丢失本次会话的结果记录。",
  reportReview: "诊断报告可能含个人数据，由宿主提供报告预览与最终导出或发送确认。发送回执不代表开发者已处理。",
  verifyReview: "仅校验本设备的事件日志投影，不修复数据，也不验证备份或其他设备。"
};
var copy = (locale) => locale.startsWith("zh") ? zh : en;

// src/operations.ts
function failureCode(error) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(code) ? code : "ipc/unknown";
}

class Operations {
  entries = [];
  pending;
  listeners = new Set;
  sequence = 0;
  retired = false;
  snapshot() {
    return this.entries.map((entry) => ({ ...entry, ...entry.outcome ? { outcome: {
      ...entry.outcome,
      ...entry.outcome.counts ? { counts: { ...entry.outcome.counts } } : {}
    } } : {} }));
  }
  get busy() {
    return Boolean(this.pending);
  }
  subscribe(listener) {
    if (!this.retired)
      this.listeners.add(listener);
    return { dispose: () => {
      this.listeners.delete(listener);
    } };
  }
  emit() {
    for (const listener of this.listeners)
      listener();
  }
  start(operation, run) {
    if (this.retired || this.pending)
      return false;
    const entry = { id: ++this.sequence, operation, timestamp: new Date().toISOString(), phase: "pending" };
    const controller = new AbortController;
    this.pending = { entry, controller };
    this.entries = [entry, ...this.entries].slice(0, 20);
    this.emit();
    (async () => {
      try {
        controller.signal.throwIfAborted();
        const outcome = await run(controller.signal);
        if (this.retired)
          return;
        if (controller.signal.aborted || outcome.status === "cancelled")
          entry.phase = "cancelled";
        else {
          entry.phase = "complete";
          entry.outcome = outcome;
        }
      } catch (error) {
        if (this.retired)
          return;
        entry.phase = controller.signal.aborted ? "cancelled" : "failed";
        if (entry.phase === "failed")
          entry.errorCode = failureCode(error);
      } finally {
        if (this.pending?.entry === entry)
          this.pending = undefined;
        if (!this.retired)
          this.emit();
      }
    })();
    return true;
  }
  cancel(id) {
    if (!this.pending || this.pending.entry.id !== id || this.pending.controller.signal.aborted)
      return;
    this.pending.entry.phase = "cancelling";
    this.pending.controller.abort();
    this.emit();
  }
  clear() {
    this.entries = this.entries.filter((entry) => entry === this.pending?.entry);
    this.emit();
  }
  dispose() {
    this.retired = true;
    this.listeners.clear();
    this.pending?.controller.abort();
    this.entries = [];
  }
}

// src/catalog.ts
var providers = [
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["openrouter", "OpenRouter"],
  ["google", "Google Gemini"],
  ["deepseek", "DeepSeek"],
  ["xai", "xAI (Grok)"],
  ["groq", "Groq"],
  ["mistral", "Mistral"],
  ["moonshotai", "Moonshot (Kimi)"],
  ["zai", "Z.ai Coding Plan"],
  ["zai-coding-cn", "Zhipu Coding Plan"],
  ["ollama-cloud", "Ollama Cloud"]
];
function catalogViews(ctx, signal) {
  const t = copy(ctx.locale), settings = ctx.domains.settings;
  const form = (provider = "openai", search = "") => ({
    kind: "form",
    title: t.catalog,
    submitLabel: t.browse,
    fields: [
      { kind: "select", id: "provider", label: t.provider, value: provider, options: providers.map(([value, label]) => ({ value, label })) },
      { kind: "text", id: "search", label: t.search, value: search }
    ],
    onSubmit: async (values) => {
      if (typeof values.provider !== "string" || !providers.some(([id]) => id === values.provider))
        return { fieldErrors: { provider: t.invalidProvider } };
      if (typeof values.search !== "string" || values.search.length > 120)
        return { fieldErrors: { search: t.invalidSearch } };
      return { view: await page({ provider: values.provider, search: values.search.trim() }) };
    }
  });
  const page = async (query) => {
    const first = { provider: query.provider, search: query.search };
    const reload = async () => ({ view: await page(first), navigation: "replace" });
    const common = [
      { id: "refresh", label: t.refresh, icon: "cloud-arrow-up", run: async () => {
        try {
          signal.throwIfAborted();
          await settings.commands.refreshModelCatalog(query.provider, { signal });
          return await reload();
        } catch (error) {
          return { view: { kind: "detail", title: t.catalog, content: [{ kind: "error", code: failureCode(error) }], actions: common }, navigation: "replace" };
        }
      } },
      { id: "reload", label: t.reload, icon: "arrows-clockwise", run: reload },
      { id: "filters", label: t.filters, icon: "magnifying-glass", run: () => ({ view: form(query.provider, query.search) }) }
    ];
    try {
      signal.throwIfAborted();
      const result = await settings.queries.modelCatalog({ ...query, limit: 25 });
      signal.throwIfAborted();
      if (result.errorCode && !result.models.length)
        return {
          kind: "detail",
          title: t.catalog,
          content: [{ kind: "error", code: result.errorCode }],
          actions: common
        };
      return {
        kind: "list",
        title: `${t.catalog}: ${query.provider}`,
        emptyText: t.empty,
        items: result.models.map((model) => ({
          id: model.id,
          title: model.name,
          subtitle: model.id,
          onSelect: () => ({ view: { kind: "detail", title: model.name, content: [{ kind: "keyValue", rows: [
            { label: "ID", value: model.id },
            { label: t.context, value: String(model.contextWindow) },
            { label: t.output, value: String(model.maxOutputTokens) },
            { label: t.input, value: model.input.join(", ") },
            { label: t.reasoning, value: model.reasoning ? t.yes : t.no }
          ] }] } })
        })),
        pagination: {
          page: Math.floor(result.offset / 25) + 1,
          pageCount: Math.max(1, Math.ceil(result.total / 25)),
          ...result.offset > 0 ? { onPrevious: async () => ({ view: await page({ ...first, offset: Math.max(0, result.offset - 25), revision: result.revision }) }) } : {},
          ...result.nextOffset !== null ? { onNext: async () => ({ view: await page({ ...first, offset: result.nextOffset, revision: result.revision }) }) } : {}
        },
        actions: [
          { id: "status", label: t.metadata, icon: "clock", run: () => ({ view: { kind: "detail", title: t.metadata, content: [
            ...result.errorCode ? [{ kind: "error", code: result.errorCode }] : [],
            { kind: "keyValue", rows: [
              { label: t.checked, value: result.checkedAt === null ? t.never : new Date(result.checkedAt).toISOString() },
              { label: t.refreshing, value: result.refreshing ? t.yes : t.no },
              { label: t.matches, value: String(result.total) }
            ] }
          ] } }) },
          ...result.errorCode ? [{ id: "catalog-error", label: t.failed, icon: "file-text", run: () => ({ view: {
            kind: "detail",
            title: t.catalog,
            content: [{ kind: "error", code: result.errorCode }],
            actions: common
          } }) }] : [],
          ...common
        ]
      };
    } catch (error) {
      return { kind: "detail", title: t.catalog, content: [{ kind: "error", code: failureCode(error) }], actions: common };
    }
  };
  return { form };
}

// src/admin-strings.ts
var en2 = {
  plugins: "Installed plugins",
  contributions: "Registered contributions",
  updates: "Software updates",
  managePlugins: "Manage plugins",
  manageUpdates: "Open update settings",
  check: "Check for updates",
  search: "Search",
  browse: "Browse",
  filters: "Search directory",
  refresh: "Refresh",
  empty: "No matches",
  invalidSearch: "Use at most 200 characters.",
  version: "Version",
  enabled: "Configured enabled",
  builtin: "Built-in",
  activationFailed: "Activation failed",
  yes: "Yes",
  no: "No",
  current: "Current version",
  available: "Available version",
  channel: "Selected channel",
  checkedChannel: "Last successfully checked channel",
  unknown: "Unknown",
  never: "Not checked",
  status: "Status",
  unsupported: "Updates unavailable on this platform",
  stable: "Stable",
  beta: "Beta",
  errorStage: "Failed operation",
  checkStage: "Update check",
  installStage: "Installation",
  phases: {
    idle: "Not checked",
    checking: "Checking",
    "up-to-date": "Up to date",
    available: "Update available",
    downloading: "Downloading",
    installing: "Installing",
    "permission-required": "Permission required",
    "installer-open": "Installer opened",
    error: "Update failed"
  }
};
var zh2 = {
  plugins: "已安装插件",
  contributions: "已注册贡献项",
  updates: "软件更新",
  managePlugins: "管理插件",
  manageUpdates: "打开更新设置",
  check: "检查更新",
  search: "搜索",
  browse: "查询",
  filters: "搜索目录",
  refresh: "刷新",
  empty: "没有匹配项",
  invalidSearch: "最多输入 200 个字符。",
  version: "版本",
  enabled: "已配置启用",
  builtin: "内置",
  activationFailed: "激活失败",
  yes: "是",
  no: "否",
  current: "当前版本",
  available: "可用版本",
  channel: "所选通道",
  checkedChannel: "上次成功检查的通道",
  unknown: "未知",
  never: "尚未检查",
  status: "状态",
  unsupported: "此平台不支持软件更新",
  stable: "稳定版",
  beta: "测试版",
  errorStage: "失败操作",
  checkStage: "检查更新",
  installStage: "安装",
  phases: {
    idle: "尚未检查",
    checking: "正在检查",
    "up-to-date": "已是最新版本",
    available: "有可用更新",
    downloading: "正在下载",
    installing: "正在安装",
    "permission-required": "需要授权",
    "installer-open": "已打开安装程序",
    error: "更新失败"
  }
};
var adminCopy = (locale) => locale.startsWith("zh") ? zh2 : en2;

// src/live-view.ts
function liveView(ctx, signal, initial, observe, render) {
  return { ...render(initial), live: { subscribe(channel) {
    signal.throwIfAborted();
    let active = true, revision = 0;
    const subscription = observe((value) => {
      if (!active || signal.aborted)
        return;
      ctx.services.ui.publishView(channel, { revision: ++revision, view: render(value) }).catch(async (error) => {
        try {
          await ctx.services.logging.write({ level: "warn", event: "maintenance-view-publish-failed", errorCode: failureCode(error) });
        } catch {}
      });
    });
    const dispose = () => {
      if (!active)
        return;
      active = false;
      signal.removeEventListener("abort", dispose);
      subscription.dispose();
    };
    signal.addEventListener("abort", dispose, { once: true });
    if (signal.aborted)
      dispose();
    return { dispose };
  } } };
}

// src/plugin-directory.ts
var LIMIT = 40;
function pluginDirectory(ctx, signal) {
  const t = adminCopy(ctx.locale);
  const manage = {
    id: "manage",
    label: t.managePlugins,
    icon: "arrow-square-out",
    run: async () => {
      signal.throwIfAborted();
      await ctx.services.maintenance.openSettings("plugins");
      return { close: true };
    }
  };
  const detail = (entry) => ({
    kind: "detail",
    title: entry.name,
    content: [{ kind: "keyValue", rows: [
      { label: "ID", value: entry.id },
      { label: t.version, value: entry.version },
      { label: t.enabled, value: entry.enabled ? t.yes : t.no },
      { label: t.builtin, value: entry.builtin ? t.yes : t.no },
      { label: t.activationFailed, value: entry.activationFailed ? t.yes : t.no }
    ] }],
    actions: [
      {
        id: "contributions",
        label: t.contributions,
        icon: "list-bullets",
        run: async () => ({ view: await page("contributions", { pluginId: entry.id }) })
      },
      manage
    ]
  });
  const form = (kind, query) => ({
    kind: "form",
    title: t[kind],
    submitLabel: t.browse,
    fields: [{ kind: "text", id: "search", label: t.search, value: query.search ?? "" }],
    onSubmit: async (values) => {
      if (typeof values.search !== "string" || values.search.length > 200)
        return { fieldErrors: { search: t.invalidSearch } };
      return { view: await page(kind, { ...query.pluginId ? { pluginId: query.pluginId } : {}, search: values.search.trim() }) };
    }
  });
  const page = async (kind = "plugins", query = {}) => {
    signal.throwIfAborted();
    const request = { ...query, offset: query.offset ?? 0, limit: LIMIT };
    const actions = [
      {
        id: "refresh",
        label: t.refresh,
        icon: "arrows-clockwise",
        run: async () => ({ view: await page(kind, { ...query, offset: 0 }), navigation: "replace" })
      },
      { id: "search", label: t.filters, icon: "magnifying-glass", run: () => ({ view: form(kind, query) }) },
      manage,
      ...kind === "plugins" ? [{
        id: "contributions",
        label: t.contributions,
        icon: "list-bullets",
        run: async () => ({ view: await page("contributions") })
      }] : []
    ];
    const pagination = (result2) => ({
      page: Math.floor(result2.offset / LIMIT) + 1,
      ...result2.offset > 0 ? { onPrevious: async () => ({ view: await page(kind, { ...query, offset: Math.max(0, result2.offset - LIMIT) }) }) } : {},
      ...result2.nextOffset !== null ? { onNext: async () => ({ view: await page(kind, { ...query, offset: result2.nextOffset }) }) } : {}
    });
    if (kind === "plugins") {
      const result2 = await ctx.services.plugins.list(request);
      signal.throwIfAborted();
      return liveView(ctx, signal, result2, (handler) => ctx.services.plugins.observe(request, handler), (value) => ({
        kind: "list",
        title: `${t.plugins} (${value.total})`,
        emptyText: t.empty,
        actions,
        pagination: pagination(value),
        items: value.plugins.map((entry) => ({
          id: entry.id,
          title: entry.name,
          subtitle: `${entry.id} · ${entry.version}`,
          accessories: entry.activationFailed ? [{ kind: "text", text: t.activationFailed }] : [],
          onSelect: () => ({ view: detail(entry) })
        }))
      }));
    }
    const result = await ctx.services.plugins.contributions(request);
    signal.throwIfAborted();
    return liveView(ctx, signal, result, (handler) => ctx.services.plugins.observeContributions(request, handler), (value) => ({
      kind: "list",
      title: `${t.contributions} (${value.total})`,
      emptyText: t.empty,
      actions,
      pagination: pagination(value),
      items: value.contributions.map((entry) => ({
        id: JSON.stringify([entry.point, entry.pluginId, entry.key]),
        title: entry.key,
        subtitle: `${entry.pluginId} · ${entry.point}`
      }))
    }));
  };
  return { page };
}

// src/updates.ts
function updateViews(ctx, signal) {
  const t = adminCopy(ctx.locale), maintenance = ctx.services.maintenance;
  const show = (snapshot) => liveView(ctx, signal, snapshot, (handler) => maintenance.observe(handler), render);
  const render = (snapshot) => {
    const busy = ["checking", "downloading", "installing"].includes(snapshot.phase);
    return { kind: "detail", title: t.updates, content: [
      { kind: "keyValue", rows: [
        { label: t.status, value: snapshot.supported ? t.phases[snapshot.phase] : t.unsupported },
        { label: t.current, value: snapshot.currentVersion ?? t.unknown },
        { label: t.available, value: snapshot.availableVersion ?? t.unknown },
        { label: t.channel, value: t[snapshot.channel] },
        { label: t.checkedChannel, value: snapshot.checkedChannel ? t[snapshot.checkedChannel] : t.never },
        ...snapshot.errorStage ? [{ label: t.errorStage, value: snapshot.errorStage === "check" ? t.checkStage : t.installStage }] : []
      ] },
      ...snapshot.supported && busy ? [{ kind: "progress", value: snapshot.progress, max: 100, label: t.phases[snapshot.phase] }] : []
    ], actions: [
      ...snapshot.supported && !busy && maintenance.checkForUpdates ? [{
        id: "check",
        label: t.check,
        icon: "arrows-clockwise",
        run: async () => {
          signal.throwIfAborted();
          const result = await maintenance.checkForUpdates();
          signal.throwIfAborted();
          return { view: show(result), navigation: "replace" };
        }
      }] : [],
      { id: "refresh", label: t.refresh, icon: "clock", run: async () => ({ view: await open(), navigation: "replace" }) },
      { id: "manage", label: t.manageUpdates, icon: "arrow-square-out", run: async () => {
        signal.throwIfAborted();
        await maintenance.openSettings("updates");
        return { close: true };
      } }
    ] };
  };
  const open = async () => {
    signal.throwIfAborted();
    const snapshot = await maintenance.snapshot();
    signal.throwIfAborted();
    return show(snapshot);
  };
  return { open };
}

// src/views.ts
function maintenanceDesk(ctx) {
  const t = copy(ctx.locale), operations = new Operations, lifetime = new AbortController;
  const catalog = catalogViews(ctx, lifetime.signal);
  const admin = adminCopy(ctx.locale), directory = pluginDirectory(ctx, lifetime.signal), updates = updateViews(ctx, lifetime.signal);
  const actions = ["connection", "backupExport", "backupImport", "reportExport", "reportSend", "verify"];
  const run = async (operation, signal) => {
    const options = { signal };
    if (operation === "connection") {
      const result2 = await ctx.services.maintenance.requestConnectionTest(options);
      return { status: result2.status === "empty" ? "emptyResponse" : result2.status };
    }
    if (operation === "backupExport" || operation === "backupImport") {
      const result2 = await ctx.services.maintenance.requestBackup(operation === "backupExport" ? "export" : "import", options);
      return { status: result2.status };
    }
    if (operation === "reportExport" || operation === "reportSend") {
      const result2 = await ctx.services.diagnostics.requestReport(operation === "reportExport" ? "export" : "send", options);
      return { status: result2.status };
    }
    const result = await ctx.services.diagnostics.verifyProjections(options);
    return { status: result.consistent ? "consistent" : "drifted", counts: {
      events: result.eventsReplayed,
      tables: result.driftedTables,
      liveRows: result.onlyLiveRows,
      replayRows: result.onlyReplayedRows
    } };
  };
  const status = (entry) => entry.outcome ? t[entry.outcome.status] : t[entry.phase];
  const review = (operation) => ({
    kind: "detail",
    title: t[operation],
    content: [
      { kind: "text", text: operation === "connection" ? t.connectionReview : operation === "verify" ? t.verifyReview : operation.startsWith("backup") ? t.backupReview : t.reportReview },
      ...operation === "backupImport" ? [{ kind: "text", text: t.importReview }] : []
    ],
    actions: [{
      id: "continue",
      label: t.continue,
      icon: "arrow-right",
      variant: operation === "backupImport" ? "danger" : "solid",
      run: () => {
        if (!operations.start(operation, (signal) => run(operation, signal)))
          return { toast: t.busy };
        return operation === "verify" ? { view: history(), navigation: "reset" } : { close: true };
      }
    }]
  });
  const entryBlocks = (entry) => [
    { kind: "heading", text: t[entry.operation], caption: entry.timestamp },
    ...entry.errorCode ? [{ kind: "error", code: entry.errorCode }] : [],
    ...entry.phase === "pending" || entry.phase === "cancelling" ? [{
      kind: "progress",
      value: null,
      label: status(entry),
      ...entry.phase === "pending" ? { cancel: { id: `cancel-${entry.id}`, label: t.cancel, run: () => {
        operations.cancel(entry.id);
      } } } : {}
    }] : [{ kind: "text", text: status(entry) }],
    ...entry.outcome?.counts ? [{ kind: "keyValue", rows: Object.entries(entry.outcome.counts).map(([key, value]) => ({
      label: t[key],
      value: String(value)
    })) }] : []
  ];
  const history = () => {
    let channel, revision = 0;
    const content = () => {
      const entries = operations.snapshot();
      return {
        kind: "detail",
        title: t.results,
        content: entries.length ? entries.flatMap(entryBlocks) : [{ kind: "text", text: t.noResults }],
        actions: [
          { id: "clear", label: t.clear, icon: "trash", run: () => {
            operations.clear();
            return { view: history(), navigation: "replace" };
          } },
          { id: "home", label: t.back, icon: "arrow-left", run: () => ({ view: home(), navigation: "reset" }) }
        ]
      };
    };
    const publish = () => {
      if (!channel || lifetime.signal.aborted)
        return;
      ctx.services.ui.publishView(channel, { revision: ++revision, view: content() }).catch(async (error) => {
        try {
          await ctx.services.logging.write({ level: "warn", event: "maintenance-view-publish-failed", errorCode: failureCode(error) });
        } catch {}
      });
    };
    return { ...content(), live: { subscribe: (next) => {
      channel = next;
      const subscription = operations.subscribe(publish);
      publish();
      return { dispose() {
        subscription.dispose();
        if (channel?.id === next.id)
          channel = undefined;
      } };
    } } };
  };
  const home = () => ({
    kind: "list",
    title: t.title,
    items: [
      { id: "catalog", title: t.catalog, icon: "list-bullets", onSelect: () => ({ view: catalog.form() }) },
      { id: "plugins", title: admin.plugins, icon: "list-bullets", onSelect: async () => ({ view: await directory.page() }) },
      { id: "updates", title: admin.updates, icon: "arrows-clockwise", onSelect: async () => ({ view: await updates.open() }) },
      ...actions.map((operation) => ({
        id: operation,
        title: t[operation],
        icon: operation === "verify" ? "database" : "arrow-square-out",
        onSelect: () => ({ view: review(operation) })
      })),
      { id: "results", title: t.results, icon: "clock", onSelect: () => ({ view: history() }) }
    ]
  });
  return { home, dispose() {
    lifetime.abort();
    operations.dispose();
  } };
}

// src/index.ts
var desk;
var src_default = {
  activate(ctx) {
    if (!ctx.domains.settings?.commands.refreshModelCatalog || !ctx.services.diagnostics) {
      throw Error("Maintenance Desk requires catalog discovery, network and diagnostics access");
    }
    desk?.dispose();
    const current = maintenanceDesk(ctx);
    desk = current;
    const title = copy(ctx.locale).title;
    ctx.contributions.commands.register({ id: "open", title, icon: "database", run: () => ({ view: current.home() }) });
    ctx.contributions.headerActions.register({ id: "shelf", title, icon: "database", surface: "shelf", presentation: "popup", view: current.home });
  },
  deactivate() {
    desk?.dispose();
    desk = undefined;
  }
};
export {
  src_default as default
};
