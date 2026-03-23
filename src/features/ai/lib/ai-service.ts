/**
 * AI Service for ReadAware MVP
 * Handles chat completion requests with user's own API key
 */

import { getAIConfig, type AIConfig, type AIProvider } from "./ai-config";

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
    throw new AIError("AI not configured. Please set up your API key in settings.", "NOT_CONFIGURED");
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

// Simple non-streaming chat for quick questions
export async function askAI(question: string, context?: string): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a thoughtful reading assistant. Help the user understand and reflect on what they're reading. " +
        "Be concise but insightful. Don't summarize; instead, ask questions that deepen understanding.",
    },
  ];

  if (context) {
    messages.push({
      role: "user",
      content: `I'm reading this text:\n\n"${context}"\n\n${question}`,
    });
  } else {
    messages.push({
      role: "user",
      content: question,
    });
  }

  const response = await sendChatCompletion({ messages, temperature: 0.7 });
  return response.content;
}

// Check if AI is configured and the key seems valid (basic check)
export function isAIConfigured(): boolean {
  const config = getAIConfig();
  return !!config && !!config.apiKey && config.apiKey.length > 10;
}
