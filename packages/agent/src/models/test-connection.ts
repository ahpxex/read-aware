/**
 * 连接自检（Settings → AI 的 Test connection）：用与聊天完全相同的
 * provider 栈（pi-ai registry）发一次最小补全。绝不另起一套 HTTP 客户端 ——
 * 测试通过即代表真实对话路径可用，测试失败的错误也来自真实路径。
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createModelResolver, type LlmAccount } from "./accounts";
import { createCompleteFn } from "./complete";
import { buildProviderRegistry } from "./registry";

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** 成功时返回模型的应答文本；失败时抛出携带 provider 错误信息的 Error。 */
export async function testLlmConnection(account: LlmAccount, modelId: string): Promise<string> {
  const registry = buildProviderRegistry();
  const resolveModel = createModelResolver(account, { smart: modelId, fast: modelId }, registry);
  const complete = createCompleteFn(registry, account);
  const message = await complete(resolveModel("smart"), {
    messages: [
      { role: "user", content: 'Reply with the single word "ok".', timestamp: Date.now() },
    ],
  });
  // completeSimple 不 reject：失败 resolve 成 stopReason "error"/"aborted" 的消息
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(message.errorMessage ?? "connection test failed");
  }
  return extractText(message).trim();
}
