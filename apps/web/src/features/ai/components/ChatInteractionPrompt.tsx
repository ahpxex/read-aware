import { CaretRight, Warning } from "@phosphor-icons/react";
import { Body, Button, Caption, Card, ChoiceGroup, TextField } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useId, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "../../../i18n";
import { respondToUserInteraction } from "../agent/ports/user-interaction-port";
import type {
  ChatInteractionAnswer,
  ChatInteractionPart,
  ChatPermissionAction,
} from "../lib/chat-types";

type InteractionResponder = (id: string, answer: ChatInteractionAnswer) => boolean;

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

function SettledInteraction({
  part,
  title,
}: {
  part: ChatInteractionPart;
  title: string;
}) {
  const { t } = useTranslation("ai");
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const declined = part.request.kind === "permission" && part.answer?.optionId === "decline";
  const cancelled = part.state === "cancelled" || part.answer?.cancelled;
  const answer = cancelled
    ? t("chat.interaction.skipped")
    : declined
      ? t("chat.interaction.permission.declined")
      : part.request.kind === "permission"
        ? t("chat.interaction.permission.approved")
        : part.answer?.text || t("chat.interaction.answered");
  const status = cancelled
    ? t("chat.interaction.skipped")
    : declined
      ? t("chat.interaction.permission.declined")
      : part.request.kind === "permission"
        ? t("chat.interaction.permission.approved")
        : t("chat.interaction.answered");

  return (
    <div className="min-w-0">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((open) => !open)}
        className="h-auto w-full justify-start gap-1 p-0 text-left font-normal hover:bg-transparent active:bg-transparent"
      >
        <CaretRight
          size={12}
          className={cn(
            "shrink-0 text-fg-subtle transition-transform",
            expanded && "rotate-90",
          )}
          aria-hidden="true"
        />
        <Caption className="min-w-0 truncate text-fg-subtle">
          {status} · {title}
        </Caption>
      </Button>
      {expanded && (
        <Caption
          as="blockquote"
          id={contentId}
          className="ml-1.5 mt-1.5 space-y-1 border-l border-border pl-3 leading-relaxed text-fg-muted"
        >
          <span className="block">
            <span className="text-fg-subtle">q:</span> {title}
          </span>
          <span className="block">
            <span className="text-fg-subtle">a:</span> {answer}
          </span>
        </Caption>
      )}
    </div>
  );
}

function QuestionPrompt({
  part,
  onRespond,
}: {
  part: ChatInteractionPart;
  onRespond: InteractionResponder;
}) {
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
    if (!onRespond(part.id, answer)) setSubmitting(false);
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

function PermissionPrompt({
  part,
  onRespond,
}: {
  part: ChatInteractionPart;
  onRespond: InteractionResponder;
}) {
  const { t } = useTranslation("ai");
  const [submitting, setSubmitting] = useState(false);
  const request = part.request.kind === "permission" ? part.request : null;
  if (!request) return null;
  const keys = permissionKeys[request.action];

  function settle(answer: ChatInteractionAnswer): void {
    setSubmitting(true);
    if (!onRespond(part.id, answer)) setSubmitting(false);
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
export function ChatInteractionPrompt({
  part,
  onRespond = respondToUserInteraction,
}: {
  part: ChatInteractionPart;
  onRespond?: InteractionResponder;
}) {
  const { t } = useTranslation("ai");
  const permission = part.request.kind === "permission";
  const title =
    part.request.kind === "permission"
      ? t(permissionKeys[part.request.action].question, { subject: part.request.subject })
      : part.request.question;

  if (part.state !== "pending") {
    return <SettledInteraction part={part} title={title} />;
  }

  return (
    <Card padding="sm" className="rounded-md bg-transparent" aria-live="polite">
      {permission ? (
        <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5">
          <Warning size={18} className="self-center text-fg-muted" aria-hidden="true" />
          <Body as="h3" className="min-w-0 text-sm font-medium leading-5 text-fg">
            {title}
          </Body>
          <div className="col-start-2 mt-3 min-w-0">
            <PermissionPrompt part={part} onRespond={onRespond} />
          </div>
        </div>
      ) : (
        <>
          <Body as="h3" className="text-sm font-medium leading-5 text-fg">
            {title}
          </Body>
          <div className="mt-3">
            <QuestionPrompt part={part} onRespond={onRespond} />
          </div>
        </>
      )}
    </Card>
  );
}
