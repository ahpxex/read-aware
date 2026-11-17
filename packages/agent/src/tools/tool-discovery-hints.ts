/**
 * What discovery knows about a tool beyond its own text.
 *
 * `keywords` are the words a reader's request uses that the tool's name, label
 * and description do not ("favorite" for a tool that says "star"). `companions`
 * are tools the task cannot be finished without (a preview before its commit, a
 * list that yields the ids an action takes); they load together so one
 * discovery is enough. Keep both short: a keyword on many tools stops meaning
 * anything, and every companion costs a schema.
 */
export interface ToolDiscoveryHint {
  keywords?: readonly string[];
  companions?: readonly string[];
}

export const TOOL_DISCOVERY_HINTS: Readonly<Record<string, ToolDiscoveryHint>> = {
  // Shelf
  update_book: {
    keywords: ["favorite", "favourite", "unstar", "rename", "retitle", "mark finished", "unread", "several books"],
  },
  delete_book: { keywords: ["remove", "shelf", "trash"] },
  delete_books: { keywords: ["remove", "shelf", "trash", "bulk", "several", "many"] },
  list_book_removal_cleanup: { keywords: ["leftover", "orphan", "disk space"] },
  list_collections: { keywords: ["folder", "group", "category", "shelf"] },
  manage_collection: {
    keywords: ["folder", "group", "organize", "move", "category"],
    companions: ["list_collections"],
  },
  delete_collection: { keywords: ["folder", "group", "remove"], companions: ["list_collections"] },
  check_book_files: {
    keywords: [
      "missing",
      "exists",
      "lost",
      "gone",
      "broken",
      "placeholder",
      "fake",
      "ghost",
      "cannot open",
      "downloaded",
      "local",
      "cloud",
      "source",
      "storage",
    ],
  },
  get_book_content_state: { keywords: ["revision", "changed", "source"] },
  get_book_enrichment: { keywords: ["cover", "metadata", "thumbnail"] },
  retry_book_enrichment: { keywords: ["cover", "metadata", "refresh"], companions: ["get_book_enrichment"] },
  list_duplicate_books: {
    keywords: ["duplicate", "copies", "same file", "dedupe"],
    companions: ["preview_book_merge"],
  },
  preview_book_merge: { keywords: ["duplicate", "combine"], companions: ["list_duplicate_books"] },
  merge_duplicate_books: {
    keywords: ["duplicate", "combine", "dedupe"],
    companions: ["list_duplicate_books", "preview_book_merge"],
  },
  query_book_imports: { keywords: ["add book", "upload"] },
  manage_book_import: {
    keywords: ["add book", "upload", "import file"],
    companions: ["acquire_resource", "query_book_imports"],
  },
  list_book_formats: { keywords: ["supported", "epub", "pdf", "mobi"] },

  // Reading statistics and state
  query_reading_stats: {
    keywords: ["statistics", "duration", "hours", "minutes", "streak", "history", "how long", "time spent"],
  },
  get_reading_session: { keywords: ["position", "cursor", "selection", "current page", "where am"] },
  get_book_text_status: { keywords: ["extraction", "indexed", "prepared"] },
  manage_book_text_task: {
    keywords: ["extract", "index", "prepare text", "rebuild"],
    companions: ["get_book_text_status", "query_book_text_tasks"],
  },

  // Annotations and bookmarks
  create_annotation: {
    keywords: ["highlight", "note", "underline", "mark passage", "annotate"],
    companions: ["get_reading_session", "find_book_locations"],
  },
  apply_annotation_changes: { keywords: ["edit note", "recolor", "change highlight", "annotate"] },
  delete_annotation: { keywords: ["remove highlight", "remove note"] },
  list_bookmarks: { keywords: ["saved place", "saved position"] },
  save_bookmark: { keywords: ["remember place", "save position"] },
  manage_bookmark: { keywords: ["saved place", "jump"], companions: ["list_bookmarks"] },
  manage_reading_emphasis: { keywords: ["temporary highlight", "point out"], companions: ["find_book_locations"] },
  set_reading_selection: { keywords: ["select text"], companions: ["find_book_locations"] },

  // Book content beyond the core reading tools
  find_book_locations: { keywords: ["locate", "exact text", "range", "where"] },
  read_book_range: { keywords: ["passage", "excerpt"], companions: ["find_book_locations"] },
  list_book_navigation_targets: { keywords: ["page list", "landmarks", "toc"] },
  list_book_images: { keywords: ["picture", "figure", "illustration", "photo"] },
  show_book_image: { keywords: ["picture", "figure", "display"], companions: ["list_book_images"] },
  read_book_image: { keywords: ["picture", "figure", "look at", "describe"], companions: ["list_book_images"] },
  open_book_image_resource: { keywords: ["picture", "export image"], companions: ["list_book_images"] },
  query_book_references: { keywords: ["footnote", "endnote", "citation"] },
  control_book_reference: { keywords: ["footnote", "endnote"], companions: ["query_book_references"] },
  manage_book_graph: { keywords: ["characters", "knowledge graph", "relationships", "digest"] },

  // Reader
  navigate_reading: { keywords: ["next page", "previous page", "turn page", "go back", "close book", "chapter"] },
  control_read_aloud: { keywords: ["tts", "speech", "voice", "listen", "narrate", "audio"] },
  configure_reading_mode: { keywords: ["sentence mode", "focus mode", "scroll", "paged"] },
  reader_panels: { keywords: ["sidebar", "toc panel", "notes panel"] },
  focus_reader: { keywords: ["keyboard focus"] },
  reading_action: { keywords: ["explain", "define", "translate", "summarize"] },
  reset_reading_settings: { keywords: ["defaults", "restore", "font", "theme"] },

  // Memory and profile
  manage_memory: { keywords: ["forget", "correct", "pin", "delete memory"] },
  inspect_user_profile: { keywords: ["generated profile", "what you know about me"] },
  update_user_profile: { keywords: ["about me", "edit profile"] },
  query_entities: { keywords: ["people", "characters", "authors", "identity"] },
  manage_entity: { keywords: ["alias", "merge people", "rename person"], companions: ["query_entities"] },
  query_context_bundles: { keywords: ["snapshot", "context export"] },
  manage_context_bundle: { keywords: ["snapshot", "context export"], companions: ["query_context_bundles"] },

  // Conversation
  manage_conversation: { keywords: ["clear chat", "new thread", "rename chat", "history"] },
  request_conversation_turn: { keywords: ["send message", "ask in book chat"] },
  ask_user_form: { keywords: ["several questions", "inputs"] },

  // Files and resources
  acquire_resource: { keywords: ["pick file", "choose file", "upload", "download", "original file", "cover image"] },
  manage_resource: {
    keywords: ["save file", "export book", "copy image", "open with"],
    companions: ["acquire_resource"],
  },
  resource_directory: { keywords: ["folder", "directory", "browse"] },
  read_resource_text: { keywords: ["read file", "open document"], companions: ["acquire_resource"] },
  export_text_file: { keywords: ["save", "download", "markdown", "notes file", "txt"] },
  copy_to_clipboard: { keywords: ["copy", "paste"] },
  open_external_url: { keywords: ["browser", "link", "website"] },

  // App surface
  get_workspace: { keywords: ["current screen", "selected books", "what is open"] },
  navigate_app: {
    keywords: ["go to", "open settings", "shelf", "statistics page", "notes page"],
    companions: ["get_workspace"],
  },
  list_host_commands: { keywords: ["menu", "sort", "layout", "grid", "list view"] },
  execute_host_command: { keywords: ["menu", "sort shelf", "layout", "group by"], companions: ["list_host_commands"] },
  get_app_window: { keywords: ["fullscreen", "maximized"] },
  control_app_window: { keywords: ["fullscreen", "minimize", "maximize"], companions: ["get_app_window"] },
  get_host_environment: { keywords: ["platform", "version", "operating system", "date", "timezone"] },

  // Sync, data and maintenance
  get_sync_status: { keywords: ["cloud", "devices", "last synced", "quota"] },
  manage_sync: {
    keywords: ["cloud", "sign in", "log in", "sync now", "subscription", "upgrade"],
    companions: ["get_sync_status"],
  },
  request_backup: { keywords: ["export data", "restore", "archive", "import backup"] },
  verify_local_data: { keywords: ["integrity", "corrupt", "check database"] },
  request_projection_repair: { keywords: ["rebuild", "fix data", "corrupt"], companions: ["verify_local_data"] },
  request_diagnostics_report: { keywords: ["logs", "bug report", "feedback"] },
  request_ai_connection_test: { keywords: ["api key", "provider", "model not working"] },
  get_software_update: { keywords: ["new version", "upgrade app", "changelog"] },
  open_maintenance_settings: { keywords: ["data settings", "about"] },
  model_catalog: { keywords: ["available models", "provider models", "llm"] },

  // Plugins and saved work
  list_installed_plugins: { keywords: ["extensions", "addons"] },
  list_plugin_contributions: { keywords: ["extensions", "plugin features"] },
  list_plugin_services: { keywords: ["plugin api"] },
  call_plugin_service: { keywords: ["plugin api"], companions: ["list_plugin_services"] },
  list_plugin_schedules: { keywords: ["scheduled", "recurring", "automation"] },
  manage_plugin_schedule: { keywords: ["scheduled", "recurring", "run now"], companions: ["list_plugin_schedules"] },
  preview_atomic_transaction: {
    keywords: ["bulk edit", "batch", "several books", "rename many", "undoable"],
    companions: ["commit_atomic_transaction", "get_transaction_receipt"],
  },
  commit_atomic_transaction: { companions: ["preview_atomic_transaction", "get_transaction_receipt"] },
  preview_transaction_undo: { keywords: ["undo", "revert", "roll back"], companions: ["commit_atomic_transaction"] },
  query_durable_jobs: { keywords: ["background task", "long running", "progress"] },
  manage_durable_job: {
    keywords: ["background task", "long running", "resume later"],
    companions: ["query_durable_jobs"],
  },
  open_change_cursor: { keywords: ["what changed", "recent changes", "activity"], companions: ["read_changes"] },
  read_changes: { keywords: ["what changed", "recent changes"], companions: ["open_change_cursor"] },
};
