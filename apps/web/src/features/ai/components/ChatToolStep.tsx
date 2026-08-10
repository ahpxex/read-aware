import { useEffect, useId, useState } from "react";
import { CaretRight, Check, WarningCircle } from "@phosphor-icons/react";
import { Button, Caption, Spinner } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useAtomValue } from "jotai";
import { useTranslation } from "../../../i18n";
import { contributionText } from "../../plugins/lib/plugin-i18n";
import { pluginToolName } from "../../plugins/runtime/plugin-tools";
import { pluginToolsAtom } from "../../plugins/state/plugin-store";
import type { ChatToolPart } from "../lib/chat-types";

/**
 * Tool name → localized label key. Unknown tools (a future backend may add
 * some) fall back to a generic "working" row instead of disappearing.
 */
const TOOL_LABEL_KEYS = {
  search_memory: "chat.tools.search_memory",
  remember: "chat.tools.remember",
  search_conversation: "chat.tools.search_conversation",
  get_conversation_insights: "chat.tools.get_conversation_insights",
  list_books: "chat.tools.list_books",
  get_book_overview: "chat.tools.get_book_overview",
  get_annotations: "chat.tools.get_annotations",
  get_toc: "chat.tools.get_toc",
  read_chapter: "chat.tools.read_chapter",
  search_book_text: "chat.tools.search_book_text",
  list_collections: "chat.tools.list_collections",
  get_reading_stats: "chat.tools.get_reading_stats",
  update_book: "chat.tools.update_book",
  manage_collection: "chat.tools.manage_collection",
  delete_book: "chat.tools.delete_book",
  delete_collection: "chat.tools.delete_collection",
  create_annotation: "chat.tools.create_annotation",
  edit_annotation: "chat.tools.edit_annotation",
  delete_annotation: "chat.tools.delete_annotation",
  open_book: "chat.tools.open_book",
  get_recent_turns: "chat.tools.get_recent_turns",
  get_settings: "chat.tools.get_settings",
  update_settings: "chat.tools.update_settings",
} as const;

/**
 * One tool call in the assistant's turn, rendered as a quiet activity row: the
 * same chevron glyph as the thinking disclosure (a spinner while running), a
 * localized label, and the distilled argument (e.g. the search query). Errors
 * stay understated — a plain suffix, no red banner.
 */
export function ChatToolStep({ part }: { part: ChatToolPart }) {
  const { t } = useTranslation("ai");
  const pluginTools = useAtomValue(pluginToolsAtom);
  const contentId = useId();
  // Plugin tools arrive under their wire name; their label lives in the
  // contribution registry, not in the app catalog.
  const pluginTool = part.tool.startsWith("plugin_")
    ? pluginTools.find((tool) => pluginToolName(tool) === part.tool)
    : undefined;
  const known = part.tool as keyof typeof TOOL_LABEL_KEYS;
  const label =
    (pluginTool &&
      (pluginTool.label
        ? contributionText(pluginTool.label)
        : `${pluginTool.pluginName} · ${pluginTool.name}`)) ||
    (TOOL_LABEL_KEYS[known] ? t(TOOL_LABEL_KEYS[known]) : t("chat.tools.fallback"));
  const running = part.state === "running";
  const hasTrace = Boolean(part.input || part.output);
  // Live calls arrive mounted in the running state, so their arguments are
  // visible immediately. Collapse as soon as execution settles; a reader can
  // still reopen the persisted trace on demand.
  const [expanded, setExpanded] = useState(running && hasTrace);
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
          className={cn(
            "shrink-0 text-fg-subtle transition-transform",
            expanded && "rotate-90",
          )}
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
          {running && (
            <Caption className="ra-chat-pulse block text-fg-subtle">
              {t("chat.tools.running")}
            </Caption>
          )}
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
