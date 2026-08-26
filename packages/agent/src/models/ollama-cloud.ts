/**
 * Ollama Cloud（ollama.com 托管 API）provider。
 *
 * 接入方式（来自 https://docs.ollama.com/cloud.md，2026-07 实证）：
 * ollama.com 对 OpenAI 兼容端点（`/v1/chat/completions`）直接暴露为远程
 * Ollama host，认证是 `Authorization: Bearer <OLLAMA_API_KEY>`（key 在
 * https://ollama.com/settings/keys 创建）。所以它骑在项目的
 * custom-openai-completions 适配器上，与 `custom-openai` 同一套 wire——
 * 只换 baseUrl + provider id + 模型目录。
 *
 * 云模型目录用 `curl https://ollama.com/v1/models` 实证（当前 19 个）。
 * Ollama 会不定期退役老云模型（见 cloud.md 的 Retirement 表），所以这里
 * 只钉当前活跃/常用项，按需增删；目录滞后时 `createModelResolver` 会克隆
 * 任一模型并覆盖 id 原样透传，不会挡住新模型。
 */
import { createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";
import { createCustomOpenAIModel } from "./custom-openai";
import { customOpenAICompletionsApi } from "./custom-openai-completions";

export const OLLAMA_CLOUD_PROVIDER_ID = "ollama-cloud";
export const OLLAMA_CLOUD_BASE_URL = "https://ollama.com/v1";

/**
 * 云输出 token 上限。agent eval 常带长思考 + 工具轨迹，默认的 8192 偏紧，
 * 显式提到 16k 避免 reasoning 长的场景被截断（端点本身 OpenAI 兼容，
 * 收 `max_tokens`）。
 */
const OLLAMA_CLOUD_MAX_OUTPUT_TOKENS = 16_384;

/** 当前 ollama.com 云模型（`/v1/models` 实证）；reasoning 模型为主。 */
export const OLLAMA_CLOUD_MODELS = [
  "deepseek-v4-flash:0731",
  "deepseek-v4-pro:0813",
  "gpt-oss:120b",
  "gpt-oss:20b",
  "minimax-m3",
  "kimi-k2.6",
  "kimi-k3",
  "qwen3.5:397b",
  "mistral-large-3:675b",
  "glm-5.2",
] as const;

export function ollamaCloudProvider() {
  return createProvider({
    id: OLLAMA_CLOUD_PROVIDER_ID,
    name: "Ollama Cloud",
    baseUrl: OLLAMA_CLOUD_BASE_URL,
    auth: { apiKey: envApiKeyAuth("Ollama Cloud API key", ["OLLAMA_API_KEY"]) },
    models: OLLAMA_CLOUD_MODELS.map((id) =>
      createCustomOpenAIModel(id, {
        providerId: OLLAMA_CLOUD_PROVIDER_ID,
        baseUrl: OLLAMA_CLOUD_BASE_URL,
        api: "openai-completions",
        supportsThinking: true,
        maxOutputTokens: OLLAMA_CLOUD_MAX_OUTPUT_TOKENS,
      }),
    ),
    api: customOpenAICompletionsApi(),
  });
}
