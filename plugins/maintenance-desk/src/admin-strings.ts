const en = {
  plugins: "Installed plugins", contributions: "Registered contributions", updates: "Software updates",
  managePlugins: "Manage plugins", manageUpdates: "Open update settings", check: "Check for updates",
  search: "Search", browse: "Browse", filters: "Search directory", refresh: "Refresh", empty: "No matches",
  invalidSearch: "Use at most 200 characters.", version: "Version", enabled: "Configured enabled",
  builtin: "Built-in", activationFailed: "Activation failed", yes: "Yes", no: "No",
  current: "Current version", available: "Available version", channel: "Selected channel",
  checkedChannel: "Last successfully checked channel", unknown: "Unknown", never: "Not checked",
  status: "Status", unsupported: "Updates unavailable on this platform", stable: "Stable", beta: "Beta",
  errorStage: "Failed operation", checkStage: "Update check", installStage: "Installation",
  phases: { idle: "Not checked", checking: "Checking", "up-to-date": "Up to date", available: "Update available",
    downloading: "Downloading", installing: "Installing", "permission-required": "Permission required",
    "installer-open": "Installer opened", error: "Update failed" },
};
const zh: typeof en = {
  plugins: "已安装插件", contributions: "已注册贡献项", updates: "软件更新",
  managePlugins: "管理插件", manageUpdates: "打开更新设置", check: "检查更新",
  search: "搜索", browse: "查询", filters: "搜索目录", refresh: "刷新", empty: "没有匹配项",
  invalidSearch: "最多输入 200 个字符。", version: "版本", enabled: "已配置启用",
  builtin: "内置", activationFailed: "激活失败", yes: "是", no: "否",
  current: "当前版本", available: "可用版本", channel: "所选通道",
  checkedChannel: "上次成功检查的通道", unknown: "未知", never: "尚未检查",
  status: "状态", unsupported: "此平台不支持软件更新", stable: "稳定版", beta: "测试版",
  errorStage: "失败操作", checkStage: "检查更新", installStage: "安装",
  phases: { idle: "尚未检查", checking: "正在检查", "up-to-date": "已是最新版本", available: "有可用更新",
    downloading: "正在下载", installing: "正在安装", "permission-required": "需要授权",
    "installer-open": "已打开安装程序", error: "更新失败" },
};
export const adminCopy = (locale: string) => locale.startsWith("zh") ? zh : en;
