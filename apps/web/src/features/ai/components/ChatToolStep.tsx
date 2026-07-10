import { CaretRight } from "@phosphor-icons/react";
import { Caption, Spinner } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
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
  get_vocabulary: "chat.tools.get_vocabulary",
  lookup_word: "chat.tools.lookup_word",
} as const;

/**
 * One tool call in the assistant's turn, rendered as a quiet activity row: the
 * same chevron glyph as the thinking disclosure (a spinner while running), a
 * localized label, and the distilled argument (e.g. the search query). Errors
 * stay understated — a plain suffix, no red banner.
 */
export function ChatToolStep({ part }: { part: ChatToolPart }) {
  const { t } = useTranslation("ai");
  const known = part.tool as keyof typeof TOOL_LABEL_KEYS;
  const label = TOOL_LABEL_KEYS[known] ? t(TOOL_LABEL_KEYS[known]) : t("chat.tools.fallback");
  const running = part.state === "running";

  return (
    <div className="flex min-w-0 items-center gap-1">
      {running ? (
        <Spinner size="sm" className="mx-0.5 h-3 w-3 shrink-0" />
      ) : (
        <CaretRight size={12} className="shrink-0 text-fg-subtle" aria-hidden="true" />
      )}
      <Caption className={cn("truncate", running ? "text-fg-muted" : "text-fg-subtle")}>
        {label}
        {part.detail ? ` · ${part.detail}` : null}
        {part.state === "error" ? ` — ${t("chat.tools.failed")}` : null}
      </Caption>
    </div>
  );
}
