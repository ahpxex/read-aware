export * from "./thread-scope";
export * from "./chunks";
export * from "./ports";
export * from "./settings";
// 宿主注入 extraTools 时需要的工具类型（apps/web 的插件桥用它，避免直依 pi）。
export type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
export { searchChapters,
  searchTurnRecords, type ChapterLike, type ChapterHit } from "./text/search";
export * from "./models/roles";
export * from "./models/accounts";
export {
  CUSTOM_OPENAI_APIS,
  CUSTOM_OPENAI_PROVIDER_ID,
  DEFAULT_CUSTOM_OPENAI_API,
  LEGACY_CUSTOM_OPENAI_API,
  isCustomOpenAIApi,
  normalizeCustomOpenAIBaseUrl,
  type CustomOpenAIApi,
} from "./models/custom-openai";
export {
  KNOWN_PROVIDERS,
  getProviderModelCatalog,
  type KnownProviderId,
  type ProviderModelCatalogEntry,
} from "./models/registry";
export type { CompleteFn } from "./models/complete";
export type { AgentFetch } from "./models/transport";
export { testLlmConnection } from "./models/test-connection";
export { extractJsonObject, schemaViolations } from "./structured";
export * from "./onboarding";
export type { ConsolidationReport } from "./memory/consolidation";
export {
  DIGEST_VERSION,
  digestMissingChapters,
  extractChapterDigest,
  mergeCharacterRegistry,
} from "./memory/chapter-digest";
export { PRESENT_TOOL_NAMES, MAX_PRESENTED_ITEMS } from "./tools/present-tools";
export { INTERACTIVE_TOOL_NAMES } from "./tools/user-interaction";
export { AgentThread, type AgentThreadOptions, type SendTurnInput, type SelectionAttachment } from "./runtime/thread";
export { type ReadingCursor } from "./runtime/reading-cursor";
export { AgentRuntime, createAgentRuntime, type AgentRuntimeOptions } from "./runtime/runtime";
export { matchesMemoryQuery } from "./memory/query-match";

// eval viewer 的数据源：套件目录（场景定义本身就是可序列化的）。
