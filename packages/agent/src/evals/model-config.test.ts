import { expect, test } from "bun:test";
import { applyEvalRouting, EVAL_DEFAULT_PROVIDER, evalProviderRegistry, resolveEvalModel } from "./model-config";

test("fixed OpenRouter eval snapshot fits preferred endpoint completion capacity", () => {
  const model = {
    provider: "openrouter",
    id: "deepseek/deepseek-v4-flash-0731",
    maxTokens: 943_718,
    contextWindow: 1_048_576,
    compat: { supportsReasoningEffort: true },
  };
  const routed = applyEvalRouting(model);
  expect(routed.maxTokens).toBe(131_072);
  // Actual failed input from the diagnostic run now fits both preferred endpoints.
  expect(118_077 + routed.maxTokens).toBeLessThan(262_144);
  expect(routed.compat).toMatchObject({
    supportsReasoningEffort: true,
    openRouterRouting: { order: ["baidu", "coreweave"], allow_fallbacks: true },
  });
  expect(model.maxTokens).toBe(943_718);
  expect(applyEvalRouting({ ...model, maxTokens: 8_192 }).maxTokens).toBe(8_192);
  expect(applyEvalRouting({ ...model, id: "another-model" }).maxTokens).toBe(943_718);
  const other = { ...model, provider: "deepseek" };
  expect(applyEvalRouting(other)).toBe(other);
});

test("an eval with no provider named runs DeepSeek's own flash model", () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";
  try {
    const resolved = resolveEvalModel(evalProviderRegistry(), EVAL_DEFAULT_PROVIDER);
    expect(EVAL_DEFAULT_PROVIDER).toBe("deepseek");
    expect(resolved.modelId).toBe("deepseek-flash");
    expect(resolved.account).toEqual({ kind: "api-key", provider: "deepseek", apiKey: "test-key" });
    // A named model is passed through untouched.
    expect(resolveEvalModel(evalProviderRegistry(), "deepseek", "deepseek-v4-pro").modelId).toBe("deepseek-v4-pro");
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
});
