import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { buildAgentTools } from "../packages/agent/src/tools/registry";
import { createInMemoryDeps } from "../packages/agent/src/testing/fixtures";
import { HOST_CAPABILITY_CATALOG, PLUGIN_PERMISSIONS } from "../packages/core/src/capabilities";
import { HOST_COMMAND_IDS } from "../packages/core/src/host-commands";
import { buildPluginContext } from "../apps/web/src/features/plugins/runtime/plugin-context";
import { buildSettingDefinitions } from "../apps/web/src/domain/settings/catalog";
import { DEFAULT_GENERAL_SETTINGS } from "../apps/web/src/features/settings/lib/general-settings";
import { DEFAULT_AI_PREFERENCES } from "../apps/web/src/features/settings/lib/ai-preferences";
import { DEFAULT_READER_SETTINGS } from "../apps/web/src/features/settings/lib/reader-settings";
import { DEFAULT_CONTENT_TYPOGRAPHY } from "../apps/web/src/features/settings/lib/content-typography";
import { groups, staticSettingPaths, readOnlySettings } from "../docs/host-capability-matrix.data";

const ts = createRequire(new URL("../apps/web/package.json", import.meta.url))("typescript") as typeof import("../apps/web/node_modules/typescript");
const ids = new Set(groups.flatMap(g => g.rows.map(r => r.id)));
export type Inventory = { family: string; name: string; rows: string[]; note: string };
const inventory: Inventory[] = [];
function add(family: string, name: string, rows: string[] | undefined, note = "[代码] 注册库存已映射，不表示产品 E2E 通过") {
  if (!rows?.length || rows.some(id => !ids.has(id))) throw new Error(`Unmapped ${family}: ${name} -> ${rows}`);
  inventory.push({ family, name, rows, note });
}
const words = (s: string) => s.split(/\s+/).filter(Boolean);
function pairs(entries: Array<[string, string]>): Record<string, string[]> {
  return Object.fromEntries(entries.flatMap(([names, rows]) => words(names).map(name => [name, words(rows)])));
}
const agentMap = pairs([
  ["get_conversation_state", "AI01 AI02 AI03"],
  ["manage_conversation", "AI02 AI03"],
  ["request_conversation_turn", "AI03"],
  ["get_sync_status", "OPS01 OPS03 OPS06 OPS07"],
  ["manage_sync", "OPS01 OPS04 OPS06 OPS07"],
  ["list_plugin_schedules manage_plugin_schedule", "MORE01"],
  ["get_software_update", "SYS16"],
  ["verify_local_data", "OPS03 OPS11 SYS15"],
  ["request_diagnostics_report", "SYS15"],
  ["request_backup", "OPS08"],
  ["request_ai_connection_test", "CFG08"],
  ["open_maintenance_settings", "SYS15 SYS16 EXT12 OPS08 OPS09 OPS10 CFG08"],
  ["pick_resource_files", "SYS11"],
  ["download_resource", "SYS06 SYS07 SYS13"],
  ["import_resource_book", "LIB06 SYS11"],
  ["open_book_resource", "LIB08"],
  ["open_book_cover", "LIB09"],
  ["list_book_formats inspect_resource_book", "LIB07"],
  ["get_book_enrichment", "LIB09 LIB10"],
  ["get_book_content_state", "LIB14"],
  ["list_duplicate_books preview_book_merge merge_duplicate_books resolve_book_reference", "LIB11"],
  ["retry_book_enrichment", "LIB10"],
  ["copy_resource_image", "SYS09"],
  ["read_resource_text release_resource", "SYS13"],
  ["save_resource", "SYS10"],
  ["list_installed_plugins", "EXT11"],
  ["list_plugin_contributions", "EXT11 MORE06"],
  ["copy_to_clipboard", "SYS08"],
  ["export_text_file", "SYS10"],
  ["open_external_url", "SYS12"],
  ["classify_book", "MEM09"],
  ["list_books get_book_overview", "LIB01"], ["get_annotations", "ANN01"],
  ["list_collections", "LIB15"], ["get_reading_stats", "STAT01 STAT02"],
  ["get_reading_time", "STAT03"],
  ["get_reading_insights", "STAT02"],
  ["update_book", "LIB02 LIB03 READ19"], ["manage_collection", "LIB16 LIB18"],
  ["delete_book", "LIB04"], ["delete_books", "LIB05"], ["delete_collection", "LIB17"],
  ["list_book_removal_cleanup", "LIB05 LIB13"],
  ["create_annotation", "ANN02 ANN05"], ["edit_annotation", "ANN04 ANN05"],
  ["apply_annotation_changes", "ANN04 ANN05 ANN06 ANN08"],
  ["delete_annotation", "ANN04 ANN05 ANN06"], ["search_memory", "MEM01"], ["remember", "MEM02"],
  ["manage_memory", "MEM01 MEM04 MEM05"],
  ["manage_book_graph", "MEM10"],
  ["search_conversation get_recent_turns", "AI01"], ["get_conversation_insights", "MEM12"],
  ["get_toc", "TXT01"], ["read_chapter", "TXT03"], ["search_book_text", "TXT06"],
  ["get_book_text_status", "TXT04"],
  ["prepare_book_text get_book_text_tasks cancel_book_text_task", "TXT05"],
  ["get_navigation_toc", "TXT02"], ["find_book_locations", "TXT07 TXT13"],
  ["list_book_navigation_targets", "READ05"],
  ["read_book_range", "TXT10 TXT13"],
  ["list_book_references read_book_reference", "TXT11"],
  ["show_book_reference close_book_reference", "TXT11"],
  ["query_book_graph", "MEM11"], ["present_books", "AI05"], ["open_book", "READ01 READ03"],
  ["get_reading_session", "READ07 TXT09 TXT10 READ13 READ16"], ["navigate_reading", "READ02 READ04 READ06 READ16"],
  ["control_read_aloud", "READ18"],
  ["get_host_environment", "MORE03"],
  ["get_host_capabilities", "CON01"],
  ["get_workspace navigate_app", "UI01 UI02"],
  ["list_host_commands execute_host_command", "UI03"],
  ["configure_reading_mode", "READ16"],
  ["set_reader_controls", "READ09"],
  ["set_reading_selection", "READ13"],
  ["manage_reading_emphasis", "READ14"],
  ["get_reader_panels set_reader_panel", "READ10"],
  ["set_reader_panel_width", "READ11"],
  ["focus_reader", "READ11"],
  ["get_app_window control_app_window", "SYS17"],
  ["get_reader_image control_reader_image", "READ12"],
  ["list_book_images open_book_image_resource show_book_image", "TXT12"],
  ["get_user_profile", "MEM06"],
  ["update_user_profile", "MEM07"],
  ["ask_user", "AI04"], ["get_settings update_settings", "CFG01"],
  ["get_setting_options", "SYS14"],
  ["get_model_catalog refresh_model_catalog", "CFG08"],
  ["reset_reading_settings", "CFG03"],
]);
const pluginMap = pairs([
  ["domains.conversations.queries.runtime domains.conversations.events.observeRuntime", "AI02 AI03"],
  ["domains.conversations.queries.getInsights", "MEM12"],
  ["domains.library.events.observeInvalidation domains.conversations.events.observeInvalidation", "OPS05 CON07"],
  ["domains.conversations.commands.createThread domains.conversations.commands.selectThread domains.conversations.commands.clear", "AI02"],
  ["domains.conversations.commands.stop", "AI03"],
  ["domains.conversations.commands.requestTurn domains.conversations.commands.cancelTurnRequest domains.conversations.queries.turnRequests", "AI03"],
  ["services.plugins.list services.plugins.observe", "EXT11"],
  ["services.plugins.contributions services.plugins.observeContributions", "EXT11 MORE06"],
  ["services.ui.openExternal", "SYS12"],
  ["services.ui.window.snapshot services.ui.window.observe services.ui.window.control", "SYS17"],
  ["services.ui.reader.image.snapshot services.ui.reader.image.observe services.ui.reader.image.control", "READ12"],
  ["services.ui.reader.image.open", "TXT12"],
  ["domains.library.queries.books.listImages domains.library.queries.books.openImageResource", "TXT12"],
  ["domains.settings.queries.snapshot domains.settings.queries.discover domains.settings.queries.read domains.settings.commands.update", "CFG01"],
  ["domains.settings.commands.resetReading", "CFG03"],
  ["domains.settings.queries.options", "SYS14"],
  ["domains.settings.queries.modelCatalog domains.settings.commands.refreshModelCatalog", "CFG08"],
  ["services.maintenance.requestConnectionTest", "CFG08"],
  ["domains.settings.events.subscribe domains.settings.queries.observe services.storage.onChange", "CFG10"],
  ["domains.memory.queries.search", "MEM01"],
  ["domains.memory.queries.page", "MEM01"],
  ["domains.memory.queries.profile", "MEM06"],
  ["domains.memory.commands.updateProfile", "MEM07"],
  ["domains.memory.queries.entities domains.memory.commands.decideEntity", "MEM08"],
  ["domains.memory.queries.bookGraph", "MEM11"],
  ["domains.memory.queries.inspect", "MEM01 MEM05"],
  ["domains.memory.commands.mutate", "MEM04 MEM05"],
  ["domains.memory.queries.classification domains.memory.commands.classify", "MEM09"],
  ["domains.memory.queries.getGraphTask domains.memory.queries.listGraphTasks domains.memory.commands.startGraphTask domains.memory.commands.cancelGraphTask domains.memory.commands.retryGraphTask", "MEM10"],
  ["domains.memory.events.observe", "MEM01 MEM04 MEM05 MEM09 MEM10 MEM11"],
  ["domains.library.queries.books.list domains.library.queries.books.get", "LIB01"],
  ["domains.library.queries.books.getToc", "TXT01"], ["domains.library.queries.books.getChapterText", "TXT03"],
  ["domains.library.queries.books.getTextState", "TXT04"],
  ["domains.library.queries.books.listDuplicates domains.library.queries.books.previewMerge domains.library.queries.books.resolveId domains.library.commands.books.mergeDuplicates", "LIB11"],
  ["domains.library.queries.books.getEnrichment domains.library.events.observeEnrichment", "LIB09 LIB10"],
  ["domains.library.queries.books.getContentState domains.library.events.observeContentState", "LIB14"],
  ["domains.library.commands.books.retryEnrichment", "LIB10"],
  ["domains.library.commands.books.prepareText domains.library.commands.books.cancelTextTask domains.library.queries.books.getTextTask domains.library.queries.books.listTextTasks domains.library.events.observeTextTask", "TXT05"],
  ["domains.library.queries.books.getNavigationToc", "TXT02"], ["domains.library.queries.books.searchLocations", "TXT07 TXT13"],
  ["domains.library.queries.books.listNavigationTargets", "READ05"],
  ["domains.library.queries.books.readRange", "TXT10 TXT13"],
  ["domains.library.queries.books.listReferences domains.library.queries.books.readReference", "TXT11"],
  ["services.ui.reader.previewReference services.ui.reader.closeReferencePreview", "TXT11"],
  ["domains.library.queries.books.searchText", "TXT06"],
  ["domains.library.queries.collections.list domains.library.queries.collections.booksIn", "LIB15"],
  ["domains.library.commands.books.importBook", "LIB06"], ["domains.library.commands.books.editMetadata", "LIB02"],
  ["domains.library.commands.books.importResource", "LIB06 SYS11"],
  ["domains.library.queries.books.listFormats domains.library.queries.books.inspectResource", "LIB07"],
  ["domains.library.commands.books.setStarred", "LIB03"], ["domains.library.commands.books.remove", "LIB04"],
  ["domains.library.commands.books.removeMany domains.library.commands.books.retryRemovalCleanup", "LIB05"],
  ["domains.library.queries.books.listRemovalCleanup", "LIB05 LIB13"],
  ["domains.library.commands.books.addVirtualBook", "LIB12"], ["domains.library.commands.books.removeVirtualBook", "LIB13"],
  ["domains.library.commands.books.invalidateVirtualBook", "LIB14"],
  ["domains.library.commands.collections.create domains.library.commands.collections.rename", "LIB16"],
  ["domains.library.commands.collections.remove", "LIB17"], ["domains.library.commands.collections.assignBooks", "LIB18"],
  ["domains.library.events.subscribe domains.reading.events.subscribe domains.conversations.events.subscribe", "CON07"],
  ["domains.annotations.events.subscribe domains.annotations.events.observe", "ANN09"],
  ["domains.reading.queries.stats.forBook domains.reading.queries.stats.list domains.reading.queries.stats.overview", "STAT01"],
  ["domains.reading.queries.stats.time domains.reading.events.observeTime", "STAT03"],
  ["domains.reading.queries.stats.insights", "STAT02"],
  ["domains.reading.commands.setFinished", "READ19"], ["domains.reading.commands.openBook", "READ01"], ["domains.reading.commands.goTo", "READ03"],
  ["domains.reading.queries.session", "READ07 TXT09 TXT10 READ13 READ16"], ["domains.reading.events.observeSession", "READ08 READ13"],
  ["domains.reading.commands.back domains.reading.commands.forward", "READ06"],
  ["domains.reading.commands.step", "READ04"], ["domains.reading.commands.close", "READ02"],
  ["domains.reading.commands.reload", "LIB14"],
  ["domains.reading.commands.controlPlayback", "READ18"],
  ["domains.reading.commands.configureMode", "READ16"],
  ["domains.reading.commands.returnToMode", "READ16"],
  ["domains.reading.commands.stepMode", "READ16"],
  ["domains.reading.commands.setControls", "READ09"],
  ["domains.reading.commands.selectRange domains.reading.commands.clearSelection", "READ13"],
  ["domains.reading.queries.emphasis domains.reading.commands.putEmphasis domains.reading.commands.removeEmphasis domains.reading.events.observeEmphasis", "READ14"],
  ["domains.annotations.queries.list", "ANN01"], ["domains.annotations.commands.createHighlight", "ANN02 ANN03"],
  ["domains.annotations.queries.get domains.annotations.queries.page domains.annotations.queries.inspect", "ANN08"],
  ["domains.annotations.commands.applyChanges", "ANN04 ANN05 ANN06 ANN08"],
  ["domains.annotations.commands.createNote", "ANN05"],
  ["domains.conversations.queries.getBookThread domains.conversations.queries.listThreads domains.conversations.queries.getThread", "AI01"],
  ["services.storage.get services.storage.set services.storage.remove", "SYS01"], ["services.storage.collection", "SYS02"],
  ["services.storage.flush", "SYS01"],
  ["services.storage.observeDocuments", "SYS02 CON07"],
  ["services.storage.applyDocuments", "SYS02"],
  ["services.logging.write services.logging.policy", "SYS15"],
  ["services.llm.policy", "AI07"],
  ["services.llm.askDetailed", "AI07"],
  ["services.llm.getRequest", "AI07"],
  ["services.llm.listRequests", "AI07"],
  ["services.llm.cancelRequest", "AI07"],
  ["services.secrets.get services.secrets.set services.secrets.remove", "SYS04"], ["services.ui.showToast", "EXT07"],
  ["services.ui.exportFile", "SYS10"], ["services.schedules.bind", "MORE01"],
  ["services.ui.publishView", "MORE05"],
  ["services.ui.reader.snapshot services.ui.reader.observe services.ui.reader.setPanel", "READ10"],
  ["services.ui.reader.setWidth", "READ11"],
  ["services.ui.reader.focus", "READ11"],
  ["services.ui.workspace.snapshot services.ui.workspace.observe services.ui.workspace.navigate", "UI01 UI02"],
  ["services.ui.commands.list services.ui.commands.execute services.ui.commands.observe", "UI03"],
  ["services.network.fetch", "SYS06"], ["services.network.policy", "SYS07"], ["services.llm.ask", "AI06"], ["services.clipboard.writeText", "SYS08"],
  ["services.network.openStream", "SYS07"], ["services.network.readStream", "SYS07"], ["services.network.closeStream", "SYS07"],
  ["services.session.environment services.session.observeEnvironment", "MORE03"],
  ["services.sync.snapshot services.sync.observe services.sync.backlog services.sync.requestSync", "OPS01 OPS03"],
  ["services.sync.account", "OPS06 OPS07"],
  ["services.sync.connectionOptions", "OPS01"],
  ["services.sync.requestFlow", "OPS01 OPS06 OPS07"],
  ["services.schedules.list services.schedules.observe services.schedules.control", "MORE01"],
  ["services.maintenance.snapshot services.maintenance.observe services.maintenance.checkForUpdates", "SYS16"],
  ["services.maintenance.openSettings", "SYS15 SYS16 EXT12 OPS08 OPS09 OPS10 CFG08"],
  ["services.maintenance.requestBackup", "OPS08"],
  ["services.diagnostics.verifyProjections", "OPS03 OPS11 SYS15"],
  ["services.diagnostics.requestReport", "SYS15"],
  ["services.resources.pick", "SYS11"],
  ["services.resources.openBook", "LIB08"],
  ["services.resources.openCover", "LIB09"],
  ["services.clipboard.writeImage", "SYS09"],
  ["services.resources.create services.resources.stat services.resources.read services.resources.append services.resources.commit services.resources.release", "SYS13"],
  ["services.resources.save", "SYS10"],
  ["services.sync.openSettings", "OPS01 OPS04 OPS06 OPS07"],
]);
const catalogMap: Record<string, Record<string, string[]>> = {
  domains: { library:["LIB01"], reading:["STAT01","READ01"], annotations:["ANN01"], conversations:["AI01"], settings:["CFG01"], memory:["MEM01","MEM11"] },
  contributions: { selectionActions:["EXT01"], headerActions:["EXT02","MORE04"], contextActions:["MORE04"], commands:["UI03"], settingsOptions:["CFG09"], voiceProviders:["READ17"], contentProviders:["LIB14"], readerModes:["READ15"], agentTools:["AI05","AI10"], agentContextProviders:["AI11"], agentRetrievalProviders:["AI12"], memoryCandidateProviders:["MEM03"], themes:["EXT08"], fonts:["EXT08"], syncTransports:["OPS04"] },
  services: { storage:["SYS01","SYS02"], secrets:["SYS04"], ui:["EXT07","SYS10"], schedules:["MORE01"], session:["MORE03"], plugins:["EXT11"], maintenance:["SYS15","SYS16"], diagnostics:["OPS03","OPS11","SYS15"], logging:["SYS15"], resources:["SYS11","SYS13"], sync:["OPS01"], network:["SYS06"], llm:["AI06"], clipboard:["SYS08"] },
  schemas: { views:["EXT03","EXT04","EXT05","EXT06"], settings:["CFG09"], themes:["EXT08"] },
};
const nativeMap = pairs([
  ["library_stage_import", "LIB06"], ["library_put_cover library_cover_backlog", "LIB09 LIB10"],
  ["library_duplicate_groups library_merge_preview library_merge_commit library_resolve_book", "LIB11"],
  ["append_events commit_events rebuild_projections verify_projections read_events_since list_event_aggregate_ids", "OPS11"],
  ["apply_remote_events stage_remote_events finalize_staged_events", "OPS02 OPS05"],
  ["local_device_get sync_profile_get sync_profile_set sync_profile_touch sync_adopt_account", "OPS01 OPS02"],
  ["sync_outbox_counts sync_book_backlog", "OPS01"],
  ["sync_quota_rejected_blobs sync_requeue_blobs", "OPS01 OPS02"],
  ["sync_unverified_events sync_resolve_events sync_assume_events_missing sync_unverified_blobs sync_resolve_blobs sync_assume_blobs_missing sync_cursor_get sync_cursor_set sync_outbox_events sync_mark_events_pushed sync_mark_events_failed sync_outbox_blobs sync_mark_blobs_pushed sync_mark_blobs_failed sync_mark_blobs_rejected", "OPS02"],
  ["checkpoint_schema_version checkpoint_list checkpoint_maintain checkpoint_prepare_publish checkpoint_mark_published checkpoint_restore_bootstrap sync_backfill_status sync_backfill_events sync_backfill_settle", "OPS03"],
  ["preferences_load_all", "OPS05"], ["wipe_all_data", "OPS09"],
  ["put_blob get_blob get_blob_info get_blob_range delete_blob blob_read_open blob_read_chunk blob_read_close blob_write_open blob_write_chunk blob_write_chunk_raw blob_write_commit blob_write_abort", "SYS13"],
  ["secret_get secret_keys secret_set secret_delete", "SYS04 CFG07"],
  ["load_kv_all set_kv set_kv_batch delete_kv replace_kv_prefix", "SYS01 CFG01 SET04 SET05"],
  ["library_load library_get_book library_put_book", "LIB01 LIB02 OPS11"], ["library_release_book_files", "LIB04 LIB05 LIB13"],
  ["library_list_removal_cleanup", "LIB05 LIB13"],
  ["library_list_collections library_put_collection", "LIB15 LIB16 LIB17 LIB18"], ["library_duplicate_book_groups", "LIB11"],
  ["annotations_list annotations_search annotations_page annotation_get annotation_put annotation_delete", "ANN01 ANN08"],
  ["annotation_inspect annotations_commit", "ANN08"],
  ["memories_list_all memory_get memory_put", "MEM01 MEM02 MEM04"], ["chapter_digests_list", "MEM10 MEM11"],
  ["memory_inspect memory_commit", "MEM01 MEM04 MEM05"],
  ["profile_inspect profile_initialize profile_commit", "MEM06 MEM07 MEM08"],
  ["profile_restore", "MEM07 MEM08 OPS11"],
  ["entity_query entity_commit", "MEM08"],
  ["book_classification_inspect book_classification_commit", "MEM09"],
  ["book_digest_inspect book_digest_commit", "MEM10"],
  ["memories_snapshot memory_maintenance_commit", "MEM02 MEM04 MEM05"],
  ["ai_chat_load ai_chat_load_all ai_chat_list ai_chat_replace ai_chat_clear", "AI01 AI02 AI03"],
  ["plugin_docs_put plugin_docs_get plugin_docs_delete plugin_docs_list plugin_docs_clear vocabulary_migrate_to_plugin_documents", "SYS02 SYS03"],
  ["plugin_docs_snapshot plugin_docs_restore", "SYS03"],
  ["plugin_docs_page plugin_docs_apply", "SYS02"],
  ["reading_time_genesis reading_time_load reading_session_accrue reading_session_position reading_sessions_pending reading_session_flush reading_time_import", "STAT03 STAT04"],
  ["reading_time_snapshot", "STAT03"],
  ["reading_time_scope", "STAT02"],
  ["external_open_take external_open_is_current", "SYS12 SET05"], ["diagnostics_read_logs diagnostics_log_dir", "SYS15"],
  ["book_file_size read_book_head", "LIB06 SYS11"], ["write_export_file", "SYS10"],
  ["android_update_check android_update_install set_status_bar_hidden sync_safe_area set_volume_key_capture app_store_storefront move_task_to_back book_pick_start book_pick_poll", "SYS18"],
  ["resource_open_file", "SYS11"],
  ["resource_open_cover", "LIB09"],
  ["resource_copy_image", "SYS09"],
  ["resource_image_preview", "EXT06"],
  ["resource_open_book", "LIB08"],
  ["resource_create resource_append resource_commit resource_read resource_release", "SYS13"],
  ["resource_save", "SYS10"],
  ["desktop_update_check desktop_update_install", "SYS16"], ["set_traffic_lights_visible", "SYS17"], ["list_system_fonts", "SYS14"],
  ["desktop_startup_enabled", "SET04"],
  ["plugins_list plugins_stage_dir plugins_stage_zip plugins_stage_files plugins_commit_candidate plugins_discard_candidate plugins_rollback plugins_uninstall", "EXT11 EXT12 SYS03"],
]);

function source(path: string) { return ts.createSourceFile(path, readFileSync(path,"utf8"), ts.ScriptTarget.Latest, true, path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS); }
function typeMembers(path: string, name: string): string[] {
  const file = source(path);
  const resolve = (name: string, seen: Set<string>): string[] => {
    if (seen.has(name)) throw new Error(`Recursive inventory type ${name}`);
    const declaration = file.statements.find(s => ts.isTypeAliasDeclaration(s) && s.name.text === name);
    if (!declaration || !ts.isTypeAliasDeclaration(declaration)) throw new Error(`Missing type ${name}`);
    const active = new Set([...seen, name]);
    const members = (node: import("../apps/web/node_modules/typescript").TypeNode): string[] => {
      if (ts.isTypeLiteralNode(node)) return node.members.map(m => m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : "");
      if (ts.isIntersectionTypeNode(node)) return node.types.flatMap(members);
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && !node.typeArguments) return resolve(node.typeName.text, active);
      throw new Error(`Unsupported inventory type ${name}: ${node.getText()}`);
    };
    return [...new Set(members(declaration.type))];
  };
  return resolve(name, new Set());
}
function namedInitializer(path: string, name: string) {
  for (const statement of source(path).statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) return declaration.initializer;
    }
  }
  throw new Error(`Missing declaration ${path}:${name}`);
}
function stringProperties(node: import("../apps/web/node_modules/typescript").Node, key: string): string[] {
  const found: string[] = [];
  function visit(n: typeof node) {
    if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && n.name.text === key && ts.isStringLiteral(n.initializer)) found.push(n.initializer.text);
    ts.forEachChild(n, visit);
  }
  visit(node); return found;
}
function methodPaths(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, entry]) => typeof entry === "function" ? [prefix + key] : entry && typeof entry === "object" && !Array.isArray(entry) ? methodPaths(entry, `${prefix}${key}.`) : []);
}
export function assertUniqueSourceKeys(source = readFileSync(new URL("../docs/host-capability-matrix.data.ts", import.meta.url), "utf8")): void {
  const file = ts.createSourceFile("matrix.ts", source, ts.ScriptTarget.Latest, true);
  let found = false;
  const visit = (node: import("../apps/web/node_modules/typescript").Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "sources") {
      found = true;
      if (!node.initializer || !ts.isObjectLiteralExpression(node.initializer)) throw Error("Expected explicit source map");
      const seen = new Set<string>();
      for (const property of node.initializer.properties) {
        if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) throw Error("Expected static source key");
        const key = property.name.text;
        if (seen.has(key)) throw Error(`Duplicate source key: ${key}`);
        seen.add(key);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) throw Error("Source map missing");
}

export function collectInventory(): Inventory[] {
  assertUniqueSourceKeys();
  inventory.length = 0;
  const { deps } = createInMemoryDeps();
  for (const scope of [{ kind:"global", threadId:"audit" }, { kind:"book", bookId:"audit" }] as const) {
    const tools = buildAgentTools(scope as never, deps);
    for (const tool of tools) add(`Agent ${scope.kind}`, tool.name, agentMap[tool.name]);
  }
  const { context } = buildPluginContext({ id:"coverage-audit", name:"Coverage audit", version:"1.0.0", schemaVersion:1, requires:{}, permissions:[...PLUGIN_PERMISSIONS] }, "0.0.0", []);
  for (const family of ["domains","services","contributions"] as const) {
    for (const path of methodPaths(context[family], `${family}.`)) {
      add("Plugin ctx", path, family === "contributions" ? catalogMap.contributions[path.split(".")[1]] : pluginMap[path]);
    }
  }
  for (const method of typeMembers("packages/plugin-types/src/index.ts", "PluginDocumentCollection")) add("Plugin returned interface", `storage.collection().${method}`, ["SYS02"]);
  for (const method of typeMembers("packages/plugin-types/src/index.ts", "PluginSyncTransportSession")) add("Plugin returned interface", `syncTransport.open().${method}`, ["OPS04"]);
  for (const point of ["commands", "headerActions", "contextActions", "selectionActions", "agentTools"]) {
    for (const method of typeMembers("packages/plugin-types/src/index.ts", "PluginActionRegistration")) {
      add("Plugin returned interface", `contributions.${point}.register().${method}`, ["MORE05"], "[代码] 精确注册句柄；不是按公开 ID 更新其他注册或增加权限");
    }
  }
  for (const [family, catalog] of Object.entries(HOST_CAPABILITY_CATALOG)) for (const key of Object.keys(catalog)) add(`Capability ${family}`, key, catalogMap[family]?.[key]);

  const snapshot = { general:DEFAULT_GENERAL_SETTINGS, shelf:{layout:"grid",group:"none",sort:"recent"}, appearance:{theme:"system",motion:"system"}, reading:DEFAULT_READER_SETTINGS, readerOverrides:{}, contentTypography:DEFAULT_CONTENT_TYPOGRAPHY, defaultMarkColor:"yellow", updateChannel:"stable", aiPreferences:DEFAULT_AI_PREFERENCES, aiConfig:{provider:"custom",model:"test",fastModel:"fast",apiKey:"stub"}, pluginThemes:[], pluginFonts:[], menus:{config:{},plugins:{}}, pluginSettings:{declared:[],values:{}} };
  const settings = buildSettingDefinitions({ ...snapshot, shortcuts: { bindings: {}, commands: [], modeAvailable: false, lookupAvailable: false } } as never);
  if (JSON.stringify(settings.map(s => s.path).sort()) !== JSON.stringify([...staticSettingPaths].sort())) throw new Error("Static settings roster drift");
  for (const setting of settings) {
    if (!!setting.write === readOnlySettings.has(setting.path)) throw new Error(`Setting mutability drift: ${setting.path}`);
    add("Settings path", setting.path, [`SET${String(staticSettingPaths.indexOf(setting.path)+1).padStart(2,"0")}`], setting.write ? "[代码] 目录可读写；实际效果见主表" : "[代码] 只读状态");
  }
  const rust = readFileSync("apps/desktop/src-tauri/src/lib.rs","utf8");
  const block = rust.match(/tauri::generate_handler!\[([\s\S]*?)\]/)?.[1];
  if (!block) throw new Error("Native registration block missing");
  const nativeNames = block.replace(/\/\/[^\n]*/g, "").split(",").map(s=>s.trim()).filter(Boolean);
  for (const qualified of nativeNames) {
    if (!/^(?:[a-z_]+::)*[a-z_]+$/.test(qualified)) throw new Error(`Unexpected native syntax: ${qualified}`);
    const name = qualified.split("::").at(-1)!;
    add("Native command", qualified, nativeMap[name], "[代码] 内部 IPC 能力证据；不是插件或模型授权入口");
  }
  const nativePluginMap = pairs([["single_instance decorum", "SYS17 SYS12"],["autostart", "SET04"],["log", "SYS15"],["updater process", "SYS16"],["dialog fs", "SYS11"],["deep_link opener", "SYS12"],["clipboard_manager", "SYS08 SYS09"],["http", "SYS06"]]);
  for (const name of new Set([...rust.matchAll(/\.plugin\(tauri_plugin_([a-z_]+)::/g)].map(m=>m[1]))) add("Native plugin", name, nativePluginMap[name]);
  add("Native plugin", "log (build_log_plugin)", ["SYS15"]);
  const menuMap = pairs([["core:library core:agent core:stats core:settings", "UI01"],["core:search", "UI03"],["core:import", "LIB06"],["core:viewControl", "UI02"],["core:navigator core:appearance core:chat", "READ10"],["core:copy", "SYS08"],["core:highlight", "ANN02"],["core:underline", "ANN03"],["core:addNote", "ANN05"],["core:askAI", "AI03"]]);
  for (const name of stringProperties(namedInitializer("apps/web/src/features/menus/lib/menu-registry.tsx", "CORE_MENU_ITEMS"),"id")) add("Menu placement", name, menuMap[name]);
  const shortcutMap = pairs([["search settings", "UI03"],["new-conversation", "AI02"],["next-page prev-page next-chapter prev-chapter", "READ04"],["toggle-controls", "READ09"],["reader-mode-next-unit reader-mode-prev-unit", "READ16"],["selection-copy", "SYS08"],["selection-highlight", "ANN02"],["selection-underline", "ANN03"],["selection-add-note", "ANN05"],["selection-look-up", "EXT09"],["selection-ask-ai", "AI03"],["close", "UI01 READ02"],["primary-nav", "UI01"],["reader-mode-volume-keys", "SYS18"]]);
  for (const declaration of ["EDITABLE_SHORTCUTS","INFO_SHORTCUTS"]) for (const name of stringProperties(namedInitializer("apps/web/src/features/settings/lib/shortcuts.ts",declaration),"id")) add("Shortcut", name, shortcutMap[name]);
  const eventMap = pairs([["reader-demand-activity", "TXT05"],["book-removed library-changed book-changed", "CON07 LIB01"],["plugin-storage-changed local-write-failed", "SYS01 CFG10"],["roaming-preferences-changed", "OPS05"],["projections-invalidated", "CON07 OPS05"],["conversations-changed", "AI01 OPS05"]]);
  for (const name of typeMembers("apps/web/src/platform/app-events.ts","AppEventMap")) add("App event", name, eventMap[name]);
  const actionMap = pairs([["importBook", "LIB06"]]);
  for (const name of typeMembers("apps/web/src/features/command/lib/build-commands.tsx","CommandActions")) add("Command action", name, actionMap[name]);
  const hostCommandMap = pairs([
    ["go-shelf go-context go-stats open-settings open-collection", "UI03 UI01"],
    ["select layout-grid layout-list sort-recent sort-added sort-title sort-author sort-progress group-none group-status group-author group-format", "UI03 UI02"],
    ["open-book", "UI03 READ01"],
  ]);
  for (const name of HOST_COMMAND_IDS) add("Host semantic command", name, hostCommandMap[name]);
  const domainMap = pairs([
    ["book.imported", "LIB06"],["book.metadataEdited", "LIB02"],["book.coverExtracted", "LIB09"],
    ["book.chapterDigested", "MEM10"],["book.narrativityClassified", "MEM09"],["book.merged", "LIB11"],
    ["book.starred", "LIB03"],["book.removed", "LIB04"],["collection.created collection.renamed", "LIB16"],
    ["collection.removed", "LIB17"],["book.addedToCollection book.removedFromCollection", "LIB18"],
    ["book.opened", "READ01"],["book.finished", "READ19"],["book.progressed book.timeRecorded book.sessionRecorded", "STAT04 STAT05"],
    ["highlight.created", "ANN02 ANN03"],["highlight.recolored highlight.removed", "ANN04"],
    ["note.created note.updated note.removed", "ANN05"],["ask.recorded ask.removed", "ANN06 ANN07"],
    ["aiConversation.started aiMessage.appended aiMessage.removed aiConversation.cleared", "AI01 AI02 AI03"],
    ["profile.updated entity.resolved entity.merged", "MEM08"],["memory.promoted", "MEM02 MEM03"],
    ["memory.revised memory.superseded memory.forgotten", "MEM04"],["memory.feedback", "MEM05"],["preference.changed", "OPS05 CFG01"],
  ]);
  function visitEvent(node: import("../apps/web/node_modules/typescript").Node) {
    if (ts.isTypeReferenceNode(node) && node.typeName.getText() === "DomainEventEnvelope") {
      const argument = node.typeArguments?.[0];
      if (argument && ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) add("Canonical event", argument.literal.text, domainMap[argument.literal.text]);
    }
    ts.forEachChild(node, visitEvent);
  }
  visitEvent(source("packages/core/src/events.ts"));
  for (const roster of ["LIBRARY_EVENTS","READING_EVENTS","ANNOTATION_EVENTS","CONVERSATION_EVENTS"]) {
    function visitString(node: import("../apps/web/node_modules/typescript").Node) {
      if (ts.isStringLiteral(node)) add(`Domain subscription ${roster}`,node.text,domainMap[node.text]);
      ts.forEachChild(node,visitString);
    }
    visitString(roster === "READING_EVENTS"
      ? namedInitializer("packages/core/src/reading-events.ts", "READING_DOMAIN_EVENT_TYPES")
      : namedInitializer("apps/web/src/domain/events.ts",roster));
  }
  const featureMap = pairs([["agent ai", "AI01 AI03 MEM01"],["annotations", "ANN01"],["command", "UI03"],["library shelf", "LIB01 UI02"],["menus", "UI05"],["navigation", "UI01 SYS17"],["plugins", "EXT01 CON03"],["reader", "READ01 TXT01"],["settings", "CFG01 OPS08"],["stats", "STAT01"],["sync", "OPS01"],["update", "SYS16"]]);
  for (const directory of readdirSync("apps/web/src/features", {withFileTypes:true}).filter(d=>d.isDirectory())) add("Feature owner", directory.name, featureMap[directory.name], "[代码+人工审计] 所属功能组入口；目录覆盖不等于每个 UI 分支测试通过");
  const expectedPlugins = pairs([["memory-desk", "MEM01 MEM04 MEM05 MEM09 MEM10 MEM11 READ01 EXT02 EXT05"],["dictionary", "EXT09 AI12 READ07 LIB01"],["rss-reader", "EXT10"],["editorial-themes", "EXT08"],["sentence-reader", "READ15 READ16"],["tts", "READ17 READ18"],["webdav-sync", "OPS04"],["jumper", "TXT02 TXT07 READ06 EXT02"],["annotation-desk", "ANN01 ANN04 ANN05 ANN08 ANN09 EXT02 EXT05 SYS10"],["listening-desk", "READ16 READ18 READ06 EXT02 MORE03"],["reading-goals", "AI11 MEM03 SET23 STAT02 STAT05 STAT03 EXT07 EXT02 EXT05 SYS01"],["workspace-profiles", "UI02 UI04 CFG01 CFG10 EXT02 EXT05 SYS02"],["text-desk", "TXT04 TXT05 TXT06 TXT07 TXT10 TXT11 TXT12 TXT13 LIB01 READ01 READ13 EXT01 EXT02 EXT05 EXT06 SYS09 SYS13"],["library-desk", "LIB01 LIB02 LIB03 LIB05 LIB06 LIB07 LIB08 LIB09 LIB10 LIB11 LIB15 LIB16 LIB17 LIB18 READ01 UI01 UI02 UI03 EXT02 EXT03 EXT05 EXT06 SYS09 SYS11 SYS13 MORE05"]]);
  expectedPlugins["maintenance-desk"] = ["CFG08", "SYS15", "OPS03", "OPS08", "OPS11", "EXT02", "EXT05"];
  expectedPlugins["reading-goals"].push("SYS02");
  expectedPlugins["jumper"] = ["TXT02", "TXT07", "READ01", "READ06", "READ07", "READ13", "EXT02", "SYS02", "AI05"];
  for (const directory of readdirSync("plugins",{withFileTypes:true}).filter(d=>d.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))) {
    const manifest = JSON.parse(readFileSync(`plugins/${directory.name}/manifest.json`,"utf8"));
    add("First-party source plugin", manifest.id, expectedPlugins[directory.name], `[代码] 源码版本 ${manifest.version}；源码存在不等于打包、安装、启用或模型可调用`);
    for (const field of manifest.settings ?? []) add("Plugin setting declaration", `plugins.${manifest.id}.${field.id}`, [field.kind === "secret" || field.inputMode === "password" ? "SYS04" : "CFG09"], `${field.kind}；${field.kind === "secret" || field.inputMode === "password" ? "不进入 Agent/普通 settings catalog" : "非敏感配置；字段存在不等于其功能有 Agent 工具"}`);
    for (const file of readdirSync(`plugins/${directory.name}/src`,{recursive:true}).filter(name=>/\.(ts|tsx)$/.test(String(name)) && !/\.test\./.test(String(name)))) {
      function visitRegistration(node: import("../apps/web/node_modules/typescript").Node) {
        if (ts.isCallExpression(node) && /\.contributions\.(agentTools|agentRetrievalProviders)\.register$/.test(node.expression.getText())) {
          const retrieval = node.expression.getText().includes("agentRetrievalProviders");
          const names = stringProperties(node.arguments[0], retrieval ? "id" : "name");
          if (names.length !== 1) throw new Error(`Dynamic Agent contribution needs manual audit: ${file}`);
          const wireName = `plugin_${manifest.id.replace(/[^a-zA-Z0-9_]/g,"_")}_${retrieval ? "retrieve_" : ""}${names[0].replace(/[^a-zA-Z0-9_]/g,"_")}`;
          add("Plugin Agent contribution",wireName,expectedPlugins[directory.name], `[代码] ${["rss-reader", "jumper"].includes(manifest.id) ? "仅 global" : "global/book"}；插件启用后才进入工具集；来源 plugins/${directory.name}/src/${file}`);
        }
        ts.forEachChild(node,visitRegistration);
      }
      visitRegistration(source(`plugins/${directory.name}/src/${file}`));
    }
  }
  const bundled = readFileSync("apps/desktop/src-tauri/src/plugins.rs", "utf8").match(/static BUNDLED:.*?=\s*&\[([\s\S]*?)\];/);
  if (!bundled) throw new Error("Native bundled plugin table needs audit");
  const bundledEntries = [...bundled[1].matchAll(/\("([^"]+)",\s*&([A-Z_]+)\)/g)];
  if (!bundledEntries.length) throw new Error("Empty native bundled plugin inventory");
  for (const [, id] of bundledEntries) add("Native bundled plugin", id, expectedPlugins[id], "[代码] Rust BUNDLED 编译内置清单；不是用户当前安装/启用状态");
  const assertRoster = (family:string, expected:string[]) => {
    const actual = new Set(inventory.filter(row=>row.family===family).map(row=>row.name.split("::").at(-1)!));
    const stale = expected.filter(name=>!actual.has(name));
    if (stale.length) throw new Error(`Stale ${family} mappings: ${stale}`);
  };
  assertRoster("Agent global",Object.keys(agentMap));
  assertRoster("Native command",Object.keys(nativeMap));
  assertRoster("Plugin ctx",Object.keys(pluginMap));
  return inventory;
}
