/**
 * AI Configuration Panel for Settings
 * BYOK (Bring Your Own Key) setup
 */

import { useState, useEffect, type ReactNode } from "react";
import { testLlmConnection } from "@read-aware/agent";
import {
  Accordion,
  Button,
  Caption,
  Divider,
  IconButton,
  Select,
  Stack,
  TextField,
  Toggle,
} from "@read-aware/ui";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { Trans, useTranslation } from "../../../i18n";
import { accountFromConfig } from "../../ai/agent/account";
import {
  getAIConfig,
  getStoredApiKey,
  getStoredProviderSettings,
  saveAIConfig,
  clearAIConfig,
  DEFAULT_MODELS,
  DEFAULT_THINKING_LEVEL,
  PROVIDER_MODELS,
  PROVIDER_LABELS,
  PROVIDER_KEY_URLS,
  SUGGESTED_FAST_MODELS,
  THINKING_LEVELS,
  type AIProvider,
  type ThinkingLevel,
} from "../../ai/lib/ai-config";

type ModelOption = { label: string; value: string };

type AIConfigPanelProps = {
  advancedContent?: ReactNode;
};

function includeSelectedModel(options: ModelOption[], value: string): ModelOption[] {
  if (!value || options.some((option) => option.value === value)) return options;
  return [{ label: value, value }, ...options];
}

export function AIConfigPanel({ advancedContent }: AIConfigPanelProps) {
  const { t } = useTranslation("settings");
  const [provider, setProvider] = useState<AIProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_MODELS.openai);
  const [fastModel, setFastModel] = useState(DEFAULT_MODELS.openai);
  const [useSeparateFastModel, setUseSeparateFastModel] = useState(false);
  const [thinkingLevel, setThinkingLevel] =
    useState<ThinkingLevel>(DEFAULT_THINKING_LEVEL);
  const [fastThinkingLevel, setFastThinkingLevel] =
    useState<ThinkingLevel>(DEFAULT_THINKING_LEVEL);
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
      const resolvedFastModel = config.fastModel || config.model;
      setFastModel(resolvedFastModel);
      setUseSeparateFastModel(resolvedFastModel !== config.model);
      setThinkingLevel(config.thinkingLevel ?? DEFAULT_THINKING_LEVEL);
      setFastThinkingLevel(config.fastThinkingLevel ?? DEFAULT_THINKING_LEVEL);
      setCustomBaseUrl(config.customBaseUrl || "");
      setIsConfigured(true);
    }
  }, []);

  // Switching provider swaps in that provider's OWN remembered settings —
  // its credential slot, its last-saved model tiers (defaults when never
  // saved), its custom endpoint. Nothing of another provider's setup leaks
  // across or gets clobbered. Done in the change handler (not an effect) so
  // loading a saved config on mount doesn't overwrite the stored choices.
  const handleProviderChange = (value: string) => {
    const next = value as AIProvider;
    setProvider(next);
    setApiKey(getStoredApiKey(next));
    const remembered = getStoredProviderSettings(next);
    setModel(remembered.model);
    setFastModel(remembered.fastModel);
    setUseSeparateFastModel(remembered.fastModel !== remembered.model);
    setThinkingLevel(remembered.thinkingLevel);
    setFastThinkingLevel(remembered.fastThinkingLevel);
    setCustomBaseUrl(remembered.customBaseUrl);
    setTestResult(null);
  };

  const handleSave = () => {
    const config = {
      provider,
      apiKey: apiKey.trim(),
      model: model.trim(),
      fastModel: useSeparateFastModel ? fastModel.trim() || undefined : undefined,
      thinkingLevel,
      fastThinkingLevel,
      customBaseUrl: provider === "custom" ? customBaseUrl.trim() : undefined,
    };
    saveAIConfig(config);
    setIsConfigured(true);
    setTestResult({ success: true, message: t("aiConfig.savedMessage") });
  };

  const handleClear = () => {
    clearAIConfig();
    const defaultModel = DEFAULT_MODELS[provider];
    setApiKey("");
    setModel(defaultModel);
    setFastModel(defaultModel);
    setUseSeparateFastModel(false);
    setThinkingLevel(DEFAULT_THINKING_LEVEL);
    setFastThinkingLevel(DEFAULT_THINKING_LEVEL);
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
        fastModel: useSeparateFastModel ? fastModel.trim() || undefined : undefined,
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
  const primaryModelOptions = includeSelectedModel(modelOptions, model);
  const fastModelOptions = includeSelectedModel(modelOptions, fastModel);
  const thinkingOptions = THINKING_LEVELS.map((level) => ({
    value: level,
    label: t(`aiConfig.thinkingLevels.${level}`),
  }));
  const keyUrl = PROVIDER_KEY_URLS[provider];
  const isIncomplete =
    !apiKey.trim() ||
    !model.trim() ||
    (provider === "custom" && !customBaseUrl.trim());

  const handleModelChange = (value: string) => {
    setModel(value);
    if (!useSeparateFastModel) setFastModel(value);
    setTestResult(null);
  };

  const handleSeparateFastModelChange = (enabled: boolean) => {
    setUseSeparateFastModel(enabled);
    setFastModel(
      enabled ? SUGGESTED_FAST_MODELS[provider] || fastModel || model : model,
    );
    setTestResult(null);
  };

  return (
    <Stack gap="xl">
      <Stack gap="lg">
        <Select
          label={t("aiConfig.provider")}
          value={provider}
          onChange={handleProviderChange}
          options={providerOptions}
        />

        <TextField
          label={t("aiConfig.apiKey.label")}
          type={showKey ? "text" : "password"}
          value={apiKey}
          onChange={(event) => {
            setApiKey(event.target.value);
            setTestResult(null);
          }}
          placeholder={t("aiConfig.apiKey.placeholder", {
            provider: PROVIDER_LABELS[provider],
          })}
          helperText={t("aiConfig.apiKey.helper")}
          trailingAction={
            <IconButton
              size="sm"
              label={showKey ? t("aiConfig.hide") : t("aiConfig.show")}
              icon={showKey ? <EyeSlash size={16} /> : <Eye size={16} />}
              onClick={() => setShowKey(!showKey)}
            />
          }
        />

        {keyUrl && (
          <Caption as="p">
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
          </Caption>
        )}

        {/* The simple setup has one model. Fast follows it unless the advanced
            override is enabled below. */}
        {hasModelCatalog ? (
          <Select
            label={t("aiConfig.model")}
            value={model}
            onChange={handleModelChange}
            options={primaryModelOptions}
            helperText={t("aiConfig.modelHelper")}
          />
        ) : (
          <TextField
            label={t("aiConfig.model")}
            value={model}
            onChange={(event) => handleModelChange(event.target.value)}
            placeholder={DEFAULT_MODELS.openai}
            helperText={t("aiConfig.modelHelper")}
          />
        )}
      </Stack>

      <Stack gap="sm">
        <div className="flex gap-3">
          <Button onClick={handleSave} disabled={isIncomplete}>
            {t("aiConfig.save")}
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={isIncomplete || isTesting}
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

      <Accordion
        className="border-y border-border"
        items={[
          {
            label: t("aiConfig.advancedSettings"),
            content: (
              <Stack gap="lg">
                {provider === "custom" && (
                  <TextField
                    label={t("aiConfig.customBaseUrl.label")}
                    type="url"
                    value={customBaseUrl}
                    onChange={(event) => {
                      setCustomBaseUrl(event.target.value);
                      setTestResult(null);
                    }}
                    placeholder="https://api.example.com/v1"
                    helperText={t("aiConfig.customBaseUrl.helper")}
                  />
                )}

                <Toggle
                  label={t("aiConfig.separateFastModel")}
                  checked={useSeparateFastModel}
                  onChange={handleSeparateFastModelChange}
                />

                {useSeparateFastModel &&
                  (hasModelCatalog ? (
                    <Select
                      label={t("aiConfig.fastModel")}
                      value={fastModel}
                      onChange={(value) => {
                        setFastModel(value);
                        setTestResult(null);
                      }}
                      options={fastModelOptions}
                      helperText={t("aiConfig.fastModelHelper")}
                    />
                  ) : (
                    <TextField
                      label={t("aiConfig.fastModel")}
                      value={fastModel}
                      onChange={(event) => {
                        setFastModel(event.target.value);
                        setTestResult(null);
                      }}
                      placeholder={SUGGESTED_FAST_MODELS.openai}
                      helperText={t("aiConfig.fastModelHelper")}
                    />
                  ))}

                {/* pi maps these levels onto each provider's thinking
                    parameters. Unsupported models ignore them. */}
                <Select
                  label={t("aiConfig.smartThinking")}
                  value={thinkingLevel}
                  onChange={(value) => {
                    setThinkingLevel(value as ThinkingLevel);
                    setTestResult(null);
                  }}
                  options={thinkingOptions}
                  helperText={t("aiConfig.smartThinkingHelper")}
                />
                <Select
                  label={t("aiConfig.fastThinking")}
                  value={fastThinkingLevel}
                  onChange={(value) => {
                    setFastThinkingLevel(value as ThinkingLevel);
                    setTestResult(null);
                  }}
                  options={thinkingOptions}
                  helperText={t("aiConfig.fastThinkingHelper")}
                />

                <Caption as="p" className="leading-relaxed">
                  {t("aiConfig.byok.body")}
                </Caption>

                {advancedContent && (
                  <>
                    <Divider />
                    {advancedContent}
                  </>
                )}
              </Stack>
            ),
          },
        ]}
      />
    </Stack>
  );
}
