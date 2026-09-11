import { AppError } from "./errors";

type FieldBase = { id: string; label: string; required?: boolean };
export type InteractionFormField = FieldBase & (
  | { kind: "text" | "textarea"; maxLength?: number; value?: string }
  | { kind: "number"; min?: number; max?: number; value?: number }
  | { kind: "select"; options: { value: string; label: string }[]; value?: string }
  | { kind: "checkbox"; value?: boolean }
);
export type InteractionForm = { title: string; fields: InteractionFormField[] };
export type InteractionFormValues = Record<string, string | number | boolean | null>;
export type InteractionFormErrors = Record<string, "required" | "invalid">;
const invalid = (): never => { throw new AppError("ai/invalid-interaction", "Invalid structured interaction"); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const bounded = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Small, data-only form schema. No secrets, callbacks, permissions or executable validation. */
export function validateInteractionForm(value: unknown): InteractionForm {
  if (!object(value) || !bounded(value.title, 300) || !Array.isArray(value.fields) || value.fields.length < 1 || value.fields.length > 8 ||
    Object.keys(value).some(key => key !== "title" && key !== "fields") || JSON.stringify(value).length > 16_384) return invalid();
  const ids = new Set<string>();
  for (const field of value.fields) {
    if (!object(field) || typeof field.id !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(field.id) ||
      ["constructor", "prototype", "__proto__"].includes(field.id) || ids.has(field.id) || !bounded(field.label, 200) ||
      field.required !== undefined && typeof field.required !== "boolean") return invalid();
    ids.add(field.id);
    const keys = ["id", "label", "kind", "required", "value"];
    if (field.kind === "text" || field.kind === "textarea") {
      keys.push("maxLength");
      if (field.maxLength !== undefined && (!Number.isSafeInteger(field.maxLength) || Number(field.maxLength) < 1 || Number(field.maxLength) > 4000)) return invalid();
      if (field.value !== undefined && (typeof field.value !== "string" || field.value.length > Number(field.maxLength ?? 4000))) return invalid();
    } else if (field.kind === "number") {
      keys.push("min", "max");
      if (field.min !== undefined && !finite(field.min) || field.max !== undefined && !finite(field.max) ||
        field.min !== undefined && field.max !== undefined && Number(field.min) > Number(field.max)) return invalid();
      if (field.value !== undefined && (!finite(field.value) || field.min !== undefined && field.value < Number(field.min) || field.max !== undefined && field.value > Number(field.max))) return invalid();
    } else if (field.kind === "select") {
      keys.push("options");
      if (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 32) return invalid();
      const choices = new Set<string>();
      for (const option of field.options) {
        if (!object(option) || !bounded(option.value, 128) || !bounded(option.label, 200) || choices.has(option.value) ||
          Object.keys(option).some(key => key !== "value" && key !== "label")) return invalid();
        choices.add(option.value);
      }
      if (field.value !== undefined && (typeof field.value !== "string" || !choices.has(field.value))) return invalid();
    } else if (field.kind === "checkbox") {
      if (field.value !== undefined && typeof field.value !== "boolean") return invalid();
    } else return invalid();
    if (Object.keys(field).some(key => !keys.includes(key))) return invalid();
  }
  return structuredClone(value) as InteractionForm;
}

/** Validate at the host response boundary as well as before showing field errors. */
export function validateInteractionFormValues(form: InteractionForm, input: unknown): { values: InteractionFormValues; errors: InteractionFormErrors } {
  if (!object(input) || Object.keys(input).some(key => !form.fields.some(field => field.id === key))) return invalid();
  const values: InteractionFormValues = {}, errors: InteractionFormErrors = {};
  for (const field of form.fields) {
    const value = Object.prototype.hasOwnProperty.call(input, field.id) ? input[field.id] : null;
    const missing = value === null || value === undefined || typeof value === "string" && !value.trim();
    if (missing) {
      if (field.required) errors[field.id] = "required";
      values[field.id] = null;
    } else if (field.kind === "checkbox") {
      if (typeof value !== "boolean") errors[field.id] = "invalid";
      else values[field.id] = value; // required means supplied, not consent/true.
    } else if (field.kind === "number") {
      if (!finite(value) || field.min !== undefined && value < field.min || field.max !== undefined && value > field.max) errors[field.id] = "invalid";
      else values[field.id] = value;
    } else {
      if (typeof value !== "string" || (field.kind === "select" ? !field.options.some(option => option.value === value) : value.length > (field.maxLength ?? 4000))) errors[field.id] = "invalid";
      else values[field.id] = value;
    }
  }
  return { values, errors };
}
