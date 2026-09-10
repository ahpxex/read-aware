const en = {
  controls: "Conversation controls", current: "Selected global conversation", newDraft: "New global draft", selected: "Conversation selected", draftSelected: "New draft selected",
  select: "Select conversation", refresh: "Refresh", requests: "My turn requests", noRequests: "No retained requests", cancel: "Cancel request",
  draft: "Propose draft", send: "Request send", retry: "Request retry", text: "Message", invalidText: "Enter 1-65,536 characters",
  stop: "Stop conversation", stopped: "Stop completed", clear: "Clear conversation", cleared: "Conversation cleared",
  confirmClear: "Clear this conversation and its summary; keep long-term memories and event history",
  confirmRetry: "Retry the existing user message", confirm: "Confirm this action first", target: "Target", state: "State", messages: "Messages",
  inactive: "Not mounted", loading: "Loading", streaming: "Generating", idle: "Idle", pending: "Awaiting host confirmation",
  adopted: "Draft adopted", started: "Turn started", dismissed: "Dismissed", cancelled: "Cancelled", stale: "Conversation changed", failed: "Failed", expired: "Expired",
};
const zh: typeof en = {
  controls: "对话控制", current: "当前选中的全局对话", newDraft: "新建全局草稿", selected: "已选择对话", draftSelected: "已选择新草稿",
  select: "选择对话", refresh: "刷新", requests: "我的回合请求", noRequests: "暂无保留请求", cancel: "取消请求",
  draft: "提交草稿", send: "请求发送", retry: "请求重试", text: "消息", invalidText: "请输入 1-65,536 个字符",
  stop: "停止对话", stopped: "停止操作已完成", clear: "清空对话", cleared: "对话已清空",
  confirmClear: "清空此对话及其摘要，保留长期记忆和事件历史",
  confirmRetry: "重试已有用户消息", confirm: "请先确认此操作", target: "目标", state: "状态", messages: "消息数",
  inactive: "未挂载", loading: "加载中", streaming: "生成中", idle: "空闲", pending: "等待宿主确认",
  adopted: "已采用草稿", started: "回合已开始", dismissed: "已拒绝", cancelled: "已取消", stale: "对话已变化", failed: "失败", expired: "已过期",
};
export const conversationWords = (locale: string) => locale === "zh-Hans" ? zh : en;
