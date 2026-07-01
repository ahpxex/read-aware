/**
 * AI Configuration Panel for Settings
 * BYOK (Bring Your Own Key) setup
 */

import { useState, useEffect } from "react";
import { Button, Select, TextField, Stack, Alert } from "@read-aware/ui";
import { Trans, useTranslation } from "../../../i18n";
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
  const { t } = useTranslation("settings");
  // The `ai` namespace localizes error messages thrown by the AI service.
  const { t: tAi } = useTranslation("ai");
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
    setTestResult({ success: true, message: t("aiConfig.savedMessage") });
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
        t: tAi,
      });

      if (response.content) {
        setTestResult({
          success: true,
          message: t("aiConfig.testSuccessMessage", { response: response.content.trim() }),
        });
        setIsConfigured(true);
      } else {
        setTestResult({
          success: false,
          message: t("aiConfig.testEmptyMessage"),
        });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : t("aiConfig.testUnknownError"),
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
        <Alert variant="success" title={t("aiConfig.configured.title")}>
          {t("aiConfig.configured.body")}
        </Alert>
      )}

      {testResult && (
        <Alert
          variant={testResult.success ? "success" : "destructive"}
          title={testResult.success ? t("aiConfig.result.success") : t("aiConfig.result.error")}
        >
          {testResult.message}
        </Alert>
      )}

      <Stack gap="lg">
        <Select
          label={t("aiConfig.provider")}
          value={provider}
          onChange={(value) => setProvider(value as AIProvider)}
          options={providerOptions}
        />

        {provider === "custom" && (
          <TextField
            label={t("aiConfig.customBaseUrl.label")}
            type="url"
            value={customBaseUrl}
            onChange={(e) => setCustomBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            helperText={t("aiConfig.customBaseUrl.helper")}
          />
        )}

        <TextField
          label={t("aiConfig.apiKey.label")}
          type={showKey ? "text" : "password"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={t("aiConfig.apiKey.placeholder", { provider: PROVIDER_LABELS[provider] })}
          helperText={t("aiConfig.apiKey.helper")}
          trailingIcon={
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="text-xs text-fg-subtle hover:text-fg-muted"
            >
              {showKey ? t("aiConfig.hide") : t("aiConfig.show")}
            </button>
          }
        />

        <Select
          label={t("aiConfig.model")}
          value={model}
          onChange={setModel}
          options={modelOptions.length > 0 ? modelOptions : [{ label: t("aiConfig.modelDefault"), value: "" }]}
          disabled={modelOptions.length === 0}
        />

        {provider === "openai" && (
          <p className="text-xs text-fg-muted">
            <Trans
              t={t}
              i18nKey="aiConfig.getKey.openai"
              components={{
                link: (
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-fg"
                  />
                ),
              }}
            />
          </p>
        )}

        {provider === "anthropic" && (
          <p className="text-xs text-fg-muted">
            <Trans
              t={t}
              i18nKey="aiConfig.getKey.anthropic"
              components={{
                link: (
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-fg"
                  />
                ),
              }}
            />
          </p>
        )}

        {provider === "openrouter" && (
          <p className="text-xs text-fg-muted">
            <Trans
              t={t}
              i18nKey="aiConfig.getKey.openrouter"
              components={{
                link: (
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-fg"
                  />
                ),
              }}
            />
          </p>
        )}
      </Stack>

      <div className="flex gap-3">
        <Button
          onClick={handleSave}
          disabled={!apiKey.trim() || (provider === "custom" && !customBaseUrl.trim())}
        >
          {t("aiConfig.save")}
        </Button>
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={!apiKey.trim() || isTesting || (provider === "custom" && !customBaseUrl.trim())}
        >
          {isTesting ? t("aiConfig.testing") : t("aiConfig.test")}
        </Button>
        {isConfigured && (
          <Button variant="ghost" onClick={handleClear}>
            {t("aiConfig.clear")}
          </Button>
        )}
      </div>

      <div className="rounded-md border border-border bg-fill p-4 text-sm text-fg-muted">
        <p className="font-medium text-fg">{t("aiConfig.byok.title")}</p>
        <p className="mt-1">{t("aiConfig.byok.body")}</p>
      </div>
    </Stack>
  );
}
