const en = {
  title: "Bookmarks", empty: "No bookmarks", name: "Name", save: "Save bookmark", saved: "Bookmark saved",
  current: "Bookmark current location", selection: "Bookmark selection", location: "Reading location", range: "Selected passage",
  open: "Go to bookmark", rename: "Rename", renamed: "Bookmark renamed", remove: "Delete bookmark", removed: "Bookmark deleted",
  confirm: "Delete this bookmark", invalidName: "Enter a name of 1-120 characters.", required: "Confirm deletion.",
  invalid: "Bookmark data unavailable", missing: "Bookmark no longer exists", stale: "Bookmarks changed. Refresh the list.",
  conflict: "This bookmark changed. Refresh before trying again.", refresh: "Refresh", all: "All books", thisBook: "Current book",
  version: "Source version", book: "Book", kind: "Type",
};
const zh: typeof en = {
  title: "书签", empty: "暂无书签", name: "名称", save: "保存书签", saved: "书签已保存",
  current: "收藏当前位置", selection: "收藏选区", location: "阅读位置", range: "选中段落",
  open: "跳转到书签", rename: "重命名", renamed: "书签已重命名", remove: "删除书签", removed: "书签已删除",
  confirm: "删除这条书签", invalidName: "请输入 1-120 个字符的名称。", required: "请确认删除。",
  invalid: "书签数据不可用", missing: "书签已不存在", stale: "书签列表已变化，请刷新。",
  conflict: "这条书签已变化，请刷新后再试。", refresh: "刷新", all: "全部书籍", thisBook: "当前书籍",
  version: "内容版本", book: "书籍", kind: "类型",
};
export const bookmarkCopy = (locale: string) => locale.startsWith("zh") ? zh : en;
