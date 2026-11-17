/** Public tool families. Members are internal operations, never additional
 * model-callable aliases. Keep unrelated resources and destructive boundaries separate. */
export const TOOL_FAMILIES = [
  {
    name: "query_conversation",
    label: "Read conversation",
    description:
      "Read conversation history: search exact past wording, retrieve recent turns, or inspect a stored summary. A summary is not a verbatim transcript.",
    members: { search: "search_conversation", recent: "get_recent_turns", summary: "get_conversation_insights" },
  },
  {
    name: "query_reading_stats",
    label: "Reading statistics",
    description:
      "Read reading statistics: overview, live settled plus pending time, or historical trends. Choose the view that answers the question.",
    members: { overview: "get_reading_stats", time: "get_reading_time", trends: "get_reading_insights" },
  },
  {
    name: "query_book_text_tasks",
    label: "Text preparation status",
    description: "Inspect current text preparation requests or their persisted history. Does not start extraction.",
    members: { current: "get_book_text_tasks", history: "get_book_text_task_history" },
  },
  {
    name: "manage_book_text_task",
    sequential: true,
    label: "Manage text preparation",
    description:
      "Start or control a text preparation request. A task receipt is not completed text. Rebuild requires explicit user intent; cancellation only releases this request.",
    members: {
      start: "prepare_book_text",
      cancel: "cancel_book_text_task",
      priority: "set_book_text_task_priority",
      pause: "pause_book_text_task",
      resume: "resume_book_text_task",
    },
  },
  {
    name: "reader_panels",
    sequential: true,
    label: "Reader panels",
    description:
      "Inspect reader sidebars, open or close a panel, or resize it. Changes require explicit user intent and the matching active reader.",
    members: { inspect: "get_reader_panels", set: "set_reader_panel", resize: "set_reader_panel_width" },
  },
  {
    name: "model_catalog",
    sequential: true,
    label: "Model catalog",
    description:
      "Query cached provider model metadata, or refresh it on explicit request. Neither action changes the selected model or tests credentials.",
    members: { query: "get_model_catalog", refresh: "refresh_model_catalog" },
  },
  {
    name: "acquire_resource",
    sequential: true,
    label: "Prepare a file",
    description:
      "Obtain a conversation-owned temporary file reference: user-picked file, original book, cover, or approved download. Does not grant arbitrary filesystem access or let book bytes bypass reading privacy.",
    members: {
      pick: "pick_resource_files",
      book: "open_book_resource",
      cover: "open_book_cover",
      download: "download_resource",
    },
  },
  {
    name: "manage_resource",
    sequential: true,
    label: "Use a file",
    description:
      "Save, release, copy an image, or open an existing conversation-owned resource externally. Saving and clipboard/external actions require user intent; release does not delete the original file.",
    members: {
      save: "save_resource",
      release: "release_resource",
      copyImage: "copy_resource_image",
      openExternal: "open_resource_external",
    },
  },
  {
    name: "resource_directory",
    sequential: true,
    label: "File directory",
    description:
      "Pick, list, open a file from, or release a user-approved directory reference. No arbitrary paths; releasing a reference never deletes its files.",
    members: {
      pick: "pick_resource_directory",
      list: "list_resource_directory",
      open: "open_directory_resource",
      release: "release_resource_directory",
    },
  },
  {
    name: "query_book_imports",
    label: "Inspect book imports",
    description:
      "Inspect whether a prepared resource can be parsed as a book, or inspect import task progress. Neither operation imports a book.",
    members: { inspect: "inspect_resource_book", tasks: "get_book_import_tasks" },
  },
  {
    name: "manage_book_import",
    sequential: true,
    label: "Manage book import",
    description:
      "Import an approved resource into the library, or cancel an import request. A queued task is not a completed import; cancellation cannot roll back committed work.",
    members: { start: "import_resource_book", cancel: "cancel_book_import_task" },
  },
  {
    name: "query_durable_jobs",
    label: "Saved task status",
    description: "List saved tasks or inspect one task's progress and receipts.",
    members: { list: "list_durable_jobs", get: "get_durable_job" },
  },
  {
    name: "manage_durable_job",
    sequential: true,
    label: "Manage saved task",
    description:
      "Create an approved saved task plan or control an existing task. Retains the host's authorization, ownership, cancellation and receipt rules.",
    members: { start: "start_durable_job", control: "control_durable_job" },
  },
  {
    name: "query_context_bundles",
    label: "Read context bundles",
    description:
      "List captured context versions or read one exact version. Captures are historical snapshots, not live data.",
    members: { list: "list_context_bundles", read: "read_context_bundle" },
  },
  {
    name: "manage_context_bundle",
    sequential: true,
    label: "Capture or export context",
    description:
      "Capture current permitted context or export a sealed version. Privacy and source validity are rechecked; no arbitrary path or secret export.",
    members: { capture: "capture_context_bundle", export: "export_context_bundle" },
  },
  {
    name: "query_book_references",
    label: "Read book references",
    description:
      "List source references or read a returned reference. Preserve its versioned book location and reading boundary.",
    members: { list: "list_book_references", read: "read_book_reference" },
  },
  {
    name: "control_book_reference",
    sequential: true,
    label: "Show book reference",
    description: "Open or close a reference preview in the current reader on user request.",
    members: { show: "show_book_reference", close: "close_book_reference" },
  },
  {
    name: "reading_action",
    sequential: true,
    label: "Start reading task",
    description:
      "On explicit user intent, start a task in the active book chat: explain, define, translate, or summarize. A started task is not its completed answer. Book-scoped agents instead read the selection/chapter and answer directly.",
    members: {
      explain: "explain_selection",
      define: "define_term",
      translate: "translate_selection",
      summarize: "summarize_chapter",
    },
  },
] as const;
