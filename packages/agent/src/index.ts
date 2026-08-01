export * from "./thread-scope";
export * from "./chunks";
export * from "./ports";
// 宿主注入 extraTools 时需要的工具类型（apps/web 的插件桥用它，避免直依 pi）。
export type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
export { searchChapters, type ChapterLike, type ChapterHit } from "./text/search";
export * from "./models/roles";
export * from "./models/accounts";
export {
  KNOWN_PROVIDERS,
  getProviderModelCatalog,
  type KnownProviderId,
  type ProviderModelCatalogEntry,
} from "./models/registry";
export type { CompleteFn } from "./models/complete";
export { testLlmConnection } from "./models/test-connection";
export { extractJsonObject, schemaViolations } from "./structured";
export * from "./onboarding";
export type { ConsolidationReport } from "./memory/consolidation";
export { PRESENT_TOOL_NAMES, MAX_PRESENTED_ITEMS } from "./tools/present-tools";
export { INTERACTIVE_TOOL_NAMES } from "./tools/user-interaction";
export { AgentThread, type AgentThreadOptions, type SendTurnInput, type SelectionAttachment } from "./runtime/thread";
export { AgentRuntime, createAgentRuntime, type AgentRuntimeOptions } from "./runtime/runtime";
