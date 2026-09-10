const en = {
  organize: "Organize", metadata: "Edit title and author", title: "Title", author: "Author", save: "Save",
  required: "Enter a name", favorite: "Favorite", addFavorite: "Add to favorites", removeFavorite: "Remove from favorites",
  done: "Done", yes: "Yes", no: "No", refresh: "Refresh", missing: "Book no longer available", collections: "Collections",
  create: "New collection", rename: "Rename", name: "Name", remove: "Remove collection", confirm: "Confirm",
  deleteWarning: "Remove this collection. Its books will remain in the library.", confirmRequired: "Confirm this change first",
  move: "Move selected books", ungroup: "No collection", destination: "Destination", selected: "Selected books",
  duplicates: "Duplicate books", noDuplicates: "No duplicates found", keep: "Keep", merge: "Merge records",
  mergeWarning: "Merge these duplicate records into the retained book. This cannot be undone.", merged: "Records merged",
  previous: "Previous", next: "Next", openKeeper: "Retained book", noCollection: "Collection no longer available",
};
const zh: typeof en = {
  organize: "整理书籍", metadata: "编辑书名与作者", title: "书名", author: "作者", save: "保存",
  required: "请输入名称", favorite: "收藏", addFavorite: "加入收藏", removeFavorite: "取消收藏",
  done: "完成", yes: "是", no: "否", refresh: "刷新", missing: "书籍已不可用", collections: "集合",
  create: "新建集合", rename: "重命名", name: "名称", remove: "移除集合", confirm: "确认",
  deleteWarning: "移除此集合，书籍仍保留在书库中。", confirmRequired: "请先确认此变更",
  move: "移动所选书籍", ungroup: "无集合", destination: "目标集合", selected: "所选书籍",
  duplicates: "重复书籍", noDuplicates: "没有重复书籍", keep: "保留", merge: "合并记录",
  mergeWarning: "将这些重复记录合并到保留书籍中，此操作无法撤销。", merged: "记录已合并",
  previous: "上一页", next: "下一页", openKeeper: "保留书籍", noCollection: "集合已不可用",
};
export const organizeStrings = (locale: string) => locale === "zh-Hans" || locale === "zh-CN" ? zh : en;
