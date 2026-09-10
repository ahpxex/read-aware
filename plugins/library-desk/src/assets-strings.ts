const en = {
  details: "Book details", import: "Import book", confirmImport: "Import", imported: "Imported",
  duplicate: "Already in library", cover: "Cover", preview: "Preview cover", copy: "Copy cover",
  copied: "Cover copied", save: "Save cover", export: "Export original file", saved: "Saved",
  unavailable: "Not available locally", unchecked: "Not checked", none: "No cover", ready: "Available locally",
  enrichment: "Metadata and cover", retry: "Retry enrichment", refresh: "Refresh", source: "Original file",
  local: "Available locally", remote: "Not available locally", pending: "Metadata pending", complete: "Metadata complete",
  file: "File", size: "Bytes", format: "Format", sections: "Sections", inspection: "Parser initialization",
  parsed: "Initialized", unsupported: "Unsupported format", encrypted: "Encrypted", failed: "Failed", unknown: "Unknown",
  idle: "Idle", queued: "Queued", running: "Running", completed: "Completed", skipped: "Skipped",
};
const zh: typeof en = {
  details: "书籍详情", import: "导入书籍", confirmImport: "导入", imported: "已导入",
  duplicate: "书库中已存在", cover: "封面", preview: "预览封面", copy: "复制封面",
  copied: "封面已复制", save: "保存封面", export: "导出原文件", saved: "已保存",
  unavailable: "本地不可用", unchecked: "尚未检查", none: "没有封面", ready: "本地可用",
  enrichment: "元数据与封面", retry: "重试补齐", refresh: "刷新", source: "原文件",
  local: "本地可用", remote: "本地不可用", pending: "元数据待补齐", complete: "元数据已完整",
  file: "文件", size: "字节", format: "格式", sections: "章节数", inspection: "解析器初始化",
  parsed: "已初始化", unsupported: "不支持的格式", encrypted: "已加密", failed: "失败", unknown: "未知",
  idle: "空闲", queued: "排队中", running: "进行中", completed: "已完成", skipped: "已跳过",
};
export const assetStrings = (locale: string) => locale === "zh-Hans" || locale === "zh-CN" ? zh : en;
