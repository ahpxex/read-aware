// src/profiles.ts
var LEGACY_PROFILE_PATHS = ["shelf.layout", "shelf.group", "shelf.sort", "appearance.theme", "appearance.motion", "reading.fontSize", "reading.lineSpacing"];
var PROFILE_PATHS = [...LEGACY_PROFILE_PATHS, "reading.fontFamily", "appearance.contentTypography.fontFamily", "appearance.contentTypography.followReader"];
var profileCollection = (ctx) => ctx.services.storage.collection("profiles");
var invalid = (message) => {
  throw Object.assign(Error(message), { code: "plugin/invalid-input" });
};
function profileName(name) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80)
    return invalid("Profile name must contain 1-80 characters");
  return name.trim();
}
function parseProfile(value) {
  if (!value || typeof value !== "object")
    return null;
  const profile = value;
  const paths = profile.version === 1 ? LEGACY_PROFILE_PATHS : PROFILE_PATHS;
  if (![1, 2].includes(profile.version) || typeof profile.name !== "string" || !profile.name.trim() || profile.name.trim().length > 80 || !Array.isArray(profile.changes) || profile.changes.length !== paths.length || profile.changes.some((change) => !change || typeof change !== "object" || !paths.includes(change.path) || change.target?.kind !== "global" || !(change.value === null && (change.path === "reading.fontFamily" || change.path === "appearance.contentTypography.fontFamily") || typeof change.value === "boolean" || typeof change.value === "number" && Number.isFinite(change.value) || typeof change.value === "string" && change.value.length <= 1024)) || new Set(profile.changes.map((change) => change.path)).size !== paths.length)
    return null;
  return { version: profile.version, name: profile.name.trim(), changes: paths.map((path) => ({
    path,
    value: profile.changes.find((change) => change.path === path).value,
    target: { kind: "global" }
  })) };
}
async function listProfiles(ctx, cursor, limit = 40) {
  return profileCollection(ctx).page({ limit, ...cursor ? { cursor } : {} });
}
async function captureProfile(ctx, name) {
  const cleanName = profileName(name);
  const snapshot = await ctx.domains.settings.queries.snapshot({ target: { kind: "global" } });
  const changes = PROFILE_PATHS.map((path) => {
    const setting = snapshot.settings.find((setting2) => setting2.path === path);
    if (!setting?.writable)
      throw Object.assign(Error(`Profile setting unavailable: ${path}`), { code: "plugin/unavailable" });
    return { path, value: setting.value, target: { kind: "global" } };
  });
  const profile = parseProfile({ version: 2, name: cleanName, changes });
  if (!profile)
    return invalid("Invalid workspace snapshot");
  return profile;
}
async function profileToken(profile) {
  const bytes = new TextEncoder().encode(JSON.stringify(profile.changes));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `wp1:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
async function saveProfile(ctx, name, expectedToken) {
  const profile = await captureProfile(ctx, name);
  if (expectedToken !== undefined && await profileToken(profile) !== expectedToken)
    return { status: "stale-workspace" };
  const id = crypto.randomUUID();
  const receipt = await ctx.services.storage.applyDocuments([{ kind: "put", collection: "profiles", id, data: profile, expectedRevision: null }]);
  return receipt.status === "conflict" ? { status: "conflict" } : { status: "saved", id, name: profile.name };
}
async function applyProfile(ctx, id, expectedRevision) {
  const doc = await profileCollection(ctx).get(id);
  if (!doc || doc.revision !== expectedRevision)
    return { status: "conflict" };
  const profile = parseProfile(doc.data);
  if (!profile)
    return invalid("Invalid workspace profile");
  const receipt = await ctx.domains.settings.commands.update(profile.changes);
  return { status: "applied", id, name: profile.name, changed: receipt.changed, overrides: receipt.settings.overrides };
}
async function deleteProfile(ctx, id, expectedRevision) {
  const receipt = await ctx.services.storage.applyDocuments([{ kind: "delete", collection: "profiles", id, expectedRevision }]);
  return { status: receipt.status === "conflict" ? "conflict" : "deleted", id };
}

// src/tools.ts
var invalid2 = () => {
  throw Object.assign(Error("Invalid workspace tool input"), { code: "plugin/invalid-input" });
};
function fields(params, allowed) {
  if (Object.keys(params).some((key) => !allowed.includes(key)))
    invalid2();
}
function text(value, max = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    return invalid2();
  return value;
}
var string = (maxLength = 512) => ({ type: "string", minLength: 1, maxLength });
function registerProfileTools(ctx) {
  if (!ctx.contributions.agentTools)
    throw Error("Workspace Profiles requires agent:tools");
  ctx.contributions.agentTools.register({
    name: "workspace_profiles",
    label: "Inspect workspace profiles",
    contexts: ["global", "book"],
    description: "Read-only workspace presets. List returns a bounded page of names, IDs and revisions; continue with nextCursor, restart on stale-cursor. Inspect requires an exact id and returns the preset values and revision for manage_workspace_profile. Current returns the ten global preset settings and workspaceToken for save_workspace_profile. Does not change settings, select a profile or save. Invalid entries may only be deleted.",
    parameters: { type: "object", properties: { operation: { type: "string", enum: ["list", "inspect", "current"] }, id: string(), cursor: string(8192), limit: { type: "integer", minimum: 1, maximum: 20 } }, required: ["operation"], additionalProperties: false },
    execute: async (params) => {
      if (params.operation === "list") {
        fields(params, ["operation", "cursor", "limit"]);
        const limit = params.limit ?? 10;
        if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20)
          return invalid2();
        const page = await listProfiles(ctx, params.cursor === undefined ? undefined : text(params.cursor, 8192), limit);
        if (page.status === "stale-cursor")
          return page;
        return { status: "ready", nextCursor: page.nextCursor, items: page.items.map((doc) => {
          const profile = parseProfile(doc.data);
          return { id: doc.id, revision: doc.revision, valid: Boolean(profile), ...profile ? { name: profile.name, version: profile.version } : {} };
        }) };
      }
      if (params.operation === "current") {
        fields(params, ["operation"]);
        const profile = await captureProfile(ctx, "Current workspace");
        return { changes: profile.changes, workspaceToken: await profileToken(profile) };
      }
      if (params.operation === "inspect") {
        fields(params, ["operation", "id"]);
        const id = text(params.id), doc = await profileCollection(ctx).get(id);
        if (!doc)
          return { status: "not-found", id };
        const profile = parseProfile(doc.data);
        return { status: profile ? "ready" : "invalid-profile", id, revision: doc.revision, ...profile ? { profile } : {} };
      }
      return invalid2();
    }
  });
  ctx.contributions.agentTools.register({
    name: "save_workspace_profile",
    label: "Save workspace profile",
    contexts: ["global", "book"],
    approval: "required",
    description: "After host approval, save a named copy of the global workspace previously inspected using workspace_profiles(current). Requires its unchanged workspaceToken; returns stale-workspace if those ten values changed. Captures shelf layout/group/sort, app theme/motion, global reader font size/spacing/font and independent content font/follow-reader. No host settings are changed. Does not overwrite an existing profile; repeated successful calls may create separate presets.",
    parameters: { type: "object", properties: { name: string(80), workspaceToken: { type: "string", pattern: "^wp1:[a-f0-9]{64}$" } }, required: ["name", "workspaceToken"], additionalProperties: false },
    execute: async (params) => {
      fields(params, ["name", "workspaceToken"]);
      const name = profileName(params.name), token = text(params.workspaceToken, 68);
      if (!/^wp1:[a-f0-9]{64}$/.test(token))
        return invalid2();
      return saveProfile(ctx, name, token);
    }
  });
  ctx.contributions.agentTools.register({
    name: "manage_workspace_profile",
    label: "Manage workspace profile",
    contexts: ["global", "book"],
    approval: "required",
    description: "Apply or permanently delete an exact workspace preset after host approval. First inspect it with workspace_profiles(inspect), then pass the exact id and expectedRevision. Changed documents return conflict. Apply submits the inspected preset values in one host settings update, preserving per-book overrides; version 1 changes seven fields and leaves fonts unchanged, version 2 changes ten. Delete conditionally removes only the preset. No book data, selection, AI privacy, credentials or plugin lifecycle changes. Application is not a transaction with private profile storage or a font-rendering completion receipt.",
    parameters: { type: "object", properties: { action: { type: "string", enum: ["apply", "delete"] }, id: string(), expectedRevision: string() }, required: ["action", "id", "expectedRevision"], additionalProperties: false },
    execute: async (params) => {
      fields(params, ["action", "id", "expectedRevision"]);
      const id = text(params.id), revision = text(params.expectedRevision);
      if (params.action === "delete")
        return deleteProfile(ctx, id, revision);
      if (params.action !== "apply")
        return invalid2();
      const result = await applyProfile(ctx, id, revision);
      return result.status === "conflict" ? result : {
        status: result.status,
        id,
        name: result.name,
        changed: result.changed,
        preservedBookOverrides: result.overrides.length
      };
    }
  });
}

// src/strings.ts
var en = {
  title: "Workspace Profiles",
  save: "Save current workspace",
  name: "Name",
  invalid: "Enter a name of 1-80 characters.",
  empty: "No saved profiles",
  apply: "Apply",
  remove: "Delete profile",
  refresh: "Refresh",
  saved: "Profile saved",
  applied: "Profile applied",
  conflict: "The profile changed. Refresh before trying again.",
  missing: "Profile no longer exists",
  invalidProfile: "Invalid profile",
  stalePage: "Profiles changed. Refresh the list.",
  confirmDelete: "Permanently delete this profile",
  confirmRequired: "Confirm deletion first.",
  deleted: "Profile deleted",
  shortcut: "Keyboard shortcut",
  binding: "Binding",
  defaultBinding: "Default",
  customBinding: "Custom",
  key: "Key",
  shortcutSaved: "Shortcut updated",
  current: "Current workspace",
  fonts: "Fonts",
  appDefault: "App default",
  follow: "Content follows reader typography",
  search: "Search fonts",
  query: "Font name",
  invalidSearch: "Maximum 120 characters",
  noFonts: "No matching fonts",
  previous: "Previous",
  next: "Next",
  saveFonts: "Apply font",
  fontSaved: "Font settings saved",
  saveFollow: "Save",
  yes: "On",
  no: "Off"
};
var zh = {
  title: "工作区预设",
  save: "保存当前工作区",
  name: "名称",
  invalid: "请输入 1-80 个字符的名称。",
  empty: "暂无预设",
  apply: "应用",
  remove: "删除预设",
  refresh: "刷新",
  saved: "预设已保存",
  applied: "预设已应用",
  conflict: "预设已变化，请刷新后再试。",
  missing: "预设已不存在",
  invalidProfile: "无效预设",
  stalePage: "预设列表已变化，请刷新。",
  confirmDelete: "永久删除此预设",
  confirmRequired: "请先确认删除。",
  deleted: "预设已删除",
  shortcut: "键盘快捷键",
  binding: "绑定",
  defaultBinding: "默认",
  customBinding: "自定义",
  key: "按键",
  shortcutSaved: "快捷键已更新",
  current: "当前工作区",
  fonts: "字体",
  appDefault: "应用默认",
  follow: "应用内容跟随阅读排版",
  search: "搜索字体",
  query: "字体名称",
  invalidSearch: "最多 120 个字符",
  noFonts: "没有匹配的字体",
  previous: "上一页",
  next: "下一页",
  saveFonts: "应用字体",
  fontSaved: "字体设置已保存",
  saveFollow: "保存",
  yes: "开启",
  no: "关闭"
};
var copy = (locale) => locale.startsWith("zh") ? zh : en;
var labels = {
  "shelf.layout": ["Shelf layout", "书架布局"],
  "shelf.group": ["Group books", "书籍分组"],
  "shelf.sort": ["Sort books", "书籍排序"],
  "appearance.theme": ["App theme", "应用主题"],
  "appearance.motion": ["Motion", "动画"],
  "reading.fontSize": ["Global reading font size", "全局阅读字号"],
  "reading.lineSpacing": ["Global reading line spacing", "全局阅读行距"],
  "reading.fontFamily": ["Global reading font", "全局阅读字体"],
  "appearance.contentTypography.fontFamily": ["Independent content font", "独立应用内容字体"],
  "appearance.contentTypography.followReader": ["Content follows reader typography", "应用内容跟随阅读排版"]
};
var settingLabel = (locale, path) => labels[path]?.[locale.startsWith("zh") ? 1 : 0] ?? path;

// src/shortcut.ts
async function shortcutView(ctx) {
  const t = copy(ctx.locale);
  const path = `shortcuts.plugin.${encodeURIComponent(`${ctx.manifest.id}:open`)}`;
  const entry = (await ctx.domains.settings.queries.snapshot({ section: "shortcuts" })).settings.find((setting) => setting.path === path);
  if (!entry?.writable)
    throw Error("Workspace shortcut is unavailable");
  const tokens = Array.isArray(entry.value) ? entry.value : [];
  const modifiers = tokens.slice(0, -1);
  return { kind: "form", title: t.shortcut, submitLabel: t.apply, fields: [
    {
      kind: "select",
      id: "mode",
      label: t.binding,
      value: entry.shortcut?.overridden ? "custom" : "default",
      options: [{ value: "default", label: t.defaultBinding }, { value: "custom", label: t.customBinding }]
    },
    { kind: "toggle", id: "mod", label: "Command / Ctrl", value: modifiers.includes("mod") },
    { kind: "toggle", id: "alt", label: "Alt / Option", value: modifiers.includes("alt") },
    { kind: "toggle", id: "shift", label: "Shift", value: modifiers.includes("shift") },
    { kind: "text", id: "key", label: t.key, value: tokens[tokens.length - 1] ?? "" }
  ], onSubmit: async (values) => {
    const value = values.mode === "default" ? null : [...values.mod ? ["mod"] : [], ...values.alt ? ["alt"] : [], ...values.shift ? ["shift"] : [], String(values.key ?? "")];
    await ctx.domains.settings.commands.update([{ path, value }]);
    return { toast: t.shortcutSaved, close: true };
  } };
}

// src/current.ts
async function currentWorkspaceView(ctx) {
  let snapshot = await ctx.domains.settings.queries.snapshot({ target: { kind: "global" } });
  let error, revision = 0;
  const content = () => ({ kind: "blocks", blocks: [
    { kind: "heading", text: copy(ctx.locale).current },
    ...error ? [{ kind: "error", code: error }] : [],
    ...snapshot.settings.filter((setting) => PROFILE_PATHS.some((path) => path === setting.path)).map((setting) => ({
      kind: "text",
      text: `${settingLabel(ctx.locale, setting.path)}: ${String(setting.value)}`
    }))
  ] });
  return { ...content(), live: { subscribe: (channel) => ctx.domains.settings.queries.observe({ target: { kind: "global" } }, async (state) => {
    if (state.status === "ready") {
      snapshot = state.snapshot;
      error = undefined;
    } else
      error = state.code;
    await ctx.services.ui.publishView(channel, { revision: ++revision, view: content() });
  }) } };
}

// src/fonts.ts
var FONT_PATHS = ["reading.fontFamily", "appearance.contentTypography.fontFamily"];
var followPath = "appearance.contentTypography.followReader";
var target = { kind: "global" };
function saved(ctx) {
  const t = copy(ctx.locale);
  return {
    kind: "detail",
    title: t.fonts,
    content: [{ kind: "text", text: t.fontSaved }],
    actions: [{ id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await fontsView(ctx), navigation: "replace" }) }]
  };
}
async function fontsView(ctx) {
  const t = copy(ctx.locale), snapshot = await ctx.domains.settings.queries.snapshot({ target });
  const follow = snapshot.settings.find((s) => s.path === followPath);
  return { kind: "list", title: t.fonts, items: FONT_PATHS.map((path) => {
    const setting = snapshot.settings.find((s) => s.path === path);
    if (!setting)
      throw Object.assign(Error("Font setting unavailable"), { code: "settings/options-forbidden" });
    return {
      id: path,
      title: settingLabel(ctx.locale, path),
      subtitle: setting.value === null ? t.appDefault : String(setting.value),
      icon: "text-aa",
      ...setting.writable && (path !== FONT_PATHS[1] || follow?.writable) ? { onSelect: async () => ({ view: await fontCatalog(ctx, path) }) } : {}
    };
  }), actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await fontsView(ctx), navigation: "replace" }) },
    ...follow?.writable ? [{ id: "follow", label: t.follow, icon: "text-aa", run: () => ({ view: {
      kind: "form",
      title: t.fonts,
      submitLabel: t.saveFollow,
      fields: [{ id: "follow", kind: "toggle", label: t.follow, value: follow.value === true }],
      onSubmit: async (values) => {
        if (typeof values.follow !== "boolean")
          return { fieldErrors: { follow: t.invalid } };
        await ctx.domains.settings.commands.update([{ path: followPath, value: values.follow, target }]);
        return { view: saved(ctx), navigation: "replace" };
      }
    } }) }] : []
  ] };
}
async function fontCatalog(ctx, path, search = "", offsets = [0], revision) {
  const t = copy(ctx.locale);
  const page = await ctx.domains.settings.queries.options({ path, target, search, offset: offsets[offsets.length - 1], limit: 40, revision });
  const go = async (next) => ({ view: await fontCatalog(ctx, path, search, next, page.revision), navigation: "replace" });
  return {
    kind: "list",
    title: settingLabel(ctx.locale, path),
    emptyText: t.noFonts,
    items: page.options.map((option, index) => ({
      id: String(page.offset + index),
      title: option.label,
      icon: "text-aa",
      onSelect: () => ({ view: {
        kind: "detail",
        title: option.label,
        content: [{ kind: "text", text: settingLabel(ctx.locale, path) }],
        actions: [
          { id: "apply", label: t.saveFonts, icon: "check", run: async () => {
            await ctx.domains.settings.commands.update([
              { path, value: option.value, target },
              ...path === FONT_PATHS[1] ? [{ path: followPath, value: false, target }] : []
            ]);
            return { view: saved(ctx), navigation: "replace" };
          } }
        ]
      } })
    })),
    actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await fontCatalog(ctx, path, search), navigation: "replace" }) },
      { id: "search", label: t.search, icon: "magnifying-glass", run: () => ({ view: {
        kind: "form",
        title: t.search,
        submitLabel: t.search,
        fields: [{ id: "query", kind: "text", label: t.query, value: search }],
        onSubmit: async (values) => {
          if (typeof values.query !== "string" || values.query.length > 120)
            return { fieldErrors: { query: t.invalidSearch } };
          return { view: await fontCatalog(ctx, path, values.query.trim()) };
        }
      } }) }
    ],
    pagination: {
      page: offsets.length,
      ...offsets.length > 1 ? { onPrevious: () => go(offsets.slice(0, -1)) } : {},
      ...page.nextOffset === null ? {} : { onNext: () => go([...offsets, page.nextOffset]) }
    }
  };
}

// src/window.ts
var en2 = {
  title: "Window",
  minimized: "Minimized",
  maximized: "Maximized",
  fullscreen: "Full screen",
  focused: "Focused",
  yes: "Yes",
  no: "No",
  unavailable: "Window controls unavailable",
  refresh: "Refresh",
  minimize: "Minimize",
  maximize: "Maximize",
  restore: "Restore window",
  enter: "Enter full screen",
  leave: "Exit full screen",
  requested: "Window change requested"
};
var zh2 = {
  title: "窗口",
  minimized: "已最小化",
  maximized: "已最大化",
  fullscreen: "全屏",
  focused: "已聚焦",
  yes: "是",
  no: "否",
  unavailable: "窗口控制不可用",
  refresh: "刷新",
  minimize: "最小化",
  maximize: "最大化",
  restore: "还原窗口",
  enter: "进入全屏",
  leave: "退出全屏",
  requested: "已请求窗口变更"
};
var windowCopy = (locale) => locale.startsWith("zh") ? zh2 : en2;
async function windowView(ctx) {
  const window = ctx.services.ui.window, t = windowCopy(ctx.locale);
  if (!window)
    throw Object.assign(Error("Window service unavailable"), { code: "ui/unavailable" });
  let snapshot = await window.snapshot();
  let error;
  const render = () => {
    const available = snapshot.supported && !error;
    const fullscreen = snapshot.supported && snapshot.fullscreen;
    const request = async (input) => {
      await window.control(input);
      return { toast: t.requested };
    };
    return {
      kind: "detail",
      title: t.title,
      content: error ? [{ kind: "error", code: error }] : !snapshot.supported ? [{ kind: "text", text: t.unavailable }] : [{ kind: "keyValue", rows: ["minimized", "maximized", "fullscreen", "focused"].map((key) => ({ label: t[key], value: snapshot.supported && snapshot[key] ? t.yes : t.no })) }],
      actions: [
        ...available ? [
          { id: "minimize", label: t.minimize, run: () => request({ action: "minimize" }) },
          { id: "maximize", label: t.maximize, run: () => request({ action: "maximize" }) },
          { id: "restore", label: t.restore, run: () => request({ action: "restore" }) },
          {
            id: fullscreen ? "exit-fullscreen" : "enter-fullscreen",
            label: fullscreen ? t.leave : t.enter,
            run: () => request({ action: "fullscreen", enabled: !fullscreen })
          }
        ] : [],
        { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await windowView(ctx), navigation: "replace" }) }
      ]
    };
  };
  return { ...render(), live: { subscribe(channel) {
    let active = true, revision = 0;
    const subscription = window.observe(async (value) => {
      if (!active)
        return;
      if (value.status === "ready") {
        snapshot = value.snapshot;
        error = undefined;
      } else
        error = value.code;
      await ctx.services.ui.publishView(channel, { revision: ++revision, view: render() });
    });
    return { dispose() {
      if (!active)
        return;
      active = false;
      subscription.dispose();
    } };
  } } };
}

// src/views.ts
function message(ctx, text2) {
  const t = copy(ctx.locale);
  return { kind: "detail", title: t.title, content: [{ kind: "text", text: text2 }], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await profilesView(ctx), navigation: "reset" }) }
  ] };
}
function saveView(ctx) {
  const t = copy(ctx.locale);
  return {
    kind: "form",
    title: t.save,
    submitLabel: t.save,
    fields: [{ kind: "text", id: "name", label: t.name, value: "" }],
    onSubmit: async (values) => {
      let name;
      try {
        name = profileName(values.name);
      } catch {
        return { fieldErrors: { name: t.invalid } };
      }
      const result = await saveProfile(ctx, name);
      return { view: message(ctx, result.status === "saved" ? t.saved : t.conflict), navigation: "replace" };
    }
  };
}
function deleteForm(ctx, doc) {
  const t = copy(ctx.locale);
  return {
    kind: "form",
    title: parseProfile(doc.data)?.name ?? t.invalidProfile,
    submitLabel: t.remove,
    fields: [{ id: "confirm", kind: "checkbox", label: t.confirmDelete, value: false }],
    onSubmit: async (values) => {
      if (values.confirm !== true)
        return { fieldErrors: { confirm: t.confirmRequired } };
      const result = await deleteProfile(ctx, doc.id, doc.revision);
      return { view: message(ctx, result.status === "deleted" ? t.deleted : t.conflict), navigation: "replace" };
    }
  };
}
async function profileView(ctx, id) {
  const doc = await profileCollection(ctx).get(id);
  const t = copy(ctx.locale);
  if (!doc)
    return message(ctx, t.missing);
  const profile = parseProfile(doc.data);
  return { kind: "blocks", blocks: [
    { kind: "heading", text: profile?.name ?? t.invalidProfile },
    ...(profile?.changes ?? []).map((change) => ({ kind: "text", text: `${settingLabel(ctx.locale, change.path)}: ${change.value === null ? t.appDefault : String(change.value)}` })),
    { kind: "actions", actions: [
      ...profile ? [{ id: "apply", label: t.apply, icon: "check", run: async () => {
        const result = await applyProfile(ctx, id, doc.revision);
        return result.status === "applied" ? { toast: t.applied, close: true } : { view: message(ctx, t.conflict), navigation: "replace" };
      } }] : [],
      { id: "delete", label: t.remove, icon: "trash", run: () => ({ view: deleteForm(ctx, doc) }) },
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await profileView(ctx, id), navigation: "replace" }) }
    ] }
  ] };
}
async function profilesView(ctx, cursors = [undefined]) {
  const t = copy(ctx.locale);
  const page = await listProfiles(ctx, cursors[cursors.length - 1]);
  if (page.status === "stale-cursor")
    return message(ctx, t.stalePage);
  const go = async (next) => ({ view: await profilesView(ctx, next), navigation: "replace" });
  return {
    kind: "list",
    title: t.title,
    emptyText: t.empty,
    actions: [
      { id: "save", label: t.save, icon: "plus", run: () => ({ view: saveView(ctx) }) },
      { id: "current", label: t.current, icon: "rows", run: async () => ({ view: await currentWorkspaceView(ctx) }) },
      { id: "fonts", label: t.fonts, icon: "text-aa", run: async () => ({ view: await fontsView(ctx) }) },
      { id: "window", label: windowCopy(ctx.locale).title, icon: "rows", run: async () => ({ view: await windowView(ctx) }) },
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await profilesView(ctx), navigation: "replace" }) },
      { id: "shortcut", label: t.shortcut, icon: "rows", run: async () => ({ view: await shortcutView(ctx) }) }
    ],
    items: page.items.map((doc) => ({
      id: doc.id,
      title: parseProfile(doc.data)?.name ?? t.invalidProfile,
      timestamp: doc.updatedAt,
      icon: "cards",
      onSelect: async () => ({ view: await profileView(ctx, doc.id) })
    })),
    pagination: {
      page: cursors.length,
      ...cursors.length > 1 ? { onPrevious: () => go(cursors.slice(0, -1)) } : {},
      ...page.nextCursor ? { onNext: () => go([...cursors, page.nextCursor]) } : {}
    }
  };
}

// src/index.ts
var src_default = {
  activate(ctx) {
    const title = copy(ctx.locale).title;
    ctx.contributions.headerActions.register({ id: "profiles", title, icon: "cards", surface: "shelf", presentation: "popup", view: () => profilesView(ctx) });
    ctx.contributions.commands.register({ id: "open", title, icon: "cards", run: async () => ({ view: await profilesView(ctx) }) });
    registerProfileTools(ctx);
  }
};
export {
  src_default as default
};
