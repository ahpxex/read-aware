// src/profiles.ts
var PROFILE_PATHS = ["shelf.layout", "shelf.group", "shelf.sort", "appearance.theme", "appearance.motion", "reading.fontSize", "reading.lineSpacing"];
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
  await collection(ctx).put(id, { version: 1, name: cleanName, changes });
  return { id, name: cleanName };
}
async function readProfile(ctx, id) {
  const doc = await collection(ctx).get(id);
  if (!doc)
    throw Error("Workspace profile no longer exists");
  const profile = doc.data;
  if (profile?.version !== 1 || !Array.isArray(profile.changes) || profile.changes.length !== PROFILE_PATHS.length || new Set(profile.changes.map((change) => change.path)).size !== PROFILE_PATHS.length || profile.changes.some((change) => !PROFILE_PATHS.some((path) => path === change.path) || change.target?.kind !== "global")) {
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
  shortcutSaved: "Shortcut updated"
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
  shortcutSaved: "快捷键已更新"
};
var copy = (locale) => locale.startsWith("zh") ? zh : en;
var labels = {
  "shelf.layout": ["Shelf layout", "书架布局"],
  "shelf.group": ["Group books", "书籍分组"],
  "shelf.sort": ["Sort books", "书籍排序"],
  "appearance.theme": ["App theme", "应用主题"],
  "appearance.motion": ["Motion", "动画"],
  "reading.fontSize": ["Global reading font size", "全局阅读字号"],
  "reading.lineSpacing": ["Global reading line spacing", "全局阅读行距"]
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
      description: "List, save the current workspace as a named preset, apply an existing preset, or delete a preset. Only save/apply/delete when explicitly requested. List first to get the exact ID. Applies device-local shelf layout/group/sort, app theme/motion, and global reading font size/spacing; book overrides are preserved. Never changes books, current selection, AI privacy, credentials or plugin lifecycle.",
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
