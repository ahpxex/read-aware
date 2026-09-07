/** Protocol routes are trusted application code; model inventories are remote data. */
export const PROVIDER_DEFINITIONS = {
  anthropic: { baseUrl: "https://api.anthropic.com", api: "anthropic-messages", env: "ANTHROPIC_API_KEY" },
  openai: { baseUrl: "https://api.openai.com/v1", api: "openai-responses", env: "OPENAI_API_KEY" },
  "openai-codex": { baseUrl: "https://chatgpt.com/backend-api", api: "openai-codex-responses", env: "OPENAI_CODEX_ACCESS_TOKEN" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", api: "openai-completions", env: "OPENROUTER_API_KEY" },
  zai: { baseUrl: "https://api.z.ai/api/coding/paas/v4", api: "openai-completions", env: "ZAI_API_KEY" },
  "zai-coding-cn": { baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", api: "openai-completions", env: "ZAI_CODING_CN_API_KEY" },
  google: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", api: "google-generative-ai", env: "GEMINI_API_KEY" },
  deepseek: { baseUrl: "https://api.deepseek.com", api: "openai-completions", env: "DEEPSEEK_API_KEY" },
  xai: { baseUrl: "https://api.x.ai/v1", api: "openai-responses", env: "XAI_API_KEY" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", api: "openai-completions", env: "GROQ_API_KEY" },
  mistral: { baseUrl: "https://api.mistral.ai", api: "mistral-conversations", env: "MISTRAL_API_KEY" },
  moonshotai: { baseUrl: "https://api.moonshot.ai/v1", api: "openai-completions", env: "MOONSHOT_API_KEY" },
  "ollama-cloud": { baseUrl: "https://ollama.com/v1", api: "openai-completions", env: "OLLAMA_API_KEY" },
} as const;

export type KnownProviderId = keyof typeof PROVIDER_DEFINITIONS;
export const KNOWN_PROVIDERS = Object.keys(PROVIDER_DEFINITIONS) as KnownProviderId[];

export function supportsProviderApi(provider: KnownProviderId, api: string): boolean {
  return api === PROVIDER_DEFINITIONS[provider].api ||
    (provider === "openrouter" && api === "anthropic-messages");
}

export function providerBaseUrl(provider: KnownProviderId, api: string): string {
  return provider === "openrouter" && api === "anthropic-messages"
    ? "https://openrouter.ai/api"
    : PROVIDER_DEFINITIONS[provider].baseUrl;
}
