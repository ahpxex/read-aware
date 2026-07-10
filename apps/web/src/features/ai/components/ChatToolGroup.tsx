/**
 * A settled run of consecutive tool steps, folded behind one quiet disclosure
 * (the ChatThinking idiom). While the turn streams the individual rows stay
 * visible — that's the intermediate process; once the message settles the
 * transcript keeps a single "N steps" line, expandable to the full trace.
 */
import { CaretRight } from "@phosphor-icons/react";
import { Caption } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { ChatToolPart } from "../lib/chat-types";
import { ChatToolStep } from "./ChatToolStep";

export function ChatToolGroup({ parts }: { parts: ChatToolPart[] }) {
  const { t } = useTranslation("ai");
  const failed = parts.some((part) => part.state === "error");
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
        <Caption className="text-fg-subtle">
          {t("chat.steps", { count: parts.length })}
          {failed ? ` — ${t("chat.tools.failed")}` : null}
        </Caption>
      </summary>
      <div className="mt-1.5 flex flex-col gap-1.5 pl-4">
        {parts.map((part) => (
          <ChatToolStep key={part.id} part={part} />
        ))}
      </div>
    </details>
  );
}
