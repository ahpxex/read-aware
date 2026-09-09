const en = { title: "Workspace Profiles", save: "Save current workspace", name: "Name", invalid: "Enter a name of 1-80 characters.",
  empty: "No saved profiles", apply: "Apply", remove: "Delete profile", refresh: "Refresh", saved: "Profile saved", applied: "Profile applied",
  shortcut: "Keyboard shortcut", binding: "Binding", defaultBinding: "Default", customBinding: "Custom", key: "Key", shortcutSaved: "Shortcut updated", current: "Current workspace" };
const zh: typeof en = { title: "工作区预设", save: "保存当前工作区", name: "名称", invalid: "请输入 1-80 个字符的名称。",
  empty: "暂无预设", apply: "应用", remove: "删除预设", refresh: "刷新", saved: "预设已保存", applied: "预设已应用",
  shortcut: "键盘快捷键", binding: "绑定", defaultBinding: "默认", customBinding: "自定义", key: "按键", shortcutSaved: "快捷键已更新", current: "当前工作区" };
export const copy = (locale: string) => locale.startsWith("zh") ? zh : en;

const labels: Record<string, [string, string]> = {
  "shelf.layout": ["Shelf layout", "书架布局"], "shelf.group": ["Group books", "书籍分组"], "shelf.sort": ["Sort books", "书籍排序"],
  "appearance.theme": ["App theme", "应用主题"], "appearance.motion": ["Motion", "动画"],
  "reading.fontSize": ["Global reading font size", "全局阅读字号"], "reading.lineSpacing": ["Global reading line spacing", "全局阅读行距"],
};
export const settingLabel = (locale: string, path: string) => labels[path]?.[locale.startsWith("zh") ? 1 : 0] ?? path;
