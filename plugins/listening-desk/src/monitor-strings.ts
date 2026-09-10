const en = {
  title: "Live reading status", layout: "Panel widths", width: "Preferred width for all books (CSS px)",
  saved: "Panel width saved", invalidWidth: "Enter a whole number from 240 to 640.",
  layoutMode: "Panel layout", docked: "Docked", exclusive: "Exclusive", unknown: "Unavailable",
  reader: "Reader", idle: "No open book", loading: "Loading", ready: "Ready", error: "Reader failed",
  mode: "Text-unit mode", modeError: "Text-unit mode failed", inactive: "Inactive", preparing: "Preparing", empty: "No units",
  progress: "Current section unit", panels: "Panels", open: "Open", closed: "Closed", visible: "Visible", hidden: "Hidden",
  network: "System network hint", online: "Online", offline: "Offline", networkUnknown: "Unknown",
};
const zh: typeof en = {
  title: "实时阅读状态", layout: "面板宽度", width: "所有书籍的首选宽度（CSS 像素）",
  saved: "面板宽度已保存", invalidWidth: "请输入 240 到 640 之间的整数。",
  layoutMode: "面板布局", docked: "并排", exclusive: "互斥", unknown: "不可用",
  reader: "阅读器", idle: "尚未打开书籍", loading: "正在加载", ready: "已就绪", error: "阅读器出错",
  mode: "句段模式", modeError: "句段模式出错", inactive: "未启用", preparing: "正在准备", empty: "没有单元",
  progress: "当前分节单元", panels: "面板", open: "已打开", closed: "已关闭", visible: "可见", hidden: "隐藏",
  network: "系统网络提示", online: "在线", offline: "离线", networkUnknown: "未知",
};
export const monitorCopy = (locale: string) => locale.startsWith("zh") ? zh : en;
