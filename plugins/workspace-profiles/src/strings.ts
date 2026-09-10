const en = { title: "Workspace Profiles", save: "Save current workspace", name: "Name", invalid: "Enter a name of 1-80 characters.",
  empty: "No saved profiles", apply: "Apply", remove: "Delete profile", refresh: "Refresh", saved: "Profile saved", applied: "Profile applied",
  conflict: "The profile changed. Refresh before trying again.", missing: "Profile no longer exists", invalidProfile: "Invalid profile",
  stalePage: "Profiles changed. Refresh the list.", confirmDelete: "Permanently delete this profile", confirmRequired: "Confirm deletion first.", deleted: "Profile deleted",
  shortcut: "Keyboard shortcut", binding: "Binding", defaultBinding: "Default", customBinding: "Custom", key: "Key", shortcutSaved: "Shortcut updated", current: "Current workspace",
  fonts: "Fonts", appDefault: "App default", follow: "Content follows reader typography", search: "Search fonts", query: "Font name", invalidSearch: "Maximum 120 characters", noFonts: "No matching fonts", previous: "Previous", next: "Next", saveFonts: "Apply font", fontSaved: "Font settings saved", saveFollow: "Save", yes: "On", no: "Off" };
const zh: typeof en = { title: "工作区预设", save: "保存当前工作区", name: "名称", invalid: "请输入 1-80 个字符的名称。",
  empty: "暂无预设", apply: "应用", remove: "删除预设", refresh: "刷新", saved: "预设已保存", applied: "预设已应用",
  conflict: "预设已变化，请刷新后再试。", missing: "预设已不存在", invalidProfile: "无效预设",
  stalePage: "预设列表已变化，请刷新。", confirmDelete: "永久删除此预设", confirmRequired: "请先确认删除。", deleted: "预设已删除",
  shortcut: "键盘快捷键", binding: "绑定", defaultBinding: "默认", customBinding: "自定义", key: "按键", shortcutSaved: "快捷键已更新", current: "当前工作区",
  fonts: "字体", appDefault: "应用默认", follow: "应用内容跟随阅读排版", search: "搜索字体", query: "字体名称", invalidSearch: "最多 120 个字符", noFonts: "没有匹配的字体", previous: "上一页", next: "下一页", saveFonts: "应用字体", fontSaved: "字体设置已保存", saveFollow: "保存", yes: "开启", no: "关闭" };
export const copy = (locale: string) => locale.startsWith("zh") ? zh : en;

const labels: Record<string, [string, string]> = {
  "shelf.layout": ["Shelf layout", "书架布局"], "shelf.group": ["Group books", "书籍分组"], "shelf.sort": ["Sort books", "书籍排序"],
  "appearance.theme": ["App theme", "应用主题"], "appearance.motion": ["Motion", "动画"],
  "reading.fontSize": ["Global reading font size", "全局阅读字号"], "reading.lineSpacing": ["Global reading line spacing", "全局阅读行距"],
  "reading.fontFamily": ["Global reading font", "全局阅读字体"],
  "appearance.contentTypography.fontFamily": ["Independent content font", "独立应用内容字体"],
  "appearance.contentTypography.followReader": ["Content follows reader typography", "应用内容跟随阅读排版"],
};
export const settingLabel = (locale: string, path: string) => labels[path]?.[locale.startsWith("zh") ? 1 : 0] ?? path;
