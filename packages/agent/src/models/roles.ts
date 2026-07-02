import type { Api, Model } from "@earendil-works/pi-ai";

/**
 * 模型档位：agent 代码永远不写死具体模型，只请求档位
 * （docs/agent-architecture.md §8）。
 * - `smart`：慢、聪明、贵 —— 聊天轮次、onboarding 访谈、跨书综合
 * - `fast`：便宜、快 —— 逐轮记忆提炼、滚动摘要、去重初筛、标题/标签
 */
export type ModelRole = "smart" | "fast";

/** 从当前激活的 LLM 账户配置解析某个档位对应的具体模型。 */
export type ResolveModel = (role: ModelRole) => Model<Api>;
