import { useAtomValue } from "jotai";
import { useTranslation } from "../../../i18n";
import { contributionText } from "../../plugins/lib/plugin-i18n";
import { pluginToolName } from "../../plugins/runtime/plugin-tools";
import { pluginToolsAtom } from "../../plugins/state/plugin-store";

/**
 * Tool name → localized label key. Unknown tools (a future backend may add
 * some) fall back to a generic "working" row instead of disappearing.
 */
const TOOL_LABEL_KEYS = {
  query_conversation: "chat.tools.query_conversation",
  query_reading_stats: "chat.tools.query_reading_stats",
  query_book_text_tasks: "chat.tools.query_book_text_tasks",
  manage_book_text_task: "chat.tools.manage_book_text_task",
  reader_panels: "chat.tools.reader_panels",
  model_catalog: "chat.tools.model_catalog",
  acquire_resource: "chat.tools.acquire_resource",
  manage_resource: "chat.tools.manage_resource",
  resource_directory: "chat.tools.resource_directory",
  query_book_imports: "chat.tools.query_book_imports",
  manage_book_import: "chat.tools.manage_book_import",
  query_durable_jobs: "chat.tools.query_durable_jobs",
  manage_durable_job: "chat.tools.manage_durable_job",
  query_context_bundles: "chat.tools.query_context_bundles",
  manage_context_bundle: "chat.tools.manage_context_bundle",
  query_book_references: "chat.tools.query_book_references",
  control_book_reference: "chat.tools.control_book_reference",
  reading_action: "chat.tools.reading_action",
  apply_annotation_changes: "chat.tools.apply_annotation_changes",

  web_search: "chat.tools.web_search",
  web_fetch: "chat.tools.web_fetch",
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
  get_reading_time: "chat.tools.get_reading_time",
  get_reading_insights: "chat.tools.get_reading_insights",
  get_workspace: "chat.tools.get_workspace",
  navigate_app: "chat.tools.navigate_app",
  update_book: "chat.tools.update_book",
  manage_collection: "chat.tools.manage_collection",
  delete_book: "chat.tools.delete_book",
  delete_books: "chat.tools.delete_books",
  list_book_removal_cleanup: "chat.tools.list_book_removal_cleanup",
  delete_collection: "chat.tools.delete_collection",
  create_annotation: "chat.tools.create_annotation",
  edit_annotation: "chat.tools.edit_annotation",
  delete_annotation: "chat.tools.delete_annotation",
  list_bookmarks: "chat.tools.list_bookmarks",
  save_bookmark: "chat.tools.save_bookmark",
  manage_bookmark: "chat.tools.manage_bookmark",
  open_book: "chat.tools.open_book",
  get_recent_turns: "chat.tools.get_recent_turns",
  get_settings: "chat.tools.get_settings",
  update_settings: "chat.tools.update_settings",
} as const;

/** Shared labels keep the activity summary and individual calls consistent. */
export function useChatToolLabel(name?: string) {
  const { t } = useTranslation("ai");
  const pluginTools = useAtomValue(pluginToolsAtom);
  const pluginTool = name?.startsWith("plugin_")
    ? pluginTools.find((tool) => pluginToolName(tool) === name)
    : undefined;
  const known = name as keyof typeof TOOL_LABEL_KEYS;
  return (
    (pluginTool &&
      (pluginTool.label ? contributionText(pluginTool.label) : `${pluginTool.pluginName} · ${pluginTool.name}`)) ||
    (TOOL_LABEL_KEYS[known] ? t(TOOL_LABEL_KEYS[known]) : t("chat.tools.fallback"))
  );
}
