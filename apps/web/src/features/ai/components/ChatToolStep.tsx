import { useEffect, useId, useState } from "react";
import { CaretRight, Check, WarningCircle } from "@phosphor-icons/react";
import { Button, Caption, Spinner } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { useChatToolLabel } from "../hooks/useChatToolLabel";
import type { ChatToolPart } from "../lib/chat-types";

/**
 * One tool call in the assistant's turn, rendered as a quiet activity row: the
 * same chevron glyph as the thinking disclosure (a spinner while running), a
 * localized label, and the distilled argument (e.g. the search query). Errors
 * stay understated — a plain suffix, no red banner.
 */
export function ChatToolStep({ part, defaultExpanded = true }: { part: ChatToolPart; defaultExpanded?: boolean }) {
  const { t } = useTranslation("ai");
  const contentId = useId();
  const label = useChatToolLabel(part.tool);
  const running = part.state === "running";
  const hasTrace = Boolean(part.input || part.output);
  // A live call shows its arguments and partial output while it runs; a step
  // revealed by reopening a settled activity group starts folded.
  // Collapse when execution settles; persisted traces remain available.
  const [expanded, setExpanded] = useState(defaultExpanded && running && hasTrace);
  useEffect(() => {
    if (!running) setExpanded(false);
  }, [running]);

  const row = (
    <>
      {running ? (
        <Spinner size="sm" className="mx-0.5 h-3 w-3 shrink-0" />
      ) : hasTrace ? (
        <CaretRight
          size={12}
          className={cn("shrink-0 text-fg-subtle transition-transform", expanded && "rotate-90")}
          aria-hidden="true"
        />
      ) : part.state === "error" ? (
        <WarningCircle size={12} className="shrink-0 text-fg-subtle" aria-hidden="true" />
      ) : (
        <Check size={12} className="shrink-0 text-fg-subtle" aria-hidden="true" />
      )}
      <Caption className={cn("truncate", running ? "text-fg-muted" : "text-fg-subtle")}>
        {label}
        {part.detail ? ` · ${part.detail}` : null}
        {part.state === "error" ? ` — ${t("chat.tools.failed")}` : null}
      </Caption>
    </>
  );

  return (
    <div className="min-w-0" data-chat-tool-step={part.id}>
      {hasTrace ? (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((open) => !open)}
          className="h-auto w-full justify-start gap-1 p-0 text-left font-normal hover:bg-transparent active:bg-transparent"
        >
          {row}
        </Button>
      ) : (
        <div className="flex min-w-0 items-center gap-1">{row}</div>
      )}
      {expanded && hasTrace && (
        <div id={contentId} className="ml-1.5 mt-1.5 space-y-2 border-l border-border pl-3">
          {part.input && <TraceValue label={t("chat.tools.input")} value={part.input} />}
          {part.output && <TraceValue label={t("chat.tools.output")} value={part.output} />}
          {running && <Caption className="ra-chat-pulse block text-fg-subtle">{t("chat.tools.running")}</Caption>}
        </div>
      )}
    </div>
  );
}

function TraceValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <Caption className="mb-1 block text-fg-subtle">{label}</Caption>
      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-fg-muted">
        {value}
      </pre>
    </div>
  );
}
