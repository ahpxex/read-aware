/**
 * AI Configuration Panel for Settings
 * BYOK (Bring Your Own Key) setup
 */

import { useState, useEffect } from "react";
import { testLlmConnection } from "@read-aware/agent";
import { Button, Select, TextField, Stack } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { Trans, useTranslation } from "../../../i18n";
import { accountFromConfig } from "../../ai/agent/account";
import {
  getAIConfig,
  saveAIConfig,
  clearAIConfig,
  DEFAULT_MODELS,
  FAST_DEFAULT_MODELS,
  PROVIDER_MODELS,
  PROVIDER_LABELS,
  PROVIDER_KEY_URLS,
  type AIProvider,
} from "../../ai/lib/ai-config";

export function AIConfigPanel() {
  const { t } = useTranslation("settings");
  const [provider, setProvider] = useState<AIProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_MODELS.openai);
  const [fastModel, setFastModel] = useState(FAST_DEFAULT_MODELS.openai);
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
      setFastModel(config.fastModel ?? FAST_DEFAULT_MODELS[config.provider] ?? "");
      setCustomBaseUrl(config.customBaseUrl || "");
      setIsConfigured(true);
    }
  }, []);

  // Switching provider resets both tiers to that provider's defaults. Done in
  // the change handler (not an effect) so loading a saved config on mount
  // doesn't clobber the stored model choices.
  const handleProviderChange = (value: string) => {
    const next = value as AIProvider;
    setProvider(next);
    setModel(DEFAULT_MODELS[next]);
    setFastModel(FAST_DEFAULT_MODELS[next]);
    setTestResult(null);
  };

  const handleSave = () => {
    const config = {
      provider,
      apiKey: apiKey.trim(),
      model: model.trim(),
      fastModel: fastModel.trim() || undefined,
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
    setFastModel(FAST_DEFAULT_MODELS.openai);
    setCustomBaseUrl("");
    setIsConfigured(false);
    setTestResult(null);
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      // Same provider stack as real chat (pi-ai), against the form values —
      // testing neither saves the config nor depends on a saved one. Exercises
      // the smart tier (the model the chat turn uses).
      const { account, models } = accountFromConfig({
        provider,
        apiKey: apiKey.trim(),
        model: model.trim(),
        fastModel: fastModel.trim() || undefined,
        customBaseUrl: provider === "custom" ? customBaseUrl.trim() : undefined,
      });
      const response = await testLlmConnection(account, models.smart);

      if (response) {
        setTestResult({
          success: true,
          message: t("aiConfig.testSuccessMessage", { response }),
        });
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
  const hasModelCatalog = modelOptions.length > 0;
  const keyUrl = PROVIDER_KEY_URLS[provider];

  return (
    <Stack gap="xl">
      <Stack gap="lg">
        <Select
          label={t("aiConfig.provider")}
          value={provider}
          onChange={handleProviderChange}
          options={providerOptions}
        />

        {provider === "custom" && (
          <TextField
            label={t("aiConfig.customBaseUrl.label")}
            type="url"
            value={customBaseUrl}
            onChange={(e) => {
              setCustomBaseUrl(e.target.value);
              setTestResult(null);
            }}
            placeholder="https://api.example.com/v1"
            helperText={t("aiConfig.customBaseUrl.helper")}
          />
        )}

        <TextField
          label={t("aiConfig.apiKey.label")}
          type={showKey ? "text" : "password"}
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setTestResult(null);
          }}
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

        {/* Two model tiers. `smart` runs chat turns; `fast` runs the cheaper
            background/dictionary work. Providers with a catalog get dropdowns;
            a custom OpenAI-compatible endpoint gets free-text fields. */}
        {hasModelCatalog ? (
          <>
            <Select
              label={t("aiConfig.smartModel")}
              value={model}
              onChange={(value) => {
                setModel(value);
                setTestResult(null);
              }}
              options={modelOptions}
              helperText={t("aiConfig.smartModelHelper")}
            />
            <Select
              label={t("aiConfig.fastModel")}
              value={fastModel}
              onChange={(value) => {
                setFastModel(value);
                setTestResult(null);
              }}
              options={modelOptions}
              helperText={t("aiConfig.fastModelHelper")}
            />
          </>
        ) : (
          <>
            <TextField
              label={t("aiConfig.smartModel")}
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setTestResult(null);
              }}
              placeholder={t("aiConfig.modelPlaceholder")}
              helperText={t("aiConfig.smartModelHelper")}
            />
            <TextField
              label={t("aiConfig.fastModel")}
              value={fastModel}
              onChange={(e) => {
                setFastModel(e.target.value);
                setTestResult(null);
              }}
              placeholder={t("aiConfig.fastModelCustomPlaceholder")}
              helperText={t("aiConfig.fastModelHelper")}
            />
          </>
        )}

        {keyUrl && (
          <p className="text-xs text-fg-muted">
            <Trans
              t={t}
              i18nKey="aiConfig.getKey.generic"
              values={{ provider: PROVIDER_LABELS[provider] }}
              components={{
                link: (
                  <a
                    href={keyUrl}
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

      <Stack gap="sm">
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
        {testResult && (
          <p
            role="status"
            className={cn(
              "text-xs leading-relaxed",
              testResult.success ? "text-fg-muted" : "text-red-700 dark:text-red-400",
            )}
          >
            {testResult.message}
          </p>
        )}
      </Stack>

      <div className="rounded-md border border-border bg-fill p-4 text-sm text-fg-muted">
        <p className="font-medium text-fg">{t("aiConfig.byok.title")}</p>
        <p className="mt-1">{t("aiConfig.byok.body")}</p>
      </div>
    </Stack>
  );
}
