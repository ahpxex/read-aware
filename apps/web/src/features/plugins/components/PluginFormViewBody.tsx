import { useState } from "react";
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
import { useTranslation } from "../../../i18n";
import { renderPluginIcon } from "../lib/plugin-icons";
import type { PluginFormValues, PluginFormView } from "../lib/plugin-types";
import type { PluginResultRunner } from "./plugin-view-types";

type PluginFormViewBodyProps = {
  view: PluginFormView;
  busy: boolean;
  onResult: PluginResultRunner;
};

export function PluginFormViewBody({ view, busy, onResult }: PluginFormViewBodyProps) {
  const { t } = useTranslation("plugins");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [values, setValues] = useState<PluginFormValues>(() => {
    const initial: PluginFormValues = {};
    for (const field of view.fields) {
      initial[field.id] =
        field.kind === "toggle" || field.kind === "checkbox"
          ? (field.value ?? false)
          : field.kind === "number"
            ? (field.value ?? 0)
            : field.kind === "select" || field.kind === "choice"
              ? (field.value ?? field.options[0]?.value ?? "")
              : (field.value ?? "");
    }
    return initial;
  });

  return (
    <Stack
      as="form"
      gap="md"
      className="px-0.5 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        setErrors({});
        void (async () => {
          const result = await onResult(() => view.onSubmit({ ...values }));
          if (result?.fieldErrors) setErrors(result.fieldErrors);
        })();
      }}
    >
      {view.fields.map((field) => {
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
              onChange={(event) =>
                setValues((previous) => ({ ...previous, [field.id]: event.target.value }))
              }
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
              onChange={(event) =>
                setValues((previous) => ({ ...previous, [field.id]: event.target.value }))
              }
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
              onChange={(event) =>
                setValues((previous) => ({
                  ...previous,
                  [field.id]: Number(event.target.value),
                }))
              }
            />
          );
        }
        if (field.kind === "select") {
          return (
            <Select
              key={field.id}
              label={field.label}
              variant="outlined"
              options={field.options}
              value={String(values[field.id] ?? "")}
              onChange={(value) =>
                setValues((previous) => ({ ...previous, [field.id]: value }))
              }
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
              onChange={(value) =>
                setValues((previous) => ({ ...previous, [field.id]: value }))
              }
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
              onChange={(event) =>
                setValues((previous) => ({ ...previous, [field.id]: event.target.checked }))
              }
            />
          );
        }
        return (
          <Toggle
            key={field.id}
            label={field.label}
            checked={values[field.id] === true}
            onChange={(checked) =>
              setValues((previous) => ({ ...previous, [field.id]: checked }))
            }
          />
        );
      })}
      <Stack direction="horizontal" justify="end">
        <Button type="submit" size="sm" disabled={busy}>
          {view.submitLabel ?? t("viewer.submit")}
        </Button>
      </Stack>
    </Stack>
  );
}
