/**
 * AI Configuration Panel for Settings
 * BYOK (Bring Your Own Key) setup
 */

import { useState, useEffect } from "react";
import { Button, Select, TextField, Stack, Alert } from "@read-aware/ui";
import {
  getAIConfig,
  saveAIConfig,
  clearAIConfig,
  DEFAULT_MODELS,
  PROVIDER_MODELS,
  PROVIDER_LABELS,
  type AIProvider,
} from "../../ai/lib/ai-config";
import { sendChatCompletion } from "../../ai/lib/ai-service";

export function AIConfigPanel() {
  const [provider, setProvider] = useState<AIProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_MODELS.openai);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [isConfigured, setIsConfigured] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showKey, setShowKey] = useState(false);

  // Load existing config on mount
  useEffect(() => {
    const config = getAIConfig();
    if (config) {
      setProvider(config.provider);
      setApiKey(config.apiKey);
      setModel(config.model);
      setCustomBaseUrl(config.customBaseUrl || "");
      setIsConfigured(true);
    }
  }, []);

  // Update model when provider changes
  useEffect(() => {
    setModel(DEFAULT_MODELS[provider]);
  }, [provider]);

  const handleSave = () => {
    const config = {
      provider,
      apiKey: apiKey.trim(),
      model,
      customBaseUrl: provider === "custom" ? customBaseUrl.trim() : undefined,
    };
    saveAIConfig(config);
    setIsConfigured(true);
    setTestResult({ success: true, message: "Configuration saved successfully." });
  };

  const handleClear = () => {
    clearAIConfig();
    setApiKey("");
    setModel(DEFAULT_MODELS.openai);
    setCustomBaseUrl("");
    setIsConfigured(false);
    setTestResult(null);
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);

    // Temporarily save config for testing
    const config = {
      provider,
      apiKey: apiKey.trim(),
      model,
      customBaseUrl: provider === "custom" ? customBaseUrl.trim() : undefined,
    };
    saveAIConfig(config);

    try {
      const response = await sendChatCompletion({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Say 'ReadAware AI is working!' in 10 words or less." },
        ],
        maxTokens: 50,
      });

      if (response.content) {
        setTestResult({
          success: true,
          message: `Test successful! Response: "${response.content.trim()}"`,
        });
        setIsConfigured(true);
      } else {
        setTestResult({
          success: false,
          message: "Test failed: Empty response from AI provider.",
        });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error during test.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const providerOptions = Object.entries(PROVIDER_LABELS).map(([value, label]) => ({
    value: value as AIProvider,
    label,
  }));

  const modelOptions = PROVIDER_MODELS[provider] || [];

  return (
    <Stack gap="xl">
      {isConfigured && (
        <Alert variant="success" title="AI is configured">
          Your API key is saved locally. You can use AI features in the reader.
        </Alert>
      )}

      {testResult && (
        <Alert variant={testResult.success ? "success" : "destructive"} title={testResult.success ? "Success" : "Error"}>
          {testResult.message}
        </Alert>
      )}

      <Stack gap="lg">
        <Select
          label="AI Provider"
          value={provider}
          onChange={(value) => setProvider(value as AIProvider)}
          options={providerOptions}
        />

        {provider === "custom" && (
          <TextField
            label="Custom Base URL"
            type="url"
            value={customBaseUrl}
            onChange={(e) => setCustomBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            helperText="Enter the base URL for your OpenAI-compatible API endpoint."
          />
        )}

        <TextField
          label="API Key"
          type={showKey ? "text" : "password"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={`Enter your ${PROVIDER_LABELS[provider]} API key`}
          helperText="Your API key is stored locally in your browser and never sent to our servers."
          trailingIcon={
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="text-xs text-stone-500 hover:text-stone-700"
            >
              {showKey ? "Hide" : "Show"}
            </button>
          }
        />

        <Select
          label="Model"
          value={model}
          onChange={setModel}
          options={modelOptions.length > 0 ? modelOptions : [{ label: "Default", value: "" }]}
          disabled={modelOptions.length === 0}
        />

        {provider === "openai" && (
          <p className="text-xs text-stone-500">
            Get your API key from{" "}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-stone-700"
            >
              OpenAI Dashboard
            </a>
          </p>
        )}

        {provider === "anthropic" && (
          <p className="text-xs text-stone-500">
            Get your API key from{" "}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-stone-700"
            >
              Anthropic Console
            </a>
          </p>
        )}

        {provider === "openrouter" && (
          <p className="text-xs text-stone-500">
            Get your API key from{" "}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-stone-700"
            >
              OpenRouter
            </a>
          </p>
        )}
      </Stack>

      <div className="flex gap-3">
        <Button
          onClick={handleSave}
          disabled={!apiKey.trim() || (provider === "custom" && !customBaseUrl.trim())}
        >
          Save Configuration
        </Button>
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={!apiKey.trim() || isTesting || (provider === "custom" && !customBaseUrl.trim())}
        >
          {isTesting ? "Testing..." : "Test Connection"}
        </Button>
        {isConfigured && (
          <Button variant="ghost" onClick={handleClear}>
            Clear
          </Button>
        )}
      </div>

      <div className="rounded-md border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">
        <p className="font-medium text-stone-700">About BYOK (Bring Your Own Key)</p>
        <p className="mt-1">
          ReadAware uses your own API key to access AI services. Your key is stored locally in your
          browser and is never sent to our servers. You are responsible for any API usage charges
          incurred.
        </p>
      </div>
    </Stack>
  );
}
