import { describe, expect, test } from "bun:test";
import {
  CUSTOM_OPENAI_PROVIDER_ID,
  LEGACY_CUSTOM_OPENAI_API,
} from "@read-aware/agent";
import { accountFromConfig } from "./account";
import { DEFAULT_THINKING_LEVEL } from "../lib/ai-config";

describe("accountFromConfig", () => {
  test("uses the primary model for both roles by default", () => {
    const result = accountFromConfig({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-5.5",
    });

    expect(result.models).toEqual({ smart: "gpt-5.5", fast: "gpt-5.5" });
    expect(result.thinking).toEqual({
      smart: DEFAULT_THINKING_LEVEL,
      fast: DEFAULT_THINKING_LEVEL,
    });
  });

  test("preserves explicit advanced overrides", () => {
    const result = accountFromConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-opus-5",
      fastModel: "claude-haiku-4-5",
      thinkingLevel: "high",
      fastThinkingLevel: "off",
    });

    expect(result.models).toEqual({
      smart: "claude-opus-5",
      fast: "claude-haiku-4-5",
    });
    expect(result.thinking).toEqual({ smart: "high", fast: "off" });
  });

  test("shares thinking effort when Fast uses the primary model", () => {
    const result = accountFromConfig({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-5.5",
      fastModel: "gpt-5.5",
      thinkingLevel: "high",
      fastThinkingLevel: "off",
    });

    expect(result.models).toEqual({ smart: "gpt-5.5", fast: "gpt-5.5" });
    expect(result.thinking).toEqual({ smart: "high", fast: "high" });
  });

  test("maps Custom settings onto the dedicated dual-API account", () => {
    const result = accountFromConfig({
      provider: "custom",
      apiKey: "test-key",
      model: "gateway-smart",
      fastModel: "gateway-fast",
      customBaseUrl: "https://gateway.example/v1",
      customApi: "openai-completions",
      customSupportsThinking: true,
      customMaxOutputTokens: 4_096,
    });

    expect(result.account).toEqual({
      kind: "api-key",
      provider: CUSTOM_OPENAI_PROVIDER_ID,
      apiKey: "test-key",
      baseUrl: "https://gateway.example/v1",
      api: "openai-completions",
      supportsThinking: true,
      maxOutputTokens: 4_096,
    });
    expect(result.models).toEqual({
      smart: "gateway-smart",
      fast: "gateway-fast",
    });
  });

  test("preserves the legacy Responses path for unmigrated direct callers", () => {
    const result = accountFromConfig({
      provider: "custom",
      apiKey: "test-key",
      model: "gateway-model",
      customBaseUrl: "https://gateway.example/v1",
    });

    expect(result.account).toMatchObject({
      provider: CUSTOM_OPENAI_PROVIDER_ID,
      api: LEGACY_CUSTOM_OPENAI_API,
    });
  });
});
