import type { CatalogState } from "@read-aware/agent";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { IconButton, InlineError, SearchSelect, Spinner } from "@read-aware/ui";
import { describeError, formatDate, useTranslation } from "../../../i18n";

type ModelPickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  catalog: CatalogState & { refresh: () => void };
  helperText?: string;
};

export function ModelPicker({ label, value, onChange, catalog, helperText }: ModelPickerProps) {
  const { t } = useTranslation("settings");
  const failure = catalog.error ? describeError(catalog.error, { fallback: t("aiConfig.modelPicker.loadFailed") }) : null;
  return (
    <SearchSelect
      label={label} value={value} onChange={onChange} helperText={helperText}
      searchLabel={t("aiConfig.modelPicker.search")}
      emptyText={catalog.refreshing ? t("aiConfig.modelPicker.loading") : failure ? t("aiConfig.modelPicker.loadFailed") : t("aiConfig.modelPicker.empty")}
      customLabel={(id) => t("aiConfig.modelPicker.useCustom", { id })}
      options={catalog.models.map((model) => ({
        value: model.id, label: model.name,
        description: model.id !== model.name ? model.id : undefined,
      }))}
      status={
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {failure ? (
              <InlineError compact onRetry={failure.retryable ? catalog.refresh : undefined} retryLabel={t("aiConfig.modelPicker.refresh")}>
                {failure.body}
              </InlineError>
            ) : (
              <span role="status" className="text-xs text-fg-muted">
                {catalog.refreshing ? t("aiConfig.modelPicker.loading") : catalog.checkedAt
                  ? t("aiConfig.modelPicker.updated", { time: formatDate(catalog.checkedAt, { dateStyle: "short", timeStyle: "short" }) })
                  : t("aiConfig.modelPicker.notLoaded")}
              </span>
            )}
          </div>
          {catalog.refreshing ? <Spinner size="sm" /> : !failure && (
            <IconButton size="sm" label={t("aiConfig.modelPicker.refresh")} icon={<ArrowsClockwise size={14} />} onClick={catalog.refresh} />
          )}
        </div>
      }
    />
  );
}
