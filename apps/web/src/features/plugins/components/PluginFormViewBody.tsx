import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  ChoiceGroup,
  Select,
  Stack,
  TextArea,
  TextField,
  Toggle,
} from "@read-aware/ui";
import { useReactiveSetting } from "../../../hooks/useReactiveSetting";
import { useTranslation } from "../../../i18n";
import { usePluginFieldOptions } from "../hooks/usePluginFieldOptions";
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
};

/**
 * A credential field over the form's secret adapter. The stored value is
 * never echoed: the input holds only the CURRENT draft, a masked placeholder
 * says "configured", and saving clears the draft back to that state. Blur
 * persists a non-empty draft; Clear removes the stored secret.
 */
function PluginSecretField({ field, adapter, onChanged }: SecretFieldProps) {
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
        label={field.label}
        variant="outlined"
        type="password"
        className="min-w-0 flex-1"
        placeholder={
          configured ? t("viewer.secretConfigured") : field.placeholder
        }
        helperText={field.helperText}
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

/**
 * A select whose options the plugin resolves at runtime. While the source
 * yields options the field is a Select (the stored value stays selectable
 * even when the list no longer contains it); when the source errors or lists
 * nothing, the field falls back to free text input so the value can always
 * be typed. The fallback never swaps out from under an active edit — a
 * focused text input keeps its form until blur.
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
  const resolved = usePluginFieldOptions({
    visible: true,
    fieldId: field.id,
    values,
    resolve,
    revision,
  });

  const options = resolved ?? field.options;
  if (options.length === 0 || editing) {
    return (
      <TextField
        label={field.label}
        variant="outlined"
        helperText={field.helperText}
        error={error}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          onBlur?.();
        }}
      />
    );
  }

  const listed = options.some((option) => option.value === value);
  return (
    <Select
      label={field.label}
      variant="outlined"
      helperText={field.helperText}
      error={error}
      placeholder={t("viewer.selectPlaceholder")}
      options={
        listed || value === ""
          ? options
          : [{ value, label: value }, ...options]
      }
      value={value}
      onChange={onChange}
    />
  );
}

export function PluginFormViewBody({ view, busy, onResult }: PluginFormViewBodyProps) {
  const { t } = useTranslation("plugins");
  const reactive = view.submitMode === "change";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveRevision, setSaveRevision] = useState(0);
  // Bumped when a secret field writes/clears, so state that depends on
  // stored credentials (dynamic option lists) knows to re-resolve.
  const [secretsRevision, setSecretsRevision] = useState(0);
  const [values, setValues] = useState<PluginFormValues>(() => {
    const initial: PluginFormValues = {};
    for (const field of view.fields) {
      // Secret fields have no form value — they live in the secret store.
      if (field.kind === "secret") continue;
      initial[field.id] =
        field.kind === "toggle" || field.kind === "checkbox"
          ? (field.value ?? false)
          : field.kind === "number"
            ? (field.value ?? 0)
            : field.kind === "select" || field.kind === "choice"
              ? (field.value ??
                (field.kind === "select" && field.dynamicOptions
                  ? ""
                  : (field.options[0]?.value ?? "")))
              : (field.value ?? "");
    }
    return initial;
  });
  const { flush } = useReactiveSetting({
    value: values,
    revision: saveRevision,
    enabled: reactive,
    persist: (next) => {
      setErrors({});
      void (async () => {
        const result = await onResult(
          () => view.onSubmit({ ...next }),
          { background: true },
        );
        if (result?.fieldErrors) setErrors(result.fieldErrors);
      })();
    },
  });

  const updateValue = (id: string, value: string | boolean | number) => {
    setValues((previous) => ({ ...previous, [id]: value }));
    setErrors((previous) => {
      if (previous[id] === undefined) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
    if (reactive) setSaveRevision((current) => current + 1);
  };

  return (
    <Stack
      as="form"
      gap="md"
      className="px-0.5 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (reactive) {
          flush();
          return;
        }
        setErrors({});
        void (async () => {
          const result = await onResult(() => view.onSubmit({ ...values }));
          if (result?.fieldErrors) setErrors(result.fieldErrors);
        })();
      }}
    >
      {view.fields.filter((field) => fieldVisible(field, values)).map((field) => {
        if (field.kind === "text") {
          return (
            <TextField
              key={field.id}
              label={field.label}
              variant="outlined"
              type={field.inputMode ?? "text"}
              placeholder={field.placeholder}
              helperText={field.helperText}
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
              label={field.label}
              placeholder={field.placeholder}
              helperText={field.helperText}
              rows={field.rows ?? 4}
              error={errors[field.id]}
              value={String(values[field.id] ?? "")}
              onChange={(event) => updateValue(field.id, event.target.value)}
              onBlur={reactive ? flush : undefined}
            />
          );
        }
        if (field.kind === "number") {
          return (
            <TextField
              key={field.id}
              label={field.label}
              variant="outlined"
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              helperText={field.helperText}
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
              label={field.label}
              variant="outlined"
              helperText={field.helperText}
              options={field.options}
              value={String(values[field.id] ?? "")}
              onChange={(value) => updateValue(field.id, value)}
            />
          );
        }
        if (field.kind === "choice") {
          return (
            <ChoiceGroup
              key={field.id}
              label={field.label}
              options={field.options.map((option) => ({
                ...option,
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
              label={field.label}
              description={field.description}
              checked={values[field.id] === true}
              onChange={(event) => updateValue(field.id, event.target.checked)}
            />
          );
        }
        return (
          <Toggle
            key={field.id}
            label={field.label}
            checked={values[field.id] === true}
            onChange={(checked) => updateValue(field.id, checked)}
          />
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
