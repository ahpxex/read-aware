import { useEffect, useId, useRef, useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { Button, Caption, Spinner } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";

/**
 * A run of model reasoning. While it streams, the tail of the thought is shown
 * live under the pulsing "Thinking…" label (bottom-anchored, the top fading
 * out once it overflows) — watching the work happen beats staring at a
 * spinner. Once the run settles it collapses behind the quiet "Thought
 * process" disclosure: available, never imposed.
 */
export function ChatThinking({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  const { t } = useTranslation("ai");
  const tailRef = useRef<HTMLDivElement | null>(null);
  const [clipped, setClipped] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  // The fade mask only makes sense once the tail actually overflows —
  // fading the first line of a short thought reads as a rendering bug.
  useEffect(() => {
    if (!streaming) return;
    const el = tailRef.current;
    if (el) setClipped(el.scrollHeight > el.clientHeight + 1);
  }, [text, streaming]);

  if (streaming) {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <Spinner size="sm" className="mx-0.5 h-3 w-3 shrink-0" />
          <Caption className="ra-chat-pulse text-fg-subtle">{t("chat.thinking")}</Caption>
        </div>
        {text.trim().length > 0 && (
          <div
            ref={tailRef}
            className={cn(
              "mt-1.5 flex max-h-24 flex-col justify-end overflow-hidden pl-4",
              clipped &&
                "[mask-image:linear-gradient(to_bottom,transparent,black_2.5rem)]",
            )}
          >
            <p className="whitespace-pre-wrap text-caption leading-relaxed text-fg-subtle">
              {text}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((open) => !open)}
        className="h-auto w-fit justify-start gap-1 p-0 text-left font-normal text-fg-subtle hover:bg-transparent hover:text-fg-muted active:bg-transparent"
      >
        <CaretRight
          size={12}
          className={cn(
            "shrink-0 text-fg-subtle transition-transform",
            expanded && "rotate-90",
          )}
          aria-hidden="true"
        />
        <Caption className="text-fg-subtle">{t("chat.thought")}</Caption>
      </Button>
      {expanded && (
        <div
          id={contentId}
          className="mt-1.5 whitespace-pre-wrap border-l border-border pl-4 text-caption leading-relaxed text-fg-muted"
        >
          {text}
        </div>
      )}
    </div>
  );
}
