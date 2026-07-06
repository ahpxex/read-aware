import { CaretRight } from "@phosphor-icons/react";
import { Caption } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";

/**
 * A run of model reasoning, collapsed behind a quiet disclosure. Closed by
 * default — the reasoning is available, never imposed. While the block is
 * still streaming the summary reads "Thinking…" with a soft pulse; afterwards
 * it settles into a plain "Thought process" line.
 */
export function ChatThinking({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  const { t } = useTranslation("ai");
  return (
    <details className="group min-w-0">
      <summary
        className="flex w-fit cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden"
      >
        <CaretRight
          size={12}
          className="shrink-0 text-fg-subtle transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        <Caption className={cn("text-fg-subtle", streaming && "ra-chat-pulse")}>
          {streaming ? t("chat.thinking") : t("chat.thought")}
        </Caption>
      </summary>
      <div className="mt-1.5 whitespace-pre-wrap pl-4 text-caption leading-relaxed text-fg-muted">
        {text}
      </div>
    </details>
  );
}
