const en = {
  navigation: "Navigation", sections: "Source sections", pages: "Book page labels", section: "Source section", page: "Page label",
  screen: "Screen in this section", empty: "No matching targets", absent: "Page labels unavailable", unlocated: "No reading location",
  number: "Section number", jump: "Go", invalidSection: "Enter an existing positive section number", invalidLabel: "Enter a page label of 1-300 characters",
  findPage: "Find page label", refresh: "Refresh", nonLinear: "Non-linear section",
  next: "Next screen", previous: "Previous screen", "next-section": "Next source section", "previous-section": "Previous source section",
  "next-chapter": "Next TOC heading", "previous-chapter": "Previous TOC heading", start: "Start of book", end: "End of book",
};
const zh: typeof en = {
  navigation: "导航", sections: "源分节", pages: "原书页码", section: "源分节", page: "页码标签",
  screen: "本分节屏幕页", empty: "没有匹配目标", absent: "暂无可用的页码标签", unlocated: "没有可跳转的位置",
  number: "分节序号", jump: "跳转", invalidSection: "请输入存在的正整数分节序号", invalidLabel: "请输入 1-300 个字符的页码标签",
  findPage: "查找页码标签", refresh: "刷新", nonLinear: "非线性分节",
  next: "下一屏", previous: "上一屏", "next-section": "下一源分节", "previous-section": "上一源分节",
  "next-chapter": "下一目录标题", "previous-chapter": "上一目录标题", start: "书首", end: "书尾",
};
export const navigationWords = (locale: string) => locale === "zh-Hans" ? zh : en;
