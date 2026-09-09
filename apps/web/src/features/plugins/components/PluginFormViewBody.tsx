import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  ChoiceGroup,
  Select,
  Stack,
  TextArea,
  TextField,
  TimeField,
  Toggle,
} from "@read-aware/ui";
import { usePluginFormDraft } from "../hooks/usePluginFormDraft";
import { useTranslation } from "../../../i18n";
import { usePluginFieldOptions } from "../hooks/usePluginFieldOptions";
import { contributionText } from "../lib/plugin-i18n";
import { renderPluginIcon } from "../lib/plugin-icons";
import type {
  PluginFormField,
  PluginFormValues,
  PluginFormView,
} from "../lib/plugin-types";
import type { PluginResultRunner } from "./plugin-view-types";

type PluginFormViewBodyProps = {
  view: PluginFormView;
  busy: boolean;
  onResult: PluginResultRunner;
};

/**
 * `visibleWhen` gates rendering only: hidden fields keep their values in the
 * form state and in the persisted object, which is what lets one settings
 * object hold a value set per variant (e.g. one voice per TTS provider).
 */
function fieldVisible(field: PluginFormField, values: PluginFormValues): boolean {
  if (!field.visibleWhen) return true;
  const actual = values[field.visibleWhen.field];
  const expected = Array.isArray(field.visibleWhen.equals)
    ? field.visibleWhen.equals
    : [field.visibleWhen.equals];
  return expected.some((entry) => actual === entry || String(actual) === entry);
}

type SecretFieldProps = {
  field: Extract<PluginFormField, { kind: "secret" }>;
  adapter: PluginFormView["secrets"];
  /** Signals key changes so dependent state (dynamic voice lists) refreshes. */
  onChanged?: () => void;
  error?: string;
};

/**
 * A credential field over the form's secret adapter. The stored value is
 * never echoed: the input holds only the CURRENT draft, a masked placeholder
 * says "configured", and saving clears the draft back to that state. Blur
 * persists a non-empty draft; Clear removes the stored secret.
 */
function PluginSecretField({ field, adapter, onChanged, error }: SecretFieldProps) {
  const { t } = useTranslation("plugins");
  const [configured, setConfigured] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!adapter) return;
    void Promise.resolve(adapter.has(field.id)).then((has) => {
      if (!cancelled) setConfigured(has);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, field.id]);

  const save = () => {
    const value = draft.trim();
    if (!adapter || !value) return;
    void Promise.resolve(adapter.set(field.id, value)).then(() => {
      setConfigured(true);
      setDraft("");
      onChanged?.();
    });
  };

  return (
    <Stack direction="horizontal" gap="sm" align="end">
      <TextField
        label={contributionText(field.label)}
        variant="outlined"
        type="password"
        className="min-w-0 flex-1"
        placeholder={
          configured
            ? t("viewer.secretConfigured")
            : field.placeholder && contributionText(field.placeholder)
        }
        helperText={field.helperText && contributionText(field.helperText)}
        error={error}
        value={draft}
        disabled={!adapter}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          }
        }}
      />
      {configured && !draft && adapter && (
        <Button
          size="sm"
          variant="ghost"
          // Sit on the input's baseline row, above its helper text.
          className={field.helperText ? "mb-6" : undefined}
          onClick={() => {
            void Promise.resolve(adapter.remove(field.id)).then(() => {
              setConfigured(false);
              onChanged?.();
            });
          }}
        >
          {t("viewer.secretClear")}
        </Button>
      )}
    </Stack>
  );
}

type DynamicSelectProps = {
  field: Extract<PluginFormField, { kind: "select" }>;
  value: string;
  values: PluginFormValues;
  resolve: PluginFormView["resolveOptions"];
  /** Bumped when out-of-band inputs (stored secrets) change. */
  revision?: number;
  error?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
};

/** Sentinel option that switches a dynamic select into free text entry. */
// A literal NUL, written as an escape: a raw one in the source makes the
// whole file binary to git and grep.
const MANUAL_ENTRY = "\u0000manual-entry";

/**
 * A select whose options the plugin resolves at runtime. While the source
 * yields options the field is a Select (the stored value stays selectable
 * even when the list no longer contains it, and an "enter manually" entry
 * offers the way out — a catalog is rarely the whole truth); when the source
 * errors or lists nothing, the field falls back to free text input so the
 * value can always be typed. The fallback never swaps out from under an
 * active edit — a focused text input keeps its form until blur.
 *
 * `allowManualEntry: false` turns both of those off: the list IS the set of
 * acceptable values (a theme, an installed font), so typing one is
 * meaningless and an empty list means there is nothing to pick — offering a
 * text box there would only invite a value the write path will reject.
 */
function PluginDynamicSelectField({
  field,
  value,
  values,
  resolve,
  revision,
  error,
  onChange,
  onBlur,
}: DynamicSelectProps) {
  const { t } = useTranslation("plugins");
  const [editing, setEditing] = useState(false);
  // True only when editing was entered through the manual-entry option, so
  // the text input can take focus without stealing it in the empty-list case.
  const [manualEntry, setManualEntry] = useState(false);
  const resolved = usePluginFieldOptions({
    fieldId: field.id,
    values,
    resolve,
    revision,
  });

  const options =
    resolved ??
    field.options.map((option) => ({
      value: option.value,
      label: contributionText(option.label),
    }));
  const manualAllowed = field.kind === "select" && field.allowManualEntry !== false;
  if (!manualAllowed) {
    return (
      <Select
        label={contributionText(field.label)}
        variant="outlined"
        helperText={field.helperText && contributionText(field.helperText)}
        error={error}
        placeholder={t("viewer.selectPlaceholder")}
        options={
          options.some((option) => option.value === value) || value === ""
            ? options
            : [{ value, label: value }, ...options]
        }
        value={value}
        disabled={options.length === 0}
        onChange={onChange}
      />
    );
  }
  if (options.length === 0 || editing) {
    return (
      <TextField
        label={contributionText(field.label)}
        variant="outlined"
        helperText={field.helperText && contributionText(field.helperText)}
        error={error}
        value={value}
        autoFocus={manualEntry}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          setManualEntry(false);
          onBlur?.();
        }}
      />
    );
  }

  const listed = options.some((option) => option.value === value);
  return (
    <Select
      label={contributionText(field.label)}
      variant="outlined"
      helperText={field.helperText && contributionText(field.helperText)}
      error={error}
      placeholder={t("viewer.selectPlaceholder")}
      options={[
        ...(listed || value === "" ? options : [{ value, label: value }, ...options]),
        { value: MANUAL_ENTRY, label: t("viewer.enterManually") },
      ]}
      value={value}
      onChange={(next) => {
        if (next === MANUAL_ENTRY) {
          setManualEntry(true);
          setEditing(true);
          return;
        }
        onChange(next);
      }}
    />
  );
}

export function PluginFormViewBody({ view, busy, onResult }: PluginFormViewBodyProps) {
  const { t } = useTranslation("plugins");
  const { values, errors, updateValue, submit, flush, reactive } = usePluginFormDraft(view, onResult);
  // Bumped when a secret field writes/clears, so state that depends on
  // stored credentials (dynamic option lists) knows to re-resolve.
  const [secretsRevision, setSecretsRevision] = useState(0);

  return (
    <Stack
      as="form"
      gap="md"
      className="px-0.5 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {view.fields.filter((field) => fieldVisible(field, values)).map((field) => {
        if (field.kind === "text") {
          return (
            <TextField
              key={field.id}
              label={contributionText(field.label)}
              variant="outlined"
              type={field.inputMode ?? "text"}
              placeholder={field.placeholder && contributionText(field.placeholder)}
              helperText={field.helperText && contributionText(field.helperText)}
              error={errors[field.id]}
              value={String(values[field.id] ?? "")}
              onChange={(event) => updateValue(field.id, event.target.value)}
              onBlur={reactive ? flush : undefined}
            />
          );
        }
        if (field.kind === "textarea") {
          return (
            <TextArea
              key={field.id}
              label={contributionText(field.label)}
              placeholder={field.placeholder && contributionText(field.placeholder)}
              helperText={field.helperText && contributionText(field.helperText)}
              rows={field.rows ?? 4}
              error={errors[field.id]}
              value={String(values[field.id] ?? "")}
              onChange={(event) => updateValue(field.id, event.target.value)}
              onBlur={reactive ? flush : undefined}
            />
          );
        }
        if (field.kind === "time") {
          return (
            <TimeField
              key={field.id}
              label={contributionText(field.label)}
              helperText={field.helperText && contributionText(field.helperText)}
              error={errors[field.id]}
              minuteStep={field.minuteStep}
              hoursLabel={t("viewer.hours")}
              minutesLabel={t("viewer.minutes")}
              value={String(values[field.id] ?? "")}
              onChange={(value) => {
                updateValue(field.id, value);
                if (reactive) flush();
              }}
            />
          );
        }
        if (field.kind === "number") {
          return (
            <TextField
              key={field.id}
              label={contributionText(field.label)}
              variant="outlined"
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              helperText={field.helperText && contributionText(field.helperText)}
              error={errors[field.id]}
              value={String(values[field.id] ?? 0)}
              onChange={(event) => updateValue(field.id, Number(event.target.value))}
              onBlur={reactive ? flush : undefined}
            />
          );
        }
        if (field.kind === "secret") {
          return (
            <PluginSecretField
              key={field.id}
              field={field}
              adapter={view.secrets}
              error={errors[field.id]}
              onChanged={() => setSecretsRevision((current) => current + 1)}
            />
          );
        }
        if (field.kind === "select") {
          if (field.dynamicOptions) {
            return (
              <PluginDynamicSelectField
                key={field.id}
                field={field}
                value={String(values[field.id] ?? "")}
                values={values}
                resolve={view.resolveOptions}
                revision={secretsRevision}
                error={errors[field.id]}
                onChange={(value) => updateValue(field.id, value)}
                onBlur={reactive ? flush : undefined}
              />
            );
          }
          return (
            <Select
              key={field.id}
              label={contributionText(field.label)}
              variant="outlined"
              helperText={field.helperText && contributionText(field.helperText)}
              options={field.options.map((option) => ({
                value: option.value,
                label: contributionText(option.label),
              }))}
              value={String(values[field.id] ?? "")}
              error={errors[field.id]}
              onChange={(value) => updateValue(field.id, value)}
            />
          );
        }
        if (field.kind === "choice") {
          return (
            <ChoiceGroup
              key={field.id}
              label={contributionText(field.label)}
              error={errors[field.id]}
              options={field.options.map((option) => ({
                value: option.value,
                label: contributionText(option.label),
                icon: option.icon ? renderPluginIcon(option.icon, 15) : undefined,
              }))}
              value={String(values[field.id] ?? "")}
              onChange={(value) => updateValue(field.id, value)}
            />
          );
        }
        if (field.kind === "checkbox") {
          return (
            <Checkbox
              key={field.id}
              label={contributionText(field.label)}
              description={field.description && contributionText(field.description)}
              error={errors[field.id]}
              checked={values[field.id] === true}
              onChange={(event) => updateValue(field.id, event.target.checked)}
            />
          );
        }
        // Same row anatomy as the app's own settings panels (SettingsRow):
        // title + optional description on the left, the switch trailing.
        return (
          <div key={field.id} className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="font-sans text-sm font-medium text-fg">
                {contributionText(field.label)}
              </p>
              {field.description && (
                <p className="mt-0.5 font-sans text-[13px] leading-5 text-fg-muted">
                  {contributionText(field.description)}
                </p>
              )}
            </div>
            <Toggle
              aria-label={contributionText(field.label)}
              error={errors[field.id]}
              checked={values[field.id] === true}
              onChange={(checked) => updateValue(field.id, checked)}
              className="shrink-0 pt-0.5"
            />
          </div>
        );
      })}
      {!reactive && (
        <Stack direction="horizontal" justify="end">
          <Button type="submit" size="sm" disabled={busy}>
            {view.submitLabel ?? t("viewer.submit")}
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
