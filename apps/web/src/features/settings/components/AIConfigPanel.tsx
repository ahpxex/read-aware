/**
 * AI Configuration Panel for Settings
 * BYOK (Bring Your Own Key) setup
 */

import { useState, type ReactNode } from "react";
import {
  DEFAULT_CUSTOM_OPENAI_API,
  testLlmConnection,
  type CustomOpenAIApi,
} from "@read-aware/agent";
import { appHttpFetch } from "../../../platform/http-client";
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
import { useReactiveSetting } from "../../../hooks/useReactiveSetting";
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
  type AIConfig,
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

function parsePositiveInteger(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function AIConfigPanel({ advancedContent }: AIConfigPanelProps) {
  const { t } = useTranslation("settings");
  const [initialConfig] = useState(() => getAIConfig());
  const initialProvider = initialConfig?.provider ?? "openai";
  const initialModel = initialConfig?.model ?? DEFAULT_MODELS[initialProvider];
  const initialFastModel = initialConfig?.fastModel || initialModel;
  const initialUsesSeparateFastModel = initialFastModel !== initialModel;

  const [provider, setProvider] = useState<AIProvider>(initialProvider);
  const [apiKey, setApiKey] = useState(initialConfig?.apiKey ?? "");
  const [model, setModel] = useState(initialModel);
  const [fastModel, setFastModel] = useState(initialFastModel);
  const [useSeparateFastModel, setUseSeparateFastModel] = useState(
    initialUsesSeparateFastModel,
  );
  const [thinkingLevel, setThinkingLevel] =
    useState<ThinkingLevel>(
      initialConfig?.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
    );
  const [fastThinkingLevel, setFastThinkingLevel] =
    useState<ThinkingLevel>(
      initialUsesSeparateFastModel
        ? initialConfig?.fastThinkingLevel ?? DEFAULT_THINKING_LEVEL
        : initialConfig?.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
    );
  const [customBaseUrl, setCustomBaseUrl] = useState(
    initialConfig?.customBaseUrl ?? "",
  );
  const [customApi, setCustomApi] = useState<CustomOpenAIApi>(
    initialConfig?.customApi ?? DEFAULT_CUSTOM_OPENAI_API,
  );
  const [customSupportsThinking, setCustomSupportsThinking] = useState(
    Boolean(initialConfig?.customSupportsThinking),
  );
  const [customMaxOutputTokens, setCustomMaxOutputTokens] = useState(
    initialConfig?.customMaxOutputTokens
      ? String(initialConfig.customMaxOutputTokens)
      : "",
  );
  const [isConfigured, setIsConfigured] = useState(Boolean(initialConfig));
  const [saveRevision, setSaveRevision] = useState(0);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showKey, setShowKey] = useState(false);

  const parsedCustomMaxOutputTokens = parsePositiveInteger(customMaxOutputTokens);
  const hasInvalidCustomMaxOutputTokens =
    provider === "custom" &&
    Boolean(customMaxOutputTokens.trim()) &&
    parsedCustomMaxOutputTokens === undefined;
  const hasInvalidSeparateFastModel =
    useSeparateFastModel &&
    (!fastModel.trim() || fastModel.trim() === model.trim());
  const reactiveConfig: AIConfig = {
    provider,
    apiKey: apiKey.trim(),
    model: model.trim(),
    fastModel: useSeparateFastModel ? fastModel.trim() || undefined : undefined,
    thinkingLevel,
    fastThinkingLevel: useSeparateFastModel
      ? fastThinkingLevel
      : thinkingLevel,
    customBaseUrl: provider === "custom" ? customBaseUrl.trim() : undefined,
    customApi: provider === "custom" ? customApi : undefined,
    customSupportsThinking:
      provider === "custom" ? customSupportsThinking : undefined,
    customMaxOutputTokens:
      provider === "custom" ? parsedCustomMaxOutputTokens : undefined,
  };
  const { flush: flushConfig, discardPending } = useReactiveSetting({
    value: reactiveConfig,
    revision: saveRevision,
    persist: saveAIConfig,
    enabled:
      !hasInvalidCustomMaxOutputTokens && !hasInvalidSeparateFastModel,
  });

  const markConfigChanged = () => {
    setSaveRevision((current) => current + 1);
    setIsConfigured(true);
    setTestResult(null);
  };

  // Switching provider swaps in that provider's OWN remembered settings —
  // its credential slot, its last-saved model tiers (defaults when never
  // saved), its custom endpoint. Nothing of another provider's setup leaks
  // across or gets clobbered. Done in the change handler (not an effect) so
  // loading a saved config on mount doesn't overwrite the stored choices.
  const handleProviderChange = (value: string) => {
    flushConfig();
    const next = value as AIProvider;
    setProvider(next);
    setApiKey(getStoredApiKey(next));
    const remembered = getStoredProviderSettings(next);
    const usesSeparateFastModel = remembered.fastModel !== remembered.model;
    setModel(remembered.model);
    setFastModel(remembered.fastModel);
    setUseSeparateFastModel(usesSeparateFastModel);
    setThinkingLevel(remembered.thinkingLevel);
    setFastThinkingLevel(
      usesSeparateFastModel
        ? remembered.fastThinkingLevel
        : remembered.thinkingLevel,
    );
    setCustomBaseUrl(remembered.customBaseUrl);
    setCustomApi(remembered.customApi);
    setCustomSupportsThinking(remembered.customSupportsThinking);
    setCustomMaxOutputTokens(
      remembered.customMaxOutputTokens
        ? String(remembered.customMaxOutputTokens)
        : "",
    );
    markConfigChanged();
  };

  const handleClear = () => {
    discardPending();
    clearAIConfig();
    const defaultModel = DEFAULT_MODELS[provider];
    setApiKey("");
    setModel(defaultModel);
    setFastModel(defaultModel);
    setUseSeparateFastModel(false);
    setThinkingLevel(DEFAULT_THINKING_LEVEL);
    setFastThinkingLevel(DEFAULT_THINKING_LEVEL);
    setCustomBaseUrl("");
    setCustomApi(DEFAULT_CUSTOM_OPENAI_API);
    setCustomSupportsThinking(false);
    setCustomMaxOutputTokens("");
    setIsConfigured(false);
    setTestResult(null);
  };

  const handleTest = async () => {
    flushConfig();
    setIsTesting(true);
    setTestResult(null);

    try {
      // Same provider stack as real chat (pi-ai), against the current form
      // values. Exercises the smart tier (the model the chat turn uses).
      const { account, models } = accountFromConfig({
        provider,
        apiKey: apiKey.trim(),
        model: model.trim(),
        fastModel: useSeparateFastModel ? fastModel.trim() || undefined : undefined,
        customBaseUrl: provider === "custom" ? customBaseUrl.trim() : undefined,
        customApi: provider === "custom" ? customApi : undefined,
        customSupportsThinking:
          provider === "custom" ? customSupportsThinking : undefined,
        customMaxOutputTokens:
          provider === "custom"
            ? parsePositiveInteger(customMaxOutputTokens)
            : undefined,
      });
      const response = await testLlmConnection(account, models.smart, {
        fetch: appHttpFetch,
      });

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
  const customApiOptions = [
    {
      value: "openai-completions",
      label: t("aiConfig.customApi.chatCompletions"),
    },
    {
      value: "openai-responses",
      label: t("aiConfig.customApi.responses"),
    },
  ];
  const keyUrl = PROVIDER_KEY_URLS[provider];
  const isIncomplete =
    !apiKey.trim() ||
    !model.trim() ||
    (provider === "custom" && !customBaseUrl.trim()) ||
    hasInvalidCustomMaxOutputTokens ||
    hasInvalidSeparateFastModel;

  const handleModelChange = (value: string) => {
    setModel(value);
    if (!useSeparateFastModel) setFastModel(value);
    markConfigChanged();
  };

  const handleSeparateFastModelChange = (enabled: boolean) => {
    setUseSeparateFastModel(enabled);
    const distinctFastModel = [
      SUGGESTED_FAST_MODELS[provider],
      fastModel,
      ...modelOptions.map((option) => option.value),
    ].find((candidate) => candidate && candidate !== model);
    setFastModel(enabled ? distinctFastModel || "" : model);
    if (!enabled) setFastThinkingLevel(thinkingLevel);
    markConfigChanged();
  };

  const handleSharedThinkingChange = (value: string) => {
    const level = value as ThinkingLevel;
    setThinkingLevel(level);
    setFastThinkingLevel(level);
    markConfigChanged();
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

        {provider === "custom" && (
          <>
            <TextField
              label={t("aiConfig.customBaseUrl.label")}
              type="url"
              value={customBaseUrl}
              onChange={(event) => {
                setCustomBaseUrl(event.target.value);
                markConfigChanged();
              }}
              onBlur={flushConfig}
              placeholder="https://api.example.com/v1"
              helperText={t("aiConfig.customBaseUrl.helper")}
            />
            <Select
              label={t("aiConfig.customApi.label")}
              value={customApi}
              onChange={(value) => {
                setCustomApi(value as CustomOpenAIApi);
                markConfigChanged();
              }}
              options={customApiOptions}
              helperText={t("aiConfig.customApi.helper")}
            />
          </>
        )}

        <TextField
          label={t("aiConfig.apiKey.label")}
          type={showKey ? "text" : "password"}
          value={apiKey}
          onChange={(event) => {
            setApiKey(event.target.value);
            markConfigChanged();
          }}
          onBlur={flushConfig}
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
            onBlur={flushConfig}
            placeholder={DEFAULT_MODELS.openai}
            helperText={t("aiConfig.modelHelper")}
          />
        )}
      </Stack>

      <Stack gap="sm">
        <div className="flex gap-3">
          <Button
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
                  <>
                    <Toggle
                      label={t("aiConfig.customSupportsThinking")}
                      checked={customSupportsThinking}
                      onChange={(checked) => {
                        setCustomSupportsThinking(checked);
                        markConfigChanged();
                      }}
                    />
                    <TextField
                      label={t("aiConfig.customMaxOutputTokens.label")}
                      type="number"
                      min={1}
                      step={1}
                      value={customMaxOutputTokens}
                      onChange={(event) => {
                        setCustomMaxOutputTokens(event.target.value);
                        markConfigChanged();
                      }}
                      onBlur={flushConfig}
                      placeholder={t(
                        "aiConfig.customMaxOutputTokens.placeholder",
                      )}
                      helperText={t("aiConfig.customMaxOutputTokens.helper")}
                      error={
                        hasInvalidCustomMaxOutputTokens
                          ? t("aiConfig.customMaxOutputTokens.error")
                          : undefined
                      }
                    />
                  </>
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
                        markConfigChanged();
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
                        markConfigChanged();
                      }}
                      onBlur={flushConfig}
                      placeholder={SUGGESTED_FAST_MODELS.openai}
                      helperText={t("aiConfig.fastModelHelper")}
                    />
                  ))}

                {/* pi maps these levels onto each provider's thinking
                    parameters. Unsupported models ignore them. A shared model
                    has one effort; separate model tiers may diverge. */}
                {(provider !== "custom" || customSupportsThinking) &&
                  (useSeparateFastModel ? (
                    <>
                      <Select
                        label={t("aiConfig.smartThinking")}
                        value={thinkingLevel}
                        onChange={(value) => {
                          setThinkingLevel(value as ThinkingLevel);
                          markConfigChanged();
                        }}
                        options={thinkingOptions}
                        helperText={t("aiConfig.smartThinkingHelper")}
                      />
                      <Select
                        label={t("aiConfig.fastThinking")}
                        value={fastThinkingLevel}
                        onChange={(value) => {
                          setFastThinkingLevel(value as ThinkingLevel);
                          markConfigChanged();
                        }}
                        options={thinkingOptions}
                        helperText={t("aiConfig.fastThinkingHelper")}
                      />
                    </>
                  ) : (
                    <Select
                      label={t("aiConfig.thinking")}
                      value={thinkingLevel}
                      onChange={handleSharedThinkingChange}
                      options={thinkingOptions}
                      helperText={t("aiConfig.thinkingHelper")}
                    />
                  ))}

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
