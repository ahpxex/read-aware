// src/profiles.ts
var LEGACY_PROFILE_PATHS = ["shelf.layout", "shelf.group", "shelf.sort", "appearance.theme", "appearance.motion", "reading.fontSize", "reading.lineSpacing"];
var PROFILE_PATHS = [...LEGACY_PROFILE_PATHS, "reading.fontFamily", "appearance.contentTypography.fontFamily", "appearance.contentTypography.followReader"];
var collection = (ctx) => ctx.services.storage.collection("profiles");
function profileName(name) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80)
    throw Error("Profile name must contain 1-80 characters");
  return name.trim();
}
async function listProfiles(ctx) {
  return collection(ctx).list();
}
async function saveProfile(ctx, name) {
  const cleanName = profileName(name);
  const snapshot = await ctx.domains.settings.queries.snapshot({ target: { kind: "global" } });
  const changes = PROFILE_PATHS.map((path) => {
    const setting = snapshot.settings.find((setting2) => setting2.path === path);
    if (!setting?.writable)
      throw Error(`Profile setting unavailable: ${path}`);
    return { path, value: setting.value, target: { kind: "global" } };
  });
  const id = crypto.randomUUID();
  await collection(ctx).put(id, { version: 2, name: cleanName, changes });
  return { id, name: cleanName };
}
async function readProfile(ctx, id) {
  const doc = await collection(ctx).get(id);
  if (!doc)
    throw Error("Workspace profile no longer exists");
  const profile = doc.data;
  const paths = profile?.version === 1 ? LEGACY_PROFILE_PATHS : PROFILE_PATHS;
  if (!profile || ![1, 2].includes(profile.version) || !Array.isArray(profile.changes) || profile.changes.length !== paths.length || profile.changes.some((change) => !change || typeof change !== "object" || !paths.includes(change.path) || change.target?.kind !== "global") || new Set(profile.changes.map((change) => change.path)).size !== paths.length) {
    throw Error("Invalid workspace profile");
  }
  profileName(profile.name);
  return doc;
}
async function applyProfile(ctx, id) {
  const doc = await readProfile(ctx, id);
  const receipt = await ctx.domains.settings.commands.update(doc.data.changes);
  return { id, name: doc.data.name, changed: receipt.changed, overrides: receipt.settings.overrides };
}
async function deleteProfile(ctx, id) {
  await readProfile(ctx, id);
  await collection(ctx).delete(id);
  return { deleted: id };
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

// src/views.ts
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
      await saveProfile(ctx, name);
      return { toast: t.saved, view: await profilesView(ctx), navigation: "reset" };
    }
  };
}
async function profileView(ctx, id) {
  const doc = await readProfile(ctx, id);
  const t = copy(ctx.locale);
  return { kind: "blocks", blocks: [
    { kind: "heading", text: doc.data.name },
    ...doc.data.changes.map((change) => ({ kind: "text", text: `${settingLabel(ctx.locale, change.path)}: ${String(change.value)}` })),
    { kind: "actions", actions: [
      { id: "apply", label: t.apply, icon: "check", run: async () => {
        await applyProfile(ctx, id);
        return { toast: t.applied, close: true };
      } },
      { id: "delete", label: t.remove, icon: "trash", run: async () => {
        await deleteProfile(ctx, id);
        return { view: await profilesView(ctx), navigation: "reset" };
      } }
    ] }
  ] };
}
async function profilesView(ctx) {
  const t = copy(ctx.locale);
  const profiles = await listProfiles(ctx);
  return { kind: "list", title: t.title, emptyText: t.empty, actions: [
    { id: "save", label: t.save, icon: "plus", run: () => ({ view: saveView(ctx) }) },
    { id: "current", label: t.current, icon: "rows", run: async () => ({ view: await currentWorkspaceView(ctx) }) },
    { id: "fonts", label: t.fonts, icon: "text-aa", run: async () => ({ view: await fontsView(ctx) }) },
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await profilesView(ctx), navigation: "replace" }) },
    { id: "shortcut", label: t.shortcut, icon: "rows", run: async () => ({ view: await shortcutView(ctx) }) }
  ], items: profiles.map((doc) => ({
    id: doc.id,
    title: doc.data.name,
    timestamp: doc.updatedAt,
    icon: "cards",
    onSelect: async () => ({ view: await profileView(ctx, doc.id) })
  })) };
}

// src/index.ts
var src_default = {
  activate(ctx) {
    if (!ctx.contributions.agentTools)
      throw Error("Workspace Profiles requires agent:tools");
    const title = copy(ctx.locale).title;
    ctx.contributions.headerActions.register({ id: "profiles", title, icon: "cards", surface: "shelf", presentation: "popup", view: () => profilesView(ctx) });
    ctx.contributions.commands.register({ id: "open", title, icon: "cards", run: async () => ({ view: await profilesView(ctx) }) });
    ctx.contributions.agentTools.register({
      name: "workspace_profiles",
      label: title,
      contexts: ["global", "book"],
      description: "List, save the current workspace as a named preset, apply an existing preset, or delete a preset. Only save/apply/delete when explicitly requested. List first to get the exact ID. Applies device-local shelf layout/group/sort, app theme/motion, and global reading font size/spacing. Version 2 also captures reader font, independent content font and content-follow-reader typography; version 1 leaves those unchanged. Book overrides are preserved. Never changes books, current selection, AI privacy, credentials or plugin lifecycle.",
      parameters: { type: "object", properties: { operation: { type: "string", enum: ["list", "save", "apply", "delete"] }, id: { type: "string" }, name: { type: "string" } }, required: ["operation"], additionalProperties: false },
      execute: async (params) => {
        let result;
        if (params.operation === "list")
          result = (await listProfiles(ctx)).map((doc) => ({ id: doc.id, ...doc.data }));
        else if (params.operation === "save")
          result = await saveProfile(ctx, typeof params.name === "string" ? params.name : "");
        else if ((params.operation === "apply" || params.operation === "delete") && typeof params.id === "string" && params.id) {
          result = params.operation === "apply" ? await applyProfile(ctx, params.id) : await deleteProfile(ctx, params.id);
        } else
          throw Error("Invalid workspace profile operation");
        return { gist: result };
      }
    });
  }
};
export {
  src_default as default
};
