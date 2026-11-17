import { CaretRight, WarningCircle } from "@phosphor-icons/react";
import { Button, Caption, Spinner } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useChatActivity } from "../hooks/useChatActivity";
import type { ChatActivityPart } from "../lib/chat-activity";
import { ChatThinking } from "./ChatThinking";
import { ChatToolStep } from "./ChatToolStep";

/** Compact chat disclosure; uses the same Button as the existing trace rows. */
export function ChatActivity({
  part,
  streaming,
  thinking,
  pendingStatus,
}: {
  part: ChatActivityPart;
  streaming: boolean;
  thinking: boolean;
  pendingStatus?: string;
}) {
  const { contentId, expanded, live, busy, failed, summary, toggle } = useChatActivity(
    part,
    streaming,
    thinking,
    pendingStatus,
  );
  return (
    <div className="min-w-0" data-chat-activity>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={toggle}
        className="h-auto max-w-full justify-start gap-1 p-0 text-left font-normal text-fg-subtle hover:bg-transparent hover:text-fg-muted active:bg-transparent"
      >
        <CaretRight
          size={12}
          className={cn("shrink-0 transition-transform", expanded && "rotate-90")}
          aria-hidden="true"
        />
        {busy ? (
          <Spinner size="sm" className="mx-0.5 h-3 w-3 shrink-0" />
        ) : failed > 0 ? (
          <WarningCircle size={12} className="shrink-0" aria-hidden="true" />
        ) : null}
        <Caption className="min-w-0 truncate text-fg-subtle">{summary}</Caption>
      </Button>
      {expanded && (
        <div id={contentId} className="ml-1.5 mt-2 space-y-2 border-l border-border pl-3">
          {part.parts.map((step, index) =>
            step.type === "tool" ? (
              <ChatToolStep key={step.id} part={step} defaultExpanded={live} />
            ) : (
              <ChatThinking
                key={`thinking-${index}`}
                text={step.text}
                streaming={thinking && index === part.parts.length - 1}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
