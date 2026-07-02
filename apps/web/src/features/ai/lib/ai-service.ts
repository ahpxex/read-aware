/**
 * AI Service for ReadAware MVP
 * Handles chat completion requests with user's own API key
 */

import type { TFunction } from "i18next";
import { getAIConfig, type AIConfig, type AIProvider } from "./ai-config";
import { parseSSEStream } from "./parse-sse";

const NOT_CONFIGURED_FALLBACK =
  "AI not configured. Please set up your API key in settings.";

/** Resolve the user-facing "not configured" message, localized when a `t` is passed. */
function notConfiguredMessage(t?: TFunction<"ai">): string {
  return t ? t("service.notConfigured") : NOT_CONFIGURED_FALLBACK;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  onStreamChunk?: (chunk: string) => void;
  /** Passed from the calling component to localize user-facing error messages. */
  t?: TFunction<"ai">;
}

export interface ChatCompletionResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class AIError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "AIError";
  }
}

function getBaseUrl(config: AIConfig): string {
  switch (config.provider) {
    case "openai":
      return "https://api.openai.com/v1";
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "zai":
      return "https://api.z.ai/api/coding/paas/v4";
    case "zai-coding-cn":
      return "https://open.bigmodel.cn/api/coding/paas/v4";
    case "custom":
      return config.customBaseUrl?.replace(/\/$/, "") || "";
    default:
      throw new AIError("Unknown provider", "UNKNOWN_PROVIDER");
  }
}

function getHeaders(config: AIConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${config.apiKey}`,
  };

  if (config.provider === "anthropic") {
    headers["x-api-key"] = config.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    delete headers["Authorization"];
  }

  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] = typeof window !== "undefined" ? window.location.origin : "";
    headers["X-Title"] = "ReadAware";
  }

  return headers;
}

function transformMessagesForProvider(
  messages: ChatMessage[],
  provider: AIProvider
): ChatMessage[] {
  // Anthropic doesn't support system messages in the same way
  if (provider === "anthropic") {
    return messages.map((m) => ({
      ...m,
      role: m.role === "system" ? "user" : m.role,
    }));
  }
  return messages;
}

async function parseOpenAIResponse(response: Response): Promise<ChatCompletionResponse> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: "Unknown error" } }));
    throw new AIError(
      error.error?.message || `HTTP ${response.status}`,
      error.error?.code || "API_ERROR",
      response.status
    );
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || "",
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
  };
}

async function parseAnthropicResponse(response: Response): Promise<ChatCompletionResponse> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: "Unknown error" } }));
    throw new AIError(
      error.error?.message || `HTTP ${response.status}`,
      error.error?.type || "API_ERROR",
      response.status
    );
  }

  const data = await response.json();
  return {
    content: data.content?.[0]?.text || "",
    usage: data.usage
      ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.input_tokens + data.usage.output_tokens,
        }
      : undefined,
  };
}

export async function sendChatCompletion(
  options: ChatCompletionOptions
): Promise<ChatCompletionResponse> {
  const config = getAIConfig();
  if (!config) {
    throw new AIError(notConfiguredMessage(options.t), "NOT_CONFIGURED");
  }

  const baseUrl = getBaseUrl(config);
  const headers = getHeaders(config);
  const messages = transformMessagesForProvider(options.messages, config.provider);

  // Build request body
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2000,
    stream: options.stream ?? false,
  };

  // Anthropic uses different endpoint and format
  const endpoint =
    config.provider === "anthropic"
      ? `${baseUrl}/messages`
      : `${baseUrl}/chat/completions`;

  if (config.provider === "anthropic") {
    // Transform to Anthropic format
    const anthropicBody: Record<string, unknown> = {
      model: config.model,
      messages: messages.filter((m) => m.role !== "system"),
      max_tokens: options.maxTokens ?? 2000,
      temperature: options.temperature ?? 0.7,
    };
    const systemMessage = messages.find((m) => m.role === "system");
    if (systemMessage) {
      anthropicBody.system = systemMessage.content;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(anthropicBody),
    });

    return parseAnthropicResponse(response);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  return parseOpenAIResponse(response);
}

export interface StreamingChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  onChunk: (text: string) => void;
  signal?: AbortSignal;
  /** Passed from the calling component to localize user-facing error messages. */
  t?: TFunction<"ai">;
}

export async function sendChatCompletionStreaming(
  options: StreamingChatOptions,
): Promise<ChatCompletionResponse> {
  const config = getAIConfig();
  if (!config) {
    throw new AIError(notConfiguredMessage(options.t), "NOT_CONFIGURED");
  }

  const baseUrl = getBaseUrl(config);
  const headers = getHeaders(config);
  const messages = transformMessagesForProvider(options.messages, config.provider);
  let fullContent = "";

  if (config.provider === "anthropic") {
    const anthropicBody: Record<string, unknown> = {
      model: config.model,
      messages: messages.filter((m) => m.role !== "system"),
      max_tokens: options.maxTokens ?? 2000,
      temperature: options.temperature ?? 0.7,
      stream: true,
    };
    const systemMessage = messages.find((m) => m.role === "system");
    if (systemMessage) {
      anthropicBody.system = systemMessage.content;
    }

    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(anthropicBody),
      signal: options.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: "Unknown error" } }));
      throw new AIError(
        error.error?.message || `HTTP ${response.status}`,
        error.error?.type || "API_ERROR",
        response.status,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) throw new AIError("No response body", "NO_BODY");

    for await (const data of parseSSEStream(reader)) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === "content_block_delta" && parsed.delta?.text) {
          fullContent += parsed.delta.text;
          options.onChunk(parsed.delta.text);
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  } else {
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2000,
      stream: true,
    };

    const endpoint = `${baseUrl}/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: "Unknown error" } }));
      throw new AIError(
        error.error?.message || `HTTP ${response.status}`,
        error.error?.code || "API_ERROR",
        response.status,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) throw new AIError("No response body", "NO_BODY");

    for await (const data of parseSSEStream(reader)) {
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          options.onChunk(delta);
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  return { content: fullContent };
}

// Check if AI is configured and the key seems valid (basic check)
export function isAIConfigured(): boolean {
  const config = getAIConfig();
  return !!config && !!config.apiKey && config.apiKey.length > 10;
}
