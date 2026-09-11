import { Button, Checkbox, Select, Stack, TextArea, TextField } from "@read-aware/ui";
import type { InteractionForm } from "@read-aware/core";
import { useTranslation } from "../../../i18n";
import { useInteractionForm } from "../hooks/useInteractionForm";
import type { ChatInteractionAnswer } from "../lib/chat-types";

/** The same host design-system controls as plugin forms, with a data-only answer boundary. */
export function ChatInteractionForm({ form, respond }: { form: InteractionForm; respond: (answer: ChatInteractionAnswer) => boolean }) {
  const { t } = useTranslation("ai");
  const state = useInteractionForm(form, respond);
  return <Stack as="form" gap="md" noValidate onSubmit={event => { event.preventDefault(); state.submit(); }}>
    {form.fields.map(field => {
      const error = state.errors[field.id] ? t(`chat.interaction.form.${state.errors[field.id]}`) : undefined;
      const shared = { label: field.label, error, disabled: state.submitting, "aria-required": field.required ?? false };
      if (field.kind === "checkbox") return <Checkbox key={field.id} {...shared}
        checked={state.draft[field.id] === true} onChange={event => state.update(field.id, event.target.checked)} />;
      if (field.kind === "select") return <Select key={field.id} {...shared} variant="outlined"
        placeholder={t("chat.interaction.form.choose")} options={field.options} value={String(state.draft[field.id])}
        onChange={value => state.update(field.id, value)} />;
      if (field.kind === "textarea") return <TextArea key={field.id} {...shared} rows={3}
        maxLength={field.maxLength ?? 4000} value={String(state.draft[field.id])} onChange={event => state.update(field.id, event.target.value)} />;
      return <TextField key={field.id} {...shared} variant="outlined" type={field.kind === "number" ? "number" : "text"}
        {...(field.kind === "number" ? { min: field.min, max: field.max, step: "any" } : { maxLength: field.maxLength ?? 4000 })}
        value={String(state.draft[field.id])} onChange={event => state.update(field.id, event.target.value)} />;
    })}
    <Stack direction="horizontal" gap="sm">
      <Button size="sm" type="submit" disabled={state.submitting}>{t("chat.interaction.submit")}</Button>
      <Button size="sm" type="button" variant="ghost" disabled={state.submitting} onClick={state.skip}>{t("chat.interaction.skip")}</Button>
    </Stack>
  </Stack>;
}
