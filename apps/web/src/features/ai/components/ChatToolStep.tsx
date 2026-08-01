import { CaretRight } from "@phosphor-icons/react";
import { Caption, Spinner } from "@read-aware/ui";
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
  edit_book_metadata: "chat.tools.edit_book_metadata",
  set_book_starred: "chat.tools.set_book_starred",
  set_book_finished: "chat.tools.set_book_finished",
  create_collection: "chat.tools.create_collection",
  rename_collection: "chat.tools.rename_collection",
  assign_books_to_collection: "chat.tools.assign_books_to_collection",
  delete_book: "chat.tools.delete_book",
  delete_collection: "chat.tools.delete_collection",
  create_note: "chat.tools.create_note",
  update_note: "chat.tools.update_note",
  create_highlight: "chat.tools.create_highlight",
  recolor_highlight: "chat.tools.recolor_highlight",
  delete_annotation: "chat.tools.delete_annotation",
  open_book: "chat.tools.open_book",
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
