-- ReadAware 目标 SQLite schema。这个文件来自一次全项目持久化扫描，目标是替代当前分散在 IndexedDB/localStorage 里的状态。
-- 本文件是 schema 的唯一权威来源（single source of truth）。docs/data-model.md 只做概念说明，事件目录以 packages/core/src/events.ts 为准。
-- 设计原则：SQLite 保存结构化事实、设备本地配置、同步状态、blob 清单和 AI 记忆（检索走 FTS + 结构化信号）。
-- 向量索引不在默认架构里（2026-07-02 决策，见 docs/agent-architecture.md §4）；vector_documents/embedding_jobs 仅作可选后路的休眠预留。
-- 设计原则：domain_events 是跨设备同步的唯一权威日志；books/highlights/notes/memories/context_bundles 等表都是本机可重放 projection。
-- 设计原则：API key、E2E 私钥等秘密不进入 SQLite，只在系统 Keychain / Secure Storage 中保存，SQLite 只保存 keychain 引用。
--
-- 表分类（每张表的开头注释都标了类别 tag）：
--   [synced log]   跨设备同步的 append-only 事件日志，唯一权威事实源（domain_events）。
--   [projection]   可从事件日志确定性重放重建的读模型；不持有独立权威状态。
--   [device-local] 设备本地权威配置/同步运行状态；不进事件日志、默认不同步、也不能从事件重建。
--   [local index]  从 SQLite 内容派生、可丢弃重建的本地索引/缓存。
--
-- 重建契约（important）：projection 重建走 **按稳定 id 的 UPSERT/merge**，而不是 “DROP/DELETE 全表再重插”。
--   原因：device-local 表（reader_book_overrides、reader_panel_layouts、blob_sync_state 等）保存的是事件日志里没有的本地事实，
--   一旦用 DELETE+CASCADE 方式重建 projection，会把这些非派生状态一起级联删掉。因此重建只作用于 [projection] 表，
--   且不触碰 [device-local]/[local index] 表；下面也已把会跨类别误删的外键解耦（见 reader_book_overrides / reader_panel_layouts）。
--
-- 实施现状（implementation status，2026-07 更新）：同步地基已在桌面端落地。桌面 SQLite（apps/desktop/src-tauri/src/storage.rs）
--   的迁移 v3 已实现本文件的同步核心：domain_events（完整 envelope）+ event_sync_state/blob_sync_state 两个 outbox +
--   blob_objects 注册表；blob bytes 已迁出 SQLite 落在 <app_data>/blobs/ 文件系统；连接基线开 WAL；local_device 设备身份已生成。
--   前端在 library/annotations/阅读时长各持久化 seam 上**双写事件**（先事件后投影），启动时的 genesis 对账
--   （apps/web/src/platform/event-genesis.ts）会为日志从未见过的投影行补合成创建事件（前事件时代数据、旧备份恢复）。
--   迁移 v4 落地 annotations_fts 全文索引（CJK bigram 预切分，见该表注释），标注搜索已走 FTS。
--   尚未落地：投影 replay/rebuild 管线、规范化投影表（现行读模型仍是迁移 v2 的非规范化 books/annotations）、
--   memory/entity/vector/context 子系统（user_profile、entities、entity_aliases、memories、memory_evidence、working_memory、
--   context_bundles、context_bundle_items、vector_documents、embedding_jobs）以及 sync_* 远端中继表——它们目前都还没有生产者，
--   等 consolidation/同步管线落地时再启用。
--
-- 当前持久化来源：read-aware-library IndexedDB 的 books/files/collections 迁移到 books/blob_objects/collections/book_collection_memberships。
-- 当前持久化来源：read-aware-annotations IndexedDB 的 highlights/notes 迁移到 highlights/notes，并由 domain_events 重放生成。
-- 当前持久化来源：read-aware-fonts IndexedDB 的字体 ArrayBuffer 迁移到 cached_font_faces + blob_objects；它是可删除缓存，不参与同步。
-- 当前持久化来源：read-aware-conversations localStorage 迁移到 ai_conversations/ai_messages/ai_message_attachments。
-- 当前持久化来源：read-aware-reading-stats localStorage 迁移到 reading_time_totals/reading_time_daily/reading_time_hourly，可由 reading.timeRecorded 事件重建。
-- 当前持久化来源：read-aware-reader-settings/read-aware-app-settings/read-aware-general-settings/read-aware-ai-preferences/read-aware-shelf-view/read-aware-shortcuts 等配置迁移到 settings/app_kv/shortcut_bindings 等设备本地表。
-- 当前持久化来源：read-aware-ai-config 中的明文 apiKey 不迁移进 SQLite；provider/model/customBaseUrl 迁移到 ai_provider_configs，apiKey 迁移到系统 Keychain。
-- 不进入桌面数据库：apps/landing 的 loops-form-timestamp 只是营销站点的浏览器节流状态，不属于 ReadAware 桌面本地数据模型。

-- 连接基线（每条新建连接的 open hook 都必须重新执行，均不持久化在数据库文件里；实现见 storage.rs 的 apply_connection_pragmas）：
--   PRAGMA journal_mode = WAL;     -- 读不阻塞写；大事务不再通过 rollback journal 双倍写盘。WAL 模式本身持久化，但仍每次显式设置。
--   PRAGMA synchronous = NORMAL;   -- WAL 下的安全档位（checkpoint 时落盘）。
--   PRAGMA busy_timeout = 5000;    -- 第二个进程或 checkpoint 短暂持锁时等待而不是直接 SQLITE_BUSY。
--   PRAGMA foreign_keys = ON;      -- per-connection 开关；不设则本文件所有 ON DELETE CASCADE / SET NULL / DEFERRABLE 静默失效。
-- 下面这行只对执行迁移的那条连接生效，因此主要是文档性质。
PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations ( -- [device-local] 记录本地 SQLite schema 已应用的迁移，Tauri 启动时用它判断是否需要升级数据库结构。
  version INTEGER NOT NULL PRIMARY KEY, -- 递增迁移版本号；每个 migration 文件或内置迁移对应一行，避免重复执行。
  name TEXT NOT NULL, -- 人类可读的迁移名称，比如 "create_local_first_core_tables"，方便排查用户数据库版本。
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) -- 本机完成该迁移的 UTC 时间，用于诊断升级顺序和失败恢复。
); -- schema_migrations 表结束。

CREATE TABLE local_device ( -- [device-local] 当前安装实例的设备身份；HLC、同步去重、E2E 设备信任都依赖这个稳定 device_id。
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1), -- 单行表固定为 1；ReadAware 桌面单用户单实例，不需要多行设备记录。
  device_id TEXT NOT NULL UNIQUE, -- 这个本机安装生成的稳定设备 ID，用在 domain_events.hlc_device 里作为最终排序和去重维度。
  display_name TEXT, -- Data & Sync 未来的设备管理界面里显示的设备名称，例如 "Xuan's MacBook Pro"。
  created_at TEXT NOT NULL, -- 这个本地数据仓库首次初始化的时间，用于新设备 bootstrap 和问题诊断。
  last_opened_at TEXT NOT NULL -- 最近一次打开 ReadAware 的时间，用于本机健康状态、备份提示和同步新鲜度展示。
); -- local_device 表结束。

CREATE TABLE sync_profile ( -- [device-local] 设备连接远端 encrypted relay 的本地状态；远端不是业务事实源，只保存密文事件和 blob。尚无生产者（云服务未做）。
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1), -- 单行表固定为 1；当前产品方向是一位本地用户对应一个同步身份。
  sync_enabled INTEGER NOT NULL DEFAULT 0, -- 在 Data & Sync 页面 Account 连接后置为 1；为 0 时所有数据仍完全本地可用。
  remote_account_id TEXT, -- 远端 relay 的账号 ID；只用于认证和变更流定位，不参与本地业务逻辑。
  encryption_key_ref TEXT, -- 系统 Keychain 中 E2E 主密钥或包裹密钥的引用；SQLite 不保存真实密钥材料。
  last_push_at TEXT, -- 最近一次把本机新增 domain_events/blob 上传到 relay 的时间，用于同步状态提示。
  last_pull_at TEXT, -- 最近一次从 relay 拉取其他设备事件的时间，用于判断本机是否落后。
  updated_at TEXT NOT NULL -- 本行最后变化时间；连接、断开、换密钥、同步失败状态都会更新它。
); -- sync_profile 表结束。

CREATE TABLE sync_devices ( -- [device-local] 已知同步设备清单；用于 E2E 信任、设备撤销、冲突排查和 Data & Sync 设备列表。尚无生产者。
  device_id TEXT NOT NULL PRIMARY KEY, -- 其他设备或本机的稳定设备 ID，必须和事件日志里的 hlc_device 对得上。
  display_name TEXT, -- 设备列表里显示的名称；可能来自远端设备自报，也可能由用户手动改名。
  public_key TEXT, -- 该设备用于 E2E 加密会话的公钥；真实私钥仍只在该设备 Keychain 中。
  trusted INTEGER NOT NULL DEFAULT 0, -- 用户是否信任这个设备参与解密和同步；撤销设备时置为 0。
  first_seen_at TEXT NOT NULL, -- 第一次在同步流或本机初始化中见到该设备的时间。
  last_seen_at TEXT -- 最近一次看到该设备产生事件或心跳的时间，用于提示长期离线设备。
); -- sync_devices 表结束。

CREATE TABLE sync_cursors ( -- [device-local] 本机读取远端 change feed 的游标；它是同步运行状态，不是产品事实。尚无生产者。
  feed_name TEXT NOT NULL PRIMARY KEY, -- 游标名称，例如 "events"、"blobs" 或未来的分片 feed 名称。
  remote_cursor TEXT, -- relay 返回的不透明游标；用于下次增量拉取，不直接参与业务排序。
  hlc_wall_ms INTEGER, -- 已确认合并到本机的最新事件 HLC wallMs；便于按 HLC 回放和恢复。
  hlc_counter INTEGER, -- 已确认合并到本机的最新事件 HLC counter；和 hlc_wall_ms/hlc_device 一起定位。
  hlc_device TEXT, -- 已确认合并到本机的最新事件 HLC deviceId；处理同毫秒同 counter 的最终排序。
  updated_at TEXT NOT NULL -- 游标最近更新时间；用于 Data & Sync 显示"上次同步"和排查卡住的 feed。
); -- sync_cursors 表结束。

CREATE TABLE domain_events ( -- [synced log] append-only 领域事件日志；这是书籍、标注、阅读进度、记忆等可同步数据的唯一权威来源。事件目录见 packages/core/src/events.ts。
  id TEXT NOT NULL PRIMARY KEY, -- 全局唯一事件 ID，通常是 UUID；同步拉取重复事件时用它幂等去重。
  type TEXT NOT NULL, -- 事件类型（canonical 名以 events.ts 为准），例如 book.imported、highlight.created、reading.progressed、memory.promoted。
  schema_version INTEGER NOT NULL DEFAULT 1, -- payload_json 的版本；事件 shape 永远不原地改，新增版本或新增 type 来演进。
  hlc_wall_ms INTEGER NOT NULL, -- Hybrid Logical Clock 的 wallMs；跨设备合并时的主排序键。
  hlc_counter INTEGER NOT NULL, -- Hybrid Logical Clock 的 counter；同一毫秒内产生多个事件时保持全序。
  hlc_device TEXT NOT NULL, -- 产生事件的稳定 device_id；作为 HLC 最终 tiebreaker，也能追踪事件来源设备。
  aggregate_type TEXT, -- 事件主要作用的聚合类型，例如 book、highlight、note、memory、settings；加速 projection 定位。
  aggregate_id TEXT, -- 事件主要作用的聚合 ID，例如 bookId/highlightId/noteId；用于按对象调试和重放局部历史。
  payload_json TEXT NOT NULL, -- 事件完整 payload 的 JSON；例如 book.imported 里包含 title/author/format/fileName/fileSize/sourceBlobKey。
  actor_id TEXT NOT NULL DEFAULT 'local', -- 操作者 ID；当前单用户本地 app 固定写 'local'，多身份/协作落地后历史事件仍可归属。
  origin TEXT NOT NULL DEFAULT 'user', -- 软件行为体来源：'user'（用户直接操作）、'agent'（阅读 agent）、'system'（后台机制）、'plugin:<id>'（插件数据 API）。与 actor_id 正交；插件写入的审计与卸载补偿建立在这一列上。桌面迁移 v8 已落地。
  created_at TEXT NOT NULL, -- 事件在源设备被创建的 UTC 时间；和 HLC 不同，它主要用于审计和人类展示。
  ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) -- 当前设备第一次存入该事件的时间；用于同步延迟和导入诊断。
); -- domain_events 表结束。

CREATE UNIQUE INDEX ix_domain_events_hlc ON domain_events (hlc_wall_ms, hlc_counter, hlc_device); -- 按 HLC 保证可重放全序，readEventsSince 和 projection replay 都走这个索引。
CREATE INDEX ix_domain_events_type ON domain_events (type); -- 按事件类型筛选，例如只重放 memory.* 或排查 highlight.* 的历史。
CREATE INDEX ix_domain_events_aggregate ON domain_events (aggregate_type, aggregate_id); -- 按聚合对象查事件历史，例如一本书的导入、进度、收藏和移除。

CREATE TABLE event_blob_refs ( -- [projection] 事件引用的大文件清单（从事件 payload 派生）；同步时用它知道哪些 book source、cover、字体缓存或导出包需要单独传输。
  event_id TEXT NOT NULL REFERENCES domain_events(id) ON DELETE CASCADE, -- 引用 blob 的领域事件 ID，例如 book.imported 或 book.coverExtracted。
  blob_key TEXT NOT NULL REFERENCES blob_objects(key) DEFERRABLE INITIALLY DEFERRED, -- 被该事件引用的 blob key；DEFERRABLE 让迁移/重放时 blob 与事件的写入先后顺序更宽松。
  role TEXT NOT NULL, -- 该 blob 在事件中的角色，例如 source_file、cover_image、context_export。
  PRIMARY KEY (event_id, blob_key, role) -- 一个事件可以引用多个 blob，同一个 blob 也可以被多个事件复用。
); -- event_blob_refs 表结束。

CREATE TABLE event_sync_state ( -- [device-local] 每个事件的本地同步投递状态；和 domain_events 分开，避免修改 append-only 事件本体。尚无生产者。
  event_id TEXT NOT NULL PRIMARY KEY REFERENCES domain_events(id) ON DELETE CASCADE, -- 需要追踪 push 状态的事件 ID。
  push_state TEXT NOT NULL DEFAULT 'pending', -- 本机上传状态：pending、pushing、pushed、failed；用于 outbox 重试。
  pushed_at TEXT, -- 成功上传到 encrypted relay 的时间；为空表示还没有被远端确认。
  remote_id TEXT, -- relay 返回的远端记录 ID 或 sequence；用于支持幂等重试和服务端排查。
  last_error TEXT, -- 最近一次上传失败的错误摘要；Data & Sync 可以据此给用户可理解提示。
  updated_at TEXT NOT NULL -- 同步状态最近更新时间；用于重试节流和调试。
); -- event_sync_state 表结束。

CREATE INDEX ix_event_sync_state_push ON event_sync_state (push_state, updated_at) WHERE push_state IN ('pending','failed'); -- outbox 重试只扫待发/失败的事件；event_sync_state 与无界事件日志 1:1，必须用 partial 索引避免全表扫。

CREATE TABLE projection_checkpoints ( -- [device-local] projection 消费事件日志的位置；让本机可以增量更新，也能删表后从零重建。
  projection_name TEXT NOT NULL PRIMARY KEY, -- projection 名称，例如 books、highlights、long_term_memories、context_bundles。
  hlc_wall_ms INTEGER NOT NULL, -- 该 projection 已处理到的最新 HLC wallMs。
  hlc_counter INTEGER NOT NULL, -- 该 projection 已处理到的最新 HLC counter。
  hlc_device TEXT NOT NULL, -- 该 projection 已处理到的最新 HLC deviceId。
  rebuilt_at TEXT, -- 最近一次完整重建该 projection 的时间；用于诊断 schema 迁移后的 rebuild。
  updated_at TEXT NOT NULL -- 最近一次增量推进 checkpoint 的时间。
); -- projection_checkpoints 表结束。

CREATE TABLE blob_objects ( -- [device-local] 本机 blob registry；保存大文件元数据和本地存放位置。它是本机权威事实（不可从事件重建），真正 bytes 由 StorageAdapter 存在文件系统。
  -- 新设备 bootstrap 契约（important）：projection 表通过 FK 引用本表（books.source_blob_key 等），而本表是 device-local、
  -- bytes 又是惰性拉取的——所以 replay 应用到引用 blob 的事件（如 book.imported.sourceBlobKey）时，必须**先**（或同事务）
  -- upsert 一行 storage_uri 为 NULL 的 manifest 行（"远端已知、本机未取"），再写 projection 行；blob 拉取器随后补 bytes 和
  -- storage_uri。因此 storage_uri IS NULL 语义是"本机没有这份 bytes"，读取方按 cache miss 处理，不是错误。
  key TEXT NOT NULL PRIMARY KEY, -- StorageAdapter 里使用的稳定 blob key；book.source_blob_key、book.cover_blob_key 都引用它。
  kind TEXT NOT NULL, -- blob 类型：book_source、cover_image、font_face、context_export、sync_package 等。
  mime_type TEXT, -- MIME 类型，例如 application/epub+zip、application/pdf、image/jpeg、font/woff2。
  byte_size INTEGER, -- blob 字节数；用于导入校验、存储占用统计和同步前预估。
  sha256 TEXT, -- 内容哈希；用于去重、损坏校验、导入导出完整性验证和跨设备 blob 对账。
  storage_uri TEXT, -- 本机实际存放地址；相对 app data 目录的文件路径，bytes 始终落在文件系统（不存进 SQLite BLOB 列）。
  sync_required INTEGER NOT NULL DEFAULT 1, -- 是否需要随事件同步到 relay；字体缓存通常为 0，书籍原文件和封面通常为 1。
  created_at TEXT NOT NULL, -- blob 第一次写入本机的时间。
  last_accessed_at TEXT, -- 最近一次被 reader/font loader/context exporter 读取的时间，用于缓存清理策略。
  deleted_at TEXT -- blob 被本机软删除的时间；保留墓碑可以避免同步或导入恢复已删除文件。
); -- blob_objects 表结束。

CREATE INDEX ix_blob_objects_kind ON blob_objects (kind); -- 按 blob 类型统计和清理，例如只清理 font_face 缓存、不动 book_source。
CREATE INDEX ix_blob_objects_sha256 ON blob_objects (sha256); -- 按内容哈希去重，例如同一本书重复导入时复用 source blob。

CREATE TABLE blob_sync_state ( -- [device-local] blob 的同步投递状态；大文件和事件分开传输，所以需要独立 outbox。尚无生产者。
  blob_key TEXT NOT NULL PRIMARY KEY REFERENCES blob_objects(key) ON DELETE CASCADE, -- 被追踪同步状态的 blob key（同为 device-local，blob 清理时一并删除其同步状态）。
  push_state TEXT NOT NULL DEFAULT 'pending', -- blob 上传状态：pending、pushing、pushed、failed、skipped。
  pushed_at TEXT, -- blob 成功上传到 encrypted blob store 的时间。
  remote_uri TEXT, -- relay 返回的 blob 远端地址或对象 key；保存的是密文对象引用。
  last_error TEXT, -- 最近一次 blob 上传/校验失败的错误摘要。
  updated_at TEXT NOT NULL -- 本行同步状态的最近更新时间。
); -- blob_sync_state 表结束。

CREATE INDEX ix_blob_sync_state_push ON blob_sync_state (push_state, updated_at) WHERE push_state IN ('pending','failed'); -- blob outbox 重试只扫待发/失败行，和事件 outbox 对齐。

CREATE TABLE settings ( -- [device-local] 设备本地的全局偏好单行表；对应 Settings 页面多个 section，不进 domain_events，也不跨设备同步。
  -- 政策：**稳定、需要校验、查询会用到**的偏好用下面的 typed 列；**高频变动/实验性**的开关放进 app_kv（KV 旁表），避免每加一个开关都要 ALTER TABLE。
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1), -- 单行表固定为 1；当前桌面 app 只有一个本地偏好集合。
  start_view TEXT NOT NULL DEFAULT 'shelf', -- 在设置页面 General > On launch 的 Start view 中，控制启动 app 时显示书架还是恢复上一本书。
  language TEXT NOT NULL DEFAULT 'en', -- 在设置页面 General > Language & privacy 的 Language 中，记录界面语言；当前只开放 English，未来可扩展。
  crash_reports INTEGER NOT NULL DEFAULT 0, -- 在设置页面 General > Language & privacy 中，控制是否发送匿名崩溃诊断；默认关闭以保护隐私。
  launch_at_startup INTEGER NOT NULL DEFAULT 0, -- 在设置页面 General > Desktop integration 中，控制登录系统时是否自动打开 ReadAware。
  file_associations INTEGER NOT NULL DEFAULT 1, -- 在设置页面 General > Desktop integration 中，控制 EPUB/MOBI/AZW3/FB2/PDF 是否关联到 ReadAware 打开。
  auto_update INTEGER NOT NULL DEFAULT 1, -- 在设置页面 General > Desktop integration 中，控制桌面 app 是否启动时检查更新并在主界面显示提示；安装仍由用户触发。
  app_theme TEXT NOT NULL DEFAULT 'system', -- 在设置页面 Appearance > Theme 中，控制 app 外壳跟随系统、固定浅色或固定深色。
  motion TEXT NOT NULL DEFAULT 'system', -- 在设置页面 Appearance > Motion 中，控制是否减少过渡动画；system 表示跟随 prefers-reduced-motion。
  reader_theme TEXT NOT NULL DEFAULT 'warm', -- 在设置页面 Reading > Page Color 中，控制书页纸色：auto、light、warm 或 dark。
  reader_font_family TEXT NOT NULL DEFAULT 'curated:inter', -- 在设置页面 Reading > Typography 的 Font 中，控制全局阅读字体；curated:* 是内置字体，system:* 是本机字体。
  reader_font_size TEXT NOT NULL DEFAULT 'medium', -- 在设置页面 Reading > Typography 的 Font Size 中，控制全局阅读字号档位，例如 small、medium、x-large。
  reader_line_spacing TEXT NOT NULL DEFAULT 'comfortable', -- 在设置页面 Reading > Typography 的 Line Spacing 中，控制正文行距：compact、comfortable 或 relaxed。
  reader_paragraph_spacing TEXT NOT NULL DEFAULT 'normal', -- 在设置页面 Reading > Typography 的 Paragraph Spacing 中，控制段落间距：tight、normal 或 loose。
  reading_mode TEXT NOT NULL DEFAULT 'scroll', -- 在设置页面 Reading > Layout 的 Reading Mode 中，控制阅读器使用连续滚动、单页翻页或双页翻页。
  ai_explain_selection INTEGER NOT NULL DEFAULT 1, -- 在设置页面 AI > Features 中，控制是否启用 Explain selection，用于解释选中的文本。
  ai_define_term INTEGER NOT NULL DEFAULT 1, -- 在设置页面 AI > Features 中，控制是否启用 Define term，用于选词定义。
  ai_translate INTEGER NOT NULL DEFAULT 1, -- 在设置页面 AI > Features 中，控制是否启用 Translate，用于翻译选中文本。
  ai_summarize_chapter INTEGER NOT NULL DEFAULT 1, -- 在设置页面 AI > Features 中，控制是否启用 Summarize chapter，用于总结当前章节。
  ai_ask_conversation INTEGER NOT NULL DEFAULT 1, -- 在设置页面 AI > Features 中，控制是否启用 Conversational Q&A，也就是右侧持久 AI 对话。
  ai_build_memory INTEGER NOT NULL DEFAULT 1, -- 在设置页面 AI > Memory 中，控制 ReadAware 是否从阅读、笔记和对话中沉淀长期记忆。
  ai_send_highlighted_text INTEGER NOT NULL DEFAULT 1, -- 在设置页面 AI > Privacy 中，控制远程模型请求是否包含用户选中的原文片段。
  ai_send_surrounding_context INTEGER NOT NULL DEFAULT 1, -- 在设置页面 AI > Privacy 中，控制远程模型请求是否包含选区附近段落来保持回答有上下文。
  ai_local_only INTEGER NOT NULL DEFAULT 0, -- 在设置页面 AI > Privacy 中，控制是否进入 Local-only mode；为 1 时不调用远程模型。
  shelf_layout TEXT NOT NULL DEFAULT 'grid', -- 在书架管理菜单中，控制书架显示为 grid 还是 list。
  shelf_group TEXT NOT NULL DEFAULT 'none', -- 在书架管理菜单中，控制书架按 none、status、author 或 format 分组。
  shelf_sort TEXT NOT NULL DEFAULT 'recent', -- 在书架管理菜单中，控制书架按最近打开、导入时间、标题、作者或进度排序。
  default_mark_color TEXT NOT NULL DEFAULT 'yellow', -- 在阅读器标注菜单中，记录下一次一键 highlight/underline 默认使用的颜色，会跟随最近一次 recolor。
  toc_panel_width_px INTEGER NOT NULL DEFAULT 288, -- 在阅读器中，记录左侧目录面板拖拽后的宽度，跨书本和重启保留。
  chat_panel_width_px INTEGER NOT NULL DEFAULT 352, -- 在阅读器中，记录右侧 AI chat 面板拖拽后的宽度，跨书本和重启保留。
  updated_at TEXT NOT NULL -- 任意全局偏好被修改的时间；设置导出、迁移和调试会用到它。
); -- settings 表结束。

CREATE TABLE app_kv ( -- [device-local] 设备本地的高频/实验性配置 KV 旁表；给那些还没稳定到值得建 typed 列的开关用，新增不需要 schema 迁移。
  key TEXT NOT NULL PRIMARY KEY, -- 配置键，例如某个实验 feature flag 或临时 UI 状态名。
  value_json TEXT NOT NULL, -- 配置值的 JSON；稳定下来后应该迁成 settings 的 typed 列。
  updated_at TEXT NOT NULL -- 该键最近修改时间。
); -- app_kv 表结束。

CREATE TABLE shortcut_bindings ( -- [device-local] 用户重绑的快捷键覆盖表；没有出现在这里的 shortcut_id 使用代码里的默认快捷键。
  shortcut_id TEXT NOT NULL PRIMARY KEY, -- 快捷键动作 ID，例如 search、settings、next-page、selection-ask-ai。
  key TEXT NOT NULL, -- KeyboardEvent.key 的规范化值，例如 k、ArrowRight、Space；这是实际触发动作的主键。
  mod INTEGER NOT NULL DEFAULT 0, -- 是否需要平台主修饰键；macOS 是 Command，其他平台是 Ctrl。
  alt INTEGER NOT NULL DEFAULT 0, -- 是否需要 Alt/Option 修饰键。
  shift INTEGER NOT NULL DEFAULT 0, -- 是否需要 Shift 修饰键。
  updated_at TEXT NOT NULL -- 该快捷键覆盖最近修改时间；用于导出设置和冲突排查。
); -- shortcut_bindings 表结束。

CREATE TABLE ai_provider_configs ( -- [device-local] BYOK 模型连接配置；保存非秘密字段和 Keychain 引用，不保存明文 API key。支持多 provider（如 chat 与 embedding 分开），不再写死单行。
  id TEXT NOT NULL PRIMARY KEY, -- 配置 ID，例如 'default-chat'、'default-embedding'；从单行 CHECK(id=1) 放开，方便将来一机多 provider。
  role TEXT NOT NULL DEFAULT 'chat', -- 该配置的用途：chat（对话推理）或 embedding（向量化）；远程推理和本地数据是两条轴，可各配一个 provider。
  is_default INTEGER NOT NULL DEFAULT 0, -- 是否是该 role 的默认 provider；下面的 partial unique 索引保证每个 role 最多一个默认。
  provider TEXT NOT NULL, -- 在设置页面 AI > Connection 的 AI Provider 中选择的供应商：openai、anthropic、openrouter 或 custom。
  model TEXT NOT NULL, -- 在设置页面 AI > Connection 的 Model 中选择的默认模型，例如 gpt-4o-mini 或 openrouter 模型名。
  custom_base_url TEXT, -- provider 为 custom 时的 OpenAI-compatible API base URL；其他 provider 通常为空。
  api_key_ref TEXT, -- 系统 Keychain 中 API key 的引用 ID；SQLite 永远不保存 apiKey 明文。
  configured_at TEXT NOT NULL, -- 用户点击 Save Configuration 或 Test Connection 首次成功保存配置的时间。
  last_tested_at TEXT, -- 用户点击 Test Connection 的最近时间，用于显示连接状态或调试模型问题。
  last_test_status TEXT, -- 最近一次连接测试状态，例如 success、failed 或 skipped。
  last_test_error TEXT -- 最近一次连接测试失败的错误摘要；避免把敏感 key 写入错误文本。
); -- ai_provider_configs 表结束。

CREATE UNIQUE INDEX ix_ai_provider_default ON ai_provider_configs (role) WHERE is_default = 1; -- 每个 role（chat/embedding）最多一个默认 provider。

CREATE TABLE cached_font_faces ( -- [local index] curated reading fonts 的离线缓存清单；实际 woff2 bytes 作为 font_face blob 存在 blob_objects，可删除重下。
  url TEXT NOT NULL PRIMARY KEY, -- 字体 face 的远端 URL；当前 IndexedDB 就是用 URL 作为 key。
  font_id TEXT NOT NULL, -- curated 字体 ID，例如 inter、literata 或某个 CJK 字体集合 ID。
  family TEXT NOT NULL, -- @font-face 使用的 font-family 名称，注入 app document 和 foliate iframe 时需要。
  style TEXT NOT NULL, -- 字体样式，例如 normal 或 italic；构建 @font-face CSS 时使用。
  weight TEXT NOT NULL, -- 字重范围或具体字重，例如 400 或 400 700；构建 @font-face CSS 时使用。
  unicode_range TEXT, -- 该 face 覆盖的 unicode-range；CJK 分片字体依赖它按需加载。
  blob_key TEXT NOT NULL REFERENCES blob_objects(key) DEFERRABLE INITIALLY DEFERRED, -- 缓存到本地 blob store 后的 key；删除缓存时通过它清理 bytes。
  cached_at TEXT NOT NULL, -- 字体 face 首次成功下载并缓存的时间。
  last_used_at TEXT -- 最近一次 reader 或设置预览使用该 face 的时间，用于缓存淘汰。
); -- cached_font_faces 表结束。

CREATE INDEX ix_cached_font_faces_font ON cached_font_faces (font_id); -- 按字体 ID 找到一个 curated 字体需要注入的所有 face 分片。

CREATE TABLE books ( -- [projection] 书籍读模型；由 book.imported/book.metadataEdited/book.coverExtracted/book.starred/book.removed 等事件重放生成，是书架核心。
  id TEXT NOT NULL PRIMARY KEY, -- 书籍 ID，对应当前 LibraryBook.id；所有进度、标注、对话、记忆都通过它关联到一本书。
  title TEXT NOT NULL, -- 书名；导入时从文件 metadata 或文件名推断，用户未来编辑后由 book.metadataEdited 更新。
  author TEXT NOT NULL DEFAULT 'Unknown author', -- 作者；当前 UI 用它排序、分组和展示，没有 metadata 时使用 Unknown author。
  format TEXT NOT NULL, -- 原始文件格式：epub、mobi、azw3、fb2 或 pdf；foliate-js 根据它选择 loader。
  file_name TEXT NOT NULL, -- 用户导入时的原始文件名；reader 重新构造 File 对象和错误提示时需要。来自 book.imported.fileName。
  mime_type TEXT, -- 导入文件的 MIME 类型；打开 reader 或导出 manifest 时用于还原文件信息。
  file_size INTEGER NOT NULL, -- 原始文件字节数；用于重复导入检测、存储统计和导出 manifest。来自 book.imported.fileSize。
  source_blob_key TEXT NOT NULL REFERENCES blob_objects(key) DEFERRABLE INITIALLY DEFERRED, -- 原始书籍文件的 blob key；ReadAware 直接读原文件，不做格式转换。新设备 replay 时先物化 blob_objects manifest 行再插本行（见 blob_objects 表头的 bootstrap 契约）。
  source_sha256 TEXT, -- 原始书籍文件内容哈希；比 title+author+size 更可靠地识别重复导入。来自 book.imported.sourceSha256。
  cover_blob_key TEXT REFERENCES blob_objects(key) DEFERRABLE INITIALLY DEFERRED, -- 抽取出的封面图片 blob key；没有封面或未抽取时为空。
  cover_status TEXT NOT NULL DEFAULT 'unchecked', -- 封面抽取状态：unchecked、ready、none、failed；替代当前 coverChecked + coverUrl 的组合语义。由 book.coverExtracted 更新。
  starred INTEGER NOT NULL DEFAULT 0, -- 书架中的星标固定状态；由 book.starred 事件更新；当前 Shelf 会把 starred books 排在所选排序之前。
  created_at TEXT NOT NULL, -- 书首次导入到本地 event log 的时间（取 book.imported 事件的 HLC wall time）；对应当前 LibraryBook.createdAt。
  updated_at TEXT NOT NULL, -- 书籍 metadata、星标、进度或集合关系最近变化时间；对应当前 LibraryBook.updatedAt。
  last_opened_at TEXT, -- 最近一次打开这本书进入 reader 的时间（由 book.opened 推进）；书架 recent 排序使用它。
  removed_at TEXT -- 软删除时间；book.removed 后保留 tombstone，避免同步把已删除书重新带回来。
); -- books 表结束。

CREATE INDEX ix_books_active_recent ON books (removed_at, last_opened_at, updated_at); -- 书架加载活跃书籍（removed_at IS NULL）并按最近打开/更新排序时使用。
CREATE INDEX ix_books_author_title ON books (author, title); -- 书架按作者分组或排序时使用。
CREATE INDEX ix_books_source_sha256 ON books (source_sha256); -- 导入重复检测和跨设备 blob 对账时使用。

CREATE TABLE collections ( -- [projection] 用户创建的书架集合；由 collection.created/renamed/removed 事件重放。当前产品是"单本书只属于一个集合"的文件夹式模型。
  id TEXT NOT NULL PRIMARY KEY, -- 集合 ID，对应当前 Collection.id；集合重命名、删除、成员关系都引用它。
  name TEXT NOT NULL, -- 集合名称，在书架顶层 CollectionTile 和 CollectionHeader 中展示。
  created_at TEXT NOT NULL, -- 集合创建时间；用于导出审计和未来排序。
  updated_at TEXT NOT NULL, -- 集合最近重命名或成员变化时间；用于同步冲突排查。
  removed_at TEXT -- 集合删除时间；删除集合时书籍保留，只清除 membership。
); -- collections 表结束。

CREATE INDEX ix_collections_name ON collections (name); -- 书架顶层集合按名称排序时使用。

CREATE TABLE book_collection_memberships ( -- [projection] 书籍到集合的当前成员关系；底层事件用 book.addedToCollection/removedFromCollection（集合语义），所以将来要扩成多对多也能从日志重建。
  book_id TEXT NOT NULL PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE, -- 书籍 ID；作为主键意味着一本书当前最多在一个集合中（多对多时改掉这个 PK 即可）。
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, -- 集合 ID；集合被硬删除时一并清除 membership（书籍保留），与 collections.removed_at 注释一致。
  assigned_at TEXT NOT NULL, -- 用户把书加入或移动到该集合的时间。
  updated_at TEXT NOT NULL -- 成员关系最近变化时间；批量移动和同步合并时可用于诊断。
); -- book_collection_memberships 表结束。

CREATE INDEX ix_book_collection_memberships_collection ON book_collection_memberships (collection_id); -- 打开某个集合时快速列出其中所有书。

CREATE TABLE reading_positions ( -- [projection] 每本书的当前阅读位置；由 reading.progressed 和 book.opened 等事件更新。
  book_id TEXT NOT NULL PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE, -- 书籍 ID；当前单用户模型下每本书只有一个当前位置。
  cfi TEXT, -- EPUB/MOBI/AZW3/FB2 的 CFI 位置；fixed-layout PDF 可能为空。来自 reading.progressed.locator。
  href TEXT, -- 当前章节 href 或 PDF/foliate 的当前位置辅助 locator；用于重新打开时定位章节。
  current_location INTEGER NOT NULL DEFAULT 0, -- 当前页码/位置编号；ReaderShellOverlay 显示 "X of N" 时使用。
  total_locations INTEGER NOT NULL DEFAULT 0, -- 当前书的总页数/位置数；和 current_location 一起计算进度显示。
  progress_percent REAL NOT NULL DEFAULT 0, -- 0 到 100 的阅读百分比；书架进度条、状态推导和统计入口使用。
  reading_status TEXT NOT NULL DEFAULT 'unread', -- unread、reading 或 finished；当前由 progress_percent 推导，书架可按 status 分组。
  last_read_at TEXT, -- 最近一次实际推进阅读位置的时间；不同于 last_opened_at，打开但没翻动不一定更新。
  updated_at TEXT NOT NULL -- 本行最近更新时间；防止高频 progress 事件合并时丢失最新位置。
); -- reading_positions 表结束。

CREATE INDEX ix_reading_positions_status ON reading_positions (reading_status); -- 书架按阅读状态分组时使用。
CREATE INDEX ix_reading_positions_last_read ON reading_positions (last_read_at); -- 统计最近阅读和恢复上一本书时使用。

CREATE TABLE reading_time_totals ( -- [projection] 每本书累计主动阅读时长；由 reading.timeRecorded 重放。桌面迁移 v9 已落地（连同 daily/hourly；app_kv 的 read-aware-reading-stats blob 启动时一次性导入后删除）。
  book_id TEXT NOT NULL PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE, -- 书籍 ID；一书一行总计。
  first_started_at TEXT, -- 第一次记录到主动阅读时长的时间（ISO-8601 UTC，与全表统一；迁移时由旧 epoch ms 转换）。
  last_read_at TEXT, -- 最近一次记录主动阅读时长的时间（ISO-8601 UTC；与 reading_positions.last_read_at 同名同类型，避免跨 affinity 误比）。
  total_ms INTEGER NOT NULL DEFAULT 0, -- 累计主动阅读毫秒数（时长，保持 INTEGER ms）；只统计窗口可见、未 idle、reader active 的时间。
  updated_at TEXT NOT NULL -- 本行最近更新时间；由 reading.timeRecorded projection 推进。
); -- reading_time_totals 表结束。

CREATE TABLE reading_time_daily ( -- [projection] 每本书按本地日聚合的阅读时长；用于周/月统计和 heatmap。
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, -- 书籍 ID；和 local_day 一起定位一个日桶。
  local_day TEXT NOT NULL, -- 本地日 YYYY-MM-DD。确定性契约：取 reading.timeRecorded 事件 payload 里**记录时**盖章的 localDay，绝不在 replay 时用当前时区从 atEpochMs 重算——否则换时区重建会平移全部历史。
  ms INTEGER NOT NULL DEFAULT 0, -- 该本地日累计主动阅读毫秒数。
  updated_at TEXT NOT NULL, -- 该日桶最近更新时间。
  PRIMARY KEY (book_id, local_day) -- 一本书一天只有一个聚合桶。
); -- reading_time_daily 表结束。

CREATE INDEX ix_reading_time_daily_day ON reading_time_daily (local_day); -- 全局统计需要按日期聚合所有书的阅读时长。

CREATE TABLE reading_time_hourly ( -- [projection] 每本书按本地小时聚合的全量阅读时长；替代当前 byHour 24 槽数组。
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, -- 书籍 ID；和 local_hour 一起定位小时桶。
  local_hour INTEGER NOT NULL CHECK (local_hour BETWEEN 0 AND 23), -- 本地小时 0-23；用于 RhythmCharts 展示一天中的阅读节律。同 local_day：取事件 payload 的 localHour，replay 时不重算。
  ms INTEGER NOT NULL DEFAULT 0, -- 该小时累计主动阅读毫秒数。
  updated_at TEXT NOT NULL, -- 该小时桶最近更新时间。
  PRIMARY KEY (book_id, local_hour) -- 一本书一个小时只有一个聚合桶。
); -- reading_time_hourly 表结束。

CREATE TABLE highlights ( -- [projection] 文本高亮/下划线；由 highlight.created/highlight.recolored/highlight.removed 事件生成。
  id TEXT NOT NULL PRIMARY KEY, -- 标注 ID，对应当前 Highlight.id；reader overlay 和 context 列表都用它删除/更新。
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, -- 所属书籍 ID；用于打开书时加载该书所有标注。
  anchor TEXT, -- 书内范围定位，当前从 cfiRange 迁移而来；PDF 或不可定位格式可能为空（与 core Highlight.anchor 可选一致）。
  chapter_href TEXT, -- 选区所在章节 href；用于跳转、上下文引用和 AI attachment。
  selected_text TEXT NOT NULL, -- 用户当时选中的原文；Context 页面、AI 引用和导出包需要。
  color TEXT NOT NULL DEFAULT 'yellow', -- 标注颜色：yellow、green、blue、pink；highlight.recolored 会更新它。
  style TEXT NOT NULL DEFAULT 'highlight', -- 视觉样式：highlight 或 underline；当前一键高亮和下划线共用同一模型。
  created_at TEXT NOT NULL, -- 标注创建时间；Context 列表按创建时间倒序展示。
  updated_at TEXT NOT NULL, -- 标注最近更新时间；recolor 或未来编辑 anchor 时更新。
  removed_at TEXT -- 删除时间；projection 可隐藏它，同时保留 tombstone 参与同步合并。
); -- highlights 表结束。

CREATE INDEX ix_highlights_book_created ON highlights (book_id, created_at); -- 打开一本书或 Context 按书分组时加载该书标注。
CREATE INDEX ix_highlights_anchor ON highlights (book_id, anchor); -- reader 点击已有标注或重新渲染标注时按 anchor 查找。

CREATE TABLE notes ( -- [projection] 用户笔记；由 note.created/note.updated/note.removed 事件生成。
  id TEXT NOT NULL PRIMARY KEY, -- 笔记 ID，对应当前 Note.id；编辑和删除都通过它定位。
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, -- 所属书籍 ID；当前所有笔记都来自一本书的选区（与 core Note.bookId 必填一致）。
  highlight_id TEXT REFERENCES highlights(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED, -- 如果笔记附着在已有高亮上，记录对应 highlight；高亮被硬删除时置空，笔记本体保留。
  anchor TEXT, -- 笔记所在书内范围定位，当前从 cfiRange 迁移而来；没有稳定定位时可为空。
  chapter_href TEXT, -- 笔记所在章节 href；用于跳转、导出和 AI 引用。
  quoted_text TEXT, -- 创建笔记时选中的原文；Context 页面显示引文，AI 也可用作 evidence；无选区时可为空。
  body TEXT NOT NULL, -- 用户写下的笔记正文；当前 Note.content 迁移到这里。
  created_at TEXT NOT NULL, -- 笔记创建时间；Context 列表按创建时间倒序展示。
  updated_at TEXT NOT NULL, -- 笔记正文最近修改时间；NoteEditor 保存时更新。
  removed_at TEXT -- 删除时间；删除后 projection 隐藏，保留 tombstone 用于同步。
); -- notes 表结束。

CREATE INDEX ix_notes_book_created ON notes (book_id, created_at); -- 打开一本书或 Context 按书分组时加载该书笔记。
CREATE INDEX ix_notes_highlight ON notes (highlight_id); -- 从高亮打开关联笔记或未来支持一条高亮多条笔记时使用。

CREATE TABLE asks ( -- [projection] 提问痕迹：书内 AI 对话中每个问题留下的被动 trace（docs/agent-architecture.md §7）；由 ask.recorded/ask.removed 事件生成。由 agent runtime 写入，不是用户直接创建。
  id TEXT NOT NULL PRIMARY KEY, -- ask ID，对应当前 Ask.id（interim annotations 表里 type='ask' 的行迁移到这里）。
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, -- 所属书籍 ID；提问总是发生在某本书的持久对话里。
  anchor TEXT, -- 提问时的选区或阅读位置定位（当前从 cfiRange 迁移）；无稳定定位时可为空。
  chapter_href TEXT, -- 提问所在章节 href；用于跳转和上下文引用。
  text TEXT NOT NULL, -- 问题本身的文本。
  created_at TEXT NOT NULL, -- 提问时间；Context 时间线按它排序。
  updated_at TEXT NOT NULL, -- 本行最近更新时间；当前 ask 创建后不可编辑，保留列以对齐其他标注表。
  removed_at TEXT -- 删除时间；保留 tombstone 参与同步合并。
); -- asks 表结束。

CREATE INDEX ix_asks_book_created ON asks (book_id, created_at); -- 打开一本书或 Context 按书分组时加载该书提问痕迹。

CREATE TABLE vocabulary_entries ( -- [projection] 生词本：阅读器词典保存的词；由 vocabulary.added/vocabulary.removed 事件重放（added 为 upsert 语义——同一 id 重加覆盖快照）。桌面迁移 v9 已落地（app_kv 的 read-aware-vocabulary blob 启动时一次性导入后删除）。
  id TEXT NOT NULL PRIMARY KEY, -- 去重身份 `<language> <term.lowercase>`，与事件 payload 的 entryId 一致。
  term TEXT NOT NULL, -- 原词（保留大小写）。
  language TEXT NOT NULL, -- 释义语言（词条以「词 × 释义语言」为身份）。
  entry_json TEXT NOT NULL, -- 词典词条快照（headword/senses/etymology/contextualMeaning）；日志自含，不引用可重建的词典缓存。
  context TEXT, -- 遇到该词的原文段落（provenance）。
  book_id TEXT, -- 遇到该词的书籍 ID（可空——旧数据只有书名）。
  book_title TEXT, -- 遇到该词的书名快照。
  added_at TEXT NOT NULL, -- 加入生词本的时间。
  removed_at TEXT -- 删除时间；保留 tombstone 参与同步合并。
); -- vocabulary_entries 表结束。

CREATE INDEX ix_vocabulary_added ON vocabulary_entries (added_at); -- 生词本按加入时间倒序展示。

CREATE VIRTUAL TABLE annotations_fts USING fts5( -- [local index] 标注全文检索（默认检索架构"FTS + 结构化信号"的 FTS 半边）；可删除重建、永不同步。桌面迁移 v4 已落地（当前喂自 interim 的统一 annotations 表；highlights/notes/asks 拆表后触发器随之改挂）。
  -- 中文分词契约（important）：fts5 的 unicode61 不切 CJK（整段汉字一个 token），trigram 又要求查询 ≥3 字符，而中文最常见的是两字词。
  -- 因此入索引前由 ra_fts_segment（storage 层在每条连接上注册的 SQL 函数）把 CJK 连续段切成**重叠 bigram**（"养成好习惯"→"养成 成好 好习 习惯"），
  -- 非 CJK 单词原样保留；查询侧走同一套切分（fts_match_expr）：CJK 段拼成 bigram 短语查询，单字/英文词用带引号的前缀 token（"习"* 能命中 bigram 习惯）。
  -- 全 token 加引号同时中和了用户输入里的 fts5 运算符。注意：绕过 app 连接（裸 sqlite3 shell）写标注表会因缺 ra_fts_segment 触发器报错。
  -- 重建/修复配方：DELETE FROM annotations_fts; INSERT INTO annotations_fts SELECT ...（见 storage.rs 迁移 v4）。
  -- memories_fts / ai_messages_fts 等未来索引沿用同一契约。
  id UNINDEXED, -- 源标注 ID；UNINDEXED 只存不索引，命中后回 join 权威表取整行。
  book_id UNINDEXED, -- 所属书籍 ID；按书过滤在 join 后的权威表上做。
  type UNINDEXED, -- 标注类型 highlight/note/ask；同上用于过滤。
  text, -- 选中原文/问题文本，经 ra_fts_segment 切分后入索引。
  content, -- 笔记正文（无则空串），同样切分入索引。
  tokenize = 'unicode61' -- 分词交给预切分 + unicode61（大小写/变音折叠仍由它做）。
); -- annotations_fts 表结束。由 AFTER INSERT/UPDATE/DELETE 触发器与权威表保持同步，查询按 bm25() 排序。

CREATE TABLE ai_conversations ( -- [projection] 每本书一个持久 AI 对话；替代当前 read-aware-conversations 的 bookId -> messages。由 aiConversation.started/cleared 重放。
  -- 生命周期：UNIQUE(book_id) 强约束"一书一个持久对话"。started 投影必须按 book 幂等 upsert/查找，绝不盲插新 UUID（否则撞 UNIQUE）。
  -- 清空 = 原地把 cleared_at 置时间并清掉该对话的 messages（保留本行、保留 id），用于跨设备一致清空，不新建第二行。
  id TEXT NOT NULL PRIMARY KEY, -- 对话 ID；建议由 book_id 确定性派生（稳定不变），也可由 aiConversation.started 事件携带。
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, -- 对话所属书籍 ID；当前产品模型是一书一个持续 conversation。
  title TEXT, -- 未来如果支持用户给书内对话命名，在这里保存；当前可为空或用书名派生。
  created_at TEXT NOT NULL, -- 对话首次创建时间；第一次对这本书 Ask AI 时生成。
  updated_at TEXT NOT NULL, -- 最近一条消息追加或清空对话的时间。
  cleared_at TEXT -- 用户清空该书对话的时间；保留墓碑以便跨设备也清空。
); -- ai_conversations 表结束。

CREATE UNIQUE INDEX ix_ai_conversations_book ON ai_conversations (book_id); -- 保证当前一书一个持久 conversation 的产品约束。

CREATE TABLE ai_messages ( -- [projection] AI 对话消息；用户和 assistant 的每一轮都单独成行，便于增量同步和检索。由 aiMessage.appended 重放。
  id TEXT NOT NULL PRIMARY KEY, -- 消息 ID，对应当前 ChatMessage.id；stream 完成后 assistant 消息也固定一个 ID。
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE, -- 所属书内对话 ID。
  role TEXT NOT NULL, -- 发言角色：user 或 assistant；当前 UI 只渲染这两种。
  seq INTEGER NOT NULL, -- 消息在 conversation 内的递增顺序；重放和显示都按它排序。
  content TEXT NOT NULL, -- 消息正文；user 输入或 assistant 流式生成后的完整文本。
  status TEXT NOT NULL DEFAULT 'complete', -- 消息状态：complete、streaming、failed；用于未来恢复中断的流式回答。
  model TEXT, -- 生成 assistant 消息所用模型；便于审计、复现和成本统计。
  created_at TEXT NOT NULL -- 消息创建时间；当前 ChatMessage.createdAt 迁移到这里。
); -- ai_messages 表结束。

CREATE UNIQUE INDEX ix_ai_messages_conversation_seq ON ai_messages (conversation_id, seq); -- 按对话顺序加载消息，并防止同一个 seq 重复。
-- seq 的确定性契约：两台离线设备可能对同一对话各自铸出相同的 seq；事件里携带的 seq 只是提示，
-- projection 在冲突时必须按 HLC 全序重新分配 seq（HLC 是真相），否则 replay 会撞本唯一索引。

CREATE TABLE ai_message_attachments ( -- [projection] 用户消息携带的选区 attachment；"Ask AI about this" 把选区作为附件进入持续对话。随 aiMessage.appended.attachments 重放。
  id TEXT NOT NULL PRIMARY KEY, -- attachment ID；为未来一条消息多个附件做准备。
  message_id TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE, -- 所属 user 消息 ID。
  kind TEXT NOT NULL DEFAULT 'selection', -- 附件类型；当前只有 selection，未来可扩展图片、笔记、上下文包。
  text TEXT NOT NULL, -- 附件展示和发送给模型的选中文本。
  anchor TEXT, -- 附件对应书内范围定位，当前从 ChatSelectionAttachment.cfiRange 迁移而来。
  chapter_href TEXT, -- 附件所在章节 href；用于未来点击 citation 跳回原文。
  created_at TEXT NOT NULL -- 附件创建时间；通常与消息创建时间一致。
); -- ai_message_attachments 表结束。

CREATE INDEX ix_ai_message_attachments_message ON ai_message_attachments (message_id); -- 加载一条 user 消息时快速取回它的所有附件 chip。

-- =====================================================================================================
-- 以下 memory / entity / vector / context 子系统是**前瞻设计**：目前没有任何生产者（consolidation/embedding 管线未落地）。
-- 它们随数据模型一起建好（空表无害），等 AI 记忆/检索管线开发时再启用。先把模型搭出来，不影响当前阅读功能上线。
-- =====================================================================================================

CREATE TABLE user_profile ( -- [projection] 长期用户画像；由 profile.updated 和 memory consolidation 产生，不是聊天 transcript 本身。前瞻，暂无生产者。
  id TEXT NOT NULL PRIMARY KEY, -- 用户画像 ID；当前单用户可固定为 local，但保留 ID 便于未来同步身份合并。
  display_name TEXT, -- 用户显示名；未来 onboarding 或 profile 设置可写入。
  traits_json TEXT, -- 稳定偏好和特征 JSON，例如阅读目标、偏好的解释方式、常读主题；由记忆管线维护。
  created_at TEXT NOT NULL, -- 用户画像首次创建时间。
  updated_at TEXT NOT NULL -- 用户画像最近更新或 consolidation 写入时间。
); -- user_profile 表结束。

CREATE TABLE entities ( -- [projection] 记忆系统里的实体解析结果；解决同一概念/人物在不同书和对话中反复出现的问题。前瞻，暂无生产者。
  id TEXT NOT NULL PRIMARY KEY, -- 实体 ID；memory.entity_id 和 entity_aliases 都引用它。
  kind TEXT NOT NULL, -- 实体类型，例如 person、concept、work、place、organization。
  canonical_name TEXT NOT NULL, -- 规范显示名；用于记忆卡片、检索调试和上下文包。
  description TEXT, -- 对实体的短描述；可由多次出现的 evidence consolidation 得到。
  created_at TEXT NOT NULL, -- 实体首次被识别或创建的时间。
  updated_at TEXT NOT NULL, -- 实体名称、描述或合并关系最近更新时间。
  merged_into_id TEXT REFERENCES entities(id) DEFERRABLE INITIALLY DEFERRED -- 如果 entity.merged 把它并入另一个实体，这里记录保留实体 ID。
); -- entities 表结束。

CREATE INDEX ix_entities_kind_name ON entities (kind, canonical_name); -- 实体解析和管理界面按类型/名称查找时使用。

CREATE TABLE entity_aliases ( -- [projection] 实体别名表；让同一人物、概念或作品在不同拼写下能归并到同一 entity。前瞻，暂无生产者。
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE, -- 归属实体 ID。
  alias TEXT NOT NULL, -- 别名文本，例如缩写、译名、英文名或书中不同叫法。
  source TEXT, -- 别名来源，例如 book_metadata、highlight、ai_conversation、user_correction。
  created_at TEXT NOT NULL, -- 这个别名首次被记录的时间。
  PRIMARY KEY (entity_id, alias) -- 同一个实体下同一个别名只存一次。
); -- entity_aliases 表结束。

CREATE INDEX ix_entity_aliases_alias ON entity_aliases (alias); -- 根据新文本命中已有实体别名时使用。

CREATE TABLE memories ( -- [projection] 长期记忆；正文和全部检索信号都在 SQLite（FTS + scope/recency/importance；默认无向量索引）。由 memory.promoted/revised/superseded/feedback/forgotten 重放；memory-port 已在每个巩固意图点双写这些事件。
  id TEXT NOT NULL PRIMARY KEY, -- 记忆 ID；memory.* 事件都引用它。
  kind TEXT NOT NULL, -- 记忆类型，例如 profile_fact、preference、reading_goal、book_insight、entity_fact。
  scope TEXT NOT NULL DEFAULT 'user', -- 记忆作用域：user、book、entity、conversation；决定检索时如何过滤。
  book_id TEXT REFERENCES books(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED, -- 如果这是一本书相关记忆，记录 book_id；书被硬删除时置空而不阻塞删除。
  entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED, -- 如果记忆绑定到解析实体，记录 entity_id；实体被删时置空。
  subject TEXT, -- 记忆短主题或 key，例如 "prefers concise explanations" 或某个概念名。
  content TEXT NOT NULL, -- consolidation 后的记忆陈述；这是可展示、可导出的记忆正文。
  importance REAL NOT NULL DEFAULT 0, -- 检索排序信号：重要性；由管线、重复出现和用户反馈共同影响。
  confidence REAL NOT NULL DEFAULT 0, -- 检索和展示信号：置信度；冲突信息会降低或触发 revision。
  recency_at TEXT NOT NULL, -- 最近一次被 evidence 强化或用户确认的时间；检索时和相似度一起加权。
  hit_count INTEGER NOT NULL DEFAULT 0, -- 该记忆背后重复出现的次数；支持"跨书/对话反复出现"这个信号。
  pinned INTEGER NOT NULL DEFAULT 0, -- 用户显式 pin/correct 后的重要反馈（memory.feedback）；检索时应提高优先级。
  status TEXT NOT NULL DEFAULT 'active', -- active、superseded、forgotten、rejected；控制是否进入上下文组装。
  superseded_by TEXT REFERENCES memories(id) DEFERRABLE INITIALLY DEFERRED, -- 当新记忆替代旧记忆时，旧记忆指向新的 memory_id。
  created_event_id TEXT REFERENCES domain_events(id) DEFERRABLE INITIALLY DEFERRED, -- 产生该记忆的 memory.promoted 事件 ID；保证 projection 可审计。
  created_at TEXT NOT NULL, -- 记忆首次创建时间。
  updated_at TEXT NOT NULL -- 记忆最近 revision、feedback、decay 或 supersede 时间。
); -- memories 表结束。

CREATE INDEX ix_memories_status_kind ON memories (status, kind); -- 检索和 Memory 管理界面筛选 active/pinned/forgotten 时使用。
CREATE INDEX ix_memories_scope_book ON memories (scope, book_id); -- 当前阅读一本书时先取 book/user 作用域记忆。
CREATE INDEX ix_memories_entity ON memories (entity_id); -- 围绕某个解析实体召回相关长期记忆时使用。
CREATE INDEX ix_memories_importance ON memories (importance); -- 在相似度之外按重要性排序或清理低价值记忆时使用。

CREATE TABLE memory_evidence ( -- [projection] 记忆 provenance；说明某条记忆来自哪些事件、书、笔记、高亮或对话消息，支持审计和去重。前瞻，暂无生产者。
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE, -- 被支持的 memory ID。
  source_kind TEXT NOT NULL, -- evidence 类型：event、book、highlight、note、ai_message、entity、manual_feedback。
  source_id TEXT NOT NULL, -- evidence 的具体 ID，例如 domain_events.id、highlights.id、notes.id 或 ai_messages.id。
  quote TEXT, -- 可选证据片段；用于 Memory 管理界面解释为什么记住这件事。
  weight REAL NOT NULL DEFAULT 1, -- 该证据对记忆的重要程度；重复出现、用户确认可提高权重。
  created_at TEXT NOT NULL, -- evidence 首次关联到记忆的时间。
  PRIMARY KEY (memory_id, source_kind, source_id) -- 同一证据对同一记忆只记录一次。
); -- memory_evidence 表结束。

CREATE INDEX ix_memory_evidence_source ON memory_evidence (source_kind, source_id); -- 从一条笔记/消息反查它支撑了哪些记忆时使用。

CREATE TABLE working_memory ( -- [projection] 当前阅读会话的短期工作记忆；可丢弃、可重建，不进入长期同步事实。前瞻，暂无生产者。
  id TEXT NOT NULL PRIMARY KEY, -- 工作记忆 ID；通常由 session 或当前 book + hash 派生。
  book_id TEXT REFERENCES books(id) ON DELETE CASCADE, -- 这条短期记忆所属书籍；用户级短期上下文可为空。
  conversation_id TEXT REFERENCES ai_conversations(id) ON DELETE CASCADE, -- 如果来自当前书内 AI 对话，记录 conversation ID。
  content TEXT NOT NULL, -- 短期上下文内容，例如当前章节摘要、最近提问意图、临时解释约束。
  salience REAL NOT NULL DEFAULT 0, -- 短期检索权重；越高越容易进入当前 context bundle。
  expires_at TEXT, -- 过期时间；到期后可由本机清理，不需要同步删除事件。
  created_at TEXT NOT NULL, -- 工作记忆创建时间。
  updated_at TEXT NOT NULL -- 工作记忆最近更新或 salience 调整时间。
); -- working_memory 表结束。

CREATE INDEX ix_working_memory_book ON working_memory (book_id, salience); -- 阅读某本书时按 salience 取短期工作记忆。
CREATE INDEX ix_working_memory_expires ON working_memory (expires_at); -- 清理过期 working memory 时使用。

CREATE TABLE context_bundles ( -- [projection] 可导出的结构化上下文包；用于外部 agent 或系统，而不是拼接 prompt 字符串。前瞻，暂无生产者。
  id TEXT NOT NULL PRIMARY KEY, -- context bundle 版本 ID；每次 assembly 生成一个不可变版本。
  bundle_key TEXT NOT NULL, -- 稳定 bundle key，例如 user_profile_context 或 book_memory:<bookId>。
  type TEXT NOT NULL, -- bundle 类型：user_profile_context、reading_intent_context、book_memory_context、conversation_insights_context。
  scope_id TEXT, -- bundle 作用域 ID；book_memory_context 通常是 book_id，用户级 bundle 可为空。
  version INTEGER NOT NULL, -- 同一个 bundle_key 下递增版本号；导出和复现时能精确引用某一版。
  content_json TEXT NOT NULL, -- 结构化上下文包 JSON；外部 agent 读取它而不是读取原始聊天 transcript。
  checksum TEXT NOT NULL, -- content_json 的哈希；用于去重、导出完整性和判断 bundle 是否变化。
  assembled_from_hlc_wall_ms INTEGER, -- assembly 时 event log 已消费到的 HLC wallMs，说明该 bundle 覆盖到哪个事实时间点。
  assembled_from_hlc_counter INTEGER, -- assembly 时 event log 已消费到的 HLC counter。
  assembled_from_hlc_device TEXT, -- assembly 时 event log 已消费到的 HLC deviceId。
  assembled_at TEXT NOT NULL -- 该版本上下文包生成时间。
); -- context_bundles 表结束。

CREATE UNIQUE INDEX ix_context_bundles_key_version ON context_bundles (bundle_key, version); -- 保证同一 bundle_key 的版本号唯一并支持按版本导出。
CREATE INDEX ix_context_bundles_type_scope ON context_bundles (type, scope_id); -- 按 bundle 类型和作用域查当前可导出上下文。

CREATE TABLE context_bundle_items ( -- [projection] 上下文包引用的具体来源清单；让导出的 bundle 可解释、可审计、可局部刷新。前瞻，暂无生产者。
  bundle_id TEXT NOT NULL REFERENCES context_bundles(id) ON DELETE CASCADE, -- 所属 context bundle 版本 ID。
  source_kind TEXT NOT NULL, -- 来源类型：memory、highlight、note、book、ai_message、profile。
  source_id TEXT NOT NULL, -- 来源对象 ID；用于从 bundle 反查原始事实。
  rank INTEGER NOT NULL, -- 该来源在 bundle 里的排序；越小越靠前。
  score REAL, -- 组装时的综合分数；可由语义相似度、重要性、recency、用户反馈混合得到。
  PRIMARY KEY (bundle_id, source_kind, source_id) -- 同一 bundle 版本里同一来源只出现一次。
); -- context_bundle_items 表结束。

CREATE TABLE vector_documents ( -- [local index] SQLite 侧的向量索引 manifest；真正 embedding 向量在 LanceDB，这里只记录来源、hash 和索引状态。前瞻，暂无生产者。
  id TEXT NOT NULL PRIMARY KEY, -- 向量文档 ID；同一个 source 可以拆多 chunk，因此它不一定等于 source_id。
  source_kind TEXT NOT NULL, -- 被嵌入的来源类型：memory、working_memory、highlight、note、ai_message、book_section。
  source_id TEXT NOT NULL, -- 来源对象 ID；用于 LanceDB 命中后回到 SQLite 取权威内容。
  source_sub_id TEXT, -- 来源内部 chunk ID，例如章节号、消息附件号或长笔记分段号。
  book_id TEXT REFERENCES books(id) ON DELETE CASCADE, -- 如果来源属于某本书，记录 book_id；用户级记忆可为空。
  content_hash TEXT NOT NULL, -- 被 embedding 的文本内容 hash；内容变了就标记旧向量 stale 并重新入队。
  embedding_model TEXT NOT NULL, -- 生成该向量使用的 embedding 模型名；换模型时可按它批量重建。
  embedding_dimension INTEGER NOT NULL, -- 向量维度；确保 LanceDB 表和查询 embedding 维度一致。
  lance_table TEXT NOT NULL DEFAULT 'semantic_index', -- LanceDB 中存放该向量的表名；默认统一语义索引表。
  indexed_at TEXT, -- 成功写入 LanceDB 的时间；为空表示还未完成 embedding/upsert。
  stale_at TEXT -- 来源内容或 embedding 模型变化导致该向量过期的时间；不为空时检索应忽略并等待重建。
); -- vector_documents 表结束。

CREATE INDEX ix_vector_documents_source ON vector_documents (source_kind, source_id); -- LanceDB 命中后按来源反查 manifest，或来源更新时找所有向量 chunk。
CREATE INDEX ix_vector_documents_book ON vector_documents (book_id); -- 当前书阅读时限制召回范围或重建该书索引时使用。
CREATE INDEX ix_vector_documents_pending ON vector_documents (source_kind, source_id) WHERE indexed_at IS NULL; -- partial 工作队列：只命中尚未写入 LanceDB 的文档。
CREATE INDEX ix_vector_documents_stale ON vector_documents (stale_at) WHERE stale_at IS NOT NULL; -- partial 工作队列：只命中已过期、需要重建的文档。

CREATE TABLE embedding_jobs ( -- [device-local] 本机 embedding 队列；远程 LLM 推理和本地数据是两条轴，embedding job 只负责把 SQLite 内容索引进 LanceDB。前瞻，暂无生产者。
  id TEXT NOT NULL PRIMARY KEY, -- job ID；用于 worker 幂等重试和调试。
  vector_document_id TEXT NOT NULL REFERENCES vector_documents(id) ON DELETE CASCADE, -- 需要生成/更新向量的 manifest 文档 ID。
  state TEXT NOT NULL DEFAULT 'pending', -- job 状态：pending、running、done、failed、cancelled。
  attempts INTEGER NOT NULL DEFAULT 0, -- 已尝试次数；失败重试和退避策略需要。
  last_error TEXT, -- 最近一次 embedding 或 LanceDB upsert 失败的错误摘要。
  created_at TEXT NOT NULL, -- job 入队时间。
  updated_at TEXT NOT NULL -- job 最近状态变化时间。
); -- embedding_jobs 表结束。

CREATE INDEX ix_embedding_jobs_state ON embedding_jobs (state, updated_at); -- worker 按状态和时间取 pending/failed job 时使用。

CREATE TABLE reader_book_overrides ( -- [device-local] 每本书的阅读外观覆盖；对应 in-reader appearance popover 的 Global/This book scope。
  -- 注意：book_id 是**逻辑**指向 books.id，但**故意不建外键**。这是设备本地、非派生状态，
  -- 不能从事件日志重建；若建 FK+CASCADE，一旦 books 这个 projection 走 DELETE 重建就会被级联清空。
  -- 书被移除后这里可能留下孤儿行（无害），由本机机会性清理。
  book_id TEXT NOT NULL PRIMARY KEY, -- 被单独定制阅读外观的书籍 ID（逻辑引用 books.id，不 FK 约束）。
  scope TEXT NOT NULL DEFAULT 'global', -- 当前该书使用 global 还是 book；global 时仍保留 settings snapshot 以便切回 book。
  reader_theme TEXT NOT NULL DEFAULT 'warm', -- 该书覆盖的页面颜色偏好；只在 scope 为 book 时生效。
  reader_font_family TEXT NOT NULL DEFAULT 'curated:inter', -- 该书覆盖的阅读字体；保留用户为这本书选择过的字体。
  reader_font_size TEXT NOT NULL DEFAULT 'medium', -- 该书覆盖的字号档位；只影响这本书。
  reader_line_spacing TEXT NOT NULL DEFAULT 'comfortable', -- 该书覆盖的行距；只影响这本书。
  reader_paragraph_spacing TEXT NOT NULL DEFAULT 'normal', -- 该书覆盖的段落间距；只影响这本书。
  reading_mode TEXT NOT NULL DEFAULT 'scroll', -- 该书覆盖的阅读模式；例如某些 PDF/长文更适合固定翻页或滚动。
  updated_at TEXT NOT NULL -- 该书外观覆盖最近修改时间。
); -- reader_book_overrides 表结束。

CREATE TABLE reader_panel_layouts ( -- [device-local] 每本书阅读器侧栏开合状态；替代 read-aware-reader-panels。
  -- 同 reader_book_overrides：book_id 逻辑引用 books.id，故意不建外键，避免 projection 重建级联清空本地状态。
  book_id TEXT NOT NULL PRIMARY KEY, -- 被记录侧栏状态的书籍 ID（逻辑引用 books.id，不 FK 约束）。
  toc_open INTEGER NOT NULL DEFAULT 0, -- 阅读器左侧目录面板是否打开；重开同一本书时恢复。
  chat_open INTEGER NOT NULL DEFAULT 0, -- 阅读器右侧 AI chat 面板是否打开；当前代码里的 notesOpen 实际是 chat panel。
  updated_at TEXT NOT NULL -- 该书侧栏开合状态最近修改时间。
); -- reader_panel_layouts 表结束。

CREATE TABLE import_jobs ( -- [device-local] 可选的导入流水表；让大文件导入、封面抽取、重复检测失败时有可观察状态。
  id TEXT NOT NULL PRIMARY KEY, -- 导入任务 ID；一次多文件导入中的每个文件可独立一条。
  file_name TEXT NOT NULL, -- 用户选择的源文件名；导入失败时用于错误提示。
  file_size INTEGER, -- 用户选择的源文件大小；用于重复检测和诊断。
  detected_format TEXT, -- detectBookFormat 得出的格式：epub、mobi、azw3、fb2 或 pdf。
  state TEXT NOT NULL DEFAULT 'pending', -- 导入状态：pending、reading_file、extracting_metadata、done、duplicate、failed。
  book_id TEXT REFERENCES books(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED, -- 导入成功或判定重复时关联的 book ID；book 被删时置空，不阻塞删除。
  duplicate_of_book_id TEXT REFERENCES books(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED, -- 如果判定为重复导入，记录已存在的 book ID；同样在 book 被删时置空。
  last_error TEXT, -- 导入失败的错误摘要，例如 unsupported file type 或 source blob 写入失败。
  created_at TEXT NOT NULL, -- 导入任务创建时间。
  updated_at TEXT NOT NULL -- 导入任务最近状态更新时间。
); -- import_jobs 表结束。

CREATE INDEX ix_import_jobs_state ON import_jobs (state, updated_at); -- 导入队列或调试界面按状态查看任务时使用。
