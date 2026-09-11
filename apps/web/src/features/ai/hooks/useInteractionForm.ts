import { useState } from "react";
import { validateInteractionFormValues, type InteractionForm, type InteractionFormErrors, type InteractionFormValues } from "@read-aware/core";
import type { ChatInteractionAnswer } from "../lib/chat-types";

export function useInteractionForm(form: InteractionForm, respond: (answer: ChatInteractionAnswer) => boolean) {
  const [draft, setDraft] = useState<Record<string, string | boolean>>(() => Object.fromEntries(form.fields.map(field => [field.id,
    field.kind === "checkbox" ? field.value ?? false : field.value === undefined ? "" : String(field.value),
  ])));
  const [errors, setErrors] = useState<InteractionFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const update = (id: string, value: string | boolean) => {
    setDraft(current => ({ ...current, [id]: value }));
    setErrors(current => { const next = { ...current }; delete next[id]; return next; });
  };
  const settle = (answer: ChatInteractionAnswer) => {
    if (submitting) return;
    setSubmitting(true);
    if (!respond(answer)) setSubmitting(false);
  };
  const submit = () => {
    const input: InteractionFormValues = Object.fromEntries(form.fields.map(field => [field.id,
      field.kind === "number" ? String(draft[field.id]).trim() === "" ? null : Number(draft[field.id]) : draft[field.id] ?? null,
    ]));
    const result = validateInteractionFormValues(form, input);
    setErrors(result.errors);
    if (!Object.keys(result.errors).length) settle({ values: result.values });
  };
  return { draft, errors, submitting, update, submit, skip: () => settle({ cancelled: true }) };
}
