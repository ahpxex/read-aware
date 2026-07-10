import { useEffect, useRef, useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { Caption } from "@read-aware/ui";
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
          <CaretRight size={12} className="shrink-0 text-fg-subtle" aria-hidden="true" />
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
    <details className="group min-w-0">
      <summary
        className="flex w-fit cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden"
      >
        <CaretRight
          size={12}
          className="shrink-0 text-fg-subtle transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        <Caption className="text-fg-subtle">{t("chat.thought")}</Caption>
      </summary>
      <div className="mt-1.5 whitespace-pre-wrap pl-4 text-caption leading-relaxed text-fg-muted">
        {text}
      </div>
    </details>
  );
}
