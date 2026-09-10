const en = {
  profile: "User profile", edit: "Edit profile", summary: "Summary", save: "Save",
  confirm: "Confirm replacing the profile, including clearing it if empty",
  required: "Confirm this change first", tooLong: "Maximum 16,000 characters",
  absent: "No profile yet", empty: "Empty profile", saved: "Profile saved", unchanged: "Profile unchanged",
  refresh: "Refresh", previous: "Previous", next: "Next", conversations: "Conversation summaries",
  noThreads: "No conversations", untitled: "Untitled conversation", noSummary: "No stored summary",
  emptySummary: "Empty summary", bookSummary: "Conversation summary", local: "Device-local",
};
const zh: typeof en = {
  profile: "用户画像", edit: "编辑画像", summary: "摘要", save: "保存",
  confirm: "确认替换画像；内容为空时清空画像",
  required: "请先确认此修改", tooLong: "最多 16,000 个字符",
  absent: "尚无画像", empty: "画像为空", saved: "画像已保存", unchanged: "画像未变化",
  refresh: "刷新", previous: "上一页", next: "下一页", conversations: "对话摘要",
  noThreads: "暂无对话", untitled: "未命名对话", noSummary: "尚无已存摘要",
  emptySummary: "摘要为空", bookSummary: "对话摘要", local: "仅本机",
};
export const contextWords = (locale: string) => locale === "zh-Hans" ? zh : en;
