import { CheckCircle, Question, Warning, XCircle } from "@phosphor-icons/react";
import { Body, Button, Caption, Card, ChoiceGroup, TextField } from "@read-aware/ui";
import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "../../../i18n";
import { respondToUserInteraction } from "../agent/ports/user-interaction-port";
import type {
  ChatInteractionAnswer,
  ChatInteractionPart,
  ChatPermissionAction,
} from "../lib/chat-types";

const CUSTOM_CHOICE = "__read_aware_custom_answer__";

const permissionKeys: Record<
  ChatPermissionAction,
  {
    question: `chat.interaction.permission.${"deleteBook" | "deleteCollection" | "deleteAnnotation"}.question`;
    description: `chat.interaction.permission.${"deleteBook" | "deleteCollection" | "deleteAnnotation"}.description`;
    approve: `chat.interaction.permission.${"deleteBook" | "deleteCollection" | "deleteAnnotation"}.approve`;
  }
> = {
  "delete-book": {
    question: "chat.interaction.permission.deleteBook.question",
    description: "chat.interaction.permission.deleteBook.description",
    approve: "chat.interaction.permission.deleteBook.approve",
  },
  "delete-collection": {
    question: "chat.interaction.permission.deleteCollection.question",
    description: "chat.interaction.permission.deleteCollection.description",
    approve: "chat.interaction.permission.deleteCollection.approve",
  },
  "delete-annotation": {
    question: "chat.interaction.permission.deleteAnnotation.question",
    description: "chat.interaction.permission.deleteAnnotation.description",
    approve: "chat.interaction.permission.deleteAnnotation.approve",
  },
};

function SettledAnswer({ part }: { part: ChatInteractionPart }) {
  const { t } = useTranslation("ai");
  const declined = part.request.kind === "permission" && part.answer?.optionId === "decline";
  const cancelled = part.state === "cancelled" || part.answer?.cancelled;
  const label = cancelled
    ? t("chat.interaction.skipped")
    : declined
      ? t("chat.interaction.permission.declined")
      : part.request.kind === "permission"
        ? t("chat.interaction.permission.approved")
        : part.answer?.text || t("chat.interaction.answered");
  const Icon = cancelled || declined ? XCircle : CheckCircle;
  return (
    <div className="flex items-center gap-1.5 text-fg-muted">
      <Icon size={14} aria-hidden="true" />
      <Caption>{label}</Caption>
    </div>
  );
}

function QuestionPrompt({ part }: { part: ChatInteractionPart }) {
  const { t } = useTranslation("ai");
  const [choice, setChoice] = useState("");
  const [custom, setCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const request = part.request.kind === "question" ? part.request : null;
  const choices = useMemo(
    () => [
      ...(request?.options.map((option) => ({ value: option.id, label: option.label })) ?? []),
      ...(request?.allowCustom
        ? [{ value: CUSTOM_CHOICE, label: t("chat.interaction.customAnswer") }]
        : []),
    ],
    [request, t],
  );
  if (!request) return null;

  const selectedOption = request.options.find((option) => option.id === choice);
  const canSubmit =
    !submitting &&
    ((choice === CUSTOM_CHOICE && custom.trim().length > 0) ||
      (choice !== CUSTOM_CHOICE && !!selectedOption));

  function settle(answer: ChatInteractionAnswer): void {
    setSubmitting(true);
    if (!respondToUserInteraction(part.id, answer)) setSubmitting(false);
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    if (choice === CUSTOM_CHOICE) {
      settle({ text: custom.trim() });
      return;
    }
    if (selectedOption) {
      settle({ optionId: selectedOption.id, text: selectedOption.label });
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <ChoiceGroup value={choice} options={choices} onChange={setChoice} />
      {selectedOption?.description && (
        <Caption as="p" className="leading-5 text-fg-muted">
          {selectedOption.description}
        </Caption>
      )}
      {choice === CUSTOM_CHOICE && (
        <TextField
          label={t("chat.interaction.customAnswerLabel")}
          placeholder={t("chat.interaction.customAnswerPlaceholder")}
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          variant="outlined"
          autoFocus
          disabled={submitting}
        />
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={!canSubmit}>
          {t("chat.interaction.submit")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={submitting}
          onClick={() => settle({ cancelled: true })}
        >
          {t("chat.interaction.skip")}
        </Button>
      </div>
    </form>
  );
}

function PermissionPrompt({ part }: { part: ChatInteractionPart }) {
  const { t } = useTranslation("ai");
  const [submitting, setSubmitting] = useState(false);
  const request = part.request.kind === "permission" ? part.request : null;
  if (!request) return null;
  const keys = permissionKeys[request.action];

  function settle(answer: ChatInteractionAnswer): void {
    setSubmitting(true);
    if (!respondToUserInteraction(part.id, answer)) setSubmitting(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <Caption as="p" className="leading-5 text-fg-muted">
        {t(keys.description, { subject: request.subject })}
      </Caption>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="danger"
          disabled={submitting}
          onClick={() => settle({ optionId: "approve", text: "Approved" })}
        >
          {t(keys.approve)}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={submitting}
          onClick={() => settle({ optionId: "decline", text: "Declined" })}
        >
          {t("chat.interaction.permission.decline")}
        </Button>
      </div>
    </div>
  );
}

/** Inline question/permission surface; settled answers remain in the transcript. */
export function ChatInteractionPrompt({ part }: { part: ChatInteractionPart }) {
  const { t } = useTranslation("ai");
  const permission = part.request.kind === "permission";
  const title =
    part.request.kind === "permission"
      ? t(permissionKeys[part.request.action].question, { subject: part.request.subject })
      : part.request.question;
  const Icon = permission ? Warning : Question;

  return (
    <Card
      padding="sm"
      className={permission ? "border-red-300 dark:border-red-900" : "border-border-strong"}
      aria-live={part.state === "pending" ? "polite" : undefined}
    >
      <div className="flex items-start gap-2.5">
        <Icon
          size={17}
          className={permission ? "mt-0.5 shrink-0 text-red-800 dark:text-red-400" : "mt-0.5 shrink-0 text-fg-muted"}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <Body as="h3" className="text-sm font-medium leading-5 text-fg">
            {title}
          </Body>
          <div className="mt-3">
            {part.state === "pending" ? (
              permission ? (
                <PermissionPrompt part={part} />
              ) : (
                <QuestionPrompt part={part} />
              )
            ) : (
              <SettledAnswer part={part} />
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
