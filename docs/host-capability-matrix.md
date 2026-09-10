# ReadAware 宿主 × Agent × 插件能力矩阵

人读版：[可筛选大表](./host-capability-matrix.html)。原验收契约：[插件能力完备基线](./plugin-capability-baseline.md)。

- 状态：**代码盘点完成；能力实现与桌面验收未完成**。
- 最后核验日期：2026-09-10。
- 范围：当前 Tauri 桌面宿主及必要组合协议；Agent 指 ReadAware 产品内的模型工具与自动管线，不是外部 Coding Agent 的电脑控制能力。
- [代码] 243 行 / 13 组，129 个既有验收项全部有对应行。字段行是可核对设置清单，不能与功能族相加当产品功能数量。
- [设计] 两个目标列是建议开放方式/刻意拒绝方式，尚未实现的目标不混入当前状态。
- 修改事实源 [host-capability-matrix.data.ts](./host-capability-matrix.data.ts)，再运行 [生成器](../scripts/build-host-capability-matrix.ts)；不要分别手改生成的 MD/HTML。

## 结论

1. 不能确认能力都已实现。此表区分宿主行为、Agent 工具/自动管线、插件 API/贡献和实际插件消费者；没有把代码存在算成端到端可用。
2. 运行态正在接通：版本化位置、会话快照、精确搜索、导航回执/历史与朗读启停已由共享域提供给 Agent、Jumper 和 Listening Desk。模式控制、通用任务与资源释放、全部格式及跨平台验收仍未完成；持久化领域 API 无法代表全部产品能力。
3. 6 个旧设置路径仍未找到对应效果消费者；两端可改值不等于行为覆盖。两个文本发送设置已过滤 Agent 自动输入/历史附件并在收紧时取消，插件结构化 readingContext 与 Dictionary 1.3 也已接通，任意 prompt/HTTP/TTS 仍有边界；buildMemory 已控制记忆构建与在途取消；localOnly 已接入宿主 Agent/插件 LLM 的拒绝与在途取消，但任意插件 HTTP/TTS/同步仍不受该策略约束，保留部分。settings 1.2 的九项真实偏好已接通；书架布局/分组/排序已接 settings 1.3；快捷键绑定查询/重绑/冲突/null 恢复与激活冲突暂停已接 settings 1.5；原生快捷键编辑与停用命令清理已统一；UI 1.3 将语义导航、命令搜索、当前集合和分页选择集接到双端，Library Desk 0.3 已组合。settings 1.6 新增已提交设置观察，Workspace Profiles 0.3 已实时组合；旧命令事件、来源身份完整性、实际效果与打包跨平台等缺口仍在。
4. memory 1.5 与 Memory Desk 0.6 已接记忆检索、保护图谱、条件反馈、分类查询/纠正与公共图谱任务；Agent 共享检索与写入，分类变更及图谱生成逐次批准。查询观察与编译视图已接变化/错误/恢复，分类冲突保留草稿；按书授权、摘要来源版本及 token/费用预算仍缺；章节上限已接两端及真实批准界面。自动巩固/digest 已接入，画像 seed/实体事件投影与正式 bundle 未同等接通，不混计完成。
5. 插件 UI、贡献注册、宿主消费、模型工具是不同方向。Dictionary/RSS 提供模型工具；宿主 control_read_aloud、configure_reading_mode 与 navigate_reading 统一消费声音和模式提供者，Listening Desk 调用相同控制器。主题调度/WebDAV 连接仍无同等直接操作工具；设置可改不等于行为接通。
6. 备份 v1 并非全部当前存储的完整快照；私有数据、聊天、记忆、密钥、日志与同步状态的生命周期必须分别建模。原基线 129 项与 GAP01–GAP18 均保留，没有借新表宣告关闭。

## 计数与口径

- 宿主：实装 194、部分 43、待建 3、占位 2、非桌面 1。
- Agent：接通 134、部分 59、扩展 13、未接 20、自动 13、内部 4。
- 插件：接通 149、部分 81、未接 13。

不提供一个虚假的“整体覆盖率”：这里既有功能族也有逐字段行，且自动管线、插件条件扩展、禁止开放、宿主未建不应混为一个分母。上面的数量是本表状态分布，不是通过率。当前可调用具体入口的库存另列，入口数也不代表语义完整。

| 标记 | 精确定义 |
| --- | --- |
| 宿主 实装 | 存在产品调用链。只表示本地源码接线，不承诺本次 Tauri/生产验证。 |
| 宿主 部分 / 引擎 / 占位 / 待建 / 非桌面 | 分别是语义缺环、仅引擎实现、声明/禁用 UI/无投影、当前无通用实现、排除出桌面产品。 |
| Agent/插件 接通 | 当前正式入口覆盖该行明确限定的操作，且有宿主调用链。授权、数据与配置仍需满足。 |
| 部分 | 有入口或有替代组合，但该行指出的参数、行为、生命周期或效果缺失。不是 0.5 个功能。 |
| 自动 / 内部 | 自动是运行时实际调用而非模型工具；内部是端口/函数/底层事件存在但未发现同等产品入口。 |
| 扩展 | 只在对应插件已安装且启用、scope 匹配时，由插件工具/检索贡献进入模型。 |
| 未接 | 该 actor 无正式入口。目标列为不开放的行是有意边界，不是应补权力；其余是需建模/接线缺口。 |

## 根因与闭包

[代码+推论] 反复缺能力不是“插件算法太新”，而是盘点一直从已导出的 API 往外看：数据库领域、React 闭包、阅读引擎、原生 IPC、Agent port、Worker 服务和声明式视图各有独立能力集合，当前并无单一行为注册源将它们联系起来。

1. 数据域只覆盖持久化对象，不覆盖当前会话、选择、面板、播放、历史和任务。
2. 把实现所有权误当作调用禁令。宿主必须拥有 DOM/密钥/文件，但仍应提供有权调用的语义对象和操作。
3. 生产和消费的引用不闭合：TOC 不给 href，搜索不给可定位 Range，导航不给完成，事件不给当前快照。
4. 接线不止一层：字段已保存、方法已导出、Worker 能调用、工具已注册、消费者实际使用、异常退出正确，六件事不能互相代替。
5. 同一个 Agent 一词混合了模型工具与后台管线；同一个插件一词混合了 API 可用与已有插件是否贡献工具，导致覆盖度被高估。
6. 测试多验证现有接口形状，缺少“宿主新增行为必须映射到两个 actor 或明确拒绝”的门禁。

[设计] 每项能力都应有：对象/引用、读/写/导航/呈现操作、可观察状态、授权与审批、完成/失败/取消、资源所有权与释放、消费者和验收证据。不是为每个 UI 按钮复制一个 API，也不是为每个插件新增宿主业务表。

[设计] “不改宿主”承诺的边界是此验收基线允许的原语与组合，且必须先真正实现并通过失败/并发/撤权场景。新插件算法、编号规则、导出格式、HTTP 来源不算新宿主能力；新格式解码器、系统权力、产品数据模型或 UI 渲染原语才算。无权限/无文本/资源失效应有明确结果，不是放弃这项承诺的借口。

## 总矩阵

每个 current 单元格为 [代码]，目标列为 [设计]。同一行的消费者只列已查到者，不暗示所有插件均使用。来源链接指向当前仓库源码，不是不可变远端快照。

统一目标、责任划分与避免过度设计的裁决见 [宿主能力统一模型](./host-capability-model.md)。本表目标列为逐行建议；统一模型进一步区分必补、组合、宿主内部与未来产品，不把每个建议都当必建 API。

### 书库与内容生命周期

| ID | 宿主能力 | 宿主现状 | Agent 当前与目标 | 插件当前与目标 | 实际消费者 | 缺口/边界 | 来源 | 旧基线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <a id="LIB01"></a>LIB01 | 枚举/查询书籍与书目元数据 | 实装 | **接通**：list_books[全局] / get_book_overview[双域]<br>[设计] 查询工具 | **接通**：library.queries.books.list/get<br>[设计] 只读领域 | 书架；RSS 订阅校验 | Agent 读模型不含封面和原文件；字段不能借元数据查询全部泄露 | [LIB](../apps/web/src/domain/library.ts) [LIBTOOLS](../packages/agent/src/tools/library-tools.ts) [LIBPORT](../apps/web/src/features/ai/agent/ports/library-port.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | B01 |
| <a id="LIB02"></a>LIB02 | 修改标题/作者 | 实装 | **接通**：update_book<br>[设计] 写工具 | **接通**：library.commands.books.editMetadata<br>[设计] 写领域 | 书架；Agent | 已有单项写，批量与冲突另列 | [LIB](../apps/web/src/domain/library.ts) [LIBUI](../apps/web/src/features/library/hooks/useLibraryCommands.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | B02 |
| <a id="LIB03"></a>LIB03 | 收藏/取消收藏 | 实装 | **接通**：update_book.starred<br>[设计] 写工具 | **接通**：library.commands.books.setStarred<br>[设计] 写领域 | 书架；Agent | 按对象授权与写回执仍需基线回归 | [LIB](../apps/web/src/domain/library.ts) [LIBUI](../apps/web/src/features/library/hooks/useLibraryCommands.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | B02 |
| <a id="LIB04"></a>LIB04 | 删除单本书 | 实装 | **接通**：delete_book + 用户批准<br>[设计] 受控写工具 | **接通**：library.commands.books.remove<br>[设计] 写领域/风险策略 | 书架；Agent；RSS | Agent 有批准环节；插件是已授权直接写，不等价于逐次批准 | [LIB](../apps/web/src/domain/library.ts) [LIBUI](../apps/web/src/features/library/hooks/useLibraryCommands.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | B02 |
| <a id="LIB05"></a>LIB05 | 批量删除书籍 | 实装 | **接通**：delete_books[全局]：固定批次一次批准/cleanupOnly；list_book_removal_cleanup<br>[设计] 批量受控工具与恢复查询 | **接通**：library 1.6 books.removeMany/retryRemovalCleanup；listRemovalCleanup<br>[设计] 原子记录批次与耐久文件清理 | 书架多选；Agent；Library Desk 0.2 选择/审阅/删除/恢复查询/重试 | 1–1000 个非空 ID，每个至多 256 字符，复制去重、不强制转换。事件/投影事务失败全回滚；提交后通知，再清源文件/封面，committed:true 与 files.released/pending 分开。迁移 31 删除触发器在记录事务内登记设备本地清理意图，恢复插入取消意图；两端可按 ID 游标查询 1–100 项（默认 50），不需保留旧回执。启动每页 100 项逐项重试，失败保留且不饿死后页；不是周期任务。文件元数据与意图确认同事务，物理删除可部分完成；重试不新增删除事件。原生持锁预检所有 ID，书已恢复或投影 stale 拒绝清理；重放后仍存在书的意图在同事务取消。Agent 批准/插件域授权边界不变。隔离 macOS debug 验权限、新消费者跨重启查询、插件菜单与 Agent 批准重试；既有原子回滚/恢复保护证据保留。迁移前孤立文件不回填；不是跨设备 CAS、全数据擦除或通用耐久任务；旧单删仍以异常表达文件失败。1000 项真实负载、晚到 blob 写入、packaged/Windows/Linux 未验。 | [LIB](../apps/web/src/domain/library.ts) [LIBUI](../apps/web/src/features/library/hooks/useLibraryCommands.ts) [BOOKBATCH](../apps/web/src/features/library/lib/book-removal.ts) [BOOKBATCHTOOL](../packages/agent/src/tools/delete-books.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [LIBRARYDESK](../plugins/library-desk/src/views.ts) [BOOKBATCHPROOF](../docs/evidence/book-batch-removal-2026-09-09.json) [BOOKCLEANUP](../apps/desktop/src-tauri/src/storage/library_cleanup.rs) [BOOKCLEANUPPROOF](../docs/evidence/book-removal-recovery-2026-09-09.json) | B02 |
| <a id="LIB06"></a>LIB06 | 导入已有支持格式的书籍字节 | 实装 | **部分**：import_resource_book[global]<br>[设计] 用户选文件后导入工具 | **部分**：library 1.8 commands.books.importBook/importResource<br>[设计] 导入任务 | 书架导入/拖放/系统打开；授权资源导入 | 已接本调用方封口资源直接导入，同源格式检测、原生内容去重和事件落库；返回 imported/duplicate 与实际书籍，修复缺失原书也通知刷新。Agent 逐次批准，插件需 library:write。受理前取消不派发，受理后完成落库而非承诺回滚；不打开书、不改原件、不释放引用。完整任务进度/取消协议与真实组合导入验收仍缺。 | [IMPORT](../apps/web/src/features/library/lib/book-import.ts) [LIB](../apps/web/src/domain/library.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) [RESOURCEIMPORT](../apps/web/src/domain/library-resource-import.ts) [RESOURCEFILES](../apps/desktop/src-tauri/src/resources.rs) [RESOURCETOOLS](../packages/agent/src/tools/resource-tools.ts) | B04 |
| <a id="LIB07"></a>LIB07 | 识别格式/DRM/损坏文件并报告 | 实装 | **接通**：list_book_formats[双域]/inspect_resource_book[全局]<br>[设计] 格式目录/授权文件检查 | **接通**：library 1.11 books.listFormats/inspectResource<br>[设计] 读授权与自有封口资源 | 导入/阅读共享路由；授权文件初始化检查 | 格式目录与导入共用扩展名/MIME 规则，formatHint 不是字节身份。检查借用本 actor 封口资源，用同一 parseBookFile，返回 parsed/unsupported/encrypted/failed、初始化覆盖范围、sectionCount 和稳定错误码；不返回标题/正文/路径、不导入/打开/写书库或同步。未知解析错误不谎称已证实损坏，存储/租约失败拒绝；MOBI/EPUB 加密码及 PDF 密码失败单列。只初始化，不逐节加载、渲染或证明全书完好。全宿主串行、最多 8 待处理；原生读每块最多 1 MiB，部分格式仍整文件内存。取消阻止后续读/结果交付，已运行解析排空销毁。定向类型/权限/失败测试通过；实际加密/坏书及所有格式的 Tauri 组合待集中 E2E。 | [IMPORT](../apps/web/src/features/library/lib/book-import.ts) [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [SESSION](../apps/web/src/features/reader/hooks/useReaderSession.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [BOOKINSPECT](../apps/web/src/domain/book-inspection.ts) [BOOKFORMATS](../packages/core/src/book-inspection.ts) [RESOURCEBOOK](../apps/web/src/platform/resource-book-file.ts) [RESOURCETOOLS](../packages/agent/src/tools/resource-tools.ts) | B08 |
| <a id="LIB08"></a>LIB08 | 查询/读取书籍原文件与本地可用性 | 实装 | **接通**：open_book_resource/save_resource[双域]<br>[设计] 批准后只导出的原书引用 | **接通**：resources.openBook/read/save<br>[设计] 受 library 授权的原文件快照 | 阅读加载；备份；同步；正式资源服务 | 本地无原文件返回 null，书已删除报错，不自动下载。插件获 library 读/写才提供 openBook；Agent 逐次批准、书内仅当前书，原书引用在端口禁止读入模型，正文仍走防剧透工具。引用是已获得的临时独立副本，源变更不替换快照，释放/到期不删原书；无路径/原生键暴露。接线及定向测试完成，真实 Tauri 组合验收待集中进行。 | [BLOB](../apps/web/src/platform/blob-store.ts) [SESSION](../apps/web/src/features/reader/hooks/useReaderSession.ts) [LIB](../apps/web/src/domain/library.ts) [API](../packages/plugin-types/src/index.ts) [RESOURCES](../apps/web/src/services/resources.ts) [RESOURCEOWNER](../apps/web/src/services/resource-owner.ts) [RESOURCEFILES](../apps/desktop/src-tauri/src/resources.rs) [RESOURCETOOLS](../packages/agent/src/tools/resource-tools.ts) | B05 |
| <a id="LIB09"></a>LIB09 | 提取/显示封面与封面可用状态 | 实装 | **部分**：present_books；open_book_cover/get_book_enrichment[双域]<br>[设计] 封面资源查询/呈现 | **部分**：resources 1.1 openCover/read/save；library 1.9 getEnrichment/observeEnrichment<br>[设计] 封面 ResourceRef | 书架；Agent 书卡；封面后台补齐；资源查询/保存/复制 | 本地 ready 封面可取得 owner 隔离快照，需书库读授权；Agent 书内限本书、只收元数据不收图片字节。library 1.9 区分 unchecked/none/ready、封面本地与原文件本地状态；插件观察初始/变化/错误恢复，串行回调后每秒刷新，非逐事件流。未知书/存储失败拒绝；资源查询不生成/下载且不随封面变化。缺失提取重试见 LIB10；插件资源引用呈现仍缺，实际 Tauri 组合待集中验证。 | [ENRICH](../apps/web/src/features/library/lib/book-enrichment.ts) [LIB](../apps/web/src/domain/library.ts) [PRESENT](../packages/agent/src/tools/present-tools.ts) [API](../packages/plugin-types/src/index.ts) [RESOURCES](../apps/web/src/services/resources.ts) [RESOURCEOWNER](../apps/web/src/services/resource-owner.ts) [RESOURCEFILES](../apps/desktop/src-tauri/src/resources.rs) [RESOURCETOOLS](../packages/agent/src/tools/resource-tools.ts) [ENRICHCONTROL](../apps/web/src/domain/book-enrichment.ts) [ENRICHTOOLS](../packages/agent/src/tools/enrichment-tools.ts) | B05 |
| <a id="LIB10"></a>LIB10 | 缺失封面/元数据后台补齐 | 实装 | **接通**：get_book_enrichment/retry_book_enrichment[双域]<br>[设计] 状态查询/受控重试 | **接通**：library 1.9 books.getEnrichment/retryEnrichment；events.observeEnrichment<br>[设计] 状态查询/受控重试 | 自动 catch-up；已开书复用；插件/Agent 受控重试 | 读不启动任务；重试需 library:write，Agent 仅明确意图/书内仅本书。共享队列后台单解析、同书合并/去重；queued/already-running 不冒充完成，completed/skipped/failed 与稳定错误分开。仅本地支持格式，不下载/调用模型；只补 unchecked 封面与缺失/文件名来源元数据，不强制重做 ready/none。元数据缺失是启发式，未找到更好信息可 skipped。当前进程最多 256 任务条目，淘汰旧终态，重启不保留；观察每 actor 64。受理后任务不随调用方取消撤销；提取失败不再提交 none，当前读到的自定义字段不覆盖。最终写入非跨设备 CAS，完整格式/并发原生验收仍待集中进行。 | [ENRICH](../apps/web/src/features/library/lib/book-enrichment.ts) [APP](../apps/web/src/App.tsx) [COREVENTS](../packages/core/src/events.ts) [ENRICHCONTROL](../apps/web/src/domain/book-enrichment.ts) [ENRICHQUEUE](../apps/web/src/features/library/lib/enrichment-queue.ts) [ENRICHTOOLS](../packages/agent/src/tools/enrichment-tools.ts) [LIB](../apps/web/src/domain/library.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | B08 |
| <a id="LIB11"></a>LIB11 | 重复检测、同源书合并和 ID 重定向 | 实装 | **接通**：list_duplicate_books/preview_book_merge/merge_duplicate_books/resolve_book_reference[全局]<br>[设计] 候选/预览/批准合并/重定向 | **接通**：library 1.10 books.listDuplicates/previewMerge/resolveId/mergeDuplicates<br>[设计] 候选/预览/条件合并/重定向 | 导入去重；同步后与双端共用条件合并 | 仅原文件 hash 相同组，最早 createdAt 再按 ID 保留，不按相似标题任意归并。读需 library:read，插件写需 library:write，global Agent 逐次批准完整组；事务重验成员/展示元数据/身份事件版本，最多 1000 重复记录，原始事件原子提交并回执 ID 映射。阅读/标注按提交时宿主规则归并，不冻结全部状态；聊天不合成单线程。保留唯一原文件，继承封面按投影 key 读取；旧 alias 资产在 keeper 存活时固定保留，非立即磁盘回收。文件复制失败不删原件，SQL 回滚可留额外缓存字节。已派发取消不回滚；未知/已删 ID resolve 为 null。定向与 Rust 测试通过，Worker/批准 UI/真实同步与格式仍待集中 Tauri E2E。 | [DEDUPE](../apps/web/src/platform/book-dedupe.ts) [LIB](../apps/web/src/domain/library.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) [BOOKMERGE](../apps/web/src/domain/book-merge.ts) [NATIVEMERGE](../apps/desktop/src-tauri/src/storage/book_merge.rs) [MERGETOOLS](../packages/agent/src/tools/book-merge-tools.ts) [API](../packages/plugin-types/src/index.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | A04, B06 |
| <a id="LIB12"></a>LIB12 | 创建/幂等绑定虚拟书并更新标题 | 实装 | **扩展**：RSS subscribe_feed[全局]<br>[设计] 内容创建工具/贡献消费 | **接通**：addVirtualBook，同 binding 更新标题<br>[设计] 插件自有内容领域 | RSS | 不是所有虚拟书创建都自动成为 Agent 工具；仅 RSS 提供一例 | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [VIRTUAL](../apps/web/src/features/plugins/lib/virtual-books.ts) [RSSFEED](../plugins/rss-reader/src/feed.ts) [RSSTOOLS](../plugins/rss-reader/src/agent-tools.ts) | B07 |
| <a id="LIB13"></a>LIB13 | 移除插件自有虚拟书 | 部分 | **部分**：delete_book 通用删除；全局清理查询/重试；无 RSS 退订工具<br>[设计] 受控删除工具 | **部分**：removeVirtualBook 传播删除失败并等待绑定清理持久化；library 1.6 文件恢复<br>[设计] 自有内容删除回执 | RSS 退订；书架删除后订阅清理 | 确认读前等待既有 KV 写结算，事件提交失败保留绑定，清理等待持久回执；已删书后失败仍拒绝，显式重试完成解绑。通知先于文件释放，绑定可能已清除；再次 removeVirtualBook 不重试文件，但 library 1.6 宿主持久意图保留书 ID/标题，两端 listRemovalCleanup/文件重试与启动恢复不再依赖绑定或旧回执。无源文件的合成虚拟书已验证意图确认失败时绑定消失、队列仍在，移除故障后重启清理完成，不冒充虚拟文件 I/O。损坏绑定报 db/error、不当空表或覆盖；同 ID 绑定变化拒绝清理。既有真实 Worker/Agent 插件工具的事件和 KV 拒绝测试保留；不是自主模型/完整 RSS 退订验收。书籍、blob、绑定、RSS 文档不是联合原子事务；RSS 私有缓存、并发 add/remove、绑定崩溃恢复、packaged/跨平台仍缺。 | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [VIRTUAL](../apps/web/src/features/plugins/lib/virtual-books.ts) [RSSVIEWS](../plugins/rss-reader/src/views.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [VIRTUALREMOVALPROOF](../docs/evidence/virtual-book-removal-2026-09-09.json) [BOOKBATCH](../apps/web/src/features/library/lib/book-removal.ts) [BOOKCLEANUP](../apps/desktop/src-tauri/src/storage/library_cleanup.rs) [BOOKCLEANUPPROOF](../docs/evidence/book-removal-recovery-2026-09-09.json) | B07 |
| <a id="LIB14"></a>LIB14 | 虚拟内容修订/离线缓存/当前书刷新 | 部分 | **扩展**：RSS refresh_feed[全局]<br>[设计] 内容刷新工具 | **部分**：contentProviders.load + 私有缓存<br>[设计] revision/失效/重载契约 | RSS | 订阅缓存更新不是通用内容版本协议；在读书/旧位置失效未闭合 | [VIRTUAL](../apps/web/src/features/plugins/lib/virtual-books.ts) [RSSFEED](../plugins/rss-reader/src/feed.ts) [RSSVIEWS](../plugins/rss-reader/src/views.ts) [API](../packages/plugin-types/src/index.ts) | B07, N02 |
| <a id="LIB15"></a>LIB15 | 列出集合及其成员 | 实装 | **接通**：list_collections[全局]<br>[设计] 查询工具 | **接通**：library.queries.collections.list/booksIn<br>[设计] 只读领域 | 书架；Agent | 集合单归属模型保持不变 | [LIB](../apps/web/src/domain/library.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | B03 |
| <a id="LIB16"></a>LIB16 | 创建/重命名集合 | 实装 | **接通**：manage_collection[全局]<br>[设计] 写工具 | **接通**：collections.create/rename<br>[设计] 写领域 | 书架；Agent | 书内不注册全局集合管理工具是明确 scope 策略 | [LIB](../apps/web/src/domain/library.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | B03 |
| <a id="LIB17"></a>LIB17 | 删除集合 | 实装 | **接通**：delete_collection[全局] + 批准<br>[设计] 受控写工具 | **接通**：collections.remove<br>[设计] 写领域/风险策略 | 书架；Agent | 删除集合与删除其中书籍是不同操作 | [LIB](../apps/web/src/domain/library.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | B03 |
| <a id="LIB18"></a>LIB18 | 批量分配/移出集合 | 实装 | **接通**：manage_collection.assign[全局]<br>[设计] 批量写工具 | **接通**：collections.assignBooks<br>[设计] 批量写领域 | 书架拖放/多选；Agent | 移动书籍只是成员变更，不是文件移动 | [LIB](../apps/web/src/domain/library.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | B03 |

### 正文、检索与位置

| ID | 宿主能力 | 宿主现状 | Agent 当前与目标 | 插件当前与目标 | 实际消费者 | 缺口/边界 | 来源 | 旧基线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <a id="TXT01"></a>TXT01 | 读取抽取章节目录 | 实装 | **接通**：get_toc<br>[设计] 查询工具 | **接通**：library.queries.books.getToc<br>[设计] 正文查询 | Agent；抽取正文管线 | 同叫 TOC：模型输出不带 hrefs，插件也不带；不是原书完整目录 | [TEXT](../apps/web/src/features/library/lib/book-text-store.ts) [TEXTPORT](../apps/web/src/features/ai/agent/ports/book-text-port.ts) [TEXTTOOLS](../packages/agent/src/tools/book-text-tools.ts) [LIB](../apps/web/src/domain/library.ts) | C01 |
| <a id="TXT02"></a>TXT02 | 读取原书分层导航目录及 href | 实装 | **接通**：get_navigation_toc 返回分层目录/版本化 Location<br>[设计] 结构化导航目录工具 | **接通**：library v1.1 books.getNavigationToc<br>[设计] 分层目录 + Location | 宿主目录；Agent；Jumper 章节/目录序号 | ordinal 是深度优先目录序号，不是印刷章号；无位置标题返回 null；超大目录的模型输出窗口与全部格式验收仍需补齐 | [LOCATIONSEARCH](../apps/web/src/features/library/lib/book-location-search.ts) [CONTENTSOURCE](../apps/web/src/features/library/lib/book-content-source.ts) [NAVTOOLS](../packages/agent/src/tools/navigation-tools.ts) [JUMPER](../plugins/jumper/src/views.ts) | A03, C01 |
| <a id="TXT03"></a>TXT03 | 按抽取章节读正文/分段 | 实装 | **接通**：read_chapter(part)，带剧透控制<br>[设计] 分段读取工具 | **接通**：library.queries.books.getChapterText<br>[设计] 正文查询 | Agent；章节摘要 | 插件整章字符串不含坐标/语言/版本；Agent 分段不是渲染分页 | [TEXT](../apps/web/src/features/library/lib/book-text-store.ts) [TEXTTOOLS](../packages/agent/src/tools/book-text-tools.ts) [LIB](../apps/web/src/domain/library.ts) | C02 |
| <a id="TXT04"></a>TXT04 | 查询本地正文准备状态与文本存在性 | 实装 | **接通**：get_book_text_status 双 scope；get_toc 空结果保留状态<br>[设计] 显式可用性查询 | **接通**：library 1.2+ queries.books.getTextState<br>[设计] 只读正文状态查询 | Agent 正文工具；Text Desk 0.3 | status 七态与 text 三态独立；查询不抽取/下载。ready 要求所有必需节成功且最终索引落盘；短正文 available 可有 0 章，不是 textless。v5 源 hash/失败集合/最终化标记；v3/v4 惰性失效，不采信旧终局。真实 macOS debug Agent/权限 Worker、FB2/空白 PDF、部分失败重试与缺源/换 hash 已验；任务控制见 TXT05，持久 setup 错误/虚拟书派生索引/全部格式与 packaged 跨平台另欠 | [TEXT](../apps/web/src/features/library/lib/book-text-store.ts) [TEXTREPO](../apps/web/src/features/library/lib/book-text-repository.ts) [TEXTRECORD](../apps/web/src/features/library/lib/book-text-record.ts) [TEXTPORT](../apps/web/src/features/ai/agent/ports/book-text-port.ts) [TEXTTOOLS](../packages/agent/src/tools/book-text-tools.ts) [TEXTDESK](../plugins/text-desk/src/views.ts) [TEXTPROOF](../docs/evidence/book-text-state-2026-09-09.json) | C03 |
| <a id="TXT05"></a>TXT05 | 启动、重建、暂停让路正文抽取 | 实装 | **部分**：prepare_book_text / get_book_text_tasks / cancel_book_text_task 双 scope<br>[设计] 请求准备正文/完整任务控制 | **部分**：library 1.3 prepareText / cancelTextTask / getTextTask / listTextTasks / observeTextTask<br>[设计] 可取消正文准备任务与调度控制 | Text Desk 0.3；Agent；阅读需求优先调度 | 显式请求有五态/递增 revision/进度/稳定错误，prepare 复用成功断点，rebuild 清派生索引重读，忙时拒绝而不抢占。每个 actor 的请求只释放自己的共享租约，末租约取消阻止晚结果发布，已派发读写/下载不回滚。插件任务限当前激活代，Agent 两 scope 共享进程所有者；16 活跃/64 保留/每任务 16 观察者，慢回调合并最新快照。回执不等于完成或已获得解析租约。Text Desk 请求详情已组合 observeTextTask 与 UI 1.2 实时推送，关闭只退订而不取消请求；列表仍显式刷新。隔离 macOS debug 已验不点击刷新即由 0/3 Running 到 3/3 Completed 并移除取消按钮。权限/共享取消/重建和双端既有证据保留；显式 pause/resume/优先级、耐久任务历史/超时、reader-demand-activity 公共事件、虚拟索引和打包跨平台仍缺 | [TEXT](../apps/web/src/features/library/lib/book-text-store.ts) [TEXTREPO](../apps/web/src/features/library/lib/book-text-repository.ts) [TEXTEXTRACTION](../apps/web/src/features/library/lib/book-text-extraction.ts) [TEXTTASKS](../apps/web/src/features/library/lib/book-text-tasks.ts) [TEXTTASKTOOLS](../packages/agent/src/tools/book-text-task-tools.ts) [TEXTDESK](../plugins/text-desk/src/views.ts) [TEXTTASKPROOF](../docs/evidence/book-text-tasks-2026-09-09.json) [LIVEVIEWPROOF](../docs/evidence/plugin-live-views-2026-09-09.json) [APPEVENTS](../apps/web/src/platform/app-events.ts) [SESSION](../apps/web/src/features/reader/hooks/useReaderSession.ts) | C03 |
| <a id="TXT06"></a>TXT06 | 当前书及跨书多查询正文检索 | 实装 | **接通**：search_book_text → library.searchText；scope/剧透约束保留<br>[设计] 检索工具 | **接通**：library 1.4 books.searchText；library:read/write<br>[设计] 授权范围正文检索 | Agent；Text Desk 0.4 多查询检索/片段查看/明确开书 | 同一共享匹配与存储流程：1–12 个非空查询，每个至多 1024 字符，结果 1–100（默认 16）；精确子串、词元回退与 200 字符桶去重沿用现状。指定书可准备正文；跨书只读本地已持久索引，不批量抽取，按书架顺序取前若干结果，不是全局相关性排序。结果含 bookId/章号/章名/offset/snippet/match，非 CFI/Range，不可直接导航。无命中不证明未索引书无内容；失败拒绝，不返回部分成功。Agent 取消与插件生命周期在异步读边界检查，不撤销抽取，不是 TXT08 分页/背压/节内协作取消。macOS debug 已验权限 Worker、缺书/非法输入、跨书不抽取与 Agent 章内 -1 围栏；完整负载、packaged/跨平台仍欠。 | [TEXT](../apps/web/src/features/library/lib/book-text-store.ts) [TEXTSEARCH](../apps/web/src/features/library/lib/book-text-search.ts) [TEXTSEARCHPROOF](../docs/evidence/book-text-search-2026-09-09.json) [TEXTPORT](../apps/web/src/features/ai/agent/ports/book-text-port.ts) [TEXTTOOLS](../packages/agent/src/tools/book-text-tools.ts) [LIB](../apps/web/src/domain/library.ts) [TEXTDESK](../plugins/text-desk/src/views.ts) [API](../packages/plugin-types/src/index.ts) | C05 |
| <a id="TXT07"></a>TXT07 | 引擎全文精确搜索并返回 CFI | 部分 | **接通**：find_book_locations + open_book(location)，保留原回合章节围栏<br>[设计] 精确命中/位置工具 | **接通**：library v1.1 books.searchLocations + reading v2 goTo<br>[设计] 精确搜索任务 | Jumper 正文搜索；Agent；隔离 Tauri FB2 Worker/实际端口通过 | 每页最多 50 命中/32 个扫描 section；cursor 绑定书/版本/查询/允许范围；未扫完不宣称 textless。仍缺单次 Worker 调用取消/超大 section 协作预算；PDF quote 已有实现和 DOM 测试，但真实前台绘制尚未通过 | [LOCATIONSEARCH](../apps/web/src/features/library/lib/book-location-search.ts) [CONTENTSOURCE](../apps/web/src/features/library/lib/book-content-source.ts) [NAVTOOLS](../packages/agent/src/tools/navigation-tools.ts) [JUMPER](../plugins/jumper/src/views.ts) [NAVPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-reading-probe.ts) | C04 |
| <a id="TXT08"></a>TXT08 | 搜索分页、取消、背压和过期查询淘汰 | 待建 | **未接**：无正式入口<br>[设计] 有界搜索任务 | **未接**：无正式入口<br>[设计] 有界搜索任务 | 无完整公共实现 | 引擎局部 cancel 不等于端到端插件/Agent 任务协议 | [ENGINE](../apps/web/foliate-js/src/view.ts) [API](../packages/plugin-types/src/index.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) | C06 |
| <a id="TXT09"></a>TXT09 | 读取当前可见文本/阅读游标 | 部分 | **部分**：get_reading_session + 原有自动 grounding<br>[设计] 按需读当前会话 + 自动 grounding | **部分**：reading.queries.session + observeSession<br>[设计] 会话快照与范围查询 | 书内 Agent；桌面 FB2 探针 | 重排正文已返回实际可见 Range 文本，限 12000 字符；PDF range 为空时 visibleText 仍为空，文本可用性分类待补 | [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVADAPTER](../apps/web/src/features/reader/lib/reading-engine-adapter.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [GROUND](../packages/agent/src/runtime/grounding-context.ts) [API](../packages/plugin-types/src/index.ts) | C07 |
| <a id="TXT10"></a>TXT10 | 选区附近句段上下文 | 实装 | **部分**：get_reading_session.selection → read_book_range；既有附件/grounding<br>[设计] 有来源的范围读取 | **部分**：reading 2.9 session.selection / selectionActions 1.2 range → library.readRange<br>[设计] 可按范围查询 | Ask AI；Dictionary；Text Desk 0.6 | 搜索/真实选区 Range 可在不移动阅读器时按 UTF-16 分页读取，默认 4000/上限 12000，整范围外同分节上下文每侧默认 240/上限 2000，不切 surrogate pair。原生选区捕获显示源的版本；当前句段仅在 position 与 book/CFI 相符时提供同源 Range。Agent 当前叙事书沿用回合 fence，自动选区查询受隐私/原始剧透限制；插件仍是领域授权。旧标注不补签当前版本，Range 写入未统一；不是句段语义分割或完整文档快照。 | [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) [GROUND](../packages/agent/src/runtime/grounding-context.ts) [API](../packages/plugin-types/src/index.ts) [DICT](../plugins/dictionary/src/index.ts) [RANGEHOST](../apps/web/src/features/library/lib/book-range.ts) [RANGEUI](../plugins/text-desk/src/range-views.ts) [RANGEPROOF](../docs/evidence/book-range-2026-09-10.json) [SELECTIONRANGE](../apps/web/src/features/reader/lib/selection-range.ts) [SELECTIONPROOF](../docs/evidence/selection-range-2026-09-10.json) | C07 |
| <a id="TXT11"></a>TXT11 | 书内脚注/链接目标解析与预览 | 实装 | **部分**：list/read/show/close_book_reference[双域]<br>[设计] 版本化查询与原生浮层 | **部分**：library 1.12 引用查询；UI 1.8 previewReference/closeReferencePreview<br>[设计] 语义引用/原生预览/导航组合 | 原生 ReaderFootnotePopover；新接口等待组合插件 | 版本化 sectionIndex+index 描述，单节列举 1–50 条、预览 2–12000 UTF-16 单元可续读；不开放 DOM 或任意目标 URL。目标解析复用同源解析器；Agent 来源与目标加载前均验证阅读边界，脚注不自动豁免。UI 1.8 接原生浮层打开/关闭：必须已打开对应版本的书，插件需 library 读取和 reading 写入，Agent owner 固定为线程。opened 等待该请求 DOM commit；非 resolved 返回 not-opened 不替换现有内容。关闭只认自有当前 ID；用户原生点击/关闭、会话退休、更新请求使旧调用失效，旧原生脚注异步结果带请求序号过滤；插件退出仅清自己的预览。API 预览前置于插件 Dialog，分页边界以省略号提示，不自动读完整注释。CFI、版本和底层读取排空沿用原租约。无 DOM 的 PDF 批注链接、computed-style 脚注猜测、图片及大型单节预算仍缺；真实格式/Worker/前台绘制和焦点组合待集中验收，TXT11 保持部分。 | [ENGINE](../apps/web/foliate-js/src/view.ts) [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [API](../packages/plugin-types/src/index.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [BOOKREFERENCES](../apps/web/src/features/library/lib/book-references.ts) [REFERENCETOOLS](../packages/agent/src/tools/reference-tools.ts) [REFERENCEPROOF](../apps/web/tests/book-references.test.ts) [REFERENCEPREVIEW](../apps/web/src/services/reader-reference-preview.ts) [REFERENCEPREVIEWHOOK](../apps/web/src/features/reader/hooks/useReferencePreview.ts) [REFERENCEPREVIEWPROOF](../apps/web/tests/reference-preview-hook.test.tsx) | C08, E05 |
| <a id="TXT12"></a>TXT12 | 书内图片读取与灯箱缩放预览 | 实装 | **未接**：无正式入口<br>[设计] 受控图片查询/预览 | **未接**：无正式入口<br>[设计] 图片 ResourceRef/预览 | ReaderImageLightbox | 灯箱存在不等于模型已有图像输入工具 | [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [BLOB](../apps/web/src/platform/blob-store.ts) [API](../packages/plugin-types/src/index.ts) | C08, E05, J08 |
| <a id="TXT13"></a>TXT13 | 统一位置/范围解析、校验、版本与失效 | 部分 | **部分**：搜索/会话选区 → read_book_range / open_book<br>[设计] 宿主签发 Location/Range | **部分**：library 1.7 / reading 2.9 / selectionActions 1.2 → readRange / goTo<br>[设计] 宿主签发 Location/Range | Jumper/Agent/RSS；Text Desk 0.6；标注仍待统一 Range | 文件 SHA-256/虚拟内容摘要；来源 lease/前后校验和 provider 代际保护。readRange 严格复制书/版本/CFI/quote，拒绝额外权力字段；DOM 用 canonical 单文档 CFI，PDF 用页 CFI+唯一 quote，歧义/缺失/不支持/越界分码。真实选区捕获显示源版本，当前句段复用匹配 position，旧标注不补签版本。共享 View 页 CFI 不再误解析为空页内路径。三项内容查询取消先拒绝 Worker 调用，物理读取/lease 仍由 shutdown drain 等待，后续非取消错误不吞。真实 macOS Worker、Agent、编译插件 FB2/PDF 选区/导航、句段详情及慢读退役已有证据；引擎大节仍整段/上下文读取，非有界内存或即时中止。公共选区命令见 READ13；标注身份/Range 写入、跨模式引用、全部格式、最大载荷、provider 更新/在途内容替换、packaged/跨平台仍未完整。 | [ENGINE](../apps/web/foliate-js/src/view.ts) [NAV](../apps/web/src/domain/reading-session-controller.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [API](../packages/plugin-types/src/index.ts) [CONTENTSOURCE](../apps/web/src/features/library/lib/book-content-source.ts) [NAVTOOLS](../packages/agent/src/tools/navigation-tools.ts) [RANGEHOST](../apps/web/src/features/library/lib/book-range.ts) [RANGETYPES](../packages/core/src/book-range.ts) [RANGEENGINE](../apps/web/foliate-js/src/content-range.ts) [RANGEUI](../plugins/text-desk/src/range-views.ts) [RANGEPROOF](../docs/evidence/book-range-2026-09-10.json) [SELECTIONRANGE](../apps/web/src/features/reader/lib/selection-range.ts) [SELECTIONPROOF](../docs/evidence/selection-range-2026-09-10.json) | A02, A03, A04, E06, F04 |

### 阅读会话与呈现控制

| ID | 宿主能力 | 宿主现状 | Agent 当前与目标 | 插件当前与目标 | 实际消费者 | 缺口/边界 | 来源 | 旧基线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <a id="READ01"></a>READ01 | 打开书/恢复保存位置 | 实装 | **接通**：open_book 等待共享控制器实际完成<br>[设计] 等待 ready 的导航工具 | **接通**：reading v2 openBook 返回 Promise<receipt><br>[设计] 导航命令 + 回执 | 书架；Agent；RSS；Library Desk；桌面探针 | 源文件 hash 标识版本；无 hash 的虚拟内容为 session 版本；PDF 等待当前页绘制，后台 WebView 暂停绘制会超时，不冒充成功。取消/超时同时作废未完成开书的 begin 凭证；关闭尚无 session 的开书请求也作废，工作区非覆盖层导航要求阅读权限并取消该请求。延迟查库回归曾先失败后修复；精确迟到窗口为单元证据，真实 FB2 双端/原生命令面板为桌面证据，不承诺取消回滚已经发生的呈现副作用。 | [SESSION](../apps/web/src/features/reader/hooks/useReaderSession.ts) [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVADAPTER](../apps/web/src/features/reader/lib/reading-engine-adapter.ts) [NAVPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-reading-probe.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [COMMANDROUTINGPROOF](../docs/evidence/command-routing-2026-09-10.json) | A05, D02 |
| <a id="READ02"></a>READ02 | 关闭当前书并返回书架 | 实装 | **接通**：navigate_reading(close) 携带书籍/会话 guard<br>[设计] 关闭指定会话工具 | **接通**：reading.commands.close(guard?)<br>[设计] 关闭指定会话命令 | 阅读关闭/完成页；实际 Agent 工具与 Worker | 关闭等待动画、会话退休、已接收时间/位置写入和本书桶结算；同步封闭旧代写者，共享队列防同书重开时旧 flush 清新桶，不靠卸载延时。失败可释放画面但必须拒绝回执，保留未结算桶；失败 tick 不假称已落盘。原生双端完成后 pending 为零，SQLite 写锁两端 db/locked，重开关闭恢复。旧 guard 拒绝关闭新书；取消只放弃调用方等待，不回滚已经开始的关闭。打包/跨平台、强杀/跨设备与长时负载未验 | [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVTEST](../apps/web/src/domain/reading-session-controller.test.ts) [SESSION](../apps/web/src/features/reader/hooks/useReaderSession.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [API](../packages/plugin-types/src/index.ts) [READINGTRACE](../apps/web/src/features/reader/lib/reading-trace.ts) [READINGTRACEPROOF](../docs/evidence/reading-retirement-2026-09-10.json) | D02 |
| <a id="READ03"></a>READ03 | 按章节/标注/href/CFI 跳转 | 实装 | **部分**：open_book 解析章节/标注并等待真实落点<br>[设计] 验证后导航工具 | **部分**：reading v2 goTo(cfi/href/contentVersion)<br>[设计] 导航命令 + 实际落点 | 阅读目录/标注；Agent；RSS 文章 | 无位置标注明确失败，缺失 href 与 stale 版本有错误码；正文搜索尚不产出可导航 Range，全部 fragment/CFI 失效边界仍需扩展验证 | [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [NAVADAPTER](../apps/web/src/features/reader/lib/reading-engine-adapter.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-reading-probe.ts) | A05, D03 |
| <a id="READ04"></a>READ04 | 前后翻页、章节、书首书尾 | 实装 | **部分**：navigate_reading(next/previous)<br>[设计] 导航步骤工具 | **部分**：reading.commands.step(next/previous,guard?)<br>[设计] 导航步骤命令 | 键盘/页面按钮/滚轮；桌面探针 | 已接页面步进；章节步进与印刷页定位未接，宿主旧页面按钮仍有直接引擎路径 | [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVADAPTER](../apps/web/src/features/reader/lib/reading-engine-adapter.ts) [SHORTCUT](../apps/web/src/features/settings/lib/shortcuts.ts) [API](../packages/plugin-types/src/index.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) | D04 |
| <a id="READ05"></a>READ05 | 按进度/固定版式页索引定位 | 实装 | **部分**：open_book(fraction,contentVersion?)<br>[设计] 进度/页位置工具 | **部分**：reading.commands.goTo({fraction,contentVersion?})<br>[设计] seek 命令 | 阅读进度拖动；两端桌面探针 | 0–1 进度已接并校验；固定版式页索引/印刷页标签/重排页数还需分开建模接线 | [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVADAPTER](../apps/web/src/features/reader/lib/reading-engine-adapter.ts) [API](../packages/plugin-types/src/index.ts) | D05 |
| <a id="READ06"></a>READ06 | 导航历史 back/forward 及可用性 | 部分 | **部分**：navigate_reading(back/forward) + 快照可用性<br>[设计] 导航历史工具 | **部分**：reading.commands.back/forward + snapshot.history<br>[设计] 共享历史查询/命令 | 共享阅读控制器；目录/标注/进度跳转；两端 | 成功后更新，最多 100 落点；失败不入历史、back/forward 不分支、新跳转截断 forward；引擎内部链接和全部 UI 入口还未统一历史 | [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVTEST](../apps/web/src/domain/reading-session-controller.test.ts) [NAVPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-reading-probe.ts) [API](../packages/plugin-types/src/index.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) | D06, D07 |
| <a id="READ07"></a>READ07 | 统一当前书/位置/加载/历史快照 | 实装 | **接通**：get_reading_session（书内 scope 不泄露其他书）<br>[设计] 显式会话查询工具 | **接通**：reading.queries.session()<br>[设计] 当前会话快照 | 共享控制器；Agent；可中途启用的插件 | revision/sessionId/bookId/status/location/history 已共享；2.1 新增 playback、2.2 新增 mode、2.3 新增版本化 mode.position（READ18/READ16）。2.5 新增 mode.availableModes；此行不代表正文 selection 已接通 | [NAV](../apps/web/src/domain/reading-session-controller.ts) [READING](../apps/web/src/domain/reading.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [API](../packages/plugin-types/src/index.ts) [NAVPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-reading-probe.ts) | D01, D12, Q02 |
| <a id="READ08"></a>READ08 | 会话开关/章节/进度事件 | 实装 | **自动**：宿主 cursor/scope + 按需 session 查询<br>[设计] 有限可观察会话状态 | **部分**：reading.events.observeSession 立即快照并观察；旧 session 四事件已删除<br>[设计] 含 ready/reason/origin/generation 事件 | Dictionary 1.2 按需读取；阅读 Worker 探针 | 统一快照含 book/session/status/location/history/mode/playback/revision；旧 services.session.subscribe、类型和 App 三个广播 effect 均移除，session 2.0 仅元数据，旧 ^1 合约拒绝。Dictionary 显式 reading:read/library:read，迟启用和改名按需读取，跨书/重开竞态丢弃旧标题；查词缓存包含标题。macOS debug 已验无权限不可见、只读观察、迟启用、FB2/PDF 换书与关闭；origin/reason 及完整撤权/跨平台仍未完成。 | [NAV](../apps/web/src/domain/reading-session-controller.ts) [READING](../apps/web/src/domain/reading.ts) [API](../packages/plugin-types/src/index.ts) [DICTTOOLS](../plugins/dictionary/src/agent-tools.ts) [SESSIONBOUNDARY](../docs/evidence/reading-session-boundary-2026-09-09.json) | D11 |
| <a id="READ09"></a>READ09 | 阅读沉浸/显示隐藏控制层 | 实装 | **接通**：set_reader_controls + get_reading_session.controls<br>[设计] 有用户意图的呈现命令 | **接通**：reading 2.6 setControls + session.controls/observeSession<br>[设计] 会话呈现命令 | 空格/内容点击/滚动隐藏；Agent；Listening Desk 0.8 | 同一控制器接收 UI 和双端意图，React DOM 提交才发布 visible 和完成回执，不等待 CSS 动画/屏幕栅格。无可用会话为 null，写要求 ready；带 book/session guard，插件生命周期与 Agent signal 取消，10 秒无提交超时，更新意图/退出使旧请求 superseded。取消仅丢弃未提交状态，不承诺撤销已呈现界面。只改 header/已选 docked panels 的显示，不改偏好、书页、历史、模式或音频。Listening Desk 按快照提供显式 show/hide 并在成功后关闭视图；不是所有面板选择 API。跨平台/packaged 仍未验。 | [CONTROLS](../apps/web/src/features/reader/lib/reading-controls-controller.ts) [CONTROLSHOOK](../apps/web/src/features/reader/hooks/useReaderControls.ts) [NAV](../apps/web/src/domain/reading-session-controller.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [API](../packages/plugin-types/src/index.ts) [LISTENINGDESK](../plugins/listening-desk/src/views.ts) [CONTROLSPROOF](../docs/evidence/reader-controls-2026-09-09.json) | D08 |
| <a id="READ10"></a>READ10 | 目录/注释/外观/聊天面板开关 | 实装 | **接通**：get_reader_panels / set_reader_panel<br>[设计] 打开指定语义面板 | **接通**：services.ui 1.1 reader.snapshot/observe/setPanel<br>[设计] 面板导航服务 | Reader header；Agent；Listening Desk 0.9 | 同一服务接收四面板显式开关；reading:read 才能查询/观察，reading:write 才能操作，零阅读授权没有 reader 接口。快照含 session/book/revision、open 与 visible，无面板内容；它描述已提交 UI，可能含待保存的乐观值，命令回执另等精确 SQLite 保存和新 DOM commit。打开会显示控制层；窄窗目录/聊天互斥单次保存，外观/注释为会话临时状态。新意图/旧会话 superseded，10 秒无提交 timeout，Agent signal/插件卸载取消，不撤销已派发写或已显示界面。面板/Ask AI 意图等待 ready，完成确认防止重开书重复消费；外观在 More 内仍可打开有限高可滚动 Dialog。隔离 macOS debug 已验双端、真实 Worker、SQLite 拒绝/回滚/重试、旧插件视图拒绝、600/1200 窗口及 PDF 外观呈现。不是动画/焦点/内容加载完成保证；单调用 Worker 取消、packaged/跨平台仍未验。滚轮 wheel-phase 已改为原生固定脚本投递当前文档、阅读器同步订阅/退订，移除异步 native listener 生命周期竞态；隔离桌面 20 次 FB2/PDF 重开无原异常，200 个退休监听不收回调，native eval 三阶段投递与退订已验。物理触控板输入/时序及 packaged 回归未验，不外推为全部 Tauri 事件无竞态。 | [WORKSPACE](../apps/web/src/features/reader/components/ReaderWorkspace.tsx) [UI](../apps/web/src/state/ui.ts) [MENU](../apps/web/src/features/menus/lib/menu-registry.tsx) [API](../packages/plugin-types/src/index.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [PANELLAYOUT](../apps/web/src/features/reader/lib/reader-panel-layout.ts) [PANELHOOK](../apps/web/src/features/reader/hooks/useReaderPanels.ts) [PANELSERVICE](../apps/web/src/services/reader-panels.ts) [PANELPROOF](../docs/evidence/reader-panel-persistence-2026-09-09.json) [PANELSAPIPROOF](../docs/evidence/reader-panels-2026-09-09.json) [LISTENINGDESK](../plugins/listening-desk/src/views.ts) [WHEELPHASE](../apps/web/src/platform/wheel-phase.ts) [WHEELNATIVE](../apps/desktop/src-tauri/src/wheel_phase.rs) [WHEELPROOF](../docs/evidence/wheel-phase-lifetime-2026-09-09.json) | D08, I06 |
| <a id="READ11"></a>READ11 | 阅读面板尺寸/布局与焦点恢复 | 实装 | **部分**：get_reader_panels / set_reader_panel_width[双域]<br>[设计] 受控面板布局/焦点意图 | **部分**：UI 1.9 reader.snapshot/observe/setWidth<br>[设计] 声明式面板布局/关闭回调 | 聊天/目录 resize；Agent/插件宽度意图 | 目录/聊天共享首选宽度 240..640 整数 CSS px，快照增加 sizes 与 docked/exclusive 布局；窄窗忽略首选宽度，不伪报实际测量值。reading 读可观察、写可调整，Agent 限当前 scope 会话。保存与原生拖拽共用有序 KV 补丁、变化/回滚订阅，命令等待保存与匹配 DOM 提交；不打开面板、不显示控制层、不改变焦点，晚取消不回滚已派发写。宽度接通待集中 Tauri/Worker 验收，语义焦点恢复与插件视图关闭原因回执仍缺，不开放任意 DOM 或拖动坐标。 | [WORKSPACE](../apps/web/src/features/reader/components/ReaderWorkspace.tsx) [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) [PANELHOOK](../apps/web/src/features/reader/hooks/useReaderPanels.ts) [PANELSERVICE](../apps/web/src/services/reader-panels.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) | I06 |
| <a id="READ12"></a>READ12 | 固定版式自动适配；图片缩放/平移/旋转 | 实装 | **未接**：无正式入口<br>[设计] 格式适用的呈现工具 | **未接**：无正式入口<br>[设计] 呈现状态/命令 | 固定版式自动适配；图片灯箱交互 | 已核对图片灯箱缩放；不把它算作书页手动缩放控件 | [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [ENGINE](../apps/web/foliate-js/src/view.ts) | D09 |
| <a id="READ13"></a>READ13 | 读取/建立/清除文本选区 | 实装 | **部分**：get_reading_session.selection；set_reading_selection；自动附件<br>[设计] Range 查询/受控选择 | **部分**：reading 2.10 selectRange/clearSelection；session/observeSession；selectionActions 1.2 range<br>[设计] 选区查询/命令 | 选择菜单；Agent；Dictionary；Text Desk 0.7 | 读取捕获版本的范围；selectRange 严格复制 Range，要求当前书 ready，先验证源再导航/选中，等匹配 React 提交。clearSelection 必须提交所见 id，拒绝误清新选区；session/book guard、取消、退役、10 秒呈现超时和导航截止保留。Agent 选区命令只返回 id；受限会话另移除当前位置/模式位置的 quote，避免隐私或剧透旁路。真实 macOS debug Worker 零/读授权无写入口，FB2/PDF 选择/清空、Agent 操作、旧 id 拒绝保留新选区及编译 Text Desk 第二命中选择/清除已验。并发/取消/超时是单元证据，不承诺撤销已移动或已显示界面。迟到非空旧文档、coarse-pointer 定时器、长选区/全部格式、原生在途取消、packaged/跨平台仍未验。旧标注范围仍为空，不用当前版本伪造来源。 | [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [ENGINE](../apps/web/foliate-js/src/view.ts) [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) [API](../packages/plugin-types/src/index.ts) [NAV](../apps/web/src/domain/reading-session-controller.ts) [SELECTIONRANGE](../apps/web/src/features/reader/lib/selection-range.ts) [SELECTIONPROOF](../docs/evidence/selection-range-2026-09-10.json) [SELECTIONCONTROL](../apps/web/src/features/reader/lib/reading-selection-adapter.ts) [SELECTIONCONTROLPROOF](../docs/evidence/selection-control-2026-09-10.json) | E01, E02 |
| <a id="READ14"></a>READ14 | 临时范围强调/搜索标记及释放 | 实装 | **接通**：manage_reading_emphasis[双域]<br>[设计] 受控临时呈现 | **接通**：reading 2.11 emphasis/putEmphasis/removeEmphasis/observeEmphasis<br>[设计] 插件所属 overlay | 共享临时标记控制器；Agent；Text Desk 0.8 | 按 Agent/插件激活代隔离，版本化 Range 源校验、条件更新/移除、跨页重建和退出释放；不导航、不选择、不写 annotation。attached 是文档附着数而非屏幕可见数。单批 64、每 owner 16 组、全局 512 范围、32 在途校验；取消回执和物理排空分离。已做 FB2/PDF 双端局部验证；完整组合插件、原生在途取消及跨平台验收待集中进行。 | [READING](../apps/web/src/domain/reading.ts) [API](../packages/plugin-types/src/index.ts) [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [RANGEUI](../plugins/text-desk/src/range-views.ts) | E03, E04 |
| <a id="READ15"></a>READ15 | 贡献句子/段落等分段模式 | 实装 | **未接**：无算法注册工具<br>[设计] 不开放：模型不注册运行代码 | **接通**：readerModes 1.1 register(text-unit-navigator)，同步或异步 segmentText<br>[设计] 模式贡献 | sentence-reader；隔离异步分段探针 | 每章至多 8 个在途 block，30 秒截止；失败不伪装空章，旧任务/同 index 新 Document 不回写，分段与 relocate 任一先后都能落点。真实 macOS debug 验证延迟/拒绝/退出；不是全内存配额或远端计算取消。只开放分段策略，非任意渲染器/解码器 | [API](../packages/plugin-types/src/index.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [SENTENCE](../plugins/sentence-reader/src/index.ts) [UNITS](../apps/web/src/features/reader/hooks/useTextUnitNavigator.ts) [UNITBUILD](../apps/web/src/features/reader/lib/text-unit-build.ts) [UNITINDEX](../apps/web/src/features/reader/lib/text-unit-index.ts) [UNITPROOF](../docs/evidence/reading-segmentation-2026-09-09.json) | K01 |
| <a id="READ16"></a>READ16 | 启停模式/上下一单元/跟随/回当前 | 实装 | **部分**：configure_reading_mode + navigate_reading(return-to-unit/next-unit/previous-unit)<br>[设计] 模式配置/返回/步进；跟随开关待建 | **部分**：reading 2.5 configureMode(selectModeKey)/returnToMode/stepMode + session.mode/observeSession<br>[设计] 模式配置/返回/步进；跟随开关待建 | 文本单元工具栏；Agent；Listening Desk 模式/返回/步进；自动朗读 | 启停、unit 选择、状态与版本化 resting Location 已共享。2.5 新增 availableModes 与 selectModeKey；modeKey 仍是前置条件。保留失效提供者选择，不静默换到其他插件；取消撤回未完成选择，原生和 Listening Desk 均消费同一控制器。配置的书内状态与提供者偏好合并 SQLite 提交，回执等待该请求的精确写 Promise 和首次位置保存；失败保留 db code 并恢复先前选择，偏好回滚不再冒充新意图。配置成功后才派发匹配 revision/key/unit 的位置写，旧失败不污染新请求。步进从 resting 而非离开的 viewport 继续，跨空节/跳过非线性节，实际页面、分段、React 反馈和目标位置 SQLite 提交后返回 moved/start-of-book/end-of-book；不新增跳转历史。返回同样等待目标位置保存，成功才记历史。保存失败保留 db code；下一次明确动作可重试，同目标重写仍等最新回执。mode.ready 只表示索引完成，不表示已保存；位置/内容版本变化及退出取消等待。模式变更/新导航/取消阻止迟到成功，但不撤销已发生的页面移动；取消不是全部已提交提供者偏好的事务撤销。恢复校验 book/contentVersion/modeKey/unitId 并重解 CFI，不钳制旧 ordinal；无版本旧地址丢弃。隔离 macOS 已验正常/慢分段跨节、拒绝、取消、两端 SQLite 故障和恢复；空节/非线性与其他格式仍需补桌面证据。源码没有独立跟随开关，自动滚到当前单元与手动翻页后单元跟到页面是不同目标，语义待确认，不应把目标开关当成已有宿主漏接；旧偏好迁移已并入配置原子提交，读设置无写副作用、既有值优先、不同提供者保留原记录；删除旧记录失败时两端收到 db code，三条记录均保留，重试可恢复。跨提供者取消补偿未闭合，短时 sessionTimer 不要求耐久调度 | [MODECONTROL](../apps/web/src/features/reader/lib/reading-mode-controller.ts) [MODEOWNER](../apps/web/src/features/reader/hooks/useReadingModeControl.ts) [UNITS](../apps/web/src/features/reader/hooks/useTextUnitNavigator.ts) [WORKSPACE](../apps/web/src/features/reader/components/ReaderWorkspace.tsx) [SHORTCUT](../apps/web/src/features/settings/lib/shortcuts.ts) [MODESTATE](../apps/web/src/features/reader/lib/text-unit-mode-state.ts) [MODETIMER](../apps/web/src/features/reader/hooks/useSessionTimer.ts) [MODEPROOF](../docs/evidence/reading-mode-2026-09-09.json) [MODERETURN](../docs/evidence/reading-mode-return-2026-09-09.json) [MODESTEP](../docs/evidence/reading-mode-step-2026-09-09.json) [MODEDURABILITY](../docs/evidence/reading-mode-durability-2026-09-09.json) [POSITIONDURABILITY](../docs/evidence/reading-position-durability-2026-09-09.json) [MODEMIGRATION](../docs/evidence/reading-mode-migration-2026-09-09.json) | K02 |
| <a id="READ17"></a>READ17 | 列声音并合成音频的提供者 | 实装 | **部分**：update_settings 可改 TTS 非敏感设置<br>[设计] 受控声源选择 | **接通**：voiceProviders.register/listVoices/synthesize<br>[设计] 语音贡献 | tts；宿主系统语音回退 | Agent 不能借设置接口声称已经触发朗读 | [TTS](../plugins/tts/src/index.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [API](../packages/plugin-types/src/index.ts) [AUDIO](../apps/web/src/features/reader/hooks/useReadAloud.ts) | K03, K05 |
| <a id="READ18"></a>READ18 | 开始/停止朗读、播放位置与 fallback 状态 | 实装 | **接通**：control_read_aloud + get_reading_session.playback<br>[设计] 朗读控制工具 | **接通**：reading 2.1 controlPlayback + session.playback/observeSession<br>[设计] 共享朗读状态与命令 | 文本单元朗读按钮；Agent；Listening Desk | 实际音频开始才回执；owner 取消/切书阻断迟到合成，系统 fallback 与单元 CFI 可观察。自动朗读消费公共 stepMode，等待真实下一单元才播，end-of-book 正常停止；单元位置保存失败停止自动朗读并保留 db code，不继续播下一段。停止/换声源取消在途步进，不被本次 React 落点反馈自我取消。35s advance 截止覆盖 30s 导航，不再用 6s 超时猜书尾。隔离 macOS Tauri 已验证；未验 release/Windows/Linux/远端 TTS。非逐字播放时间/暂停恢复。Listening Desk 为按需刷新快照。 | [PLAYBACK](../apps/web/src/features/reader/lib/read-aloud-controller.ts) [AUDIO](../apps/web/src/features/reader/hooks/useReadAloud.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [API](../packages/plugin-types/src/index.ts) [LISTENINGDESK](../plugins/listening-desk/src/views.ts) [PLAYBACKPROOF](../docs/evidence/reading-playback-2026-09-09.json) [MODESTEP](../docs/evidence/reading-mode-step-2026-09-09.json) [POSITIONDURABILITY](../docs/evidence/reading-position-durability-2026-09-09.json) | K04, K05 |
| <a id="READ19"></a>READ19 | 完成页、标记读完/撤销读完 | 实装 | **接通**：update_book.finished<br>[设计] 状态写工具 | **接通**：reading.commands.setFinished<br>[设计] 状态写领域 | 完成页；书架；Agent | 状态写接通；导航到完成页是另一个呈现行为 | [READING](../apps/web/src/domain/reading.ts) [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | G02 |
| <a id="READ20"></a>READ20 | 跨书/并发导航的取消、序列化与回执 | 部分 | **部分**：共享控制器 + Agent AbortSignal + 会话/书籍 guard<br>[设计] 全来源导航事务 | **部分**：共享控制器 + 实例停用取消 + Promise 回执<br>[设计] 全来源导航事务 | 两端 API 与部分 UI 跳转 | 新意图淘汰旧请求，同引擎串行、不同引擎互不阻塞，30s 截止；引擎本身无逐次 abort，插件尚无单次导航取消句柄；不能关闭完整 GAP | [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVTEST](../apps/web/src/domain/reading-session-controller.test.ts) [NAVADAPTER](../apps/web/src/features/reader/lib/reading-engine-adapter.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) | D07, D10 |

### 标注与阅读统计

| ID | 宿主能力 | 宿主现状 | Agent 当前与目标 | 插件当前与目标 | 实际消费者 | 缺口/边界 | 来源 | 旧基线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <a id="ANN01"></a>ANN01 | 列出/按书按词按类型检索标注 | 实装 | **接通**：get_annotations → 原生 keyset page；kind/query 过滤<br>[设计] 查询工具 | **接通**：annotations.queries.list/page<br>[设计] 只读领域 | 阅读注释；全局 Agent 注释；Agent；Annotation Desk | 模型结果统一为 items/nextCursor/consistency；书内默认当前书、显式其他书沿用现有检索规则。Annotation Desk 使用每页 20 条的原生分页，筛选重置游标，不扫描全部标注。插件 legacy list 保留；分页契约见 ANN08 | [ANNOT](../apps/web/src/domain/annotations.ts) [ANNDB](../apps/web/src/features/annotations/lib/annotation-db.ts) [LIBTOOLS](../packages/agent/src/tools/library-tools.ts) [ANNPORT](../apps/web/src/features/ai/agent/ports/annotations-port.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [DESK](../plugins/annotation-desk/src/views.ts) | F01 |
| <a id="ANN02"></a>ANN02 | 创建高亮 | 实装 | **接通**：create_annotation(kind=highlight)<br>[设计] 写工具 | **接通**：annotations.commands.createHighlight<br>[设计] 写领域 | 选择菜单；Agent | 来源与 Range 校验仍受 TXT13 限制 | [ANNOT](../apps/web/src/domain/annotations.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) | F02, F04 |
| <a id="ANN03"></a>ANN03 | 创建下划线样式 | 实装 | **接通**：create_annotation(style=underline) → 共享命令<br>[设计] 标注样式参数 | **接通**：createHighlight(style=underline)<br>[设计] 写领域 | 选择菜单；Agent；桌面 Worker 探针 | style 经 tool/port/事件持久化及 Worker 查询保真；默认 highlight，非法 style 拒绝。实机已验收落盘和回读，不代表锚定下划线的全部格式视觉验收 | [ANNOT](../apps/web/src/domain/annotations.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [ANNPORT](../apps/web/src/features/ai/agent/ports/annotations-port.ts) [ANNPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-annotation-probe.ts) [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) [API](../packages/plugin-types/src/index.ts) | F02 |
| <a id="ANN04"></a>ANN04 | 高亮改色/删除 | 实装 | **接通**：edit_annotation(expectedRevision) / delete_annotation+版本绑定批准 / apply_annotation_changes<br>[设计] 受控写工具 | **接通**：annotations 2 applyChanges 条件改色/样式/删除<br>[设计] 写领域 | 标注菜单；Agent；Annotation Desk；桌面 Worker | 新版 applyChanges 可同时改 color/style；Annotation Desk 用此接口批量改色/样式及确认删除。原生菜单现用所见列表 revision 条件改色/删除，不在保存前刷新 token；改色不重写旧 style。五个旧单项公共无条件命令已删除，旧 ^1.x 要求明确拒绝；Agent 端口同样无无条件别名，恢复/重放不作为公共入口。高亮原文修改不开放 | [ANNOT](../apps/web/src/domain/annotations.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [ANNBATCHTOOL](../packages/agent/src/tools/annotation-batch-tool.ts) [ANNMUTATIONS](../apps/desktop/src-tauri/src/storage/annotation_mutations.rs) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [DESKBATCH](../plugins/annotation-desk/src/batch.ts) [NATIVEANNWRITES](../apps/web/src/features/annotations/lib/native-annotation-mutations.ts) [NATIVEANNEDITOR](../apps/web/src/features/reader/hooks/useReaderNoteEditor.ts) [NATIVECASPROOF](../docs/evidence/native-annotation-cas-2026-09-10.json) [ANNCONTRACTPROOF](../docs/evidence/annotation-contract-v2-2026-09-10.json) [ANNCOLLECTIONS](../apps/web/src/features/annotations/hooks/useAnnotations.ts) [ANNGLOBAL](../apps/web/src/features/agent/components/AnnotationsPopover.tsx) | F02 |
| <a id="ANN05"></a>ANN05 | 创建/编辑/删除笔记 | 实装 | **接通**：create/edit/delete_annotation<br>[设计] 受控写工具 | **接通**：annotations 2 createNote；applyChanges 条件编辑/删除<br>[设计] 写领域 | NoteEditor；Agent；Annotation Desk 编辑/删除 | 可无位置笔记；Annotation Desk 不创建笔记。原生编辑器冻结所见 note/token，冲突留草稿；保存中去重并禁用输入/提交，旧草稿完成不关闭替代草稿。原生列表/书籍详情及全局标注弹层删除同样使用所见版本，全局远端先改后删冲突已验，重读后删除成功。实际 Worker 与 Agent 修改后的旧草稿冲突、重新打开后保存已验；100 个存储及两个封面同步命令迁入阻塞工作池，锁等待不占 UI/异步执行线程；封面协议异步响应。隔离 macOS 已验真实锁中 busy/Cancel/重开、释放后旧保存成功且新草稿保留、超时本地化失败及重试；排队查询/封面请求不阻断界面。取消不撤销已受理写；启动与原生窗口退出仍有同步路径，非全部原生工作无阻塞保证，最大队列/载荷和跨平台未验。删除 Agent 批准和插件授权不是同一种策略 | [ANNOT](../apps/web/src/domain/annotations.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [DESK](../plugins/annotation-desk/src/views.ts) [NATIVEANNWRITES](../apps/web/src/features/annotations/lib/native-annotation-mutations.ts) [NATIVEANNEDITOR](../apps/web/src/features/reader/hooks/useReaderNoteEditor.ts) [NATIVECASPROOF](../docs/evidence/native-annotation-cas-2026-09-10.json) [ANNCONTRACTPROOF](../docs/evidence/annotation-contract-v2-2026-09-10.json) [ANNCOLLECTIONS](../apps/web/src/features/annotations/hooks/useAnnotations.ts) [ANNGLOBAL](../apps/web/src/features/agent/components/AnnotationsPopover.tsx) [STORAGEEXEC](../apps/desktop/src-tauri/src/storage/execution.rs) [STORAGEEXECPROOF](../docs/evidence/storage-execution-2026-09-10.json) | F02 |
| <a id="ANN06"></a>ANN06 | 读取/删除 ask 问题轨迹 | 实装 | **接通**：get_annotations / delete_annotation+批准<br>[设计] 查询/受控删除 | **接通**：annotations 2 queries.get/list/inspect + applyChanges remove(kind:ask)<br>[设计] 查询/受控删除 | Agent；注释视图；隔离桌面 Worker | 写权限包含受控删除，read 不导出 commands，createAsk 仍不开放。删除必须带所见 revision，无 removeAsk 兼容别名；缺失/错误类型返回 annotations/not-found；实际 Agent 批准端口拒绝保留、批准删除已测，未代替聊天批准 UI 验收 | [ANNOT](../apps/web/src/domain/annotations.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [ANNPORT](../apps/web/src/features/ai/agent/ports/annotations-port.ts) [ANNPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-annotation-probe.ts) [ANNCONTRACTPROOF](../docs/evidence/annotation-contract-v2-2026-09-10.json) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | F05 |
| <a id="ANN07"></a>ANN07 | 自动记录书内问题轨迹 | 实装 | **自动**：thread 轮末 recordAsk → createAsk<br>[设计] 保留自动管线 | **未接**：createAsk 为 agent-only<br>[设计] 不开放：禁止伪造问题历史 | 书内 Agent | 自动行为不算模型可以任意调用的写工具 | [ANNOT](../apps/web/src/domain/annotations.ts) [THREAD](../packages/agent/src/runtime/thread.ts) [PORTS](../apps/web/src/features/ai/agent/ports/index.ts) | F05 |
| <a id="ANN08"></a>ANN08 | 按 ID 读取、分页、批量/版本冲突标注操作 | 部分 | **部分**：get_annotations 精确查询附 revision；edit/delete 走 CAS；apply_annotation_changes 原子批次<br>[设计] 有界查询/批量工具 | **部分**：annotations 2 queries.get/page/inspect + commands.applyChanges<br>[设计] 有界领域操作 | Agent 查询/条件修改/批准删除；Annotation Desk；桌面 Worker | 分页 1–100 行、默认 20，live 非冻结快照。inspect 给本机版本令牌；applyChanges 对 1–100 个不同现有对象先验所有版本，再同一事务提交事件/投影/outbox，任一失败全回滚。支持笔记正文、高亮颜色/样式、三类删除。Annotation Desk 实机验证新鲜批次保存、过期批次不改任何项、冲突保留草稿；原生双连接同版本仅一方成功。原生 annotations_list 在同一读事务携带与 inspect 相同的本机 ann1 token；笔记编辑/菜单/列表删除已迁 CAS，等毫秒 ABA 不绕过冲突。五个公共无条件命令与 Agent 三个旧别名均删除，Worker 只暴露创建两类及条件写，^1.x 版本拒绝，Annotation Desk 0.3 已迁移；恢复/重放仍是宿主内部路径，离线跨设备仍沿用同步合并；超长读结果预算、Range 校验和远端失效仍未完成 | [ANNDB](../apps/web/src/features/annotations/lib/annotation-db.ts) [ANNPAGES](../apps/desktop/src-tauri/src/storage/annotation_pages.rs) [ANNOT](../apps/web/src/domain/annotations.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [ANNBATCHTOOL](../packages/agent/src/tools/annotation-batch-tool.ts) [LIBTOOLS](../packages/agent/src/tools/library-tools.ts) [ANNMUTATIONS](../apps/desktop/src-tauri/src/storage/annotation_mutations.rs) [ANNMUTATIONPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-annotation-mutation-probe.ts) [API](../packages/plugin-types/src/index.ts) [DESKBATCH](../plugins/annotation-desk/src/batch.ts) [DESKPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-annotation-desk.ts) [NATIVEANNWRITES](../apps/web/src/features/annotations/lib/native-annotation-mutations.ts) [NATIVEANNEDITOR](../apps/web/src/features/reader/hooks/useReaderNoteEditor.ts) [NATIVECASPROOF](../docs/evidence/native-annotation-cas-2026-09-10.json) [ANNCONTRACTPROOF](../docs/evidence/annotation-contract-v2-2026-09-10.json) [ANNCOLLECTIONS](../apps/web/src/features/annotations/hooks/useAnnotations.ts) [ANNGLOBAL](../apps/web/src/features/agent/components/AnnotationsPopover.tsx) | A06, F03 |
| <a id="ANN09"></a>ANN09 | 标注变化与远端失效观察 | 部分 | **部分**：每次 get_annotations 从同源原生 page/inspect 读取；不新增常驻模型订阅<br>[设计] 自动刷新/按需查询 | **部分**：annotations 2 events.observe(page/inspect)；保留 legacy subscribe<br>[设计] 授权快照、变化与错误恢复 | Annotation Desk 0.3 实时列表；Agent 查询；真实 Worker；原生 Notes/书籍详情、全局标注弹层和正文标记 | observe 立即读取授权页或精确对象，读与 callback 结算后一秒重读，只推送变化/稳定错误/恢复；公共订阅共享 64 个名额，原生观察有独立名额，复制查询/结果，失败交付不确认，释放/退役丢迟到结果。page 沿用 1–100 行与 live cursor；inspect null 表示已删，不是读失败，订阅 revision 不是 CAS token。无需本地事件即可观察实际 sync applyRemote 投影；Agent 下一次查询同源结果。Annotation Desk 浏览列表随变化刷新，失败清掉旧内容/操作；joined 书目读失败也不确认，恢复重试。编辑/批选保持独立冻结版本，真实输入草稿经其他 Worker 修改后不被替换，保存 conflict，返回列表显示新值。隔离 macOS native 已验权限、remote/local/Worker 写、SQLite 类型读故障/恢复、删除空结果及 stop/retire；非真实网络同步/自主模型。仍非完整事件日志或即时撤回，慢读/回调无固定延迟保证；原生 Notes/书籍详情、全局标注弹层与正文标记现复用串行观察，SQL 先按书筛选；错误清列表/标记并显示稳定错误，恢复重画，删高亮还原同范围笔记标记，切书释放旧观察；不再手动 bump revision。native 已验真实 FB2、Worker 改色/删除、Agent 查询、远端笔记、SQL 错误/恢复及切书。全局弹层共享 useAnnotations all/book 作用域，真实 SQLite 类型故障清内容/删除按钮/计数、恢复自动显示已验；全局/整书集合仍可能大，原生笔记/菜单和列表删除已冻结所见版本条件写，真实 Worker/Agent 竞争不覆盖原生草稿；整书列表每行还需读取本地事件身份，最大负载未验，legacy subscribe 不补远端事件；最大文本载荷、长时/打包/跨平台及 GAP09/GAP11 其余项未关闭 | [EVENTROSTER](../apps/web/src/domain/events.ts) [EVENTS](../apps/web/src/platform/domain-events.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [SYNC](../apps/web/src/platform/sync/sync-scheduler.ts) [ANNOBSERVER](../apps/web/src/domain/annotation-observer.ts) [ANNOBSERVATION](../packages/core/src/annotation-observation.ts) [ANNLIVE](../plugins/annotation-desk/src/live-page.ts) [ANNOBSERVATIONPROOF](../docs/evidence/annotation-observation-2026-09-10.json) [NATIVEANN](../apps/web/src/features/reader/lib/observe-reader-annotations.ts) [ANNMARKS](../apps/web/src/features/reader/lib/highlight-renderer.ts) [NATIVEANNPROOF](../docs/evidence/native-annotation-observation-2026-09-10.json) [NATIVEANNWRITES](../apps/web/src/features/annotations/lib/native-annotation-mutations.ts) [NATIVEANNEDITOR](../apps/web/src/features/reader/hooks/useReaderNoteEditor.ts) [NATIVECASPROOF](../docs/evidence/native-annotation-cas-2026-09-10.json) [ANNCONTRACTPROOF](../docs/evidence/annotation-contract-v2-2026-09-10.json) [ANNCOLLECTIONS](../apps/web/src/features/annotations/hooks/useAnnotations.ts) [ANNGLOBAL](../apps/web/src/features/agent/components/AnnotationsPopover.tsx) | F06 |
| <a id="STAT01"></a>STAT01 | 单书/全库/总览已结算阅读统计 | 实装 | **接通**：get_reading_stats<br>[设计] 查询工具 | **接通**：reading.queries.stats.forBook/list/overview<br>[设计] 统计查询 | StatsWorkspace；Agent | 已结算持久数据与当前会话 scratch 必须区分 | [READING](../apps/web/src/domain/reading.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | G01 |
| <a id="STAT02"></a>STAT02 | 周月年/连续阅读/热图/时段/成就派生 | 实装 | **接通**：get_reading_insights[双域]；get_reading_stats<br>[设计] 有界统计查询/工具侧计算 | **接通**：reading 2.8 stats.insights；既有 daily 可派生热图<br>[设计] 原始统计口径+插件计算 | 统计页；Agent；Reading Goals 0.3 时段选择、日期总量、小时分布、成就与事件更新 | 同一 SQLite 读事务读取指定书/聚合已结算投影，查询不 flush；缺书/过期投影/非法参数明确拒绝。week/month/year 是含参考日的最近 7/30/365 天；年度 12–13 月柱仅包含窗口内日期，已修正原图混入范围外整月的问题。all 图最多最近 36 个自然月，不等于完整终身直方图。7 槽 weekday 随 period，24 槽小时分布和成就明确 all-time；无日期×小时联合投影，不伪造指定周期小时分布。asOfDay 是日历参考，不是历史数据库快照；聚合保留已删书的历史，不等于当前书架数量。Agent 输出秒数、默认当前书、allBooks 明确聚合。插件主详情消费 sessionRecorded/timeRecorded 并合并重读、出错保留成功样本、离开退订；子视图是快照，删除/远端变化/跨日不声称全来源自动观察。真实 macOS debug Worker 权限、双 scope 工具、编译插件及实时增量已验；无自主模型决策证明。统计页已移除 DEV 自动写模拟历史；大历史查询仍全量读取宿主内部投影，长期负载、packaged/Windows/Linux 未验。 | [STATS](../apps/web/src/features/stats/lib/reading-insights.ts) [STATUI](../apps/web/src/features/stats/components/StatsWorkspace.tsx) [READING](../apps/web/src/domain/reading.ts) [TIME](../apps/web/src/platform/reading-session.ts) [INSIGHTS](../apps/web/src/domain/reading-insights.ts) [INSIGHTSTOOL](../packages/agent/src/tools/reading-insights.ts) [INSIGHTSVIEW](../plugins/reading-goals/src/insights-view.ts) [INSIGHTSPROOF](../docs/evidence/reading-insights-2026-09-09.json) | G03 |
| <a id="STAT03"></a>STAT03 | 已持久的未结算时长/会话与采样时钟 | 实装 | **接通**：get_reading_time[双域]<br>[设计] 含 pending 的统计查询 | **接通**：reading 2.7 stats.time / events.observeTime<br>[设计] 一致快照与可退订观察 | Agent；Reading Goals 0.2 阅读时长、日期切换、待结算列表与实时详情 | 同一 SQLite 读事务返回 settled/pending/total、全 scope 桶数、原生采样时钟和有界 keyset 页；跨连接 flush 不会重复计数。可按书/记录的 localDay 过滤，页不是冻结快照，翻页不可累加全 scope 总量。插件默认 50/最多 100 桶，Agent 默认/最多 10 桶且输出秒数与 ISO 时钟；书内默认当前书，allBooks 明确聚合。observeTime 首次读取后按至少一秒间隔再读，等待回调背压、全局最多 64 订阅、每订阅 revision；错误显式发布，退订丢弃迟到结果，不中止已派发 SQLite。reading:read/write 可读，零权限不可见，不开放计时写入/强制 flush。原生时钟不是 revision；计时器尚未持久的约 20 秒间隔不外推，不代表跨设备同步或精确墙钟秒表。views 1.2 error 块由宿主 InlineError 本地化；故障保留上次成功样本，恢复自动续更。隔离 macOS debug 已验真实 Worker 权限/分页/错误恢复/退订、双 scope Agent、编译 Reading Goals 菜单及 800x650 窗口、实际阅读 tick 与关闭结算；并发读/flush 有原生 WAL 测试。自主模型决策、长时负载、打包及 Windows/Linux 未验。 | [TIME](../apps/web/src/platform/reading-session.ts) [READING](../apps/web/src/domain/reading.ts) [TIMESNAPSHOT](../apps/desktop/src-tauri/src/storage/reading_snapshot.rs) [TIMEOBSERVER](../apps/web/src/domain/reading-time-observer.ts) [TIMETOOL](../packages/agent/src/tools/reading-time.ts) [TIMEVIEW](../plugins/reading-goals/src/time-view.ts) [TIMEPROOF](../docs/evidence/reading-time-snapshot-2026-09-09.json) | G03 |
| <a id="STAT04"></a>STAT04 | 计时/位置累积、小时结算和重启恢复 | 实装 | **未接**：宿主自动采集<br>[设计] 不开放：不得伪造阅读 | **未接**：宿主自动采集<br>[设计] 不开放：只读统计/真实阅读操作 | useReadingTimeTracker | 底层 accrue/position/flush/import/genesis 不是插件写权限 | [TIME](../apps/web/src/platform/reading-session.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) | G05 |
| <a id="STAT05"></a>STAT05 | book.sessionRecorded 正式事件 | 实装 | **自动**：下轮查询最新统计，无模型事件订阅<br>[设计] 运行时数据刷新 | **接通**：共享 core roster 推导 public union 与 runtime 事件名单<br>[设计] 同源事件契约 | 领域订阅；Reading Goals 0.3 结算后重读 | reading:read/write 可订阅 canonical sessionRecorded 的类型化 ms/day/hour/start/end/position payload；无权限不可见。真实原生 flush 追加四个事件后 Worker 收到四份正式通知，编译插件重读而不自行累加事件。legacy timeRecorded 保留兼容旧写入；同源名单防止 public union 漂移，但不等于跨设备事件流/持久重放/恰好一次，相关缺口仍见 CON07。 | [EVENTROSTER](../apps/web/src/domain/events.ts) [READINGEVENTS](../packages/core/src/reading-events.ts) [API](../packages/plugin-types/src/index.ts) [COREVENTS](../packages/core/src/events.ts) [INSIGHTSVIEW](../plugins/reading-goals/src/insights-view.ts) [INSIGHTSPROOF](../docs/evidence/reading-insights-2026-09-09.json) | G04 |

### 应用导航、命令与配置范围

| ID | 宿主能力 | 宿主现状 | Agent 当前与目标 | 插件当前与目标 | 实际消费者 | 缺口/边界 | 来源 | 旧基线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <a id="UI01"></a>UI01 | 书架/Agent/统计/设置与集合页面导航 | 实装 | **接通**：get_workspace/navigate_app 双 scope<br>[设计] 语义导航工具 | **接通**：UI 1.3 workspace.snapshot/observe/navigate<br>[设计] 语义路由服务 | 原生导航；Agent；Library Desk 0.3 | 同一服务接受 shelf/agent/stats/settings/search 意图；settings 支持九个内置节及启用插件节，search 是现有命令面板。library:read/write 可查询观察，library:write 可导航；离开正在阅读的书另需 reading:write，设置/搜索不关闭阅读。校验目标存在、期望 revision；异步校验/关闭期间原生新意图优先，新请求/取消/退役拒绝旧请求。10 秒期限，目标组件在 Suspense 内提交后才确认；回执不是动画结束、数据加载或阅读时长结算。快照含实际 reader 状态但无书 ID/正文/凭据。macOS debug 已验 Worker 权限、原生命令搜索、双 scope 端口、真实 FB2 关闭和编译插件。任意命令执行、全应用历史、全部弹窗焦点管理、打包/跨平台仍未验；不公开 Router/Jotai。 | [APP](../apps/web/src/App.tsx) [UI](../apps/web/src/state/ui.ts) [COMMAND](../apps/web/src/features/command/lib/build-commands.tsx) [API](../packages/plugin-types/src/index.ts) [WORKSPACESERVICE](../apps/web/src/services/workspace.ts) [WORKSPACEADAPTER](../apps/web/src/services/workspace-adapter.ts) [WORKSPACETOOLS](../packages/agent/src/tools/workspace-tools.ts) [WORKSPACEDESK](../plugins/library-desk/src/workspace.ts) [WORKSPACENAVPROOF](../docs/evidence/workspace-navigation-2026-09-09.json) | I01 |
| <a id="UI02"></a>UI02 | 命令面板搜索/书架布局/排序/分组/多选 | 实装 | **接通**：settings 1.3 shelf.* + get_workspace/navigate_app<br>[设计] 查询视图状态/受控设置 | **接通**：settings 1.3 shelf.* + UI 1.3 workspace<br>[设计] 视图状态与选择集服务 | 书架；Workspace Profiles；Library Desk 0.3；Agent | 布局/分组/排序沿用共享设置与 KV 回滚。集合和选择为设备内存态，观察实际提交；移出集合/删除后去掉隐藏或失效选择，隐藏书架时也协调。选择查询按 ID 码元序分页，默认 100/最大 1000，total 为全选择数；翻页须比 revision。导航最多 1000 个 256 字符 ID，必须全属目标集合；省略 selection 清空，不隐选其他集合。搜索最长 4096 字符，非新建书架过滤或书内检索。64 个观察者上限，慢回调合并最新状态，退役 null；Agent 查询至多 25，结果按预算缩页且保留 cursor，query 明确 256 字符预览。Library Desk 把跨集合勾选分组，用户明确选择一组后显示，不自动删除。macOS debug 已验 2 项选择/分页、移出后变 1、插件真实选择与搜索表单；大规模负载/远端竞态/打包和跨平台未验，多选不是批量删除授权。 | [SHELF](../apps/web/src/features/shelf/lib/shelf-view.ts) [SHELFUI](../apps/web/src/features/shelf/components/Shelf.tsx) [COMMAND](../apps/web/src/features/command/lib/build-commands.tsx) [SHELFSETTINGS](../apps/web/src/domain/settings/shelf-preferences.ts) [WORKSPACEPROFILES](../plugins/workspace-profiles/src/profiles.ts) [WORKSPACEEVIDENCE](../docs/evidence/workspace-profiles-2026-09-09.json) [WORKSPACESERVICE](../apps/web/src/services/workspace.ts) [WORKSPACEADAPTER](../apps/web/src/services/workspace-adapter.ts) [WORKSPACETOOLS](../packages/agent/src/tools/workspace-tools.ts) [WORKSPACEDESK](../plugins/library-desk/src/workspace.ts) [WORKSPACENAVPROOF](../docs/evidence/workspace-navigation-2026-09-09.json) | H03 |
| <a id="UI03"></a>UI03 | 发现/执行宿主命令与可用条件 | 实装 | **部分**：list_host_commands/execute_host_command 双 scope；执行为 sequential<br>[设计] 可审计的命令调用 | **部分**：UI 1.6 commands.list/observe/execute；commands.register 仍只贡献自己的命令<br>[设计] 命令注册与受控调用分离 | 原生命令面板；Library Desk 0.6；Agent | 当前 18 个语义命令：16 个无参数导航/书架动作及 open-book/bookId、open-collection/collectionId，资源 ID 由书库查询取得，不接受显示标签或任意菜单 ID。library:read 查询/观察，library:write 执行；字段另需 settingsAccess，开书及离开阅读另需 reading:write。设置提交后导航，失败返回 partial/settings/stable code；开书等 reading ready，不清无关覆盖层。原生命令面板共享执行器，等待/禁重/Escape/旧帧隔离已接，导入和插件贡献仍单独分发。1.6 观察初始授权快照及工作区、持久 shelf 设置和语言变化；64 观察者上限，串行合并，迟到读丢弃，隐藏字段不推送，error/stable code 后可恢复，退订/退役释放。revision 仅排序同一订阅交付，不等于 workspaceRevision 或设置 CAS。Library Desk 0.6 实时更新 checked/粗粒度可用性，保留搜索；错误保留旧行但暂停操作，恢复清错，资源选择冻结点击时 revision。Agent 查询读取同源当前状态，不新增常驻模型循环。领域设置失败仍回滚、日志、发失败事件并拒绝，由 caller 呈现；旧 void 写仍全局提示，定向 SQL 已验原生/编译插件各一条、旧写不丢提示。macOS debug 已验真实 Worker 授权/退订、远端标签覆盖、FB2 状态/语言、编译插件实时搜索与失败重试；完整慢读/错误恢复/并发为单元证据。导入、跨插件、其余入口、目标级可用性/全部焦点/打包跨平台仍缺，UI03 保持部分。 | [COMMAND](../apps/web/src/features/command/lib/build-commands.tsx) [SHORTCUT](../apps/web/src/features/settings/lib/shortcuts.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [HOSTCOMMANDS](../apps/web/src/services/host-commands.ts) [HOSTCOMMANDTOOLS](../packages/agent/src/tools/host-command-tools.ts) [HOSTCOMMANDDESK](../plugins/library-desk/src/commands.ts) [HOSTCOMMANDPROOF](../docs/evidence/host-commands-2026-09-10.json) [COMMANDRUNNER](../apps/web/src/features/command/hooks/useCommandExecution.ts) [COMMANDROUTINGPROOF](../docs/evidence/command-routing-2026-09-10.json) [COMMANDOBSERVERS](../apps/web/src/services/host-command-observers.ts) [COMMANDOBSERVATIONPROOF](../docs/evidence/command-observation-2026-09-10.json) | I02, I03 |
| <a id="UI04"></a>UI04 | 快捷键查询、重绑、冲突与重置 | 实装 | **部分**：get_settings/update_settings：shortcuts section<br>[设计] 完整绑定与生命周期 | **部分**：settings 1.5：key-chord 查询/重绑/null 恢复；默认 shortcut 贡献<br>[设计] 命令绑定与冲突查询 | 快捷键设置页；Agent；Workspace Profiles 0.2 自身命令重绑 | 16 个内置、当前注册插件命令及未注册插件遗留覆盖按同一有效 binding 读写，default/override/availability/conflicted/conflicts 可查询；插件路径编码且精确授权，writable 按授权收窄，冲突引用按 read grant 过滤。整批最终态校验允许交换，失败不提交；null 删除覆盖，不表示禁用。实际 macOS 键盘验证 Agent 改搜索、Worker 交换搜索/设置、Workspace 表单改自己的命令并按新键打开；冲突保留表单与绑定并显示本地化稳定错误。原生设置页已统一域写，单项/全部重置等待提交，发出 user 来源事件；只读 atom 不再有直接整表 setter。停用命令遗留覆盖按授权可查/改/清，原生不可用分组可重置，真实 Worker 已验退休后修改与 SQLite 清理。激活冲突已统一裁决：全局、插件、阅读器按同一实时目录暂停所有冲突绑定，不依赖监听/注册顺序；停用或重绑自动恢复。原生页显示冲突，conflicted 保留给授权调用者而冲突路径仍按 grant 隐藏。实机已验搜索/插件重启冲突、正文 iframe 冲突/停用恢复与插件面板不误翻页。settings 1.6 queries.observe 已覆盖本地/远端/恢复与目录的 revision/source，旧调用者 origin 仍可为 null；available 不代表当前焦点可执行。保留部分，不宣称 packaged/跨平台与完整按键路由已验 | [SHORTCUT](../apps/web/src/features/settings/lib/shortcuts.ts) [SHORTUI](../apps/web/src/features/settings/sections/ShortcutsPanel.tsx) [SHORTCUTCATALOG](../apps/web/src/features/settings/lib/shortcut-catalog.ts) [SHORTCUTSETTINGS](../apps/web/src/domain/settings/shortcut-preferences.ts) [SHORTCUTPROOF](../docs/evidence/keyboard-shortcuts-2026-09-09.json) [SHORTCUTEDITOR](../apps/web/src/features/settings/hooks/useShortcutPreferences.ts) [SHORTCUTEDITORPROOF](../docs/evidence/shortcut-editor-2026-09-09.json) [SHORTCUTDISPATCH](../apps/web/src/features/settings/lib/shortcut-dispatch.ts) [SHORTCUTDISPATCHPROOF](../docs/evidence/shortcut-dispatch-2026-09-09.json) [API](../packages/plugin-types/src/index.ts) | H03, I02 |
| <a id="UI05"></a>UI05 | 菜单可见/溢出位置及自定义重排 | 实装 | **接通**：get_settings/update_settings menus.*<br>[设计] 结构化设置工具 | **接通**：settings domain menus.* 按路径授权<br>[设计] 结构化设置领域 | 菜单设置；插件 header/selection | 可改布局不代表可调用菜单动作；具体 8 个路径另逐项列出 | [MENU](../apps/web/src/features/menus/lib/menu-registry.tsx) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) | I08 |
| <a id="CFG01"></a>CFG01 | 设置 discover/read/update 与动态选项 | 实装 | **接通**：get_settings/update_settings；等待本地事务提交<br>[设计] 设置工具 | **接通**：settings 1.5 snapshot/discover/read/update；原子保存与授权结果<br>[设计] 路径授权设置领域 | Agent；Theme Schedule；TTS options；Workspace Profiles | snapshot 等待此前命令/UI 写结算后一次读取，按路径授权过滤；单个命令跨 KV 记录原子提交；失败不发 settings.changed，下一命令基于已结算状态；结果快照按 read/write grant 过滤，writable 反映当前 actor 授权，discover 不泄露快捷键运行态。事务不包含密钥、远端漫游提交或尚未接通的效果；设置 API 接通不证明值有消费者 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [KV](../apps/web/src/platform/local-store.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) | H01 |
| <a id="CFG02"></a>CFG02 | 全局/本书/全书阅读设置覆盖 | 实装 | **接通**：update_settings target<br>[设计] 显式作用域写工具 | **接通**：settings.commands.update target<br>[设计] 显式作用域写领域 | AppearancePanel；Agent | all-books 写全局并更新 overrides，不等于清除所有覆盖 | [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [OVERRIDES](../apps/web/src/features/settings/lib/reader-overrides.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) | H05 |
| <a id="CFG03"></a>CFG03 | 清除覆盖/恢复默认/查询值来源 | 实装 | **接通**：get_settings/reset_reading_settings[双域]<br>[设计] 来源查询/整套阅读偏好重置 | **接通**：settings 1.7 snapshot/read + commands.resetReading<br>[设计] 读路径授权/全部阅读字段写授权 | 既有阅读偏好/覆盖存储；两端共享重置 | 沿用整套本书覆盖而非新增逐字段继承。reading 元数据给出 global/book 来源、absent/active/inactive 覆盖及内置 defaultValue；discover 不泄露当前来源。defaults global 仅重置全局，book 写内置默认为本书覆盖，all-books 重置全局并删全部覆盖；inherit book/all-books 删除含停用记忆的覆盖并跟随未来全局，不能用于 global。须有全部现有 reading 字段写权；同普通更新队列、单批持久回执/失败无成功事件，退休排队不派发。重置通知使全部阅读字段失效，值相等也可能来源改变；重复重置无伪变更。不重置其他领域/阅读位置；不是跨设备 CAS、全设置来源审计或逐字段 inherit。定向测试通过，真实 Worker/外观效果仍待集中 Tauri E2E。 | [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) [OVERRIDES](../apps/web/src/features/settings/lib/reader-overrides.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [READINGRESET](../apps/web/src/domain/settings/reading-reset.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | H05 |
| <a id="CFG04"></a>CFG04 | 阅读对齐 reading.textAlign | 实装 | **接通**：get_settings/update_settings<br>[设计] 结构化设置工具 | **接通**：settings 1.2；显式 global/book/all-books<br>[设计] 路径授权设置领域 | 阅读设置/渲染 | book/start/justify；与阅读外观同一覆盖规则，不是另造 CSS 接口 | [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) | H02 |
| <a id="CFG05"></a>CFG05 | 固定版式颜色 reading.fixedLayoutColor | 实装 | **接通**：get_settings/update_settings<br>[设计] 结构化设置工具 | **接通**：settings 1.2；显式 global/book/all-books<br>[设计] 路径授权设置领域 | 固定版式外观 | theme/original；不是 reading.theme 的同义项；仅固定版式内容消费 | [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) | H02 |
| <a id="CFG06"></a>CFG06 | 更新内容弹窗 general.whatsNewDialog | 实装 | **接通**：get_settings/update_settings<br>[设计] 结构化设置工具 | **接通**：settings 1.2；全局布尔字段<br>[设计] 路径授权设置领域 | GeneralPanel / useWhatsNewDialog | 控制后续升级说明提示，不是立即打开更新弹窗或安装更新 | [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) [WHATSNEW](../apps/web/src/features/update/hooks/useWhatsNewDialog.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) | H04 |
| <a id="CFG07"></a>CFG07 | AI 提供商/端点/密钥配置 | 实装 | **部分**：只读 provider/credentialConfigured；无密钥<br>[设计] 打开宿主敏感配置流程 | **部分**：受权读非敏感存在状态；无宿主 key<br>[设计] 打开宿主敏感配置流程 | AIConfigPanel | 不开放：读取宿主密钥；不能把 readonly provider 算作可切换提供商 | [AICONFIG](../apps/web/src/features/ai/lib/ai-config.ts) [AICONFIGUI](../apps/web/src/features/settings/components/AIConfigPanel.tsx) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SECRETS](../apps/web/src/platform/secret-store.ts) | H04 |
| <a id="CFG08"></a>CFG08 | 模型目录刷新、连接测试与模型能力 | 实装 | **部分**：设置 discover 给模型选项<br>[设计] 连接诊断/能力查询 | **部分**：settings discover 动态选项<br>[设计] 连接诊断/能力查询 | AI 配置页 | 选择已缓存模型不等于能刷新/测试连接 | [MODELCATALOG](../apps/web/src/features/ai/lib/model-catalog.ts) [AICONFIGUI](../apps/web/src/features/settings/components/AIConfigPanel.tsx) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) | H04 |
| <a id="CFG09"></a>CFG09 | 插件非敏感设置的动态路径 | 实装 | **接通**：plugins.<id>.<field> get/update_settings<br>[设计] 参数配置工具 | **接通**：自有路径默认授权；他者路径需 grant<br>[设计] 隔离设置领域 | TTS/RSS/Theme Schedule 等 | 插件启用/声明决定目录；secret/password 字段不暴露；配置不等于执行插件命令 | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) | H06 |
| <a id="CFG10"></a>CFG10 | 设置变化事件/外部写入刷新 | 部分 | **自动**：get_settings/update_settings 共用已结算 revision；不建模型后台订阅<br>[设计] 运行时刷新 | **部分**：settings 1.6 queries.observe 已结算快照 + source/origin<br>[设计] 有版本/来源的观察 | Workspace Profiles 0.3 当前工作区；Theme Schedule；原生设置与 Worker 镜像 | 观察初始和实际提交后的授权值/目录元数据，64 全局上限、串行/合并、错误稳定 code、退订禁止晚发；领域/原生/插件 KV、远端覆盖、备份合并/前缀恢复、主题字体/命令/菜单/模式目录共用失效时钟。source 为 initial/local/remote/restore/catalog/mixed；领域和插件存储保留 actor，旧原生和远端实际 actor 未知为 null，不伪造 user。snapshot/discover/read 等 KV 与凭据队列结算；密钥不出域，仅已配置状态。失败写无成功通知，已发写不因退役回滚，排队插件写退役后不派发。进程 revision 非同步时钟、CAS、重放或 exactly-once；隐藏/无效变更可只推进时钟。macOS debug 已验实际设置点击、只读拒写/无权空态、两 Agent scope、五类来源、目录增删、编译实时视图、SQLite 拒绝与恢复。凭据发布已改为精确的本地持久成功值，使用已持久主密钥；回补等写队列结算，远端凭据覆盖等实际保存且不回发；原生加密存储拒写/拒删与恢复已有证据，延迟竞争和连接凭据失败有 IPC 回归。旧 settings.changed 仍只含领域命令；凭据保存与事件追加非同一事务，持久 outbox/崩溃重放、完整来源审计、旧密钥迁移、普通 KV 覆盖完成、所有 UI 草稿/异步效果、真实网络与打包跨平台未闭合，GAP03/09/11 保留。 | [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [WORKER](../apps/web/src/features/plugins/runtime/plugin-sandbox.worker.ts) [KV](../apps/web/src/platform/local-store.ts) [SETOBS](../apps/web/src/domain/settings/observation-sources.ts) [SETOBSHUB](../apps/web/src/domain/settings/observation.ts) [SETOBSPROOF](../docs/evidence/settings-observation-2026-09-10.json) [CURRENTWORKSPACE](../plugins/workspace-profiles/src/current.ts) [CREDENTIALROAMING](../apps/web/src/platform/roaming-preferences.ts) [CREDENTIALPROOF](../docs/evidence/credential-roaming-2026-09-10.json) | H01 |
| <a id="CFG11"></a>CFG11 | 聊天/笔记内容字体：跟随阅读或独立字号/字体/行距 | 实装 | **接通**：appearance.contentTypography.*<br>[设计] 结构化设置工具 | **接通**：settings 1.2；四个全局字段<br>[设计] 路径授权设置领域 | AppearancePanel；聊天、笔记、插件 Markdown 与 composer | followReader/fontFamily/fontSize/lineSpacing；跟随全局 reader 而非本书 override；fontFamily=null 为应用字体，独立字段只在 followReader=false 生效；base atom 跟随 KV 回滚 | [TYPOGRAPHY](../apps/web/src/features/settings/lib/content-typography.ts) [TYPOGRAPHYUI](../apps/web/src/features/settings/sections/AppearancePanel.tsx) [TYPOGRAPHYEFFECT](../apps/web/src/features/settings/hooks/useContentTypography.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) | 新增盘点 |
| <a id="CFG12"></a>CFG12 | 新标注默认颜色 | 实装 | **接通**：annotations.defaultColor<br>[设计] 结构化设置工具 | **接通**：settings 1.2；annotations section<br>[设计] 路径授权设置领域 | 一键高亮/下划线；recolor 更新后续默认色 | yellow/green/blue/pink，默认 yellow；宿主动作即时读取当前偏好，不再捕获挂载时颜色；不重染已有标注 | [MARKPREFS](../apps/web/src/features/annotations/lib/annotation-prefs.ts) [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) | 新增盘点 |
| <a id="CFG13"></a>CFG13 | 软件更新通道 stable/beta | 实装 | **接通**：general.updateChannel<br>[设计] 设备本地设置工具 | **接通**：settings 1.2；全局枚举字段<br>[设计] 路径授权设置领域 | AboutPanel；软件更新查询 | 设备本地且不漫游；已打开 About 控件跟随 KV 更新/回滚；修改通道只影响后续检查，不批准下载、安装或重启 | [UPDATECHANNEL](../apps/web/src/features/update/lib/update-channel.ts) [ABOUT](../apps/web/src/features/settings/sections/AboutPanel.tsx) [UPDATE](../apps/web/src/features/update/lib/software-update.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) | 新增盘点 |

### 设置字段逐项覆盖（74 个具体路径）

| ID | 宿主能力 | 宿主现状 | Agent 当前与目标 | 插件当前与目标 | 实际消费者 | 缺口/边界 | 来源 | 旧基线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <a id="SET01"></a>SET01 | general.startView | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) | 新增盘点 |
| <a id="SET02"></a>SET02 | general.language | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) | 新增盘点 |
| <a id="SET03"></a>SET03 | general.crashPrompt | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) | 新增盘点 |
| <a id="SET04"></a>SET04 | general.launchAtStartup | 部分 | **部分**：get_settings/update_settings<br>[设计] 类型化设置工具 | **部分**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 仅设置页/设置存储/目录；效果未接 | 保存值有实现；全生产源码扫描未找到对应效果消费者。不能算行为已实现或端到端覆盖。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) | 新增盘点 |
| <a id="SET05"></a>SET05 | general.fileAssociations | 部分 | **部分**：get_settings/update_settings<br>[设计] 类型化设置工具 | **部分**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 仅设置页/设置存储/目录；效果未接 | 保存值有实现；全生产源码扫描未找到对应效果消费者。不能算行为已实现或端到端覆盖。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) | 新增盘点 |
| <a id="SET06"></a>SET06 | general.autoUpdate | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 实际消费者只控制自动检查，不表示无批准自动安装。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) | 新增盘点 |
| <a id="SET07"></a>SET07 | appearance.theme | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET08"></a>SET08 | appearance.motion | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET09"></a>SET09 | reading.theme | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) | 新增盘点 |
| <a id="SET10"></a>SET10 | reading.fontFamily | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) | 新增盘点 |
| <a id="SET11"></a>SET11 | reading.fontSize | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) | 新增盘点 |
| <a id="SET12"></a>SET12 | reading.fontWeight | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) | 新增盘点 |
| <a id="SET13"></a>SET13 | reading.lineSpacing | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) | 新增盘点 |
| <a id="SET14"></a>SET14 | reading.paragraphSpacing | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) | 新增盘点 |
| <a id="SET15"></a>SET15 | reading.pageMargins | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) | 新增盘点 |
| <a id="SET16"></a>SET16 | reading.readingMode | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) | 新增盘点 |
| <a id="SET17"></a>SET17 | reading.fixedLayoutReadingMode | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) | 新增盘点 |
| <a id="SET18"></a>SET18 | ai.preferences.features.explainSelection | 部分 | **部分**：get_settings/update_settings<br>[设计] 类型化设置工具 | **部分**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 仅设置页/设置存储/目录；效果未接 | 保存值有实现；全生产源码扫描未找到对应效果消费者。不能算行为已实现或端到端覆盖。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [AIPREFS](../apps/web/src/features/settings/lib/ai-preferences.ts) | 新增盘点 |
| <a id="SET19"></a>SET19 | ai.preferences.features.defineTerm | 部分 | **部分**：get_settings/update_settings<br>[设计] 类型化设置工具 | **部分**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 仅设置页/设置存储/目录；效果未接 | 保存值有实现；全生产源码扫描未找到对应效果消费者。不能算行为已实现或端到端覆盖。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [AIPREFS](../apps/web/src/features/settings/lib/ai-preferences.ts) | 新增盘点 |
| <a id="SET20"></a>SET20 | ai.preferences.features.translate | 部分 | **部分**：get_settings/update_settings<br>[设计] 类型化设置工具 | **部分**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 仅设置页/设置存储/目录；效果未接 | 保存值有实现；全生产源码扫描未找到对应效果消费者。不能算行为已实现或端到端覆盖。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [AIPREFS](../apps/web/src/features/settings/lib/ai-preferences.ts) | 新增盘点 |
| <a id="SET21"></a>SET21 | ai.preferences.features.summarizeChapter | 部分 | **部分**：get_settings/update_settings<br>[设计] 类型化设置工具 | **部分**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 仅设置页/设置存储/目录；效果未接 | 保存值有实现；全生产源码扫描未找到对应效果消费者。不能算行为已实现或端到端覆盖。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [AIPREFS](../apps/web/src/features/settings/lib/ai-preferences.ts) | 新增盘点 |
| <a id="SET22"></a>SET22 | ai.preferences.features.askConversation | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [AIPREFS](../apps/web/src/features/settings/lib/ai-preferences.ts) | 新增盘点 |
| <a id="SET23"></a>SET23 | ai.preferences.buildMemory | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 实时控制宿主记忆构建：显式 remember、轮后抽取/强化/插件候选/旧历史领养/摘要、巩固、章节 digest/自动叙事分类及 onboarding seed 均受约束。关闭返回 ai/memory-disabled，取消在途模型调用和已排队任务，重开不复活旧任务。普通聊天/历史、旧记忆检索、用户删除和插件自有目标保存不受影响；重开后的新任务可处理保留历史。摘要写入/清除等待持久回执；已派发底层写不保证撤销，但七类受保护写的回执全部收束后外层才结束取消；迟到失败记日志，退役 guard 不可复用，读/模型物理 IO 不在保证内。隔离 macOS debug 双端、真实 UI 聊天、候选入库、取消和 SQLite 失败已验；packaged/跨平台未验。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MEMORYPOLICY](../packages/agent/src/memory/build-policy.ts) [HOSTMEMORYPOLICY](../apps/web/src/features/ai/agent/memory-policy.ts) [READINGGOALS](../plugins/reading-goals/src/index.ts) [MEMORYPOLICYPROOF](../docs/evidence/memory-build-policy-2026-09-09.json) | 新增盘点 |
| <a id="SET24"></a>SET24 | ai.preferences.sendHighlightedText | 部分 | **部分**：get_settings/update_settings<br>[设计] 类型化设置工具 | **部分**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 已有真实 Agent 消费者：selection 关闭过滤自动附件与历史附件检索/匹配；任一文本开关关闭都移除可能重叠的 viewport；surrounding 关闭不装配 grounding。保留本地附件和手写问题，get_reading_session 同样过滤文本；切策略重建缓存上下文。收紧返回 ai/context-changed，取消在途/准备中回合和排队记忆任务，重开不复活旧请求。Agent 设置与授权 Worker 设置写入、四组合请求、SQLite 历史保留和在途传输取消已在隔离 macOS debug 验证。LLM 1.1 readingContext 已将结构化正文纳入同一过滤/取消，Dictionary 1.3 已迁移，必需字段被禁止时报 ai/context-withheld；双端三模式四组合、实际缓存/拒绝、重试及三并发取消有桌面证据。插件本地 selection/lookup 回调、任意自行组装 prompt/HTTP/TTS、独立正文/标注检索与旧回答/记忆/纪要不因此清除或禁用；完整隐私、packaged/跨平台仍未闭合，保留部分。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [READINGCONTEXTPOLICY](../packages/agent/src/runtime/reading-context-policy.ts) [HOSTREADINGCONTEXTPOLICY](../apps/web/src/features/ai/agent/reading-context-policy.ts) [READINGCONTEXTPROOF](../docs/evidence/reading-context-policy-2026-09-09.json) [STRUCTUREDREADING](../packages/agent/src/runtime/one-shot.ts) [STRUCTUREDREADINGPROOF](../docs/evidence/structured-reading-context-2026-09-09.json) [THREAD](../packages/agent/src/runtime/thread.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) | 新增盘点 |
| <a id="SET25"></a>SET25 | ai.preferences.sendSurroundingContext | 部分 | **部分**：get_settings/update_settings<br>[设计] 类型化设置工具 | **部分**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 已有真实 Agent 消费者：selection 关闭过滤自动附件与历史附件检索/匹配；任一文本开关关闭都移除可能重叠的 viewport；surrounding 关闭不装配 grounding。保留本地附件和手写问题，get_reading_session 同样过滤文本；切策略重建缓存上下文。收紧返回 ai/context-changed，取消在途/准备中回合和排队记忆任务，重开不复活旧请求。Agent 设置与授权 Worker 设置写入、四组合请求、SQLite 历史保留和在途传输取消已在隔离 macOS debug 验证。LLM 1.1 readingContext 已将结构化正文纳入同一过滤/取消，Dictionary 1.3 已迁移，必需字段被禁止时报 ai/context-withheld；双端三模式四组合、实际缓存/拒绝、重试及三并发取消有桌面证据。插件本地 selection/lookup 回调、任意自行组装 prompt/HTTP/TTS、独立正文/标注检索与旧回答/记忆/纪要不因此清除或禁用；完整隐私、packaged/跨平台仍未闭合，保留部分。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [READINGCONTEXTPOLICY](../packages/agent/src/runtime/reading-context-policy.ts) [HOSTREADINGCONTEXTPOLICY](../apps/web/src/features/ai/agent/reading-context-policy.ts) [READINGCONTEXTPROOF](../docs/evidence/reading-context-policy-2026-09-09.json) [STRUCTUREDREADING](../packages/agent/src/runtime/one-shot.ts) [STRUCTUREDREADINGPROOF](../docs/evidence/structured-reading-context-2026-09-09.json) [THREAD](../packages/agent/src/runtime/thread.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) | 新增盘点 |
| <a id="SET26"></a>SET26 | ai.preferences.localOnly | 部分 | **部分**：get_settings/update_settings<br>[设计] 类型化设置工具 | **部分**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 宿主模型调用已有实时执行策略：Agent smart/fast、后台补全、Worker llm.ask 普通/结构化/流式及连接测试同源拒绝 ai/local-only；进行中调用取消，迟到结果/重试被抑制，恢复只允许新调用。当前无本地模型后端，Custom loopback 也拒绝。隔离 macOS debug 双端/取消/持久失败回滚/原生连接 UI 已验；任意插件 HTTP、TTS、同步不受此策略约束，完整隐私边界与 packaged/跨平台仍未完成，保留部分。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [AIPREFS](../apps/web/src/features/settings/lib/ai-preferences.ts) [INFERENCEPOLICY](../packages/agent/src/models/inference-policy.ts) [HOSTINFERENCEPOLICY](../apps/web/src/features/ai/agent/inference-policy.ts) [INFERENCEEVIDENCE](../docs/evidence/inference-local-only-2026-09-09.json) | 新增盘点 |
| <a id="SET27"></a>SET27 | ai.preferences.followStreaming | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [AIPREFS](../apps/web/src/features/settings/lib/ai-preferences.ts) | 新增盘点 |
| <a id="SET28"></a>SET28 | ai.connection.configured | 实装 | **接通**：get_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 只读状态，不返回密钥/端点凭据；不等于配置命令。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET29"></a>SET29 | ai.connection.credentialConfigured | 实装 | **接通**：get_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 只读状态，不返回密钥/端点凭据；不等于配置命令。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET30"></a>SET30 | menus.primaryNav.visible | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 只影响菜单排列/显示，不调用菜单动作。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) | 新增盘点 |
| <a id="SET31"></a>SET31 | menus.primaryNav.overflow | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 只影响菜单排列/显示，不调用菜单动作。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) | 新增盘点 |
| <a id="SET32"></a>SET32 | menus.shelfHeader.visible | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 只影响菜单排列/显示，不调用菜单动作。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) | 新增盘点 |
| <a id="SET33"></a>SET33 | menus.shelfHeader.overflow | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 只影响菜单排列/显示，不调用菜单动作。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) | 新增盘点 |
| <a id="SET34"></a>SET34 | menus.readerHeader.visible | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 只影响菜单排列/显示，不调用菜单动作。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) | 新增盘点 |
| <a id="SET35"></a>SET35 | menus.readerHeader.overflow | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 只影响菜单排列/显示，不调用菜单动作。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) | 新增盘点 |
| <a id="SET36"></a>SET36 | menus.selection.visible | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 只影响菜单排列/显示，不调用菜单动作。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) | 新增盘点 |
| <a id="SET37"></a>SET37 | menus.selection.overflow | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 只影响菜单排列/显示，不调用菜单动作。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) | 新增盘点 |
| <a id="SET38"></a>SET38 | ai.connection.provider | 实装 | **接通**：get_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 只读状态，不返回密钥/端点凭据；不等于配置命令。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET39"></a>SET39 | ai.connection.primaryModel | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET40"></a>SET40 | ai.connection.fastModel | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET41"></a>SET41 | ai.connection.thinkingLevel | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET42"></a>SET42 | ai.connection.fastThinkingLevel | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET43"></a>SET43 | ai.connection.custom.endpointConfigured | 实装 | **接通**：get_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 只读状态，不返回密钥/端点凭据；不等于配置命令。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET44"></a>SET44 | ai.connection.custom.api | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET45"></a>SET45 | ai.connection.custom.supportsThinking | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET46"></a>SET46 | ai.connection.custom.maxOutputTokens | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET47"></a>SET47 | reading.textAlign | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) | 新增盘点 |
| <a id="SET48"></a>SET48 | reading.fixedLayoutColor | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) | 新增盘点 |
| <a id="SET49"></a>SET49 | general.whatsNewDialog | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) | 新增盘点 |
| <a id="SET50"></a>SET50 | appearance.contentTypography.followReader | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [TYPOGRAPHY](../apps/web/src/features/settings/lib/content-typography.ts) [TYPOGRAPHYEFFECT](../apps/web/src/features/settings/hooks/useContentTypography.ts) | 新增盘点 |
| <a id="SET51"></a>SET51 | appearance.contentTypography.fontFamily | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [TYPOGRAPHY](../apps/web/src/features/settings/lib/content-typography.ts) [TYPOGRAPHYEFFECT](../apps/web/src/features/settings/hooks/useContentTypography.ts) | 新增盘点 |
| <a id="SET52"></a>SET52 | appearance.contentTypography.fontSize | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [TYPOGRAPHY](../apps/web/src/features/settings/lib/content-typography.ts) [TYPOGRAPHYEFFECT](../apps/web/src/features/settings/hooks/useContentTypography.ts) | 新增盘点 |
| <a id="SET53"></a>SET53 | appearance.contentTypography.lineSpacing | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [TYPOGRAPHY](../apps/web/src/features/settings/lib/content-typography.ts) [TYPOGRAPHYEFFECT](../apps/web/src/features/settings/hooks/useContentTypography.ts) | 新增盘点 |
| <a id="SET54"></a>SET54 | annotations.defaultColor | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MARKPREFS](../apps/web/src/features/annotations/lib/annotation-prefs.ts) [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) | 新增盘点 |
| <a id="SET55"></a>SET55 | general.updateChannel | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UPDATECHANNEL](../apps/web/src/features/update/lib/update-channel.ts) [ABOUT](../apps/web/src/features/settings/sections/AboutPanel.tsx) | 新增盘点 |
| <a id="SET56"></a>SET56 | shelf.layout | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET57"></a>SET57 | shelf.group | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET58"></a>SET58 | shelf.sort | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET59"></a>SET59 | shortcuts.search | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET60"></a>SET60 | shortcuts.settings | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET61"></a>SET61 | shortcuts.new-conversation | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET62"></a>SET62 | shortcuts.next-page | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET63"></a>SET63 | shortcuts.prev-page | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET64"></a>SET64 | shortcuts.next-chapter | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET65"></a>SET65 | shortcuts.prev-chapter | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET66"></a>SET66 | shortcuts.toggle-controls | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET67"></a>SET67 | shortcuts.reader-mode-next-unit | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET68"></a>SET68 | shortcuts.reader-mode-prev-unit | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET69"></a>SET69 | shortcuts.selection-copy | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET70"></a>SET70 | shortcuts.selection-highlight | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET71"></a>SET71 | shortcuts.selection-underline | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET72"></a>SET72 | shortcuts.selection-add-note | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET73"></a>SET73 | shortcuts.selection-look-up | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |
| <a id="SET74"></a>SET74 | shortcuts.selection-ask-ai | 实装 | **接通**：get_settings/update_settings<br>[设计] 类型化设置工具 | **接通**：settings discover/read/update（需路径授权）<br>[设计] 类型化设置领域 | 设置页；Agent；授权插件可调用（不代表每个插件实际调用） | 目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) | 新增盘点 |

### 对话、Agent 交互与推理

| ID | 宿主能力 | 宿主现状 | Agent 当前与目标 | 插件当前与目标 | 实际消费者 | 缺口/边界 | 来源 | 旧基线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <a id="AI01"></a>AI01 | 读取书内/全局对话及搜索历史 | 实装 | **接通**：search_conversation/get_recent_turns<br>[设计] 有界查询工具 | **接通**：conversations.queries getBookThread/listThreads/getThread<br>[设计] 受权只读领域 | Agent；聊天历史 | 插件拿到 transcript 不等于自动得到画像/记忆；当前查询范围和列表量需约束 | [CHATDOMAIN](../apps/web/src/domain/conversations.ts) [CHATPORT](../apps/web/src/features/ai/agent/ports/conversation-port.ts) [CHATTOOLS](../packages/agent/src/tools/conversation-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | L03 |
| <a id="AI02"></a>AI02 | 创建/切换/清空全局线程和书内聊天 | 实装 | **接通**：get_conversation_state 双 scope；manage_conversation 全局<br>[设计] 创建/选择及经批准清空其他线程 | **接通**：conversations 1.1 commands.createThread/selectThread/clear<br>[设计] conversations:write 受控命令 | AgentWorkspace；ChatPanel；Agent 工具；插件正式入口 | 创建持久选择的空全局草稿，首次消息才创建 transcript 行；选择不等于导航/可见，未知线程拒绝。clear 先停止并等在途回合最后写入，再清 transcript 与隐藏线程/insights；不删除长期记忆、事件历史或已完成工具副作用，多步清空不承诺原子回滚。Agent 不通过执行中的工具停止/清空自身，以免死锁，当前线程仍由原生控件管理。权限/持久选择失败/排空定向测试通过；新组合插件与 Tauri E2E 待集中验收。 | [CHAT](../apps/web/src/features/ai/lib/conversation-store.ts) [CHATDOMAIN](../apps/web/src/domain/conversations.ts) [CONVCONTROL](../apps/web/src/domain/conversation-control.ts) [CONVRUNTIME](../apps/web/src/domain/conversation-runtime.ts) [CONVTOOLS](../packages/agent/src/tools/conversation-control-tools.ts) [AGENTUI](../apps/web/src/features/agent/components/AgentWorkspace.tsx) [CHATCONTROL](../apps/web/src/features/ai/hooks/useBookConversation.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) | L04 |
| <a id="AI03"></a>AI03 | 发送/流式生成/停止/重试聊天回合 | 实装 | **接通**：request_conversation_turn 双 scope；get_conversation_state；manage_conversation stop<br>[设计] 宿主确认后采用/发送/重试，非递归调用自身 | **接通**：conversations 1.2 requestTurn/cancelTurnRequest + queries.turnRequests/runtime/observeRuntime<br>[设计] 受权提交意图、查询结果与停止排空 | 书内/全局聊天确认栏；Agent/插件正式入口 | draft/send 文本 1–65536 字符，retry 不接替代正文或 role；只向已挂载聊天提交，每个目标最多一个待确认请求，五分钟过期，卸载/关闭/停止/清空取消。宿主原生按钮才可采用草稿或启动回合，草稿不覆盖已输入文本；send/retry 要空闲且沿用请求时的 transcript generation，retry 复用原消息/附件。请求不自动导航；pending 不等于接受，adopted 不等于已发，started 不等于生成/持久化完成；流式输出仍由原生聊天承载，不提供任意伪造历史入口。最多保留全宿主 128 个状态记录，queries 仅返回自有无正文摘要，Agent 只看本 scope 最近 20 项并报截断。取消不能撤回已采用草稿/已启动回合或工具副作用；运行态不暴露正文，stop 等最后写入。定向权限/状态/生命周期测试通过，组合插件与 Tauri E2E 待集中验收。 | [THREAD](../packages/agent/src/runtime/thread.ts) [CHATCONTROL](../apps/web/src/features/ai/hooks/useBookConversation.ts) [CHATUI](../apps/web/src/features/ai/components/ChatPanel.tsx) [RUNTIME](../packages/agent/src/runtime/runtime.ts) [API](../packages/plugin-types/src/index.ts) [CONVCONTROL](../apps/web/src/domain/conversation-control.ts) [CONVRUNTIME](../apps/web/src/domain/conversation-runtime.ts) [CONVTOOLS](../packages/agent/src/tools/conversation-control-tools.ts) [CONVREQUESTS](../apps/web/src/domain/conversation-turn-requests.ts) [CONVREQUESTUI](../apps/web/src/features/ai/components/ChatTurnRequest.tsx) | L05 |
| <a id="AI04"></a>AI04 | 提问、选项澄清、批准/拒绝高风险动作 | 实装 | **接通**：ask_user + InteractionPort<br>[设计] 宿主交互工具 | **部分**：表单可收输入，无通用权限批准票据<br>[设计] 宿主拥有的一次性批准流程 | Agent question/permission cards | 确认 UI 与授权决策分离；插件自画 Yes 按钮不是 host approval | [INTERACTION](../packages/agent/src/tools/interaction-tools.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [API](../packages/plugin-types/src/index.ts) | L05 |
| <a id="AI05"></a>AI05 | Agent 展示可点击书卡与词典卡 | 实装 | **接通**：present_books[全局]；插件 tool details.wordCards<br>[设计] 结构化结果呈现 | **部分**：agentTools 固定 word-card details<br>[设计] 类型化呈现结果 | Agent 书卡；Dictionary 单词卡 | 工具结果卡与 PluginView 协议不同，不能任意互换 | [PRESENT](../packages/agent/src/tools/present-tools.ts) [EXTOOLS](../apps/web/src/features/plugins/runtime/plugin-tools.ts) [API](../packages/plugin-types/src/index.ts) [DICTTOOLS](../plugins/dictionary/src/agent-tools.ts) | 新增盘点 |
| <a id="AI06"></a>AI06 | 一次性文本/结构化/流式 LLM 推理 | 实装 | **自动**：Runtime ask + 线程推理<br>[设计] 运行时服务 | **接通**：services.llm 1.1 ask + readingContext/schema/onText<br>[设计] 受预算约束的推理服务 | Dictionary 1.3；Agent 后台管线 | readingContext 由宿主过滤并在收紧时取消普通/结构化/流式调用；必需正文被禁止时报 ai/context-withheld，非法结构报 ai/invalid-reading-context。Dictionary 本地缓存仍可读，外发不自行拼接选区。双端四组合、重试、并发取消已有 macOS debug 证据；任意 prompt 不做来源推断。仍无公开 AbortSignal/任务预算/用量回执 | [RUNTIME](../packages/agent/src/runtime/runtime.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [API](../packages/plugin-types/src/index.ts) [DICT](../plugins/dictionary/src/index.ts) [STRUCTUREDREADING](../packages/agent/src/runtime/one-shot.ts) [STRUCTUREDREADINGPROOF](../docs/evidence/structured-reading-context-2026-09-09.json) | L01 |
| <a id="AI07"></a>AI07 | 推理取消、超时、用量/预算/成本可见性 | 部分 | **部分**：线程 abort；model API 内部控制<br>[设计] 统一任务/预算 | **部分**：ask 无公开取消/用量字段<br>[设计] 统一任务/预算 | 聊天 Stop；模型错误处理 | 宿主线程停止不是所有插件推理任务的可取消协议 | [THREAD](../packages/agent/src/runtime/thread.ts) [RUNTIME](../packages/agent/src/runtime/runtime.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) | L02 |
| <a id="AI08"></a>AI08 | 书内 scope/游标/选区自动 grounding | 实装 | **自动**：thread + grounding-context<br>[设计] 自动且有来源的上下文 | **部分**：context/retrieval provider 能补充，不能覆写核心<br>[设计] 受限上下文贡献 | 书内 Agent | 自动注入不等于独立工具；不允许插件注入更高优先级系统策略 | [THREAD](../packages/agent/src/runtime/thread.ts) [GROUND](../packages/agent/src/runtime/grounding-context.ts) [EXTOOLS](../apps/web/src/features/plugins/runtime/plugin-tools.ts) | L07 |
| <a id="AI09"></a>AI09 | 剧透边界、请求允许超前内容 | 实装 | **接通**：read_chapter/search_book_text/query_book_graph + 批准<br>[设计] 宿主策略 | **部分**：book text domain 无同样的模型剧透审批<br>[设计] 数据授权与 Agent 剧透策略分开 | 书内 Agent | 访问权限不是剧透许可；插件提供上下文需要 provenance/fence 政策 | [SPOILER](../packages/agent/src/tools/spoiler-permission.ts) [TEXTTOOLS](../packages/agent/src/tools/book-text-tools.ts) [GRAPHTOOLS](../packages/agent/src/tools/graph-tools.ts) [LIB](../apps/web/src/domain/library.ts) | L07 |
| <a id="AI10"></a>AI10 | 注册供模型使用的插件工具 | 实装 | **扩展**：extraTools(scope) 进入真实 registry<br>[设计] 受 scope/授权控制工具 | **接通**：agentTools.register<br>[设计] 工具贡献 | Dictionary 3 个；RSS 3 个 | 插件安装/启用后才存在；不能将拥有插件 UI 视为已经有 Agent 工具 | [REGISTRY](../packages/agent/src/tools/registry.ts) [PORTS](../apps/web/src/features/ai/agent/ports/index.ts) [EXTOOLS](../apps/web/src/features/plugins/runtime/plugin-tools.ts) [DICTTOOLS](../plugins/dictionary/src/agent-tools.ts) [RSSTOOLS](../plugins/rss-reader/src/agent-tools.ts) | L06 |
| <a id="AI11"></a>AI11 | 每轮上下文 provider | 实装 | **自动**：plugin context provider 注入线程<br>[设计] 受预算/来源约束消费 | **接通**：agentContextProviders.register<br>[设计] 上下文贡献 | Reading Goals 按请求书籍 scope 提供阅读目标 | 真实 Worker 到受控推理服务已验；没有专属目标编辑工具，不等于任意上下文语义已验收 | [EXTOOLS](../apps/web/src/features/plugins/runtime/plugin-tools.ts) [THREAD](../packages/agent/src/runtime/thread.ts) [API](../packages/plugin-types/src/index.ts) [READINGGOALS](../plugins/reading-goals/src/index.ts) [MEMORYPOLICYPROOF](../docs/evidence/memory-build-policy-2026-09-09.json) | L06 |
| <a id="AI12"></a>AI12 | 按需插件检索 provider | 实装 | **扩展**：自动生成 retrieve 工具<br>[设计] 按需有界检索工具 | **接通**：agentRetrievalProviders.register<br>[设计] 检索贡献 | Dictionary saved-vocabulary | 名称隔离/限量由 adapter 控制；查询结果不是可信指令 | [EXTOOLS](../apps/web/src/features/plugins/runtime/plugin-tools.ts) [DICTTOOLS](../plugins/dictionary/src/agent-tools.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) | L06 |

### 长期记忆、画像与图谱

| ID | 宿主能力 | 宿主现状 | Agent 当前与目标 | 插件当前与目标 | 实际消费者 | 缺口/边界 | 来源 | 旧基线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <a id="MEM01"></a>MEM01 | 查询长期记忆 | 实装 | **接通**：search_memory：复用规范化记忆检索<br>[设计] 检索工具 | **部分**：memory 1.3 queries.search/inspect；memory:read<br>[设计] 受 scope 授权的只读 memory domain | Agent；Memory Desk 0.4 | 共享 active 记忆检索、pinned/importance/updatedAt 排序；1–16 个显式 user/global/book:<id> scope，去重，query 至多 2000 字符，limit 默认 20/最大 100。Agent book 检索仍包含 user/global/book，插件由 scopes 选择；memory:read 授予全部 scope，过滤不是细粒度授权，记忆记录也不按章节防剧透。不是 conversation 查询。Worker 退役前后复核，拒绝迟到结果但不物理取消 SQLite；读失败不变空列表。Memory Desk 顶多显示 100 条，尚无分页/耗尽标志或按书/字段授权；1.1 inspect 返回活动行及条件写 revision，纠错/遗忘另见 MEM04/05。真实 macOS debug Worker/Agent/编译插件已验；非自主模型、打包/跨平台未验。 memory 1.3 events.observe 接受 search/inspect/bookGraph/classification 查询，立即异步快照后在读取和回调完成后一秒重读，只推送变化/错误/恢复，至多 64 个订阅，串行读取并等待回调；序号仅属于订阅，非 CAS。每次重算现有权限和图谱边界；不是事件日志/逐写通知，不给新增 scope 授权。Memory Desk 0.4 列表、记录和图谱详情自动更新，错误清旧内容/动作，编辑表单仍冻结版本。原生 Worker 授权/退订、外部写、原生 remote apply、读故障/恢复、遗忘与边界收紧已验；Agent 查询同源状态，不新增常驻模型观察。 | [MEMTOOLS](../packages/agent/src/tools/memory-tools.ts) [MEMORYPORT](../apps/web/src/features/ai/agent/ports/memory-port.ts) [PORTS](../apps/web/src/features/ai/agent/ports/index.ts) [API](../packages/plugin-types/src/index.ts) [MEMORYDOMAIN](../apps/web/src/domain/memory.ts) [MEMORYQUERIES](../apps/web/src/domain/memory-queries.ts) [MEMORYDESK](../plugins/memory-desk/src/graph.ts) [MEMORYDOMAINPROOF](../docs/evidence/memory-domain-2026-09-10.json) [MEMORYMANAGEMENT](../apps/web/src/domain/memory-management.ts) [MEMORYFEEDBACKPROOF](../docs/evidence/memory-feedback-2026-09-10.json) [MEMORYOBSERVER](../apps/web/src/domain/memory-observer.ts) [MEMORYLIVE](../plugins/memory-desk/src/live-memory.ts) [MEMORYOBSERVATIONPROOF](../docs/evidence/memory-observation-2026-09-10.json) | M01 |
| <a id="MEM02"></a>MEM02 | 显式记住事实/偏好 | 实装 | **接通**：remember<br>[设计] 有来源的写工具 | **部分**：只能贡献 memory candidates<br>[设计] 候选提议，由宿主裁决 | Agent | 不开放：插件直接写记忆投影或伪造强化次数 | [MEMTOOLS](../packages/agent/src/tools/memory-tools.ts) [MEMORYPORT](../apps/web/src/features/ai/agent/ports/memory-port.ts) [API](../packages/plugin-types/src/index.ts) | M03 |
| <a id="MEM03"></a>MEM03 | 轮后抽取/去重/强化记忆 | 实装 | **自动**：thread 轮后抽取与 reinforce<br>[设计] 自动管线 | **部分**：memoryCandidateProviders.propose<br>[设计] 候选贡献 | Agent 后台；Reading Goals 用户选择后提议书内偏好 | buildMemory 已约束抽取/强化/候选/摘要/巩固/digest；关闭取消在途和排队任务，重开只允许新任务。候选只经宿主裁决写入，不开放投影写；候选接受/拒绝的公共可观察回执仍缺，故插件保持部分。保留旧记忆和聊天；已派发写不承诺撤销。七类受保护写均追踪实际回执，取消等待全部写 settle 后才退订/结束；迟到数据库失败有日志，已完成操作不能复用旧 guard。读/模型/插件自身 IO 可放弃等待，不算全部物理工作已停。 | [THREAD](../packages/agent/src/runtime/thread.ts) [MEMORYPORT](../apps/web/src/features/ai/agent/ports/memory-port.ts) [API](../packages/plugin-types/src/index.ts) [MEMORYPOLICY](../packages/agent/src/memory/build-policy.ts) [READINGGOALS](../plugins/reading-goals/src/index.ts) [MEMORYPOLICYPROOF](../docs/evidence/memory-build-policy-2026-09-09.json) [MEMORYDRAINPROOF](../docs/evidence/memory-commit-drain-2026-09-10.json) | L06, M03 |
| <a id="MEM04"></a>MEM04 | 记忆巩固、修订/替代/遗忘 | 实装 | **部分**：自动 consolidation + manage_memory 条件纠错/遗忘<br>[设计] 自动管线+受控反馈工具 | **部分**：memory 1.3 commands.mutate：correct/forget<br>[设计] 候选/反馈接口，不直接改投影 | 空闲维护；Agent；Memory Desk 0.4 | 纠错/遗忘采用活动行及最后本地 memory 事件身份生成的 mem1 revision；SQLite immediate 事务内复核、append/apply/outbox 一并提交，旧版本/已遗忘拒绝，SQL 失败无事件/投影残留。Agent 每次变更冻结版本并请求确认；确认期间并发修改仍冲突。插件需 memory:write；不开放原始投影、权重、scope 或证据次数。遗忘仅 status=forgotten，不抹日志/既有 prompt/外部副本，无公共恢复命令。现有记录的自动巩固与强化也已接模型前快照、同源 revision 和原子整批提交；任何所读行变化/失活拒绝整个旧计划，合并退场与胜者强化一起回滚。过滤重叠合并端点，不自动替代置顶记录；强化 ID 去重且不事后重读套用。原生 Worker 纠错期间旧计划/强化冲突、第二步 SQL 失败全回滚与重试、编译插件随后编辑已验，模型判断为脚本。后台空闲检查现从全量活动快照比对 ID/revision 和 30 天衰减期限，覆盖插件/用户/原生同步写与纯时间变化；仅用事务内存活读集回执标记已处理，不吞掉读集外新增行或迟到修改，失败/未完整结束的模型判断保留待重试。仍为五分钟空闲轮询，非即时观察/耐久任务；关闭/隐藏/未启用不保证执行。原生真实 Worker、native remote apply 与编译插件写触发、注入时钟精确期限、SQL 失败无残留及重试已验，单行 fixture 无模型调用，非联网同步/墙钟定时器验收。新事实去重/遗忘后再抽取、全量读与模型预算、公共维护任务、跨设备 CAS/全管线协调尚缺；读集外新增不使当前判断失效，只触发下一次检查。 memory 1.3 events.observe 接受 search/inspect/bookGraph/classification 查询，立即异步快照后在读取和回调完成后一秒重读，只推送变化/错误/恢复，至多 64 个订阅，串行读取并等待回调；序号仅属于订阅，非 CAS。每次重算现有权限和图谱边界；不是事件日志/逐写通知，不给新增 scope 授权。Memory Desk 0.4 列表、记录和图谱详情自动更新，错误清旧内容/动作，编辑表单仍冻结版本。原生 Worker 授权/退订、外部写、原生 remote apply、读故障/恢复、遗忘与边界收紧已验；Agent 查询同源状态，不新增常驻模型观察。 | [MAINT](../apps/web/src/features/ai/agent/maintenance.ts) [CONSOLIDATE](../packages/agent/src/memory/consolidation.ts) [MEMORYPORT](../apps/web/src/features/ai/agent/ports/memory-port.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) [MEMORYMANAGEMENT](../apps/web/src/domain/memory-management.ts) [MEMORYMUTATIONS](../apps/desktop/src-tauri/src/storage/memory_mutations.rs) [MEMORYMANAGETOOL](../packages/agent/src/tools/memory-management-tool.ts) [MEMORYFEEDBACKPROOF](../docs/evidence/memory-feedback-2026-09-10.json) [MEMORYMAINTENANCE](../apps/desktop/src-tauri/src/storage/memory_maintenance.rs) [MEMORYPLAN](../packages/agent/src/memory/maintenance-plan.ts) [MEMORYMAINTENANCEPROOF](../docs/evidence/memory-maintenance-2026-09-10.json) [RUNTIME](../packages/agent/src/runtime/runtime.ts) [MEMORYCHECKPOINT](../packages/agent/src/memory/consolidation-checkpoint.ts) [MEMORYIDLEPROOF](../docs/evidence/memory-idle-2026-09-10.json) [MEMORYOBSERVER](../apps/web/src/domain/memory-observer.ts) [MEMORYLIVE](../plugins/memory-desk/src/live-memory.ts) [MEMORYOBSERVATIONPROOF](../docs/evidence/memory-observation-2026-09-10.json) | M04 |
| <a id="MEM05"></a>MEM05 | 用户反馈记忆质量/纠错 | 部分 | **接通**：manage_memory 双 scope：inspect/correct/setPinned/forget，逐次批准<br>[设计] 受控反馈工具 | **接通**：memory 1.3 inspect + commands.mutate；memory:write<br>[设计] 受控反馈命令 | Agent；Memory Desk 0.4 的纠错/置顶/取消置顶/遗忘表单 | 严格单条语义变更，ID 非空且至多 256 字符、expectedRevision 为 mem1:64hex；correct 非空至多 16000 字符、setPinned 严格布尔、forget 无任意 reason，拒绝额外字段。pin/unpin 可逆且实际影响排序；correct 写 memory.revised，forget 写 reason=user，来源为实际 actor，不伪造强化次数。旧 MemoryFeedbackSignal 补已有原生 unpin；旧 correct/reject feedback 无投影效果且不被新入口冒充支持。Agent 书内仅 user/global/本书，global 可管理发现的其他书记忆；不是更细插件 scope 授权。Memory Desk 冻结读取版本，冲突/SQL 错误保留草稿，用户返回刷新后重新决定；遗忘要求明确勾选。macOS debug 已验真实 Worker、脚本批准的生产工具、编译表单、SQL 拒写/重试、并发保护与遗忘后检索为空；真实聊天批准点击、升级授权、跨平台仍未验。 memory 1.3 events.observe 接受 search/inspect/bookGraph/classification 查询，立即异步快照后在读取和回调完成后一秒重读，只推送变化/错误/恢复，至多 64 个订阅，串行读取并等待回调；序号仅属于订阅，非 CAS。每次重算现有权限和图谱边界；不是事件日志/逐写通知，不给新增 scope 授权。Memory Desk 0.4 列表、记录和图谱详情自动更新，错误清旧内容/动作，编辑表单仍冻结版本。原生 Worker 授权/退订、外部写、原生 remote apply、读故障/恢复、遗忘与边界收紧已验；Agent 查询同源状态，不新增常驻模型观察。 | [COREVENTS](../packages/core/src/events.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) [MEMTOOLS](../packages/agent/src/tools/memory-tools.ts) [MEMORYMANAGEMENT](../apps/web/src/domain/memory-management.ts) [MEMORYMUTATIONS](../apps/desktop/src-tauri/src/storage/memory_mutations.rs) [MEMORYMANAGETOOL](../packages/agent/src/tools/memory-management-tool.ts) [MEMORYMANAGEVIEW](../plugins/memory-desk/src/management.ts) [MEMORYFEEDBACKPROOF](../docs/evidence/memory-feedback-2026-09-10.json) [MEMORYOBSERVER](../apps/web/src/domain/memory-observer.ts) [MEMORYLIVE](../plugins/memory-desk/src/live-memory.ts) [MEMORYOBSERVATIONPROOF](../docs/evidence/memory-observation-2026-09-10.json) | M04 |
| <a id="MEM06"></a>MEM06 | 读取用户画像并注入上下文 | 实装 | **接通**：ProfilePort → prompt；get_user_profile[双域]<br>[设计] 自动上下文/受控查询 | **接通**：memory 1.6 queries.profile / events.observe(kind=profile)<br>[设计] 授权现有画像字段查询 | Agent system prompt；新查询待组合插件 | 同一 device-local KV 纯文本摘要，无结构化字段可枚举；memory:read（write 隐含）授权现有摘要，不授予原始 KV、画像写入或 profile/entity 投影。页面默认 4000、上限 16000 UTF-16 单元，nextOffset 不截断字符对；后续页强制 expectedRevision，内容变化 conflict 重读，token 是内容身份而非写 CAS。exists 区分未存与空字符串，错误不当成空画像，退休拒绝迟到页。观察复用有界串行轮询/变化/错误/恢复，无模型查询自动注册观察；不推断字段、不启动访谈或改记忆。只过定向测试，真实 Worker/Agent 对话组合待集中 Tauri 验收；MEM07 写流程、MEM08 投影与 MEM13 bundle 仍缺。 | [PROFILEPORT](../apps/web/src/features/ai/agent/ports/profile-port.ts) [THREAD](../packages/agent/src/runtime/thread.ts) [PORTS](../apps/web/src/features/ai/agent/ports/index.ts) [API](../packages/plugin-types/src/index.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | M05 |
| <a id="MEM07"></a>MEM07 | Onboarding 访谈写入画像 | 部分 | **内部**：onboarding.ts seed 可写端口；未见产品调用<br>[设计] 明确接入用户确认后的写流程 | **未接**：无正式入口<br>[设计] 候选画像变更流程 | 访谈提示词有；独立 seed 仅导出/测试 | 函数存在不能算完成的访谈→画像闭环 | [ONBOARD](../packages/agent/src/onboarding.ts) [PROFILEPORT](../apps/web/src/features/ai/agent/ports/profile-port.ts) [THREAD](../packages/agent/src/runtime/thread.ts) | M05 |
| <a id="MEM08"></a>MEM08 | profile.updated / entity.resolved / entity.merged 投影 | 占位 | **内部**：事件类型/端口，并非完整实体整合<br>[设计] 宿主 consolidation 投影 | **未接**：无正式入口<br>[设计] 未来只读/候选接口 | apply.rs 接受但返回无投影 | 宿主自身待实现，不应归为插件 API 单纯漏导出 | [COREVENTS](../packages/core/src/events.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) | M05 |
| <a id="MEM09"></a>MEM09 | 叙事性分类/重分类与图谱风格 | 实装 | **接通**：classify_book 双 scope 查询/逐次批准 + 自动分类管线<br>[设计] 管线状态+用户重分类意图 | **接通**：memory 1.3 classification/classify/observe；读写授权分离<br>[设计] 分类查询/受控重分类 | 后台管线；Agent classify_book；Memory Desk 0.4 | narrative 与 expository 的 fence 不同；重分类后旧 flavor 懒重建。内部持久化路径已补 bcl1 条件版本查询/提交；自动 classifyBookIfUnclassified 只填空并返回实际分类，用户在推理期间修改不被迟到自动结果覆盖。新自动事件携带 onlyIfUnclassified，当前投影在两种重放顺序均保留明确选择；旧无标记事件与旧客户端不具备此语义。原生 SQLite 已验填空、用户改为说明文、迟到自动结果无写入、过期版本/预取消无写、事件归因及自有记录清理；Rust 另验 ABA、SQL/发件箱回滚与重放。memory 1.3 queries.classification 需 memory:read/write，返回分类/null及条件版本；commands.classify 需 memory:write，拒绝自行传自动填空标记。observe 新增 classification，沿用至多 64 个订阅和串行至少一秒轮询。Agent classify_book 书内仅本书，全局明确 ID；先读版本，每次变更请求用户批准，拒绝/取消不写、批准期间并发仍冲突，不能借分类绕过剧透意图。Memory Desk 0.4 分类详情实时更新，表单需确认分类/剧透边界变化，冻结版本，冲突保留选择和勾选。原生六 Worker、生产 Agent 工具和真实批准组件已验拒绝/批准/并发，编译插件表单成功及冲突、SQL 读故障清旧动作/自动恢复、退订和归因已验。批准组件挂载在隔离 fixture 中，不是完整聊天/自主模型证据。插件表单确认不是宿主批准票据；按书细粒度授权、在途 digest 取消、来源版本、即时重建和跨设备/打包跨平台仍缺 | [MAINT](../apps/web/src/features/ai/agent/maintenance.ts) [RUNTIME](../packages/agent/src/runtime/runtime.ts) [COREVENTS](../packages/core/src/events.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) [CLASSIFICATION](../apps/web/src/domain/book-classification.ts) [CLASSIFICATIONSTORE](../apps/desktop/src-tauri/src/storage/book_classification.rs) [CLASSIFICATIONPROOF](../docs/evidence/book-classification-storage-2026-09-10.json) [CLASSIFICATIONTOOL](../packages/agent/src/tools/book-classification-tool.ts) [CLASSIFICATIONVIEW](../plugins/memory-desk/src/classification.ts) [CLASSIFICATIONPUBLICPROOF](../docs/evidence/book-classification-public-2026-09-10.json) [MEMORYDOMAIN](../apps/web/src/domain/memory.ts) [MEMORYOBSERVER](../apps/web/src/domain/memory-observer.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | 新增盘点 |
| <a id="MEM10"></a>MEM10 | 完成章节摘要、人物/概念图生成与补齐 | 实装 | **部分**：manage_book_graph 双 scope；逐次批准的任务控制 + 自动维护<br>[设计] 自动任务+状态/重试 | **部分**：memory 1.5 公共任务及章节预算；memory:write + service:llm<br>[设计] 图谱任务查询/候选提供 | 阅读后 catch-up；空闲维护；Memory Desk 0.6 有界生成及已落库图谱 | 内部返回 complete/partial/unavailable 与 eligible/attempted/digested/remaining、空章和逐章错误；缺目录/未知边界不等于清零，目录/进度读失败拒绝。完整 catch-up 单次有限扫描，每章最多尝试一次，失败/空章不饿死后章，不在本次重试；普通有限 idle tick 仍选最早欠账。非 stop/非法摘要不落库，写失败保留欠账与日志，失败后新一轮只重试未完成章。重建早章的名录锚仅来自更早章，排除后章实体/别名。直接执行器取消后停止接新章和迟到保存，等待已接逻辑 worker；已经派发的写不回滚，外层 memory-policy 现等待所有已派发受保护写回执后才结束取消；读/模型仍可放弃等待，不证明全部物理 IO 已停。原生回执延迟与 SQL 故障已验：取消期间保留策略订阅，释放后退订；失败事件/outbox 8→8，迟到 db/error 留日志，新轮重试成功。真实 macOS debug SQLite/脚本推理验首章失败后次章成功、SQL trigger 失败事件数不变、取消无迟到摘要、Agent/Worker 同源查询与编译 Memory Desk 显示。新增 bdg1 章节/分类条件：推理前取版本，保存不重取；原生 IMMEDIATE 事务复核版本/分类及事件 HLC 顺序，再原子写事件/投影/outbox。分类改回和同章竞争均 conflict，其他章节互不冲突；输入异步前复制，取消派发前检查，成功后才广播。六真实 Worker/脚本推理已验分类 ABA、迟到结果不覆盖 Winner、输入突变隔离、预取消及 SQL 故障事件/outbox 15→15、移除故障后重试和编译视图。BookDigestQueue 在宿主端口模块共享，跨 AgentRuntime 实例的同书 pass FIFO，其他书独立；等待者轮到时重读书籍/边界/目录/已存摘要，跳过前轮已成功章。总 active+waiting 限 64，超限 memory/task-limit 可重试；排队取消即移除，活动取消等原写回执才让位，受保护读可放弃等待且不产生迟到推理/写。三独立依赖实例的原生脚本推理已验 leader 回执暂停时 follower 不启动、queued cancel 无推理、释放后只生成剩余章、fresh retry 零调用；Agent/Worker 查询及 Memory Desk 同源。不是耐久队列、全局模型并发限制或跨设备所有权。remaining 属于本轮采样，不是竞争后全局欠账。memory 1.4 已接 get/list/start/cancel/retry 与 graphTasks/graphTask 观察，start 选择 catch-up/rebuild；插件需 memory:write，启动/重试另需 service:llm，读者只看自有激活代任务。Agent manage_book_graph 两 scope，书内限本书，每次 start/rebuild/retry 要批准；不取消只读查询。BookGraphTaskOwner 每 actor 16 活动/64 保留句柄，排队/运行/取消中与终态分开，卸载取消且停止观察；非耐久或自动任务名册。重建不先删旧摘要，失败保留旧结果，重试保留未完成目标而非误跳过旧有效行。运行时进入同书队列后解析宿主阅读边界，发正文/保存前复核；分类样本也限已完成章，未知位置不发正文；说明性或读完允许全书。Memory Desk 0.5 的任务列表/详情、费用确认、进度、错误、取消与重试已有原生实操；真实 Worker 已验权限拒绝、隔离、观察、重建失败保留旧行、失败章单独重试和卸载取消，Agent 批准通过真实端口脚本应答验证，非批准 UI/自主对话。此前 1.4 单元只证明完整有限扫描和固定并发 2，未验证用户预算/内容版本/跨设备语义，双端保持部分；本机条件不等于跨设备 CAS，旧/远端无条件事件仍兼容；跨设备推理协调、内容/来源/实体锚读集版本、全物理 IO 收束与长时/packaged/跨平台仍缺。 memory 1.5 接 options.maxChapters：1–1000 安全整数，start 默认 20，retry 继承或显式修改，拒绝空对象/null/额外字段/强转。排队和批准前复制；两并发仍最多尝试上限，空章/失败计数；上限截断 reason=chapter-limit，分类待定优先，剩余目标保留，重试优先未尝试项避免空章/失败饿死后续。每次独立批准，不自动串起请求绕过预算；不是模型调用、输入字节、token 或费用上限，分类可能另用一次模型。真实 Agent 批准组件经生产 chat mapper 显示书名/操作/上限，修正旧描述未插入 subject；拒绝无任务，批准/再批准各 1 章。编译 Memory Desk 0.6 的数字输入、限 1 后 partial/remaining 1、重试预填 1 且重新确认后改为 2、只尝试剩余 1 章已验；Worker 同样限 1 并继承重试，保护图查询一致。空章/失败报告显示一基章号及本地化错误，公平重试顺序在原生后补单测，不冒充原生证据。测试配置已写前加密备份，真实 reload 后拒绝覆盖并恢复/删除备份；非产品任务耐久化或所有 fixture 资源的 crash 恢复。来源版本、输入/token/费用预算、完整对话、长时/打包/跨平台仍缺。 | [GRAPHTASKS](../packages/agent/src/memory/book-graph-tasks.ts) [GRAPHTASKHOST](../apps/web/src/domain/book-graph-tasks.ts) [GRAPHTASKTOOL](../packages/agent/src/tools/book-graph-task-tool.ts) [GRAPHTASKVIEW](../plugins/memory-desk/src/tasks.ts) [GRAPHTASKPROOF](../docs/evidence/book-graph-tasks-2026-09-10.json) [GRAPHBUDGETPROOF](../docs/evidence/book-graph-budget-2026-09-10.json) [MAINT](../apps/web/src/features/ai/agent/maintenance.ts) [RUNTIME](../packages/agent/src/runtime/runtime.ts) [GRAPHP](../apps/web/src/features/ai/agent/ports/book-memory-port.ts) [DIGESTRUN](../packages/agent/src/memory/digest-run.ts) [DIGESTUPKEEP](../packages/agent/src/memory/graph-upkeep.ts) [DIGESTQUEUE](../packages/agent/src/memory/digest-queue.ts) [DIGESTQUEUEPORT](../apps/web/src/features/ai/agent/ports/book-memory-port.ts) [DIGESTQUEUEPROOF](../docs/evidence/digest-queue-2026-09-10.json) [DIGESTRUNPROOF](../docs/evidence/digest-run-2026-09-10.json) [DIGESTCONDITION](../apps/web/src/domain/book-digest.ts) [DIGESTSTORE](../apps/desktop/src-tauri/src/storage/book_digest.rs) [DIGESTCONDITIONPROOF](../docs/evidence/digest-conditional-2026-09-10.json) [MEMORYPOLICY](../packages/agent/src/memory/build-policy.ts) [MEMORYDRAINPROOF](../docs/evidence/memory-commit-drain-2026-09-10.json) | M02 |
| <a id="MEM11"></a>MEM11 | 检索书内人物/关系/概念图 | 实装 | **部分**：query_book_graph：共享先过滤再合并查询<br>[设计] 有 fence 和版本来源的查询工具 | **部分**：memory 1.3 queries.bookGraph；memory:read<br>[设计] book memory 只读领域 | Agent；Memory Desk 0.4 | 查询 overview、1–8 个至多 256 字符名称或非负安全整数 chapterIndex（互斥）；200 实体/profile、每 profile 40 关系，截断可判定，章节含已有 chapterHref。先按 fence/当前 flavor 过滤再合并，超前别名/备注/关系不污染已读图；未知位置 unavailable，不存在/不可见章节同一 miss。插件未读完叙事及未分类书依 live ready href 或非当前书保存 href 与现有正文目录求边界，loading 不回退保存位置；不触发文本准备/digest。说明性/已读完书允许全图，旧 flavor 排除。Agent 书内沿用回合 fence/可信剧透授权，global/cross-book 保留既有全图政策；修复元数据失败被吞后跳过保护。Memory Desk 搜索/实体/章节/来源导航复核最新边界，等实际 ready 才关闭；读取失败清除旧图与动作并内联报错，恢复后续读，SQL 故障/恢复与真实 FB2 已验。chapterHref 没有内容 hash，非版本化 ReadingLocation；旧摘要与替换原文的一致性、细粒度授权与全格式/跨平台仍未闭合，双端保留部分。 memory 1.3 events.observe 接受 search/inspect/bookGraph/classification 查询，立即异步快照后在读取和回调完成后一秒重读，只推送变化/错误/恢复，至多 64 个订阅，串行读取并等待回调；序号仅属于订阅，非 CAS。每次重算现有权限和图谱边界；不是事件日志/逐写通知，不给新增 scope 授权。Memory Desk 0.4 列表、记录和图谱详情自动更新，错误清旧内容/动作，编辑表单仍冻结版本。原生 Worker 授权/退订、外部写、原生 remote apply、读故障/恢复、遗忘与边界收紧已验；Agent 查询同源状态，不新增常驻模型观察。 章节投影现逐行校验 bookId/坐标/版本、JSON 数组、实体别名/备注和关系字段，任一损坏整次 db/error；未知 flavor 不再退回 narrative，不静默丢行或伪造空图。原生三类损坏已验双端拒绝、编译插件清旧图并自动恢复；可选 prompt 读取失败记录日志并省略纪要；降级不结清提示词缓存，下轮自动重读。 纪要查询与 system prompt 共享 chapterMemoryPolicy/visibleChapterDigests：未分类默认叙事，当前 flavor 与严格已完成章节先过滤再合并；Agent 使用独立回合纪要边界，不再混用正文 inclusive fence。分类/阅读状态/章节坐标变化或读取降级在下一用户轮刷新提示词，不丢同章对话；选区不能扩大纪要权限，游标丢失收紧。工具调用复核最新元数据，旧 all 快照不覆盖新限制。原生 SQLite AgentThread 的叙事/概念/叙事连续 1/3/5 消息、未来选区/丢失游标/未分类与编译插件自动切换已验，推理为脚本。不是已发请求取消或历史擦除，稳定策略下成功纪要仍按章缓存；未分类正文/grounding 的其余策略、来源版本和授权继续保留缺口。 | [GRAPHTOOLS](../packages/agent/src/tools/graph-tools.ts) [GRAPHP](../apps/web/src/features/ai/agent/ports/book-memory-port.ts) [API](../packages/plugin-types/src/index.ts) [MEMORYDOMAIN](../apps/web/src/domain/memory.ts) [MEMORYBOUNDARY](../apps/web/src/domain/book-memory-boundary.ts) [GRAPHQUERY](../packages/agent/src/memory/book-graph.ts) [MEMORYDESK](../plugins/memory-desk/src/graph.ts) [MEMORYDOMAINPROOF](../docs/evidence/memory-domain-2026-09-10.json) [MEMORYOBSERVER](../apps/web/src/domain/memory-observer.ts) [MEMORYLIVE](../plugins/memory-desk/src/live-memory.ts) [MEMORYOBSERVATIONPROOF](../docs/evidence/memory-observation-2026-09-10.json) [DIGESTROW](../apps/web/src/features/ai/agent/ports/chapter-digest-row.ts) [DIGESTINTEGRITYPROOF](../docs/evidence/chapter-memory-integrity-2026-09-10.json) [CHAPTERMEMORYPOLICY](../packages/agent/src/memory/book-memory-policy.ts) [MEMORYPROMPT](../packages/agent/src/context/system-prompt.ts) [MEMORYPROMPTPROOF](../docs/evidence/memory-prompt-policy-2026-09-10.json) | M02 |
| <a id="MEM12"></a>MEM12 | 跨对话 insights 与滚动摘要 | 实装 | **接通**：get_conversation_insights[全局]；rolling summary 自动<br>[设计] 检索工具+自动摘要 | **部分**：可读 transcript，无 insights/summary 正式 API<br>[设计] 有来源的只读查询 | 全局 Agent；长对话 | 不能将可重读对话当作已有相同摘要/洞见 | [CHATTOOLS](../packages/agent/src/tools/conversation-tools.ts) [THREAD](../packages/agent/src/runtime/thread.ts) [CHATPORT](../apps/web/src/features/ai/agent/ports/conversation-port.ts) | 新增盘点 |
| <a id="MEM13"></a>MEM13 | 可版本化导出 context bundle | 待建 | **未接**：无正式入口<br>[设计] 上下文包查询/导出工具 | **未接**：无正式入口<br>[设计] 上下文包资源服务 | 无正式 context bundle 产品能力 | 这是既定方向，不是已存在宿主能力；备份 JSON 不是 context bundle | [API](../packages/plugin-types/src/index.ts) [PORTS](../apps/web/src/features/ai/agent/ports/index.ts) [RUNTIME](../packages/agent/src/runtime/runtime.ts) [BACKUP](../apps/web/src/features/settings/lib/backup-io.ts) | M06 |

### 插件界面、贡献与实际消费者

| ID | 宿主能力 | 宿主现状 | Agent 当前与目标 | 插件当前与目标 | 实际消费者 | 缺口/边界 | 来源 | 旧基线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <a id="EXT01"></a>EXT01 | 选择菜单动作/lookup/标注入口 | 实装 | **部分**：选择附件可触发 Agent；非调用任意 action<br>[设计] 语义动作意图 | **接通**：selectionActions.register<br>[设计] 声明式动作贡献 | Dictionary lookup-save | menu contribution 是入口位置，不提供跳转/搜索本体能力 | [API](../packages/plugin-types/src/index.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [DICT](../plugins/dictionary/src/index.ts) [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) | I04 |
| <a id="EXT02"></a>EXT02 | 书架与阅读 header menu 入口 | 实装 | **未接**：无正式入口<br>[设计] 命令工具而不是菜单 DOM 操作 | **接通**：headerActions.register(surface=shelf/reader)<br>[设计] 声明式 header 动作 | Dictionary/RSS 书架入口；Jumper 阅读入口；Annotation Desk 双入口 | Jumper 缺口不是 header 插槽，而是 TXT/D/任务语义；Annotation Desk 仅组合已有公开 API | [API](../packages/plugin-types/src/index.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [MENU](../apps/web/src/features/menus/lib/menu-registry.tsx) [RSS](../plugins/rss-reader/src/index.ts) [DICT](../plugins/dictionary/src/index.ts) [DESK](../plugins/annotation-desk/src/views.ts) | I04 |
| <a id="EXT03"></a>EXT03 | 插件页面/对话框/视图结果与栈导航 | 实装 | **未接**：模型不渲染 PluginView 树<br>[设计] 通过工具结构化输出，由宿主呈现 | **部分**：视图栈/嵌套对话框 lease；根加载与动作迟到淘汰<br>[设计] 宿主声明式视图 | Dictionary/RSS/Jumper/Annotation Desk；隔离桌面视图探针 | push/back 保留父回调，replace/reset/关闭释放离栈回调；显式导航按 frame key 重置嵌套表单值/错误，普通根数据刷新保持已有草稿协调。Worker 退休关闭所属视图。Annotation Desk 实机复验冲突留草稿、显式刷新加载新值并清错误；仍不等于全部视觉与焦点验收。迟到 UI 淘汰不取消已发起的业务副作用，GAP06/10 未整体关闭 | [API](../packages/plugin-types/src/index.ts) [VIEWS](../apps/web/src/features/plugins/lib/plugin-view.ts) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [VIEWSESSION](../apps/web/src/features/plugins/lib/plugin-view-session.ts) [VIEWSOURCE](../apps/web/src/features/plugins/hooks/usePluginViewSource.ts) [VIEWPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-view-probe.ts) [DESKPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-annotation-desk.ts) | I06, I08, J10 |
| <a id="EXT04"></a>EXT04 | 列表、搜索、详情、Markdown、blocks 组合 | 实装 | **未接**：无正式入口<br>[设计] 工具结果呈现，不注册任意组件 | **接通**：PluginView list/detail/markdown/blocks<br>[设计] 声明式内容视图 | Dictionary/RSS/Annotation Desk | 宿主组件有 Table/Tree 不等于插件 schema 有；复杂数据视图另列 | [API](../packages/plugin-types/src/index.ts) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) [DICTVIEWS](../plugins/dictionary/src/views.ts) [RSSVIEWS](../plugins/rss-reader/src/views.ts) [DESK](../plugins/annotation-desk/src/views.ts) | J01, J03 |
| <a id="EXT05"></a>EXT05 | 表单输入、动态选项、验证与提交 | 实装 | **部分**：ask_user 固定 question 交互<br>[设计] 结构化交互 schema | **接通**：PluginFormView.onSubmit + submitMode=explicit/change<br>[设计] 声明式表单 | RSS 订阅/OPML粘贴；Dictionary；Annotation Desk 选中/确认/编辑 | 补齐静态 select、choice、checkbox、toggle、secret 的 fieldErrors 接线；选择/布尔控件有可访问错误描述。OPML 是文本粘贴而非通用选择文件服务 | [API](../packages/plugin-types/src/index.ts) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) [PLUGINFORM](../apps/web/src/features/plugins/components/PluginFormViewBody.tsx) [DICTVIEWS](../plugins/dictionary/src/views.ts) [RSSVIEWS](../plugins/rss-reader/src/views.ts) [DESKBATCH](../plugins/annotation-desk/src/batch.ts) | J02 |
| <a id="EXT06"></a>EXT06 | 大列表分页/虚拟化、Tree/Table/编辑器/图像资源 | 部分 | **未接**：无正式入口<br>[设计] 有界工具结果/资源引用 | **部分**：list 已用 PluginVirtualRows；无通用分页/Tree/Table<br>[设计] 按原语补全 schema | 宿主 UI 库比 PluginView schema 更丰富 | 虚拟行已实现，不与分页混为一谈；不能开放 React/HTML/DOM 逃生口；表格/树等需 schema 与键盘契约 | [API](../packages/plugin-types/src/index.ts) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) | J03, J06, J07 |
| <a id="EXT07"></a>EXT07 | Toast、持久错误、进度/取消/确认交互 | 部分 | **部分**：工具 error/interaction + streaming<br>[设计] 统一失败/任务呈现 | **部分**：showToast(string)；views 1.2 error(code) 内联错误<br>[设计] 类型化 error/progress/approval | 插件 toast；Agent 工具输出；Reading Goals 活跃视图读取失败 | error 块仅接受至多 128 字符的稳定 code，宿主 InlineError 本地化并对未知码显示通用错误，不透传原始 message；不会另开错误弹窗。没有自动添加 retry 命令，刷新由真实查询/观察决定。Toast string 仍不能表达 stable code/retryability；统一进度/批准未完成，保留部分。 | [API](../packages/plugin-types/src/index.ts) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) [ERRORS](../packages/core/src/errors.ts) [INTERACTION](../packages/agent/src/tools/interaction-tools.ts) [TIMEVIEW](../plugins/reading-goals/src/time-view.ts) [TIMEPROOF](../docs/evidence/reading-time-snapshot-2026-09-09.json) | J09 |
| <a id="EXT08"></a>EXT08 | 应用/阅读主题和字体贡献 | 实装 | **部分**：settings 选择已声明主题/字体<br>[设计] 选择工具，不注册代码资产 | **接通**：manifest themes/fonts<br>[设计] 静态主题/字体贡献 | editorial-themes | 能力 catalog 含 themes/fonts，ctx 无 register 是声明式设计而非漏实现 | [THEMES](../plugins/editorial-themes/manifest.json) [API](../packages/plugin-types/src/index.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) | N01 |
| <a id="EXT09"></a>EXT09 | 词典查询/收藏/复习列表/CSV 导出 | 实装 | **扩展**：lookup_word/get_vocabulary/save_word<br>[设计] 插件工具 | **接通**：Dictionary 私有 storage + LLM + views/export<br>[设计] 现有原语组合 | Dictionary | Agent 无删词/CSV 导出工具；不应把词汇领域搬回宿主 | [DICT](../plugins/dictionary/src/index.ts) [DICTTOOLS](../plugins/dictionary/src/agent-tools.ts) [DICTVIEWS](../plugins/dictionary/src/views.ts) [DICTEXPORT](../plugins/dictionary/src/export.ts) | 新增盘点 |
| <a id="EXT10"></a>EXT10 | RSS 订阅/刷新/退订/OPML/阅读文章 | 实装 | **扩展**：list_feeds/subscribe_feed/refresh_feed[全局]<br>[设计] 插件工具 | **接通**：RSS 私有 collection + content provider<br>[设计] 现有原语组合 | RSS | 退订与 OPML 无 Agent 工具；刷新正在读的版本仍见 LIB14 | [RSS](../plugins/rss-reader/src/index.ts) [RSSTOOLS](../plugins/rss-reader/src/agent-tools.ts) [RSSVIEWS](../plugins/rss-reader/src/views.ts) [RSSFEED](../plugins/rss-reader/src/feed.ts) | 新增盘点 |
| <a id="EXT11"></a>EXT11 | 本地 marketplace 插件清单与启用状态 | 实装 | **接通**：list_installed_plugins[双域]<br>[设计] 只读插件目录/能力查询工具 | **接通**：services.plugins 1.0 list/observe<br>[设计] 自有与受控公共目录 | 插件管理页；双端公共目录 | 有界查询 installed ID/name/version/builtin/enabled/activationFailed，初始快照与安装态变化观察；不返回设置、路径、凭据或原始错误。enabled 是配置而非健康保证；分页变化需重查，不承诺稳定游标。具体贡献发现/跨插件调用另列 MORE06。接线与定向测试完成，组合插件及桌面验收待集中进行。 | [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [MARKET](../apps/web/src/features/plugins/runtime/marketplace.ts) [API](../packages/plugin-types/src/index.ts) [PLUGINDIRECTORY](../apps/web/src/services/plugin-directory.ts) [HOSTIOTOOLS](../packages/agent/src/tools/host-io-tools.ts) | 新增盘点 |
| <a id="EXT12"></a>EXT12 | 安装/授权/启停/更新/回滚/卸载插件 | 实装 | **接通**：open_maintenance_settings(plugins)[双域]<br>[设计] 打开宿主管理入口 | **接通**：maintenance 1.1 openSettings(plugins)<br>[设计] 打开宿主管理入口 | Plugins settings，真实挂载标题定位 | 只打开并定位宿主插件管理页，不预选目标/点击/安装/授权/启停/卸载；不新增宿主尚无的回滚实现。用户继续使用既有宿主控件及安装授权确认，不开放静默控制自己或其他插件。opened 不代表操作成功，最终任务回执和实际 Tauri 管理组合待集中验收。 | [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [MARKET](../apps/web/src/features/plugins/runtime/marketplace.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) [HOSTMAINTENANCE](../apps/web/src/services/maintenance.ts) [MAINTENANCETOOLS](../packages/agent/src/tools/maintenance-tools.ts) | O05, R05 |

### 存储、网络与原生资源

| ID | 宿主能力 | 宿主现状 | Agent 当前与目标 | 插件当前与目标 | 实际消费者 | 缺口/边界 | 来源 | 旧基线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <a id="SYS01"></a>SYS01 | 插件隔离 KV 同步读与异步持久写 | 实装 | **扩展**：通过插件工具间接使用，无 KV 工具<br>[设计] 不得读任意私有 KV | **接通**：storage v2 get/set/remove/flush/onChange；set/remove 返回持久 Promise<br>[设计] 带 durable ack 的隔离 KV | 全部有设置/状态插件；RSS 迁移等待 remove | 已接顺序持久写、flush、镜像失败重基和 remote origin；相关故障单元测试通过，真实 Worker/Tauri 持久化与全生命周期 E2E 尚待验收，不据此关闭全部 GAP02/03 | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [WORKER](../apps/web/src/features/plugins/runtime/plugin-sandbox.worker.ts) [KV](../apps/web/src/platform/local-store.ts) [DICT](../plugins/dictionary/src/index.ts) | O01, O02 |
| <a id="SYS02"></a>SYS02 | 插件私有文档 collection CRUD/限量查询 | 实装 | **扩展**：Dictionary/RSS 工具通过插件访问<br>[设计] 插件工具封装其自有数据 | **接通**：storage.collection put/get/delete/list<br>[设计] 隔离文档服务 | Dictionary words；RSS feeds | 无游标/CAS/事务/全字段搜索；bookId/anchor 是索引不是自动删除所有权 | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [DOCS](../apps/web/src/features/plugins/runtime/plugin-backend.ts) [API](../packages/plugin-types/src/index.ts) [DICT](../plugins/dictionary/src/index.ts) [RSS](../plugins/rss-reader/src/index.ts) | O01, O02 |
| <a id="SYS03"></a>SYS03 | 插件 schema 迁移/快照/更新回滚 | 部分 | **未接**：宿主管理安装生命周期<br>[设计] 不开放：模型操作迁移存储 | **部分**：migrate storage-only；quiesce/drain 后 snapshot；schemaVersion 等待持久<br>[设计] quiescent + durable migration | RSS legacy feeds 迁移；插件更新 | 已修复健康检查失败误恢复与旧实例晚写丢失的时序；全局外部设置并发、KV/docs 联合恢复和真实 Tauri 更新故障 E2E 仍待验收，GAP01/02 不整体关闭 | [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [WORKER](../apps/web/src/features/plugins/runtime/plugin-sandbox.worker.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) | O05, R01 |
| <a id="SYS04"></a>SYS04 | 插件自有 secret get/set/remove | 实装 | **未接**：不提供密钥读取工具<br>[设计] 不开放：密钥进模型上下文 | **接通**：services.secrets namespace<br>[设计] 隔离凭据服务 | TTS；WebDAV | 私有 secret 不等于可读宿主 AI key/同步解密 key | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [SECRETS](../apps/web/src/platform/secret-store.ts) [TTS](../plugins/tts/src/index.ts) [WEBDAV](../plugins/webdav-sync/src/index.ts) | O03 |
| <a id="SYS05"></a>SYS05 | 插件数据导入导出/配额/同步策略 | 部分 | **扩展**：仅插件自定义工具<br>[设计] 插件拥有的数据操作 | **部分**：exportFile + 私有 CRUD；无通用配额/同步状态<br>[设计] 隔离数据生命周期 | Dictionary CSV；RSS OPML | KV、plugin_docs、secrets、blob 的漫游/备份边界不同，不能统一宣称可同步 | [API](../packages/plugin-types/src/index.ts) [DOCS](../apps/web/src/features/plugins/runtime/plugin-backend.ts) [ROAM](../apps/web/src/platform/roaming-preferences.ts) [BACKUP](../apps/web/src/features/settings/lib/backup-io.ts) | O06 |
| <a id="SYS06"></a>SYS06 | 原生网络 HTTP 请求与响应 | 实装 | **内部**：推理端口/插件工具，无通用 fetch 工具<br>[设计] 有用途/域名约束网络工具 | **部分**：services.network v1.1：Request/二进制/AbortSignal 跨桥；64 MiB/120s 边界<br>[设计] 完整有界 HTTP 服务 | RSS/TTS/WebDAV；隔离 Tauri wire probe | GAP04/05 的参数保真、预取消不发请求、运行中取消及停用中止原生连接已实测；仍需 Agent 受权网络入口、重定向策略及生产 CSP 验收，见 host-capability-delivery.md | [HTTP](../apps/web/src/platform/http-client.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [WORKER](../apps/web/src/features/plugins/runtime/plugin-sandbox.worker.ts) [RSS](../plugins/rss-reader/src/index.ts) [TTS](../plugins/tts/src/index.ts) | P03 |
| <a id="SYS07"></a>SYS07 | 网络域名授权、预算、下载流和离线重试 | 部分 | **未接**：无正式入口<br>[设计] 用途受限任务 | **部分**：network permission 是大开关，无完整流/配额<br>[设计] 授权/任务/缓存原语 | 宿主内部 HTTP；各插件自行缓存 | 不是给每个插件重新实现重试/缓存的理由；实时 socket 不算宿主当前产品能力 | [API](../packages/plugin-types/src/index.ts) [HTTP](../apps/web/src/platform/http-client.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [CATALOG](../packages/core/src/capabilities.ts) | P04, P06 |
| <a id="SYS08"></a>SYS08 | 剪贴板写文本 | 实装 | **接通**：copy_to_clipboard[双域]<br>[设计] 用户触发的复制意图 | **接通**：services.clipboard.writeText<br>[设计] 受权剪贴板写 | 选择复制；插件动作；Agent | 共享写入限 1000000 字符，插件需 service:clipboard；取消阻止未派发写，不回滚已派发写。只接受明确复制意图，不读取剪贴板或复制图片。定向测试通过；新双端组合 E2E 待集中进行。 | [API](../packages/plugin-types/src/index.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) [HOSTIO](../apps/web/src/services/host-io.ts) [HOSTIOTOOLS](../packages/agent/src/tools/host-io-tools.ts) | P05 |
| <a id="SYS09"></a>SYS09 | 图片复制/导出原生图片资源 | 实装 | **接通**：copy_resource_image/save_resource[双域]<br>[设计] 用户触发的图像导出 | **接通**：clipboard 1.1 writeImage；resources.save<br>[设计] Image ResourceRef + 受权复制/导出 | ReaderImageLightbox；封面/选中/自建图片引用 | 剪贴板需独立 service:clipboard，仅本 owner 封口非原书引用；原生按字节解码 PNG/JPEG/GIF/BMP/WebP 默认静态图，SVG 不支持。限 16 MiB 编码、8192 单边、16,777,216 像素与 64 MiB 解码分配，失败不先清剪贴板，完成返回 copied/width/height。不读剪贴板、不向模型发图；晚取消不回滚。桌面灯箱 PNG 复制共用后端。书内图片发现/预览仍属 TXT12 缺口；真实剪贴板粘贴和多格式/Worker E2E 待集中验收。 | [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [EXPORT](../apps/web/src/platform/export-file.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) [RESOURCEOWNER](../apps/web/src/services/resource-owner.ts) [RESOURCEIMAGES](../apps/desktop/src-tauri/src/resource_images.rs) [RESOURCEEXPORT](../apps/web/src/platform/resource-export.ts) [RESOURCETOOLS](../packages/agent/src/tools/resource-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | J08, P05 |
| <a id="SYS10"></a>SYS10 | 保存文本/二进制文件与取消回执 | 实装 | **接通**：export_text_file/save_resource[双域]<br>[设计] 原生文本/二进制资源导出 | **接通**：ui.exportFile；resources.save<br>[设计] 用户确认的文件导出 | Dictionary CSV；Annotation Desk；原生保存；Agent | exportFile 保留插件 64 MiB 便利入口，桌面已统一为资源暂存/封口/保存/释放；输入先快照，分块追加。原生保存从匿名文件复制到目标同目录暂存文件，sync_all 后替换，失败不先截断已有文件，二进制不经模型。原生保存对话框后重验取消；saved:false 为用户取消，已派发写不回滚。filename 仅 basename 不是路径授权。原生文件单测通过，真实 Tauri 保存、磁盘故障与多窗口验收待集中进行；移动端历史导出和 Storybook 浏览器降级不变。 | [EXPORT](../apps/web/src/platform/export-file.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [API](../packages/plugin-types/src/index.ts) [DICTEXPORT](../plugins/dictionary/src/export.ts) [DESKEXPORT](../plugins/annotation-desk/src/export.ts) [DESKRELEASE](../docs/evidence/packaged-annotation-desk-2026-09-09.json) [HOSTIO](../apps/web/src/services/host-io.ts) [HOSTIOTOOLS](../packages/agent/src/tools/host-io-tools.ts) [RESOURCEOWNER](../apps/web/src/services/resource-owner.ts) [RESOURCEFILES](../apps/desktop/src-tauri/src/resources.rs) [RESOURCETOOLS](../packages/agent/src/tools/resource-tools.ts) [RESOURCEEXPORT](../apps/web/src/platform/resource-export.ts) | P02 |
| <a id="SYS11"></a>SYS11 | 用户选文件/目录、拖放和流式文件句柄 | 实装 | **部分**：pick_resource_files[双域]；import_resource_book[global]<br>[设计] 用户授予 FileRef 后导入 | **部分**：resources.pick/read；library 1.8 importResource<br>[设计] 受控文件选择/句柄服务 | 书籍导入；插件安装选择 ZIP；正式资源选择 | 单/多文件原生选择和扩展名过滤已接，取消显式返回，不返回路径；快照只读、1 小时 TTL，不是文件监视。FileRef 已能直接进入原生书库导入，不需整本字节在 Worker 往返；目录授权和拖放事件接管仍缺。接线/定向检查完成，Tauri 对话框和实际组合导入验收集中执行。 | [PICKER](../apps/web/src/features/library/lib/pick-book-files.ts) [IMPORT](../apps/web/src/features/library/lib/book-import.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) [RESOURCEOWNER](../apps/web/src/services/resource-owner.ts) [RESOURCES](../apps/web/src/services/resources.ts) [RESOURCEFILES](../apps/desktop/src-tauri/src/resources.rs) [RESOURCETOOLS](../packages/agent/src/tools/resource-tools.ts) [RESOURCEIMPORT](../apps/web/src/domain/library-resource-import.ts) | P01 |
| <a id="SYS12"></a>SYS12 | 打开外部 URL/系统关联打开/深链接路由 | 实装 | **部分**：open_external_url[双域]<br>[设计] 用户意图下的受控 URL 打开 | **部分**：ui 1.7 openExternal；要求 service:network<br>[设计] scheme 白名单外部打开/URI contribution | 账号登录/购买链接；系统打开书籍；双端显式外链意图 | HTTP(S) 外链已接共享 opener，拒绝嵌入凭据、控制字符及 file/data/javascript/自定义 scheme；成功表示交给 OS，不表示网页加载。外部 URL 打开与注册协议不同，URI contribution/关联文件句柄仍未接；OAuth ticket 不给插件。定向权限和参数测试通过，集中桌面验收待做。 | [EXTERNAL](../apps/web/src/platform/external-link.ts) [APP](../apps/web/src/App.tsx) [RUST](../apps/desktop/src-tauri/src/lib.rs) [HOSTIO](../apps/web/src/services/host-io.ts) [HOSTIOTOOLS](../packages/agent/src/tools/host-io-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | P05 |
| <a id="SYS13"></a>SYS13 | Blob 范围读取/流式读写/提交/中止 | 实装 | **部分**：read_resource_text/release_resource；原书只导出<br>[设计] 受权 ResourceRef，不读任意 blob | **部分**：resources.create/stat/read/append/commit/release<br>[设计] 临时资源范围读写/封口/中止 | 原书阅读；同步分片；封面；正式资源服务 | 临时资源分块读写已接：单块 1 MiB，每 owner 16 引用/1 GiB，宿主 64 文件/2 GiB，32 个串行队列；追加 offset 防重复写，commit 后不可写，release 兼 abort，退休等待在途任务后清理。选中/原书独立副本与自建匿名文件不进入同步、备份或数据库；不开放原始 blob key。跨激活持久化资源、书内资产与 transferable 桥优化仍缺，当前桥是有界 structured clone；Agent UTF-8 读取保持码点及字节游标。原生与定向测试通过，组合/Tauri E2E 待集中进行。 | [BLOB](../apps/web/src/platform/blob-store.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) [API](../packages/plugin-types/src/index.ts) [RESOURCEOWNER](../apps/web/src/services/resource-owner.ts) [RESOURCEFILES](../apps/desktop/src-tauri/src/resources.rs) [RESOURCETOOLS](../packages/agent/src/tools/resource-tools.ts) | P01 |
| <a id="SYS14"></a>SYS14 | 系统字体枚举和字体资产加载 | 实装 | **部分**：settings discover reading.fontFamily<br>[设计] 受支持字体列表 | **部分**：settings options + fonts manifest<br>[设计] 字体资源能力 | 阅读字体选择；editorial-themes | 列表选择已可组合，不需要插件访问系统字体目录 | [RUST](../apps/desktop/src-tauri/src/lib.rs) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [API](../packages/plugin-types/src/index.ts) | 新增盘点 |
| <a id="SYS15"></a>SYS15 | 原生日志/诊断包/崩溃报告导出与发送 | 实装 | **部分**：open_maintenance_settings[双域]<br>[设计] 打开宿主脱敏诊断流程 | **部分**：services.maintenance.openSettings(diagnostics)<br>[设计] 宿主诊断入口；自有诊断输出 | 设置 About Diagnostics；CrashFollowUpPrompt | 已接宿主页面挂载与诊断控件定位，opened 不冒充导出/发送完成；不返回日志、路径、诊断包、凭据，用户仍在宿主触发导出或预览确认发送。自有 logger/诊断输出和最终操作回执仍缺；接线与定向检查完成，组合/Tauri 验收待集中进行。 | [DIAG](../apps/web/src/features/settings/lib/diagnostics.ts) [ERRORS](../packages/core/src/errors.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) [HOSTMAINTENANCE](../apps/web/src/services/maintenance.ts) [MAINTENANCETOOLS](../packages/agent/src/tools/maintenance-tools.ts) | R05, R06 |
| <a id="SYS16"></a>SYS16 | 检查/下载/安装更新与重启 | 实装 | **接通**：get_software_update/open_maintenance_settings[双域]<br>[设计] 查询状态/打开宿主更新控件 | **接通**：services.maintenance 1.0<br>[设计] 版本/更新状态与观察、受权检查；宿主执行升级 | 软件更新页；autoUpdate 与正式双端服务共用控制器 | snapshot/observe 只读当前 phase/progress/version/选中与已检查频道；checkForUpdates 需插件 network 权限，只用宿主 release feed，失败拒绝不冒充最新。检查复用单飞、与安装互斥，频道换代拒绝旧结果；调用者取消不撤销共享检查。openSettings 仅确认宿主更新控件已挂载和定位，安装/重启仍由原生用户动作批准，禁止插件静默执行；不提供升级最终结果回执。接线与定向检查完成，组合/Tauri 实际检查下载重启待集中验收。 | [UPDATE](../apps/web/src/features/update/lib/software-update.ts) [APP](../apps/web/src/App.tsx) [RUST](../apps/desktop/src-tauri/src/lib.rs) [API](../packages/plugin-types/src/index.ts) [HOSTMAINTENANCE](../apps/web/src/services/maintenance.ts) [MAINTENANCETOOLS](../packages/agent/src/tools/maintenance-tools.ts) [UPDATECONTROL](../apps/web/src/features/update/lib/software-update-controller.ts) | R05 |
| <a id="SYS17"></a>SYS17 | 窗口最小化/最大化/全屏/关闭/标题栏 | 实装 | **未接**：无正式入口<br>[设计] 用户触发的窗口意图 | **未接**：无正式入口<br>[设计] 受限窗口状态/命令 | Tauri window controls/macOS traffic lights | 不开放任意窗口创建与 shell；关闭必须先等待持久化 flush | [WINDOW](../apps/web/src/features/navigation/components/WindowCaptionControls.tsx) [APP](../apps/web/src/App.tsx) [RUST](../apps/desktop/src-tauri/src/lib.rs) | 新增盘点 |
| <a id="SYS18"></a>SYS18 | Android/iOS 遗留桥：状态栏/安全区/音量键/商店 | 非桌面 | **未接**：无正式入口<br>[设计] 不开放：不在当前 desktop 产品范围 | **未接**：无正式入口<br>[设计] 不开放：不在当前 desktop 产品范围 | cfg 分支或桌面 no-op | Android updater/book picker/background task 和 App Store storefront 不计为桌面插件缺口 | [RUST](../apps/desktop/src-tauri/src/lib.rs) | 新增盘点 |

### 同步、账号、备份与维护

| ID | 宿主能力 | 宿主现状 | Agent 当前与目标 | 插件当前与目标 | 实际消费者 | 缺口/边界 | 来源 | 旧基线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <a id="OPS01"></a>OPS01 | 同步连接/断开/立即同步/状态与积压 | 实装 | **部分**：get_sync_status；manage_sync now/settings 双 scope<br>[设计] 状态与批准同步已接，定向连接流程待接 | **部分**：services.sync 1.0 snapshot/observe/backlog/requestSync/openSettings<br>[设计] 独立 service:sync 控制面 | Data & Sync；Agent 工具；插件正式入口 | 共享 scheduler，初始/变化串行观察最多 64；fresh outbox 与 cycleStartBacklog 分开，不泄漏书籍/blobKey/游标。未连接、凭据失效、连接管理中拒绝；already-running 不是完成，新周期等现有引擎结束才 completed。连接换代或调用者取消不返回旧成功，也不回滚已派发共享同步；不是独立可取消耐久任务。openSettings 只确认 Data & Sync 页面打开，不假称连接/断开完成；定向流程和完成回执仍待接。transport/network 权限不隐式获得 sync 管理。定向测试已验，新组合插件及 Tauri/跨设备验收待集中进行。 | [SYNC](../apps/web/src/platform/sync/sync-scheduler.ts) [SYNCCONNECT](../apps/web/src/platform/sync/connect.ts) [ACCOUNTUI](../apps/web/src/features/settings/sections/SyncAccountGroup.tsx) [API](../packages/plugin-types/src/index.ts) [SYNCSERVICE](../apps/web/src/services/sync.ts) [SYNCCONTROLLER](../apps/web/src/services/sync-controller.ts) [SYNCTOOLS](../packages/agent/src/tools/sync-tools.ts) | R04 |
| <a id="OPS02"></a>OPS02 | 事件/Blob E2E 加解密、游标、去重/确认与重试 | 实装 | **未接**：宿主内部同步<br>[设计] 不开放：原始密钥/ACK/游标写 | **部分**：只处理 SealedEventWire/密文字节<br>[设计] 只贡献传输 | Relay/WebDAV | 不得通过插件改变确认语义或读取其他插件/账号明文 | [SYNCENGINE](../apps/web/src/platform/sync/sync-engine.ts) [SYNC](../apps/web/src/platform/sync/sync-scheduler.ts) [SYNCTRANSPORT](../apps/web/src/platform/sync/transport-registry.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) | 新增盘点 |
| <a id="OPS03"></a>OPS03 | 检查点/投影恢复/事件历史回填 | 实装 | **部分**：get_sync_status 的 phase/backfillRemaining/lastCycle<br>[设计] 恢复进展已接，诊断修复流程待接 | **部分**：sync 1.0 脱敏进度和观察<br>[设计] 只读回填进度 | checkpoint maintain/publish/bootstrap；backfill | 只提供阶段/计数，不开放游标/ACK/原始账本，也不把 remaining=0 当成投影校验通过。诊断/修复入口仍缺，集中验收待做。 | [RUST](../apps/desktop/src-tauri/src/lib.rs) [SYNCENGINE](../apps/web/src/platform/sync/sync-engine.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) [SYNCSERVICE](../apps/web/src/services/sync.ts) [SYNCCONTROLLER](../apps/web/src/services/sync-controller.ts) | 新增盘点 |
| <a id="OPS04"></a>OPS04 | WebDAV 等自定义密文 transport | 实装 | **部分**：可改非敏感插件设置，不能连接<br>[设计] 宿主连接流程 | **接通**：syncTransports v2：register/open/session.close 与密文方法<br>[设计] 密文传输贡献 | WebDAV 0.2.0；隔离 Tauri 原生 HTTP 探针 | 宿主按注册/engine generation 关闭会话，失配与迟到 open 也释放；5 秒 close 上限及错误仍释放回调。桌面已证并发取消/停用不再发请求；真实连接 UI、跨设备与换代失败回滚未完整验收，GAP14 不整项关闭 | [API](../packages/plugin-types/src/index.ts) [WEBDAV](../plugins/webdav-sync/src/index.ts) [SYNCTRANSPORT](../apps/web/src/platform/sync/transport-registry.ts) [SYNCSESSION](../apps/web/src/platform/sync/transport-session.ts) [SYNCCACHE](../apps/web/src/platform/sync/transport-session-cache.ts) [SYNCPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-transport-probe.ts) | N03 |
| <a id="OPS05"></a>OPS05 | 偏好漫游/远端合并后的 UI 失效 | 部分 | **自动**：下一轮读取投影/配置<br>[设计] 一致快照与刷新 | **部分**：roaming KV 与 plugin docs 路径不等价<br>[设计] 授权 change feed + 同步策略 | 跨设备设置/书架/聊天刷新 | GAP09：远端应用缺逐领域订阅广播；不得让插件 replay 原始事件补洞 | [ROAM](../apps/web/src/platform/roaming-preferences.ts) [SYNC](../apps/web/src/platform/sync/sync-scheduler.ts) [APPEVENTS](../apps/web/src/platform/app-events.ts) [DOCS](../apps/web/src/features/plugins/runtime/plugin-backend.ts) | 新增盘点 |
| <a id="OPS06"></a>OPS06 | 账号登录、连接 token、退出、删除账号 | 实装 | **部分**：get_sync_status connected/backend；manage_sync settings<br>[设计] 匿名状态及设置入口已接 | **部分**：sync 1.0 snapshot/openSettings<br>[设计] 独立授权的状态与宿主页 | SyncAccountGroup；双端设置入口 | 不返回 email、账号 ID、token/主密钥。打开页面后仍需用户操作宿主登录/退出/删除控件；定向流程请求及最终回执未接。删除远端账号不等于删除本地数据，桌面验收待集中进行。 | [ACCOUNTUI](../apps/web/src/features/settings/sections/SyncAccountGroup.tsx) [SYNCCONNECT](../apps/web/src/platform/sync/connect.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) [EXTERNAL](../apps/web/src/platform/external-link.ts) [SYNCSERVICE](../apps/web/src/services/sync.ts) [SYNCTOOLS](../packages/agent/src/tools/sync-tools.ts) | 新增盘点 |
| <a id="OPS07"></a>OPS07 | 套餐/用量/购买/账单管理 | 实装 | **部分**：get_sync_status includeAccount；manage_sync settings<br>[设计] 只读套餐用量与设置入口 | **部分**：sync 1.0 account/openSettings<br>[设计] 按需远端脱敏读 | 购买/账单 portal；双端只读配额 | account 仅返回 tier/hasBilling/三项用量及四项额度，null 是非 relay/未连接而非零用量。显式读取才发请求，失败拒绝不伪装空值；换代/连接管理中的迟到结果拒绝，不返回 keys/email/accountId/ticket。购买/账单仍在宿主页，由用户操作；定向流程与完成反馈未接。定向测试不证明远端生产数据或购买成功，不开放自动付款。 | [ACCOUNTUI](../apps/web/src/features/settings/sections/SyncAccountGroup.tsx) [EXTERNAL](../apps/web/src/platform/external-link.ts) [SYNCSERVICE](../apps/web/src/services/sync.ts) [SYNCCONTROLLER](../apps/web/src/services/sync-controller.ts) [SYNCTOOLS](../packages/agent/src/tools/sync-tools.ts) | 新增盘点 |
| <a id="OPS08"></a>OPS08 | 备份导出与合并导入 | 部分 | **部分**：open_maintenance_settings(backup-import/backup-export)[双域]<br>[设计] 打开宿主备份控件 | **部分**：maintenance 1.1 openSettings(backup-import/backup-export)<br>[设计] 打开宿主备份控件 | DataSyncPanel 原有导入/导出按钮定位 | 入口已接，不点击按钮/自动打开文件选择器，不传入备份字节或路径；opened 不是导入/导出完成。v1 仍仅 KV/books/collections/annotations/files；独立 ai_chat/memories/plugin_docs/secret/event-log 未枚举，不能称全量备份；全量内存 JSON、原有导出实现及最终任务回执未改，实际桌面效果留待集中验收。 | [BACKUP](../apps/web/src/features/settings/lib/backup-io.ts) [DATAUI](../apps/web/src/features/settings/sections/DataSyncPanel.tsx) [RUST](../apps/desktop/src-tauri/src/lib.rs) [HOSTMAINTENANCE](../apps/web/src/services/maintenance.ts) [MAINTENANCETOOLS](../packages/agent/src/tools/maintenance-tools.ts) | O06, R05 |
| <a id="OPS09"></a>OPS09 | 删除本地全部数据 | 实装 | **接通**：open_maintenance_settings(delete-data)[双域]<br>[设计] 打开宿主危险操作入口 | **接通**：maintenance 1.1 openSettings(delete-data)<br>[设计] 只定位，禁止直接 wipe | DataSyncPanel 原有删除入口与 DELETE 文字确认 | 只定位已挂载入口按钮，不打开确认框、不填 DELETE、不批准或执行删除；用户须自行点击并完成宿主文字确认。opened 不代表删除完成；清空本地与删账号不同，私有卸载不升级成全局 wipe。条件/取消/生命周期定向测试通过，真实 Tauri 确认流程待集中验收。 | [WIPE](../apps/web/src/features/settings/lib/delete-all-data.ts) [DATAUI](../apps/web/src/features/settings/sections/DataSyncPanel.tsx) [RUST](../apps/desktop/src-tauri/src/lib.rs) [HOSTMAINTENANCE](../apps/web/src/services/maintenance.ts) [MAINTENANCETOOLS](../packages/agent/src/tools/maintenance-tools.ts) | R05 |
| <a id="OPS10"></a>OPS10 | 数据目录显示/Reveal | 占位 | **未接**：无正式入口<br>[设计] 待宿主实现后暴露意图 | **未接**：无正式入口<br>[设计] 待宿主实现后暴露意图 | disabled Reveal / PendingBadge | UI 占位不能计入宿主已实现，更不能计入 Agent 或插件覆盖 | [DATAUI](../apps/web/src/features/settings/sections/DataSyncPanel.tsx) | 新增盘点 |
| <a id="OPS11"></a>OPS11 | 事件写入、重建/验证投影、历史 genesis | 实装 | **内部**：领域端口提交业务事件<br>[设计] 只走有语义领域命令 | **部分**：公开领域命令内部 commit<br>[设计] 只走有语义领域命令 | commit_events/rebuild_projections/verify_projections | 不开放：任意 SQL/事件 append/投影写；旧日志未记录的变更不可凭空恢复 | [EVENTS](../apps/web/src/platform/domain-events.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) [RUST](../apps/desktop/src-tauri/src/lib.rs) | 新增盘点 |

### 跨能力协议与明确边界

| ID | 宿主能力 | 宿主现状 | Agent 当前与目标 | 插件当前与目标 | 实际消费者 | 缺口/边界 | 来源 | 旧基线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <a id="CON01"></a>CON01 | 能力发现/版本/权限/依赖与安装同意 | 实装 | **部分**：registry 按 scope 产工具；无完整 host 能力目录工具<br>[设计] 语义工具目录 | **接通**：ctx.capabilities + manifest requires/permissions<br>[设计] 版本化能力目录 | 插件安装校验；工具构建 | catalog 当前只列已公开 API，不自动覆盖 host UI/engine/native；新增宿主行为必须更新此表 | [CATALOG](../packages/core/src/capabilities.ts) [API](../packages/plugin-types/src/index.ts) [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) | A01, R01, R07 |
| <a id="CON02"></a>CON02 | 对象级授权/用户批准/来源与审计 | 部分 | **部分**：book scope + destructive approval<br>[设计] 最小授权工具 | **部分**：domain permissions/settings path grants/plugin namespace<br>[设计] 对象级授权/审批票据 | Agent 写工具；插件 manifest | 域权限不是每个对象的授权；session metadata 默认开放需明确政策 GAP15 | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [CATALOG](../packages/core/src/capabilities.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) | L07, P06, Q05, R02 |
| <a id="CON03"></a>CON03 | 生命周期 staging/activate/deactivate 与资源释放 | 部分 | **自动**：runtime invalidation/flush background<br>[设计] 任务/贡献消费生命周期 | **部分**：注册 scope、视图/transport session 回调 lease 与异步 cleanup 排空<br>[设计] 全来源 structured cancellation | 插件启停/升级；Agent 运行时重建 | 视图移除或失效时释放局部回调，未消费/非法/迟到结果释放，旧 Worker 不关闭新实例对话框；停用退休 transport 后排空异步关闭及持久写。仍缺通用同 ID 换代失败回滚、其他 provider session/在途 effect 和真实连接全链路；GAP06/08/14 未整体关闭 | [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [CALLBACKWIRE](../apps/web/src/features/plugins/runtime/plugin-callback-wire.ts) [LIFECYCLE](../apps/web/src/features/plugins/runtime/plugin-lifecycle.ts) [THREAD](../packages/agent/src/runtime/thread.ts) [SYNCSESSION](../apps/web/src/platform/sync/transport-session.ts) [VIEWSESSION](../apps/web/src/features/plugins/lib/plugin-view-session.ts) [VIEWSOURCE](../apps/web/src/features/plugins/hooks/usePluginViewSource.ts) | E04, K06, N05, Q06, R01, R03 |
| <a id="CON04"></a>CON04 | 跨 Worker RPC 的类型、错误与资源额度 | 部分 | **扩展**：插件 tool 也经过同一 worker bridge<br>[设计] 工具任务不被悬挂 | **部分**：describeContext + 无业务字段碰撞的 callback metadata + 有界图遍历<br>[设计] 有界可取消版本化 RPC | 所有 Worker 插件及其 Agent 工具 | __fn/__disposable 保持普通数据；编码/clone 失败回滚句柄；图深度/条目/单消息 callback 有界；GAP07/12/13/17 的全消息 schema/字节与存活资源总量、取消、错误码/崩溃路径仍需统一验收 | [WORKER](../apps/web/src/features/plugins/runtime/plugin-sandbox.worker.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [CALLBACKWIRE](../apps/web/src/features/plugins/runtime/plugin-callback-wire.ts) [API](../packages/plugin-types/src/index.ts) [ERRORS](../packages/core/src/errors.ts) | J12 |
| <a id="CON05"></a>CON05 | 稳定错误码/安全文案/可重试与降级状态 | 部分 | **部分**：工具错误包装与产品错误表面<br>[设计] 可机器判定回执 | **部分**：桥会保留 code；非所有生命周期路径<br>[设计] 统一错误 envelope | 宿主 AppError；插件 UI toast | 错误字符串/空列表 fallback 不能算成功；消费者需明确 empty 与 failed | [ERRORS](../packages/core/src/errors.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | R06 |
| <a id="CON06"></a>CON06 | 长任务进度、取消、超时、并发与幂等 | 部分 | **部分**：局部 thread abort/工具 sequential<br>[设计] 统一任务原语 | **部分**：局部请求 id/回调，无通用 TaskRef<br>[设计] 统一任务服务 | 搜索/导入/LLM/同步等各自实现 | 重复业务实现的原因之一；只新增函数名不补任务契约仍会反复缺能力 | [THREAD](../packages/agent/src/runtime/thread.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [API](../packages/plugin-types/src/index.ts) | K06, L07, N05, Q04, Q06 |
| <a id="CON07"></a>CON07 | 领域事件的本地/远端/外部变化一致性 | 部分 | **自动**：端口每轮读；runtime 配置失效<br>[设计] 有版本快照/读后写 | **部分**：domain subscribe / ignoreSelf / session<br>[设计] 统一 change feed | 本地 domain broadcasts；app invalidation | GAP09/11 与 STAT05；事件类型、实发事件、异步错误三处要同源 | [EVENTROSTER](../apps/web/src/domain/events.ts) [APPEVENTS](../apps/web/src/platform/app-events.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [SYNC](../apps/web/src/platform/sync/sync-scheduler.ts) | A06, Q01, Q02 |
| <a id="CON08"></a>CON08 | 事务/CAS/撤销/跨对象一致回执 | 部分 | **部分**：单工具领域写/批准，无跨工具事务<br>[设计] 受控批量/预览/回执 | **部分**：单域命令 Promise；无通用事务/CAS<br>[设计] 声明式批次，不给 DB transaction handle | 底层 commit_events 单 SQLite 事务 | 数据库事务存在不等于业务跨调用事务；undo 与导航 back 是两类能力 | [EVENTS](../apps/web/src/platform/domain-events.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) [LIB](../apps/web/src/domain/library.ts) [ANNOT](../apps/web/src/domain/annotations.ts) [API](../packages/plugin-types/src/index.ts) | A05, O02 |
| <a id="CON09"></a>CON09 | 沙箱、权限撤销和 packaged CSP 验证 | 部分 | **扩展**：插件工具间接承受同样沙箱风险<br>[设计] 统一信任边界 | **部分**：Worker 响应独立 CSP + API gate<br>[设计] 可测试的最小出口 | 安装信任边界；全部插件及插件 Agent 工具 | macOS release 复现零权限插件经原型 fetch、子 blob Worker、HTTP 动态模块直接联网；已修复为 Worker 响应独立 CSP，三路复测均失败且服务器零新增请求，已授权宿主网络仍 200。开发响应共享策略，构建拒绝保护入口缺失/重复。Annotation Desk 正向安装/导出/卸载证据保留；直接消息/其余平台绕行、执行中撤权与 Windows/Linux 实机仍未验收，不宣称完整沙箱证明 | [WORKER](../apps/web/src/features/plugins/runtime/plugin-sandbox.worker.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [DESKRELEASE](../docs/evidence/packaged-annotation-desk-2026-09-09.json) [SANDBOXPOLICY](../apps/web/plugin-sandbox-policy.json) [SANDBOXNATIVE](../apps/desktop/src-tauri/src/plugin_sandbox_policy.rs) [SANDBOXBUILD](../apps/web/build/plugin-sandbox-policy.ts) [SANDBOXPROOF](../docs/evidence/packaged-sandbox-network-2026-09-09.json) | R03 |
| <a id="CON10"></a>CON10 | 宿主-工具-插件覆盖门禁/契约测试 | 部分 | **部分**：registry/tool-surface 测试覆盖当前工具<br>[设计] host 行为映射门禁 | **部分**：capability catalog/ctx shape/marketplace checks<br>[设计] 双端一致性/失败时序测试 | 现有测试；本次矩阵库存检查 | GAP18：形状匹配不能证明语义/消费者/交付；本表盘点也不替代 E2E | [CATALOG](../packages/core/src/capabilities.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) [API](../packages/plugin-types/src/index.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) | R07, R08 |
| <a id="CON11"></a>CON11 | 任意 SQL/FS/shell/DOM、密钥、伪造历史 | 实装 | **未接**：未注册这些工具<br>[设计] 不开放：越过领域/用户授权 | **未接**：不属于 public API<br>[设计] 不开放：越过隔离/宿主所有权 | 宿主内部可能需要底层权力 | 拒绝原始权力不等于拒绝语义需求：用 ResourceRef/审批/领域命令替代 | [API](../packages/plugin-types/src/index.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) | 新增盘点 |
| <a id="CON12"></a>CON12 | 新格式/OCR/实时协作/向量/任意编辑与新平台 | 待建 | **未接**：无正式入口<br>[设计] 宿主能力更新后再建模 | **未接**：无正式入口<br>[设计] 宿主能力更新后再建模 | 不计当前宿主对等开放率 | 不能承诺未来所有插件永不需要新 host；只能承诺当前能力闭包及其可组合范围 | [API](../packages/plugin-types/src/index.ts) [RUNTIME](../packages/agent/src/runtime/runtime.ts) [ENGINE](../apps/web/foliate-js/src/view.ts) | 新增盘点 |

### 组合能力与遗漏补查

| ID | 宿主能力 | 宿主现状 | Agent 当前与目标 | 插件当前与目标 | 实际消费者 | 缺口/边界 | 来源 | 旧基线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <a id="MORE01"></a>MORE01 | 周期调度/启动补跑/失败记录 | 实装 | **接通**：list_plugin_schedules/manage_plugin_schedule 全局<br>[设计] 枚举与批准 pause/resume/run | **接通**：schedules 1.1 bind/list/observe/control<br>[设计] 自有计划状态与受控执行 | RSS 现有每小时刷新；Agent 与插件正式入口 | 每插件最多 64 个绑定，查询偏移分页 1–100/默认 50，观察初始+串行合并变化。暂停/恢复等持久写；手动 run 越过暂停/间隔一次，不恢复自动计划。每 key 跨重绑定共享 flight，already-running 不假称完成；开始记录落库后才派发 callback，结束记录落库后才 completed，失败不会刷新 lastSuccessAt。旧时间戳只迁为 lastStartedAt；未完成记录显示 interrupted，不伪造成功。新/旧调度记录排除偏好漫游；不是完整执行历史。退休停止新调用与迟到结果写，已派发持久写参与生命周期 drain；不保证物理副作用回滚。首轮 5 秒/每分钟扫描，至少 15 分钟间隔，错过多轮合并一次，关 App 不运行；最后绑定释放计时器。定向持久/并发/权限测试已验，组合插件与 Tauri 重启/升级验收待集中进行。 | [SCHED](../apps/web/src/features/plugins/runtime/plugin-scheduler.ts) [SCHEDCONTROL](../apps/web/src/features/plugins/runtime/plugin-schedule-controller.ts) [SCHEDTOOLS](../packages/agent/src/tools/schedule-tools.ts) [API](../packages/plugin-types/src/index.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [RSS](../plugins/rss-reader/src/index.ts) [ROAM](../apps/web/src/platform/roaming-preferences.ts) | Q03 |
| <a id="MORE02"></a>MORE02 | 一次性延迟/短周期/空闲任务与自触发防环 | 部分 | **自动**：maintenance 有 idle 策略，无通用调度工具<br>[设计] 宿主自动管线/受控计划 | **部分**：Worker timer 可用，无宿主可恢复任务<br>[设计] 有 owner/origin 的任务服务 | Theme Schedule 用 Worker clock；RSS 定时 | setTimeout 不是可审计后台任务；ignoreSelf 不能阻止跨插件循环 | [SCHED](../apps/web/src/features/plugins/runtime/plugin-scheduler.ts) [MAINT](../apps/web/src/features/ai/agent/maintenance.ts) [WORKER](../apps/web/src/features/plugins/runtime/plugin-sandbox.worker.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | Q04, Q05 |
| <a id="MORE03"></a>MORE03 | 环境 locale/platform/timezone/在线/ready 快照 | 部分 | **部分**：get_host_environment（全局/书内）+ 自动语言/日期上下文<br>[设计] 环境查询与真实 availability | **部分**：session 2.0 environment/observeEnvironment + ctx.appVersion/capabilities<br>[设计] 统一环境与 availability 快照 | Agent 查询；零权限 Worker 观察；Listening Desk 0.7 离线提示 | 共享 revision、runtime/platform/locale/timeZone/utcOffsetMinutes/networkHint；首次立即快照，语言/网络/焦点变化刷新，时区每 30 秒复核且每次查询刷新，末个观察者释放监听与 timer。网络仅 OS/WebView 提示，不证明 endpoint 可达、账号/模型就绪或格式可用；这些 availability 仍缺。无阅读/账号字段，不借内置服务绕过 reading 权限。Listening Desk 按需刷新离线提示，不阻止本地朗读。隔离 macOS debug 双端与真实 Worker 已验；旧 session 四阅读事件旁路已移除；packaged/跨平台/真实系统时区和网络切换未验。 | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [ENVIRONMENT](../apps/web/src/platform/host-environment.ts) [ENVTOOLS](../packages/agent/src/tools/environment-tools.ts) [ENVPROOF](../docs/evidence/host-environment-2026-09-09.json) [SESSIONBOUNDARY](../docs/evidence/reading-session-boundary-2026-09-09.json) [API](../packages/plugin-types/src/index.ts) [LISTENINGDESK](../plugins/listening-desk/src/views.ts) | A07 |
| <a id="MORE04"></a>MORE04 | 书籍/集合上下文菜单与 Agent header 插槽 | 实装 | **未接**：无正式入口<br>[设计] 语义命令，不操作菜单 DOM | **接通**：contextActions 1.0 book/collection；headerActions 1.2 agent<br>[设计] 语义对象动作及页头视图 | 书籍网格/列表、集合卡片/详情操作菜单；Agent header 与窄窗 overflow | 接通待集中验收。书籍 id/title/author、集合 id/name 和当前全局线程 id 是点击上下文，不授予领域读取/写入权限，不披露原始路径、封面 URL、消息或成员清单。context action 返回既有 view/toast/void，复用注册级动态状态、退休和 Dialog 生命周期；Agent header 强制 popup，换线程重建视图，不加入书架导航/命令面板。集合/书籍列表为显式操作菜单，不声称系统级原生右键菜单或批量选择贡献；逐目标条件、菜单自定义布局不是本批范围。 | [SHELFUI](../apps/web/src/features/shelf/components/Shelf.tsx) [AGENTUI](../apps/web/src/features/agent/components/AgentWorkspace.tsx) [MENU](../apps/web/src/features/menus/lib/menu-registry.tsx) [API](../packages/plugin-types/src/index.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [CONTEXTACTIONS](../apps/web/src/features/plugins/lib/context-action-items.tsx) [AGENTHEADER](../apps/web/src/features/plugins/hooks/usePluginAgentHeaderEntries.tsx) [CONTEXTACTIONPROOF](../apps/web/src/features/plugins/runtime/context-actions.test.ts) | I05 |
| <a id="MORE05"></a>MORE05 | 贡献的动态 visible/enabled/checked 与自有视图刷新 | 部分 | **部分**：两 scope 每次模型请求刷新工具/检索；缓存执行复核；内置工具未统一<br>[设计] 操作 availability | **部分**：四交互贡献 1.1 register().updateState；views 1.1 live.subscribe + UI 1.2 publishView<br>[设计] 声明式条件与受控视图状态 | Jumper 0.2；Text Desk 0.3 请求详情；真实 Worker/Agent 组合探针 | commands/headerActions/selectionActions/agentTools 的精确注册句柄接收非负安全整数 revision 的完整 visible/enabled/checked 快照；旧版本 stale，同 ID 替换/释放句柄 inactive。菜单、命令面板、快捷键、查词和缓存 Agent 工具执行前复核；hidden 也拒绝新调用，checked 只呈现，不自动修改业务或增加权限。禁用不取消已启动操作，也不重置打开页面的草稿；用户菜单布局隐藏不等于贡献主动禁用。Worker 更新等待注册 ACK，沿用 RPC 限额/截止。Jumper 观察实际 session/history 自动更新前后跳。live 通道仍限激活代/可见帧，push/modal/关闭撤销，返回重新订阅，最多 16 通道；失败保留旧画面，applied 不是绘制或业务完成。AgentThread 每次模型请求更新发现与执行上下文，不因工具变化丢弃章节会话；已发出请求保留旧定义，执行前拒绝退休/禁用注册，不能转交同名新实现；检索同样复核注册身份。隔离 macOS debug 已验真实快捷键、书架/阅读菜单、命令面板、选区工具栏、页面草稿、缓存 Agent/在途操作与编译 Jumper；新增真实 Worker 九次模型请求验证启用、停用、恢复、替换与历史保留，推理为脚本、对话为内存，非自主模型或 SQLite 证据。宿主内置 Agent 工具统一 availability、全表单/焦点/大数据与 packaged/跨平台仍缺；不开放 DOM/Jotai。 | [API](../packages/plugin-types/src/index.ts) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) [VIEWSESSION](../apps/web/src/features/plugins/lib/plugin-view-session.ts) [LIVEVIEW](../apps/web/src/features/plugins/lib/plugin-live-view.ts) [VIEWCHANNELS](../apps/web/src/features/plugins/lib/plugin-view-channels.ts) [CALLBACKWIRE](../apps/web/src/features/plugins/runtime/plugin-callback-wire.ts) [LIVEVIEWPROOF](../docs/evidence/plugin-live-views-2026-09-09.json) [ACTIONSTATE](../apps/web/src/features/plugins/state/interactive-contribution-registry.ts) [ACTIONSTATEPROOF](../docs/evidence/plugin-action-state-2026-09-09.json) [THREAD](../packages/agent/src/runtime/thread.ts) [EXTOOLS](../apps/web/src/features/plugins/runtime/plugin-tools.ts) [TOOLREFRESHPROOF](../docs/evidence/agent-tool-refresh-2026-09-09.json) | I07, J04, J05 |
| <a id="MORE06"></a>MORE06 | 发现/复用类型化提供者与跨插件权限交集 | 部分 | **扩展**：host 聚合各插件 tool/retrieval<br>[设计] 宿主 broker 消费 | **部分**：阅读模式可发现/选择；无通用 provider discover/invoke<br>[设计] 依赖和资源范围重鉴权的 broker | 宿主消费 voices/content/modes/tools/transports | 注册、被宿主消费、被其他插件调用是三个方向；不开放任意字符串 RPC/他人 storage | [EXTOOLS](../apps/web/src/features/plugins/runtime/plugin-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [SYNCTRANSPORT](../apps/web/src/platform/sync/transport-registry.ts) [API](../packages/plugin-types/src/index.ts) | N04, N06 |
| <a id="MORE07"></a>MORE07 | 插件自有二进制资产与资源配额 | 部分 | **扩展**：只经插件工具间接消费<br>[设计] 受权资源意图 | **部分**：包内 assets 有；无可写私有 blob API<br>[设计] 私有可撤销 ResourceRef/流/配额 | 主题字体包内资源；TTS 内存音频 | 包内静态资产、文档 JSON、运行期私有 blob 三者不可混算 | [BLOB](../apps/web/src/platform/blob-store.ts) [DOCS](../apps/web/src/features/plugins/runtime/plugin-backend.ts) [API](../packages/plugin-types/src/index.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) | J08, O04 |
| <a id="MORE08"></a>MORE08 | 声明 UI 本地化、辅助技术、窄窗和输入焦点 | 实装 | **自动**：宿主工具卡/聊天组件统一呈现<br>[设计] 宿主可访问交互 | **部分**：PluginText + host renderer<br>[设计] 所有 schema 的可访问性契约 | 插件列表/表单；8 语言宿主 | 未做产品完整键盘/超长文本/全部 locale E2E；不能以类型齐全代替验收 | [API](../packages/plugin-types/src/index.ts) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) | J11 |

## 最高优先级缺口

| 顺序 | 行号 | 必须先解决的原因 |
| --- | --- | --- |
| P0 | SET04/SET05/SET18–SET21、SET24–SET26 | 6 个只保存值的设置；SET24/25 已接 Agent 自动输入和插件结构化推理与取消，任意文本通路仍缺；SET26 localOnly 的宿主推理已接，插件网络边界仍缺。隐私/记忆开关需要真实效果，不是只补 API。 |
| P0 | READ01/READ03/READ20、SYS01/SYS03、CON03–CON05 | 假成功、更新回滚覆盖合法写、持久屏障、失联/迟到 effect；原 GAP01–GAP18 没有关闭。 |
| P1 | TXT02/TXT07/TXT13、READ06/READ07、MORE05 | Jumper 完整闭环：语义目录、精准命中、公共 Location、当前快照、统一历史、异步搜索 UI。 |
| P1 | READ16/READ18、MEM01/MEM11、AI02/AI03、SYS11 | 已有宿主能力却没有对应端入口，不能要求新插件重写宿主。 |
| P1 | OPS08、MEM07/MEM08 | 宿主自身的备份范围/画像写入/实体投影未闭合，不能通过开放底层权限修复。 |
| P2 | CON01/CON06/CON07/CON10、MORE06 | 建立操作目录、任务、观察、跨贡献调用和新增行为门禁，再逐项补控制面。 |

### 6 个尚无效果消费者的设置

- `general.launchAtStartup`
- `general.fileAssociations`
- `ai.preferences.features.explainSelection`
- `ai.preferences.features.defineTerm`
- `ai.preferences.features.translate`
- `ai.preferences.features.summarizeChapter`

“未找到效果消费者”来自本轮生产代码检索与调用链检查，不是运行时复现；其中 fileAssociations 对应的系统文件打开本身存在，但没有读取该 toggle。sendHighlightedText、sendSurroundingContext 已接 Agent 自动输入/历史附件与收紧取消，不再列为无消费者；LLM 1.1 readingContext 与 Dictionary 1.3 已接宿主过滤，任意自组装请求和独立检索/旧衍生内容仍有边界缺口，SET24/25 保持部分。SET23 buildMemory 已接入实时记忆构建策略，普通聊天和保留记忆检索不受影响。SET26 localOnly 已有宿主推理消费者与桌面证据，完整插件网络隐私边界仍未完成，不列入“无消费者”清单，也不改为全部接通。

## 已有插件的 Agent 覆盖

| 插件 | 插件自己的能力 | 模型直接可调用 | 没有直接工具的动作 |
| --- | --- | --- | --- |
| Dictionary | 查询、生词本、词卡、删除、CSV 导出 | lookup_word / get_vocabulary / save_word + saved-vocabulary 检索；global/book | 删除词、CSV 导出；有 UI 不等于有工具 |
| RSS Reader | 订阅、刷新、退订、OPML 文本、文章虚拟书、定时更新 | list_feeds / subscribe_feed / refresh_feed；仅 global | 退订、OPML 输入/输出；阅读由通用 open_book 或 UI 提供 |
| Sentence Reader | 分段算法、句段模式 | 宿主 configure_reading_mode / navigate_reading；可选择已注册提供者、启停、步进与返回 | 跟随控制、持久失败回执仍缺；短时计时器不要求独立工具 |
| TTS | 多 vendor/voice 合成 | 宿主 control_read_aloud / get_reading_session；无需重复插件工具 | 不把支持播放等同于任意声源发现/选择已覆盖 |
| Editorial Themes | manifest 主题/字体 | 无专属工具；通用 settings 可选择 | 不需要为了选主题再增加专属工具；新增样式仍应留插件 |
| Jumper | 印刷章号/目录序号/标题、精确正文搜索、前进/后退 | 通用 get_navigation_toc / find_book_locations / open_book / navigate_reading | 不重复注册专属模型工具；仍需完整视觉/格式/取消验收 |
| Annotation Desk | 分页检索标注、无位置笔记、条件编辑与文件导出 | 消费通用 annotations 工具对应领域，不另注册专属模型工具 | UI 是组合消费者，不表示全部批次/外部变化已验收 |
| Listening Desk | 模式选择/配置、单元步进/返回、朗读、历史、控制层与四面板（0.9） | 消费 reading 域与 UI 1.1 reader 服务；通用 get_reader_panels / set_reader_panel，不重复注册模型工具 | 按需刷新 UI；不冒充实时订阅视图 |
| Reading Goals | 书内目标、上下文/记忆候选、宿主记忆开关 | 自动上下文与候选管线；通用 settings 操作开关 | 无专属目标编辑工具；非 release 内置；候选公共回执仍缺 |
| Workspace Profiles | 七路径工作区预设的保存、列表、应用与删除 | workspace_profiles；global/book，保存/应用/删除仅按明确请求 | 不改变本书覆盖；无网络/密钥/书库写权限；非内置，安装升级和跨平台未验 |
| Memory Desk | 个人/跨书/本书记忆检索、保护图谱、来源导航、条件纠错/置顶/遗忘 | 同源 search_memory / query_book_graph / manage_memory；管理逐次批准，不注册重复插件工具 | memory:read 非按书授权；有查询观察，缺来源版本校验；非内置 |
| WebDAV Sync | 密文 transport | 无专属工具；非敏感设置可改 | 连接/断开/同步状态，必须使用宿主控制面 |

[代码] Reading Goals 同时注册 agentContextProviders 与 memoryCandidateProviders：每轮按请求书籍提供私有阅读目标，用户选择后提出书内偏好；实际宿主裁决、入库与 buildMemory 取消已在隔离 Tauri 验证。Dictionary 提供检索贡献，运行时会生成一个额外 retrieve 工具。具体带命名空间的 8 个插件 Agent 入口在库存表中列出。

[代码/范围补充] 邻接仓库 `readaware-plugins` 在本轮查看的提交为 `441e3c9b2403c086459b1d4611efad6e8e1ceb72`：Theme Schedule 1.0.1 已通过 settings discover/update 与 Worker clock 组合主题定时切换，没有专属 Agent 工具；WebDAV 0.1.0 是另一个分发位置。此补充不另计主仓插件，不证明线上 marketplace 已发布或用户已安装；生成器不依赖邻接仓库。

## 注册库存与覆盖反查

- Agent global：91 个。
- Agent book：74 个。
- Plugin ctx：181 个。
- Plugin returned interface：27 个。
- Capability domains：6 个。
- Capability contributions：15 个。
- Capability services：12 个。
- Capability schemas：3 个。
- Settings path：74 个。
- Native command：160 个。
- Native plugin：11 个。
- Menu placement：16 个。
- Shortcut：19 个。
- App event：8 个。
- Command action：1 个。
- Host semantic command：18 个。
- Canonical event：39 个。
- Domain subscription LIBRARY_EVENTS：11 个。
- Domain subscription READING_EVENTS：5 个。
- Domain subscription ANNOTATION_EVENTS：8 个。
- Domain subscription CONVERSATION_EVENTS：4 个。
- Feature owner：14 个。
- First-party source plugin：14 个。
- Plugin Agent contribution：8 个。
- Plugin setting declaration：24 个。
- Native bundled plugin：6 个。

以下“已映射”只保证注册项可追到矩阵行，不意味着目标已实现。Plugin ctx 是授予当前全部 manifest 权限后的 181 个顶层可调用路径；返回的 collection/session 方法单列。Settings 74 路径是在 custom + 主/快模型配置的完整条件快照中生成，不表示未配置 AI 时也显示全部路径。Native command 包含 cfg/no-op 历史项，见 SYS18，不能算桌面能力全部对插件开放。

### Agent global

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `get_host_environment` | [MORE03](#MORE03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_workspace` | [UI01](#UI01) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `navigate_app` | [UI01](#UI01) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `list_host_commands` | [UI03](#UI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `execute_host_command` | [UI03](#UI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `list_installed_plugins` | [EXT11](#EXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `copy_to_clipboard` | [SYS08](#SYS08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `export_text_file` | [SYS10](#SYS10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `open_external_url` | [SYS12](#SYS12) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_sync_status` | [OPS01](#OPS01) [OPS03](#OPS03) [OPS06](#OPS06) [OPS07](#OPS07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `manage_sync` | [OPS01](#OPS01) [OPS04](#OPS04) [OPS06](#OPS06) [OPS07](#OPS07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_software_update` | [SYS16](#SYS16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `open_maintenance_settings` | [SYS15](#SYS15) [SYS16](#SYS16) [EXT12](#EXT12) [OPS08](#OPS08) [OPS09](#OPS09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `list_book_formats` | [LIB07](#LIB07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `pick_resource_files` | [SYS11](#SYS11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `open_book_resource` | [LIB08](#LIB08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `open_book_cover` | [LIB09](#LIB09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `copy_resource_image` | [SYS09](#SYS09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `read_resource_text` | [SYS13](#SYS13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `save_resource` | [SYS10](#SYS10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `release_resource` | [SYS13](#SYS13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `inspect_resource_book` | [LIB07](#LIB07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `import_resource_book` | [LIB06](#LIB06) [SYS11](#SYS11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_book_enrichment` | [LIB09](#LIB09) [LIB10](#LIB10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `retry_book_enrichment` | [LIB10](#LIB10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `list_duplicate_books` | [LIB11](#LIB11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `preview_book_merge` | [LIB11](#LIB11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `merge_duplicate_books` | [LIB11](#LIB11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `resolve_book_reference` | [LIB11](#LIB11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `list_plugin_schedules` | [MORE01](#MORE01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `manage_plugin_schedule` | [MORE01](#MORE01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `list_books` | [LIB01](#LIB01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_book_overview` | [LIB01](#LIB01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_annotations` | [ANN01](#ANN01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `list_collections` | [LIB15](#LIB15) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_reading_stats` | [STAT01](#STAT01) [STAT02](#STAT02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_reading_time` | [STAT03](#STAT03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_reading_insights` | [STAT02](#STAT02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `update_book` | [LIB02](#LIB02) [LIB03](#LIB03) [READ19](#READ19) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `manage_collection` | [LIB16](#LIB16) [LIB18](#LIB18) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `delete_book` | [LIB04](#LIB04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `delete_books` | [LIB05](#LIB05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `list_book_removal_cleanup` | [LIB05](#LIB05) [LIB13](#LIB13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `delete_collection` | [LIB17](#LIB17) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `create_annotation` | [ANN02](#ANN02) [ANN05](#ANN05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `edit_annotation` | [ANN04](#ANN04) [ANN05](#ANN05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `delete_annotation` | [ANN04](#ANN04) [ANN05](#ANN05) [ANN06](#ANN06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `apply_annotation_changes` | [ANN04](#ANN04) [ANN05](#ANN05) [ANN06](#ANN06) [ANN08](#ANN08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `search_memory` | [MEM01](#MEM01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `remember` | [MEM02](#MEM02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_user_profile` | [MEM06](#MEM06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `manage_memory` | [MEM01](#MEM01) [MEM04](#MEM04) [MEM05](#MEM05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `classify_book` | [MEM09](#MEM09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `search_conversation` | [AI01](#AI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_recent_turns` | [AI01](#AI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_conversation_insights` | [MEM12](#MEM12) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_conversation_state` | [AI01](#AI01) [AI02](#AI02) [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `manage_conversation` | [AI02](#AI02) [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `request_conversation_turn` | [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_book_text_status` | [TXT04](#TXT04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_toc` | [TXT01](#TXT01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `read_chapter` | [TXT03](#TXT03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `search_book_text` | [TXT06](#TXT06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `prepare_book_text` | [TXT05](#TXT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_book_text_tasks` | [TXT05](#TXT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `cancel_book_text_task` | [TXT05](#TXT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `query_book_graph` | [MEM11](#MEM11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `manage_book_graph` | [MEM10](#MEM10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `present_books` | [AI05](#AI05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `open_book` | [READ01](#READ01) [READ03](#READ03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_reading_session` | [READ07](#READ07) [TXT09](#TXT09) [TXT10](#TXT10) [READ13](#READ13) [READ16](#READ16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `navigate_reading` | [READ02](#READ02) [READ04](#READ04) [READ06](#READ06) [READ16](#READ16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `control_read_aloud` | [READ18](#READ18) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `configure_reading_mode` | [READ16](#READ16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `set_reader_controls` | [READ09](#READ09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_reader_panels` | [READ10](#READ10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `set_reader_panel` | [READ10](#READ10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `set_reader_panel_width` | [READ11](#READ11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `set_reading_selection` | [READ13](#READ13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `manage_reading_emphasis` | [READ14](#READ14) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_navigation_toc` | [TXT02](#TXT02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `find_book_locations` | [TXT07](#TXT07) [TXT13](#TXT13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `read_book_range` | [TXT10](#TXT10) [TXT13](#TXT13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `list_book_references` | [TXT11](#TXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `read_book_reference` | [TXT11](#TXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `show_book_reference` | [TXT11](#TXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `close_book_reference` | [TXT11](#TXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `ask_user` | [AI04](#AI04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_settings` | [CFG01](#CFG01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `update_settings` | [CFG01](#CFG01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `reset_reading_settings` | [CFG03](#CFG03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Agent book

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `get_host_environment` | [MORE03](#MORE03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_workspace` | [UI01](#UI01) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `navigate_app` | [UI01](#UI01) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `list_host_commands` | [UI03](#UI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `execute_host_command` | [UI03](#UI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `list_installed_plugins` | [EXT11](#EXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `copy_to_clipboard` | [SYS08](#SYS08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `export_text_file` | [SYS10](#SYS10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `open_external_url` | [SYS12](#SYS12) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_sync_status` | [OPS01](#OPS01) [OPS03](#OPS03) [OPS06](#OPS06) [OPS07](#OPS07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `manage_sync` | [OPS01](#OPS01) [OPS04](#OPS04) [OPS06](#OPS06) [OPS07](#OPS07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_software_update` | [SYS16](#SYS16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `open_maintenance_settings` | [SYS15](#SYS15) [SYS16](#SYS16) [EXT12](#EXT12) [OPS08](#OPS08) [OPS09](#OPS09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `list_book_formats` | [LIB07](#LIB07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `pick_resource_files` | [SYS11](#SYS11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `open_book_resource` | [LIB08](#LIB08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `open_book_cover` | [LIB09](#LIB09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `copy_resource_image` | [SYS09](#SYS09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `read_resource_text` | [SYS13](#SYS13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `save_resource` | [SYS10](#SYS10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `release_resource` | [SYS13](#SYS13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_book_enrichment` | [LIB09](#LIB09) [LIB10](#LIB10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `retry_book_enrichment` | [LIB10](#LIB10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_book_overview` | [LIB01](#LIB01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_annotations` | [ANN01](#ANN01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_reading_stats` | [STAT01](#STAT01) [STAT02](#STAT02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_reading_time` | [STAT03](#STAT03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_reading_insights` | [STAT02](#STAT02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `update_book` | [LIB02](#LIB02) [LIB03](#LIB03) [READ19](#READ19) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `delete_book` | [LIB04](#LIB04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `create_annotation` | [ANN02](#ANN02) [ANN05](#ANN05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `edit_annotation` | [ANN04](#ANN04) [ANN05](#ANN05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `delete_annotation` | [ANN04](#ANN04) [ANN05](#ANN05) [ANN06](#ANN06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `apply_annotation_changes` | [ANN04](#ANN04) [ANN05](#ANN05) [ANN06](#ANN06) [ANN08](#ANN08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `search_memory` | [MEM01](#MEM01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `remember` | [MEM02](#MEM02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_user_profile` | [MEM06](#MEM06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `manage_memory` | [MEM01](#MEM01) [MEM04](#MEM04) [MEM05](#MEM05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `classify_book` | [MEM09](#MEM09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `search_conversation` | [AI01](#AI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_recent_turns` | [AI01](#AI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_conversation_state` | [AI01](#AI01) [AI02](#AI02) [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `request_conversation_turn` | [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_book_text_status` | [TXT04](#TXT04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_toc` | [TXT01](#TXT01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `read_chapter` | [TXT03](#TXT03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `search_book_text` | [TXT06](#TXT06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `prepare_book_text` | [TXT05](#TXT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_book_text_tasks` | [TXT05](#TXT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `cancel_book_text_task` | [TXT05](#TXT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `query_book_graph` | [MEM11](#MEM11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `manage_book_graph` | [MEM10](#MEM10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `open_book` | [READ01](#READ01) [READ03](#READ03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_reading_session` | [READ07](#READ07) [TXT09](#TXT09) [TXT10](#TXT10) [READ13](#READ13) [READ16](#READ16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `navigate_reading` | [READ02](#READ02) [READ04](#READ04) [READ06](#READ06) [READ16](#READ16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `control_read_aloud` | [READ18](#READ18) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `configure_reading_mode` | [READ16](#READ16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `set_reader_controls` | [READ09](#READ09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_reader_panels` | [READ10](#READ10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `set_reader_panel` | [READ10](#READ10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `set_reader_panel_width` | [READ11](#READ11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `set_reading_selection` | [READ13](#READ13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `manage_reading_emphasis` | [READ14](#READ14) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_navigation_toc` | [TXT02](#TXT02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `find_book_locations` | [TXT07](#TXT07) [TXT13](#TXT13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `read_book_range` | [TXT10](#TXT10) [TXT13](#TXT13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `list_book_references` | [TXT11](#TXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `read_book_reference` | [TXT11](#TXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `show_book_reference` | [TXT11](#TXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `close_book_reference` | [TXT11](#TXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `ask_user` | [AI04](#AI04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `get_settings` | [CFG01](#CFG01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `update_settings` | [CFG01](#CFG01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `reset_reading_settings` | [CFG03](#CFG03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Plugin ctx

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `domains.settings.queries.snapshot` | [CFG01](#CFG01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.settings.queries.observe` | [CFG10](#CFG10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.settings.queries.discover` | [CFG01](#CFG01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.settings.queries.read` | [CFG01](#CFG01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.settings.commands.resetReading` | [CFG03](#CFG03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.settings.commands.update` | [CFG01](#CFG01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.settings.events.subscribe` | [CFG10](#CFG10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.getNavigationToc` | [TXT02](#TXT02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.listFormats` | [LIB07](#LIB07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.listDuplicates` | [LIB11](#LIB11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.previewMerge` | [LIB11](#LIB11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.resolveId` | [LIB11](#LIB11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.listRemovalCleanup` | [LIB05](#LIB05) [LIB13](#LIB13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.getTextState` | [TXT04](#TXT04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.getEnrichment` | [LIB09](#LIB09) [LIB10](#LIB10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.getTextTask` | [TXT05](#TXT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.listTextTasks` | [TXT05](#TXT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.searchLocations` | [TXT07](#TXT07) [TXT13](#TXT13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.readRange` | [TXT10](#TXT10) [TXT13](#TXT13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.listReferences` | [TXT11](#TXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.readReference` | [TXT11](#TXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.searchText` | [TXT06](#TXT06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.list` | [LIB01](#LIB01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.get` | [LIB01](#LIB01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.getToc` | [TXT01](#TXT01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.getChapterText` | [TXT03](#TXT03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.books.inspectResource` | [LIB07](#LIB07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.collections.list` | [LIB15](#LIB15) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.queries.collections.booksIn` | [LIB15](#LIB15) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.events.subscribe` | [CON07](#CON07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.events.observeTextTask` | [TXT05](#TXT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.events.observeEnrichment` | [LIB09](#LIB09) [LIB10](#LIB10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.books.prepareText` | [TXT05](#TXT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.books.retryEnrichment` | [LIB10](#LIB10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.books.mergeDuplicates` | [LIB11](#LIB11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.books.cancelTextTask` | [TXT05](#TXT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.books.importBook` | [LIB06](#LIB06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.books.importResource` | [LIB06](#LIB06) [SYS11](#SYS11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.books.editMetadata` | [LIB02](#LIB02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.books.setStarred` | [LIB03](#LIB03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.books.remove` | [LIB04](#LIB04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.books.removeMany` | [LIB05](#LIB05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.books.retryRemovalCleanup` | [LIB05](#LIB05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.books.addVirtualBook` | [LIB12](#LIB12) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.books.removeVirtualBook` | [LIB13](#LIB13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.collections.create` | [LIB16](#LIB16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.collections.rename` | [LIB16](#LIB16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.collections.remove` | [LIB17](#LIB17) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.library.commands.collections.assignBooks` | [LIB18](#LIB18) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.queries.emphasis` | [READ14](#READ14) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.queries.session` | [READ07](#READ07) [TXT09](#TXT09) [TXT10](#TXT10) [READ13](#READ13) [READ16](#READ16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.queries.stats.time` | [STAT03](#STAT03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.queries.stats.insights` | [STAT02](#STAT02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.queries.stats.forBook` | [STAT01](#STAT01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.queries.stats.list` | [STAT01](#STAT01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.queries.stats.overview` | [STAT01](#STAT01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.events.subscribe` | [CON07](#CON07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.events.observeSession` | [READ08](#READ08) [READ13](#READ13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.events.observeEmphasis` | [READ14](#READ14) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.events.observeTime` | [STAT03](#STAT03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.setFinished` | [READ19](#READ19) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.putEmphasis` | [READ14](#READ14) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.removeEmphasis` | [READ14](#READ14) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.selectRange` | [READ13](#READ13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.clearSelection` | [READ13](#READ13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.openBook` | [READ01](#READ01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.goTo` | [READ03](#READ03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.back` | [READ06](#READ06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.forward` | [READ06](#READ06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.step` | [READ04](#READ04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.close` | [READ02](#READ02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.controlPlayback` | [READ18](#READ18) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.configureMode` | [READ16](#READ16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.setControls` | [READ09](#READ09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.returnToMode` | [READ16](#READ16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.reading.commands.stepMode` | [READ16](#READ16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.annotations.queries.inspect` | [ANN08](#ANN08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.annotations.queries.page` | [ANN08](#ANN08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.annotations.queries.get` | [ANN08](#ANN08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.annotations.queries.list` | [ANN01](#ANN01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.annotations.events.subscribe` | [ANN09](#ANN09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.annotations.events.observe` | [ANN09](#ANN09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.annotations.commands.createHighlight` | [ANN02](#ANN02) [ANN03](#ANN03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.annotations.commands.applyChanges` | [ANN04](#ANN04) [ANN05](#ANN05) [ANN06](#ANN06) [ANN08](#ANN08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.annotations.commands.createNote` | [ANN05](#ANN05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.conversations.queries.turnRequests` | [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.conversations.queries.runtime` | [AI02](#AI02) [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.conversations.queries.getBookThread` | [AI01](#AI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.conversations.queries.listThreads` | [AI01](#AI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.conversations.queries.getThread` | [AI01](#AI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.conversations.events.observeRuntime` | [AI02](#AI02) [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.conversations.events.subscribe` | [CON07](#CON07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.conversations.commands.requestTurn` | [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.conversations.commands.cancelTurnRequest` | [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.conversations.commands.createThread` | [AI02](#AI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.conversations.commands.selectThread` | [AI02](#AI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.conversations.commands.stop` | [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.conversations.commands.clear` | [AI02](#AI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.memory.queries.search` | [MEM01](#MEM01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.memory.queries.bookGraph` | [MEM11](#MEM11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.memory.queries.profile` | [MEM06](#MEM06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.memory.queries.inspect` | [MEM01](#MEM01) [MEM05](#MEM05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.memory.queries.classification` | [MEM09](#MEM09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.memory.queries.listGraphTasks` | [MEM10](#MEM10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.memory.queries.getGraphTask` | [MEM10](#MEM10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.memory.events.observe` | [MEM01](#MEM01) [MEM04](#MEM04) [MEM05](#MEM05) [MEM09](#MEM09) [MEM10](#MEM10) [MEM11](#MEM11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.memory.commands.mutate` | [MEM04](#MEM04) [MEM05](#MEM05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.memory.commands.classify` | [MEM09](#MEM09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.memory.commands.startGraphTask` | [MEM10](#MEM10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.memory.commands.retryGraphTask` | [MEM10](#MEM10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `domains.memory.commands.cancelGraphTask` | [MEM10](#MEM10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.storage.get` | [SYS01](#SYS01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.storage.set` | [SYS01](#SYS01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.storage.remove` | [SYS01](#SYS01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.storage.flush` | [SYS01](#SYS01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.storage.onChange` | [CFG10](#CFG10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.storage.collection` | [SYS02](#SYS02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.secrets.get` | [SYS04](#SYS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.secrets.set` | [SYS04](#SYS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.secrets.remove` | [SYS04](#SYS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.publishView` | [MORE05](#MORE05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.showToast` | [EXT07](#EXT07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.exportFile` | [SYS10](#SYS10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.commands.observe` | [UI03](#UI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.commands.list` | [UI03](#UI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.commands.execute` | [UI03](#UI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.workspace.snapshot` | [UI01](#UI01) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.workspace.observe` | [UI01](#UI01) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.workspace.navigate` | [UI01](#UI01) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.reader.snapshot` | [READ10](#READ10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.reader.observe` | [READ10](#READ10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.reader.setPanel` | [READ10](#READ10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.reader.setWidth` | [READ11](#READ11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.reader.previewReference` | [TXT11](#TXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.reader.closeReferencePreview` | [TXT11](#TXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.ui.openExternal` | [SYS12](#SYS12) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.schedules.list` | [MORE01](#MORE01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.schedules.observe` | [MORE01](#MORE01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.schedules.control` | [MORE01](#MORE01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.schedules.bind` | [MORE01](#MORE01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.plugins.list` | [EXT11](#EXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.plugins.observe` | [EXT11](#EXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.maintenance.snapshot` | [SYS16](#SYS16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.maintenance.observe` | [SYS16](#SYS16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.maintenance.openSettings` | [SYS15](#SYS15) [SYS16](#SYS16) [EXT12](#EXT12) [OPS08](#OPS08) [OPS09](#OPS09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.maintenance.checkForUpdates` | [SYS16](#SYS16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.resources.pick` | [SYS11](#SYS11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.resources.openBook` | [LIB08](#LIB08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.resources.openCover` | [LIB09](#LIB09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.resources.create` | [SYS13](#SYS13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.resources.stat` | [SYS13](#SYS13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.resources.read` | [SYS13](#SYS13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.resources.append` | [SYS13](#SYS13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.resources.commit` | [SYS13](#SYS13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.resources.save` | [SYS10](#SYS10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.resources.release` | [SYS13](#SYS13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.session.environment` | [MORE03](#MORE03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.session.observeEnvironment` | [MORE03](#MORE03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.sync.snapshot` | [OPS01](#OPS01) [OPS03](#OPS03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.sync.backlog` | [OPS01](#OPS01) [OPS03](#OPS03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.sync.account` | [OPS06](#OPS06) [OPS07](#OPS07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.sync.requestSync` | [OPS01](#OPS01) [OPS03](#OPS03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.sync.openSettings` | [OPS01](#OPS01) [OPS04](#OPS04) [OPS06](#OPS06) [OPS07](#OPS07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.sync.observe` | [OPS01](#OPS01) [OPS03](#OPS03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.network.fetch` | [SYS06](#SYS06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.llm.ask` | [AI06](#AI06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.clipboard.writeImage` | [SYS09](#SYS09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `services.clipboard.writeText` | [SYS08](#SYS08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contributions.selectionActions.register` | [EXT01](#EXT01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contributions.headerActions.register` | [EXT02](#EXT02) [MORE04](#MORE04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contributions.contextActions.register` | [MORE04](#MORE04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contributions.commands.register` | [UI03](#UI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contributions.settingsOptions.register` | [CFG09](#CFG09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contributions.voiceProviders.register` | [READ17](#READ17) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contributions.contentProviders.register` | [LIB14](#LIB14) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contributions.readerModes.register` | [READ15](#READ15) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contributions.agentTools.register` | [AI10](#AI10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contributions.agentContextProviders.register` | [AI11](#AI11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contributions.agentRetrievalProviders.register` | [AI12](#AI12) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contributions.memoryCandidateProviders.register` | [MEM03](#MEM03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contributions.syncTransports.register` | [OPS04](#OPS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Plugin returned interface

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `storage.collection().put` | [SYS02](#SYS02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `storage.collection().get` | [SYS02](#SYS02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `storage.collection().delete` | [SYS02](#SYS02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `storage.collection().list` | [SYS02](#SYS02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `syncTransport.open().endpointId` | [OPS04](#OPS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `syncTransport.open().close` | [OPS04](#OPS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `syncTransport.open().probe` | [OPS04](#OPS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `syncTransport.open().getMeta` | [OPS04](#OPS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `syncTransport.open().putMetaIfAbsent` | [OPS04](#OPS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `syncTransport.open().listEventBatches` | [OPS04](#OPS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `syncTransport.open().getEventBatch` | [OPS04](#OPS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `syncTransport.open().putEventBatch` | [OPS04](#OPS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `syncTransport.open().putBlob` | [OPS04](#OPS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `syncTransport.open().getBlob` | [OPS04](#OPS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `syncTransport.open().putBlobPart` | [OPS04](#OPS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `syncTransport.open().commitBlob` | [OPS04](#OPS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `syncTransport.open().getBlobPart` | [OPS04](#OPS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contributions.commands.register().dispose` | [MORE05](#MORE05) | [代码] 精确注册句柄；不是按公开 ID 更新其他注册或增加权限 |
| `contributions.commands.register().updateState` | [MORE05](#MORE05) | [代码] 精确注册句柄；不是按公开 ID 更新其他注册或增加权限 |
| `contributions.headerActions.register().dispose` | [MORE05](#MORE05) | [代码] 精确注册句柄；不是按公开 ID 更新其他注册或增加权限 |
| `contributions.headerActions.register().updateState` | [MORE05](#MORE05) | [代码] 精确注册句柄；不是按公开 ID 更新其他注册或增加权限 |
| `contributions.contextActions.register().dispose` | [MORE05](#MORE05) | [代码] 精确注册句柄；不是按公开 ID 更新其他注册或增加权限 |
| `contributions.contextActions.register().updateState` | [MORE05](#MORE05) | [代码] 精确注册句柄；不是按公开 ID 更新其他注册或增加权限 |
| `contributions.selectionActions.register().dispose` | [MORE05](#MORE05) | [代码] 精确注册句柄；不是按公开 ID 更新其他注册或增加权限 |
| `contributions.selectionActions.register().updateState` | [MORE05](#MORE05) | [代码] 精确注册句柄；不是按公开 ID 更新其他注册或增加权限 |
| `contributions.agentTools.register().dispose` | [MORE05](#MORE05) | [代码] 精确注册句柄；不是按公开 ID 更新其他注册或增加权限 |
| `contributions.agentTools.register().updateState` | [MORE05](#MORE05) | [代码] 精确注册句柄；不是按公开 ID 更新其他注册或增加权限 |

### Capability domains

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `library` | [LIB01](#LIB01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `reading` | [STAT01](#STAT01) [READ01](#READ01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `annotations` | [ANN01](#ANN01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `conversations` | [AI01](#AI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `settings` | [CFG01](#CFG01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `memory` | [MEM01](#MEM01) [MEM11](#MEM11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Capability contributions

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `selectionActions` | [EXT01](#EXT01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `headerActions` | [EXT02](#EXT02) [MORE04](#MORE04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contextActions` | [MORE04](#MORE04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `commands` | [UI03](#UI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `settingsOptions` | [CFG09](#CFG09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `voiceProviders` | [READ17](#READ17) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `contentProviders` | [LIB14](#LIB14) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `readerModes` | [READ15](#READ15) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `agentTools` | [AI10](#AI10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `agentContextProviders` | [AI11](#AI11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `agentRetrievalProviders` | [AI12](#AI12) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `memoryCandidateProviders` | [MEM03](#MEM03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `themes` | [EXT08](#EXT08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `fonts` | [EXT08](#EXT08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `syncTransports` | [OPS04](#OPS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Capability services

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `storage` | [SYS01](#SYS01) [SYS02](#SYS02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `secrets` | [SYS04](#SYS04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `ui` | [EXT07](#EXT07) [SYS10](#SYS10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `schedules` | [MORE01](#MORE01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `session` | [MORE03](#MORE03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `plugins` | [EXT11](#EXT11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `maintenance` | [SYS15](#SYS15) [SYS16](#SYS16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `resources` | [SYS11](#SYS11) [SYS13](#SYS13) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `sync` | [OPS01](#OPS01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `network` | [SYS06](#SYS06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `llm` | [AI06](#AI06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `clipboard` | [SYS08](#SYS08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Capability schemas

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `views` | [EXT03](#EXT03) [EXT04](#EXT04) [EXT05](#EXT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `settings` | [CFG09](#CFG09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `themes` | [EXT08](#EXT08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Settings path

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `appearance.contentTypography.followReader` | [SET50](#SET50) | [代码] 目录可读写；实际效果见主表 |
| `appearance.contentTypography.fontFamily` | [SET51](#SET51) | [代码] 目录可读写；实际效果见主表 |
| `appearance.contentTypography.fontSize` | [SET52](#SET52) | [代码] 目录可读写；实际效果见主表 |
| `appearance.contentTypography.lineSpacing` | [SET53](#SET53) | [代码] 目录可读写；实际效果见主表 |
| `annotations.defaultColor` | [SET54](#SET54) | [代码] 目录可读写；实际效果见主表 |
| `general.updateChannel` | [SET55](#SET55) | [代码] 目录可读写；实际效果见主表 |
| `shelf.layout` | [SET56](#SET56) | [代码] 目录可读写；实际效果见主表 |
| `shelf.group` | [SET57](#SET57) | [代码] 目录可读写；实际效果见主表 |
| `shelf.sort` | [SET58](#SET58) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.search` | [SET59](#SET59) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.settings` | [SET60](#SET60) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.new-conversation` | [SET61](#SET61) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.next-page` | [SET62](#SET62) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.prev-page` | [SET63](#SET63) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.next-chapter` | [SET64](#SET64) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.prev-chapter` | [SET65](#SET65) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.toggle-controls` | [SET66](#SET66) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.reader-mode-next-unit` | [SET67](#SET67) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.reader-mode-prev-unit` | [SET68](#SET68) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.selection-copy` | [SET69](#SET69) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.selection-highlight` | [SET70](#SET70) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.selection-underline` | [SET71](#SET71) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.selection-add-note` | [SET72](#SET72) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.selection-look-up` | [SET73](#SET73) | [代码] 目录可读写；实际效果见主表 |
| `shortcuts.selection-ask-ai` | [SET74](#SET74) | [代码] 目录可读写；实际效果见主表 |
| `general.startView` | [SET01](#SET01) | [代码] 目录可读写；实际效果见主表 |
| `general.language` | [SET02](#SET02) | [代码] 目录可读写；实际效果见主表 |
| `general.crashPrompt` | [SET03](#SET03) | [代码] 目录可读写；实际效果见主表 |
| `general.launchAtStartup` | [SET04](#SET04) | [代码] 目录可读写；实际效果见主表 |
| `general.fileAssociations` | [SET05](#SET05) | [代码] 目录可读写；实际效果见主表 |
| `general.autoUpdate` | [SET06](#SET06) | [代码] 目录可读写；实际效果见主表 |
| `general.whatsNewDialog` | [SET49](#SET49) | [代码] 目录可读写；实际效果见主表 |
| `appearance.theme` | [SET07](#SET07) | [代码] 目录可读写；实际效果见主表 |
| `appearance.motion` | [SET08](#SET08) | [代码] 目录可读写；实际效果见主表 |
| `reading.theme` | [SET09](#SET09) | [代码] 目录可读写；实际效果见主表 |
| `reading.fontFamily` | [SET10](#SET10) | [代码] 目录可读写；实际效果见主表 |
| `reading.textAlign` | [SET47](#SET47) | [代码] 目录可读写；实际效果见主表 |
| `reading.fixedLayoutColor` | [SET48](#SET48) | [代码] 目录可读写；实际效果见主表 |
| `reading.fontSize` | [SET11](#SET11) | [代码] 目录可读写；实际效果见主表 |
| `reading.fontWeight` | [SET12](#SET12) | [代码] 目录可读写；实际效果见主表 |
| `reading.lineSpacing` | [SET13](#SET13) | [代码] 目录可读写；实际效果见主表 |
| `reading.paragraphSpacing` | [SET14](#SET14) | [代码] 目录可读写；实际效果见主表 |
| `reading.pageMargins` | [SET15](#SET15) | [代码] 目录可读写；实际效果见主表 |
| `reading.readingMode` | [SET16](#SET16) | [代码] 目录可读写；实际效果见主表 |
| `reading.fixedLayoutReadingMode` | [SET17](#SET17) | [代码] 目录可读写；实际效果见主表 |
| `ai.preferences.features.explainSelection` | [SET18](#SET18) | [代码] 目录可读写；实际效果见主表 |
| `ai.preferences.features.defineTerm` | [SET19](#SET19) | [代码] 目录可读写；实际效果见主表 |
| `ai.preferences.features.translate` | [SET20](#SET20) | [代码] 目录可读写；实际效果见主表 |
| `ai.preferences.features.summarizeChapter` | [SET21](#SET21) | [代码] 目录可读写；实际效果见主表 |
| `ai.preferences.features.askConversation` | [SET22](#SET22) | [代码] 目录可读写；实际效果见主表 |
| `ai.preferences.buildMemory` | [SET23](#SET23) | [代码] 目录可读写；实际效果见主表 |
| `ai.preferences.sendHighlightedText` | [SET24](#SET24) | [代码] 目录可读写；实际效果见主表 |
| `ai.preferences.sendSurroundingContext` | [SET25](#SET25) | [代码] 目录可读写；实际效果见主表 |
| `ai.preferences.localOnly` | [SET26](#SET26) | [代码] 目录可读写；实际效果见主表 |
| `ai.preferences.followStreaming` | [SET27](#SET27) | [代码] 目录可读写；实际效果见主表 |
| `ai.connection.configured` | [SET28](#SET28) | [代码] 只读状态 |
| `ai.connection.credentialConfigured` | [SET29](#SET29) | [代码] 只读状态 |
| `menus.primaryNav.visible` | [SET30](#SET30) | [代码] 目录可读写；实际效果见主表 |
| `menus.primaryNav.overflow` | [SET31](#SET31) | [代码] 目录可读写；实际效果见主表 |
| `menus.shelfHeader.visible` | [SET32](#SET32) | [代码] 目录可读写；实际效果见主表 |
| `menus.shelfHeader.overflow` | [SET33](#SET33) | [代码] 目录可读写；实际效果见主表 |
| `menus.readerHeader.visible` | [SET34](#SET34) | [代码] 目录可读写；实际效果见主表 |
| `menus.readerHeader.overflow` | [SET35](#SET35) | [代码] 目录可读写；实际效果见主表 |
| `menus.selection.visible` | [SET36](#SET36) | [代码] 目录可读写；实际效果见主表 |
| `menus.selection.overflow` | [SET37](#SET37) | [代码] 目录可读写；实际效果见主表 |
| `ai.connection.provider` | [SET38](#SET38) | [代码] 只读状态 |
| `ai.connection.primaryModel` | [SET39](#SET39) | [代码] 目录可读写；实际效果见主表 |
| `ai.connection.fastModel` | [SET40](#SET40) | [代码] 目录可读写；实际效果见主表 |
| `ai.connection.thinkingLevel` | [SET41](#SET41) | [代码] 目录可读写；实际效果见主表 |
| `ai.connection.fastThinkingLevel` | [SET42](#SET42) | [代码] 目录可读写；实际效果见主表 |
| `ai.connection.custom.endpointConfigured` | [SET43](#SET43) | [代码] 只读状态 |
| `ai.connection.custom.api` | [SET44](#SET44) | [代码] 目录可读写；实际效果见主表 |
| `ai.connection.custom.supportsThinking` | [SET45](#SET45) | [代码] 目录可读写；实际效果见主表 |
| `ai.connection.custom.maxOutputTokens` | [SET46](#SET46) | [代码] 目录可读写；实际效果见主表 |

### Native command

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `import::library_stage_import` | [LIB06](#LIB06) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `covers::library_put_cover` | [LIB09](#LIB09) [LIB10](#LIB10) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `covers::library_cover_backlog` | [LIB09](#LIB09) [LIB10](#LIB10) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::append_events` | [OPS11](#OPS11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::commit_events` | [OPS11](#OPS11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::apply_remote_events` | [OPS02](#OPS02) [OPS05](#OPS05) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::stage_remote_events` | [OPS02](#OPS02) [OPS05](#OPS05) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::finalize_staged_events` | [OPS02](#OPS02) [OPS05](#OPS05) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::rebuild_projections` | [OPS11](#OPS11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::verify_projections` | [OPS11](#OPS11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::read_events_since` | [OPS11](#OPS11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::list_event_aggregate_ids` | [OPS11](#OPS11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::local_device_get` | [OPS01](#OPS01) [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_profile_get` | [OPS01](#OPS01) [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_profile_set` | [OPS01](#OPS01) [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_profile_touch` | [OPS01](#OPS01) [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_adopt_account` | [OPS01](#OPS01) [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_outbox_counts` | [OPS01](#OPS01) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_unverified_events` | [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_resolve_events` | [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_assume_events_missing` | [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_unverified_blobs` | [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_resolve_blobs` | [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_assume_blobs_missing` | [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::checkpoint_schema_version` | [OPS03](#OPS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::checkpoint_list` | [OPS03](#OPS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::checkpoint_maintain` | [OPS03](#OPS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::checkpoint_prepare_publish` | [OPS03](#OPS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::checkpoint_mark_published` | [OPS03](#OPS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::checkpoint_restore_bootstrap` | [OPS03](#OPS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_backfill_status` | [OPS03](#OPS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_backfill_events` | [OPS03](#OPS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_backfill_settle` | [OPS03](#OPS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_book_backlog` | [OPS01](#OPS01) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::preferences_load_all` | [OPS05](#OPS05) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::wipe_all_data` | [OPS09](#OPS09) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_cursor_get` | [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_cursor_set` | [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_outbox_events` | [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_mark_events_pushed` | [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_mark_events_failed` | [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_outbox_blobs` | [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_mark_blobs_pushed` | [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_mark_blobs_failed` | [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_mark_blobs_rejected` | [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_quota_rejected_blobs` | [OPS01](#OPS01) [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::sync_requeue_blobs` | [OPS01](#OPS01) [OPS02](#OPS02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::put_blob` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::get_blob` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::get_blob_info` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::get_blob_range` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::delete_blob` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::blob_read_open` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::blob_read_chunk` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::blob_read_close` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::blob_write_open` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::blob_write_chunk` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::blob_write_chunk_raw` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::blob_write_commit` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::blob_write_abort` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `secrets::secret_get` | [SYS04](#SYS04) [CFG07](#CFG07) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `secrets::secret_keys` | [SYS04](#SYS04) [CFG07](#CFG07) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `secrets::secret_set` | [SYS04](#SYS04) [CFG07](#CFG07) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `secrets::secret_delete` | [SYS04](#SYS04) [CFG07](#CFG07) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::load_kv_all` | [SYS01](#SYS01) [CFG01](#CFG01) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::set_kv` | [SYS01](#SYS01) [CFG01](#CFG01) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::set_kv_batch` | [SYS01](#SYS01) [CFG01](#CFG01) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::delete_kv` | [SYS01](#SYS01) [CFG01](#CFG01) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::replace_kv_prefix` | [SYS01](#SYS01) [CFG01](#CFG01) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::library_load` | [LIB01](#LIB01) [LIB02](#LIB02) [OPS11](#OPS11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::library_get_book` | [LIB01](#LIB01) [LIB02](#LIB02) [OPS11](#OPS11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::library_put_book` | [LIB01](#LIB01) [LIB02](#LIB02) [OPS11](#OPS11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::library_release_book_files` | [LIB04](#LIB04) [LIB05](#LIB05) [LIB13](#LIB13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::library_list_removal_cleanup` | [LIB05](#LIB05) [LIB13](#LIB13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::library_list_collections` | [LIB15](#LIB15) [LIB16](#LIB16) [LIB17](#LIB17) [LIB18](#LIB18) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::library_put_collection` | [LIB15](#LIB15) [LIB16](#LIB16) [LIB17](#LIB17) [LIB18](#LIB18) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::library_duplicate_book_groups` | [LIB11](#LIB11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::library_duplicate_groups` | [LIB11](#LIB11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::library_merge_preview` | [LIB11](#LIB11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::library_merge_commit` | [LIB11](#LIB11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::library_resolve_book` | [LIB11](#LIB11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::annotations_list` | [ANN01](#ANN01) [ANN08](#ANN08) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::annotations_search` | [ANN01](#ANN01) [ANN08](#ANN08) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::annotations_page` | [ANN01](#ANN01) [ANN08](#ANN08) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::annotation_inspect` | [ANN08](#ANN08) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::annotations_commit` | [ANN08](#ANN08) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::annotation_get` | [ANN01](#ANN01) [ANN08](#ANN08) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::annotation_put` | [ANN01](#ANN01) [ANN08](#ANN08) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::annotation_delete` | [ANN01](#ANN01) [ANN08](#ANN08) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::memories_list_all` | [MEM01](#MEM01) [MEM02](#MEM02) [MEM04](#MEM04) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::memory_inspect` | [MEM01](#MEM01) [MEM04](#MEM04) [MEM05](#MEM05) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::memory_commit` | [MEM01](#MEM01) [MEM04](#MEM04) [MEM05](#MEM05) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::book_classification_inspect` | [MEM09](#MEM09) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::book_classification_commit` | [MEM09](#MEM09) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::book_digest_inspect` | [MEM10](#MEM10) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::book_digest_commit` | [MEM10](#MEM10) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::memories_snapshot` | [MEM02](#MEM02) [MEM04](#MEM04) [MEM05](#MEM05) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::memory_maintenance_commit` | [MEM02](#MEM02) [MEM04](#MEM04) [MEM05](#MEM05) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::chapter_digests_list` | [MEM10](#MEM10) [MEM11](#MEM11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::memory_get` | [MEM01](#MEM01) [MEM02](#MEM02) [MEM04](#MEM04) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::memory_put` | [MEM01](#MEM01) [MEM02](#MEM02) [MEM04](#MEM04) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::ai_chat_load` | [AI01](#AI01) [AI02](#AI02) [AI03](#AI03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::ai_chat_load_all` | [AI01](#AI01) [AI02](#AI02) [AI03](#AI03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::ai_chat_list` | [AI01](#AI01) [AI02](#AI02) [AI03](#AI03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::ai_chat_replace` | [AI01](#AI01) [AI02](#AI02) [AI03](#AI03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::ai_chat_clear` | [AI01](#AI01) [AI02](#AI02) [AI03](#AI03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::plugin_docs_put` | [SYS02](#SYS02) [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::plugin_docs_get` | [SYS02](#SYS02) [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::plugin_docs_delete` | [SYS02](#SYS02) [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::plugin_docs_list` | [SYS02](#SYS02) [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::plugin_docs_clear` | [SYS02](#SYS02) [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::plugin_docs_snapshot` | [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::plugin_docs_restore` | [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::vocabulary_migrate_to_plugin_documents` | [SYS02](#SYS02) [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::reading_time_genesis` | [STAT03](#STAT03) [STAT04](#STAT04) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::reading_time_load` | [STAT03](#STAT03) [STAT04](#STAT04) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::reading_time_snapshot` | [STAT03](#STAT03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::reading_time_scope` | [STAT02](#STAT02) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::reading_session_accrue` | [STAT03](#STAT03) [STAT04](#STAT04) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::reading_session_position` | [STAT03](#STAT03) [STAT04](#STAT04) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::reading_sessions_pending` | [STAT03](#STAT03) [STAT04](#STAT04) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::reading_session_flush` | [STAT03](#STAT03) [STAT04](#STAT04) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storage::reading_time_import` | [STAT03](#STAT03) [STAT04](#STAT04) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `external_open::external_open_take` | [SYS12](#SYS12) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `diagnostics::diagnostics_read_logs` | [SYS15](#SYS15) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `diagnostics::diagnostics_log_dir` | [SYS15](#SYS15) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `book_file_size` | [LIB06](#LIB06) [SYS11](#SYS11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `read_book_head` | [LIB06](#LIB06) [SYS11](#SYS11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `write_export_file` | [SYS10](#SYS10) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `resources::resource_open_file` | [SYS11](#SYS11) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `resources::resource_open_book` | [LIB08](#LIB08) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `resources::resource_open_cover` | [LIB09](#LIB09) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `resource_images::resource_copy_image` | [SYS09](#SYS09) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `resources::resource_create` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `resources::resource_append` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `resources::resource_commit` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `resources::resource_read` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `resources::resource_save` | [SYS10](#SYS10) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `resources::resource_release` | [SYS13](#SYS13) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `android_update::android_update_check` | [SYS18](#SYS18) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `android_update::android_update_install` | [SYS18](#SYS18) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `desktop_update::desktop_update_check` | [SYS16](#SYS16) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `desktop_update::desktop_update_install` | [SYS16](#SYS16) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `set_status_bar_hidden` | [SYS18](#SYS18) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `sync_safe_area` | [SYS18](#SYS18) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `set_volume_key_capture` | [SYS18](#SYS18) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `storefront::app_store_storefront` | [SYS18](#SYS18) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `move_task_to_back` | [SYS18](#SYS18) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `book_pick_start` | [SYS18](#SYS18) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `book_pick_poll` | [SYS18](#SYS18) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `set_traffic_lights_visible` | [SYS17](#SYS17) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `list_system_fonts` | [SYS14](#SYS14) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `plugins::plugins_list` | [EXT11](#EXT11) [EXT12](#EXT12) [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `plugins::plugins_stage_dir` | [EXT11](#EXT11) [EXT12](#EXT12) [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `plugins::plugins_stage_zip` | [EXT11](#EXT11) [EXT12](#EXT12) [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `plugins::plugins_stage_files` | [EXT11](#EXT11) [EXT12](#EXT12) [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `plugins::plugins_commit_candidate` | [EXT11](#EXT11) [EXT12](#EXT12) [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `plugins::plugins_discard_candidate` | [EXT11](#EXT11) [EXT12](#EXT12) [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `plugins::plugins_rollback` | [EXT11](#EXT11) [EXT12](#EXT12) [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |
| `plugins::plugins_uninstall` | [EXT11](#EXT11) [EXT12](#EXT12) [SYS03](#SYS03) | [代码] 内部 IPC 能力证据；不是插件或模型授权入口 |

### Native plugin

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `single_instance` | [SYS17](#SYS17) [SYS12](#SYS12) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `decorum` | [SYS17](#SYS17) [SYS12](#SYS12) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `updater` | [SYS16](#SYS16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `process` | [SYS16](#SYS16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `dialog` | [SYS11](#SYS11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `deep_link` | [SYS12](#SYS12) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `fs` | [SYS11](#SYS11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `opener` | [SYS12](#SYS12) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `clipboard_manager` | [SYS08](#SYS08) [SYS09](#SYS09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `http` | [SYS06](#SYS06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `log (build_log_plugin)` | [SYS15](#SYS15) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Menu placement

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `core:library` | [UI01](#UI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `core:agent` | [UI01](#UI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `core:stats` | [UI01](#UI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `core:search` | [UI03](#UI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `core:import` | [LIB06](#LIB06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `core:viewControl` | [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `core:stats` | [UI01](#UI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `core:settings` | [UI01](#UI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `core:navigator` | [READ10](#READ10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `core:appearance` | [READ10](#READ10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `core:chat` | [READ10](#READ10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `core:copy` | [SYS08](#SYS08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `core:highlight` | [ANN02](#ANN02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `core:underline` | [ANN03](#ANN03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `core:addNote` | [ANN05](#ANN05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `core:askAI` | [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Shortcut

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `search` | [UI03](#UI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `settings` | [UI03](#UI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `new-conversation` | [AI02](#AI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `next-page` | [READ04](#READ04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `prev-page` | [READ04](#READ04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `next-chapter` | [READ04](#READ04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `prev-chapter` | [READ04](#READ04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `toggle-controls` | [READ09](#READ09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `reader-mode-next-unit` | [READ16](#READ16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `reader-mode-prev-unit` | [READ16](#READ16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `selection-copy` | [SYS08](#SYS08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `selection-highlight` | [ANN02](#ANN02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `selection-underline` | [ANN03](#ANN03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `selection-add-note` | [ANN05](#ANN05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `selection-look-up` | [EXT09](#EXT09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `selection-ask-ai` | [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `primary-nav` | [UI01](#UI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `reader-mode-volume-keys` | [SYS18](#SYS18) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `close` | [UI01](#UI01) [READ02](#READ02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### App event

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `reader-demand-activity` | [TXT05](#TXT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book-removed` | [CON07](#CON07) [LIB01](#LIB01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `library-changed` | [CON07](#CON07) [LIB01](#LIB01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book-changed` | [CON07](#CON07) [LIB01](#LIB01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `plugin-storage-changed` | [SYS01](#SYS01) [CFG10](#CFG10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `roaming-preferences-changed` | [OPS05](#OPS05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `conversations-changed` | [AI01](#AI01) [OPS05](#OPS05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `local-write-failed` | [SYS01](#SYS01) [CFG10](#CFG10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Command action

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `importBook` | [LIB06](#LIB06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Host semantic command

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `go-shelf` | [UI03](#UI03) [UI01](#UI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `go-context` | [UI03](#UI03) [UI01](#UI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `go-stats` | [UI03](#UI03) [UI01](#UI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `open-settings` | [UI03](#UI03) [UI01](#UI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `select` | [UI03](#UI03) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `layout-grid` | [UI03](#UI03) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `layout-list` | [UI03](#UI03) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `sort-recent` | [UI03](#UI03) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `sort-added` | [UI03](#UI03) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `sort-title` | [UI03](#UI03) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `sort-author` | [UI03](#UI03) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `sort-progress` | [UI03](#UI03) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `group-none` | [UI03](#UI03) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `group-status` | [UI03](#UI03) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `group-author` | [UI03](#UI03) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `group-format` | [UI03](#UI03) [UI02](#UI02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `open-book` | [UI03](#UI03) [READ01](#READ01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `open-collection` | [UI03](#UI03) [UI01](#UI01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Canonical event

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `book.imported` | [LIB06](#LIB06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.metadataEdited` | [LIB02](#LIB02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.coverExtracted` | [LIB09](#LIB09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.chapterDigested` | [MEM10](#MEM10) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.narrativityClassified` | [MEM09](#MEM09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.merged` | [LIB11](#LIB11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.opened` | [READ01](#READ01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.starred` | [LIB03](#LIB03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.finished` | [READ19](#READ19) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.removed` | [LIB04](#LIB04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `collection.created` | [LIB16](#LIB16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `collection.renamed` | [LIB16](#LIB16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `collection.removed` | [LIB17](#LIB17) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.addedToCollection` | [LIB18](#LIB18) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.removedFromCollection` | [LIB18](#LIB18) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.progressed` | [STAT04](#STAT04) [STAT05](#STAT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.timeRecorded` | [STAT04](#STAT04) [STAT05](#STAT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.sessionRecorded` | [STAT04](#STAT04) [STAT05](#STAT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `highlight.created` | [ANN02](#ANN02) [ANN03](#ANN03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `highlight.recolored` | [ANN04](#ANN04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `highlight.removed` | [ANN04](#ANN04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `note.created` | [ANN05](#ANN05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `note.updated` | [ANN05](#ANN05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `note.removed` | [ANN05](#ANN05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `ask.recorded` | [ANN06](#ANN06) [ANN07](#ANN07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `ask.removed` | [ANN06](#ANN06) [ANN07](#ANN07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `aiConversation.started` | [AI01](#AI01) [AI02](#AI02) [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `aiMessage.appended` | [AI01](#AI01) [AI02](#AI02) [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `aiMessage.removed` | [AI01](#AI01) [AI02](#AI02) [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `aiConversation.cleared` | [AI01](#AI01) [AI02](#AI02) [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `profile.updated` | [MEM08](#MEM08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `entity.resolved` | [MEM08](#MEM08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `entity.merged` | [MEM08](#MEM08) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `memory.promoted` | [MEM02](#MEM02) [MEM03](#MEM03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `memory.revised` | [MEM04](#MEM04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `memory.superseded` | [MEM04](#MEM04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `memory.feedback` | [MEM05](#MEM05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `memory.forgotten` | [MEM04](#MEM04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `preference.changed` | [OPS05](#OPS05) [CFG01](#CFG01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Domain subscription LIBRARY_EVENTS

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `book.imported` | [LIB06](#LIB06) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.metadataEdited` | [LIB02](#LIB02) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.coverExtracted` | [LIB09](#LIB09) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.merged` | [LIB11](#LIB11) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.starred` | [LIB03](#LIB03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.removed` | [LIB04](#LIB04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `collection.created` | [LIB16](#LIB16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `collection.renamed` | [LIB16](#LIB16) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `collection.removed` | [LIB17](#LIB17) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.addedToCollection` | [LIB18](#LIB18) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.removedFromCollection` | [LIB18](#LIB18) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Domain subscription READING_EVENTS

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `book.opened` | [READ01](#READ01) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.finished` | [READ19](#READ19) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.progressed` | [STAT04](#STAT04) [STAT05](#STAT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.timeRecorded` | [STAT04](#STAT04) [STAT05](#STAT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `book.sessionRecorded` | [STAT04](#STAT04) [STAT05](#STAT05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Domain subscription ANNOTATION_EVENTS

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `highlight.created` | [ANN02](#ANN02) [ANN03](#ANN03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `highlight.recolored` | [ANN04](#ANN04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `highlight.removed` | [ANN04](#ANN04) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `note.created` | [ANN05](#ANN05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `note.updated` | [ANN05](#ANN05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `note.removed` | [ANN05](#ANN05) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `ask.recorded` | [ANN06](#ANN06) [ANN07](#ANN07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `ask.removed` | [ANN06](#ANN06) [ANN07](#ANN07) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Domain subscription CONVERSATION_EVENTS

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `aiConversation.started` | [AI01](#AI01) [AI02](#AI02) [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `aiMessage.appended` | [AI01](#AI01) [AI02](#AI02) [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `aiMessage.removed` | [AI01](#AI01) [AI02](#AI02) [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |
| `aiConversation.cleared` | [AI01](#AI01) [AI02](#AI02) [AI03](#AI03) | [代码] 注册库存已映射，不表示产品 E2E 通过 |

### Feature owner

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `reader` | [READ01](#READ01) [TXT01](#TXT01) | [代码+人工审计] 所属功能组入口；目录覆盖不等于每个 UI 分支测试通过 |
| `settings` | [CFG01](#CFG01) [OPS08](#OPS08) | [代码+人工审计] 所属功能组入口；目录覆盖不等于每个 UI 分支测试通过 |
| `update` | [SYS16](#SYS16) | [代码+人工审计] 所属功能组入口；目录覆盖不等于每个 UI 分支测试通过 |
| `plugins` | [EXT01](#EXT01) [CON03](#CON03) | [代码+人工审计] 所属功能组入口；目录覆盖不等于每个 UI 分支测试通过 |
| `navigation` | [UI01](#UI01) [SYS17](#SYS17) | [代码+人工审计] 所属功能组入口；目录覆盖不等于每个 UI 分支测试通过 |
| `library` | [LIB01](#LIB01) [UI02](#UI02) | [代码+人工审计] 所属功能组入口；目录覆盖不等于每个 UI 分支测试通过 |
| `agent` | [AI01](#AI01) [AI03](#AI03) [MEM01](#MEM01) | [代码+人工审计] 所属功能组入口；目录覆盖不等于每个 UI 分支测试通过 |
| `annotations` | [ANN01](#ANN01) | [代码+人工审计] 所属功能组入口；目录覆盖不等于每个 UI 分支测试通过 |
| `ai` | [AI01](#AI01) [AI03](#AI03) [MEM01](#MEM01) | [代码+人工审计] 所属功能组入口；目录覆盖不等于每个 UI 分支测试通过 |
| `menus` | [UI05](#UI05) | [代码+人工审计] 所属功能组入口；目录覆盖不等于每个 UI 分支测试通过 |
| `command` | [UI03](#UI03) | [代码+人工审计] 所属功能组入口；目录覆盖不等于每个 UI 分支测试通过 |
| `shelf` | [LIB01](#LIB01) [UI02](#UI02) | [代码+人工审计] 所属功能组入口；目录覆盖不等于每个 UI 分支测试通过 |
| `sync` | [OPS01](#OPS01) | [代码+人工审计] 所属功能组入口；目录覆盖不等于每个 UI 分支测试通过 |
| `stats` | [STAT01](#STAT01) | [代码+人工审计] 所属功能组入口；目录覆盖不等于每个 UI 分支测试通过 |

### First-party source plugin

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `annotation-desk` | [ANN01](#ANN01) [ANN04](#ANN04) [ANN05](#ANN05) [ANN08](#ANN08) [ANN09](#ANN09) [EXT02](#EXT02) [EXT05](#EXT05) [SYS10](#SYS10) | [代码] 源码版本 0.3.0；源码存在不等于打包、安装、启用或模型可调用 |
| `dictionary` | [EXT09](#EXT09) [AI12](#AI12) [READ07](#READ07) [LIB01](#LIB01) | [代码] 源码版本 1.3.0；源码存在不等于打包、安装、启用或模型可调用 |
| `editorial-themes` | [EXT08](#EXT08) | [代码] 源码版本 1.0.0；源码存在不等于打包、安装、启用或模型可调用 |
| `jumper` | [TXT02](#TXT02) [TXT07](#TXT07) [READ06](#READ06) [EXT02](#EXT02) | [代码] 源码版本 0.2.0；源码存在不等于打包、安装、启用或模型可调用 |
| `library-desk` | [LIB01](#LIB01) [LIB05](#LIB05) [READ01](#READ01) [UI01](#UI01) [UI02](#UI02) [UI03](#UI03) [EXT02](#EXT02) [EXT03](#EXT03) [MORE05](#MORE05) | [代码] 源码版本 0.6.0；源码存在不等于打包、安装、启用或模型可调用 |
| `listening-desk` | [READ16](#READ16) [READ18](#READ18) [READ06](#READ06) [EXT02](#EXT02) [MORE03](#MORE03) | [代码] 源码版本 0.9.0；源码存在不等于打包、安装、启用或模型可调用 |
| `memory-desk` | [MEM01](#MEM01) [MEM04](#MEM04) [MEM05](#MEM05) [MEM09](#MEM09) [MEM10](#MEM10) [MEM11](#MEM11) [READ01](#READ01) [EXT02](#EXT02) [EXT05](#EXT05) | [代码] 源码版本 0.6.0；源码存在不等于打包、安装、启用或模型可调用 |
| `reading-goals` | [AI11](#AI11) [MEM03](#MEM03) [SET23](#SET23) [STAT02](#STAT02) [STAT05](#STAT05) [STAT03](#STAT03) [EXT07](#EXT07) [EXT02](#EXT02) [EXT05](#EXT05) [SYS01](#SYS01) | [代码] 源码版本 0.3.0；源码存在不等于打包、安装、启用或模型可调用 |
| `rss-reader` | [EXT10](#EXT10) | [代码] 源码版本 0.7.0；源码存在不等于打包、安装、启用或模型可调用 |
| `sentence-reader` | [READ15](#READ15) [READ16](#READ16) | [代码] 源码版本 1.1.0；源码存在不等于打包、安装、启用或模型可调用 |
| `text-desk` | [TXT04](#TXT04) [TXT05](#TXT05) [TXT06](#TXT06) [TXT07](#TXT07) [TXT10](#TXT10) [TXT13](#TXT13) [LIB01](#LIB01) [READ01](#READ01) [READ13](#READ13) [EXT01](#EXT01) [EXT02](#EXT02) [EXT05](#EXT05) | [代码] 源码版本 0.8.0；源码存在不等于打包、安装、启用或模型可调用 |
| `tts` | [READ17](#READ17) [READ18](#READ18) | [代码] 源码版本 0.5.0；源码存在不等于打包、安装、启用或模型可调用 |
| `webdav-sync` | [OPS04](#OPS04) | [代码] 源码版本 0.2.0；源码存在不等于打包、安装、启用或模型可调用 |
| `workspace-profiles` | [UI02](#UI02) [UI04](#UI04) [CFG01](#CFG01) [CFG10](#CFG10) [EXT02](#EXT02) [EXT05](#EXT05) [SYS02](#SYS02) | [代码] 源码版本 0.3.0；源码存在不等于打包、安装、启用或模型可调用 |

### Plugin Agent contribution

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `plugin_dictionary_retrieve_saved_vocabulary` | [EXT09](#EXT09) [AI12](#AI12) [READ07](#READ07) [LIB01](#LIB01) | [代码] global/book；插件启用后才进入工具集；来源 plugins/dictionary/src/agent-tools.ts |
| `plugin_dictionary_lookup_word` | [EXT09](#EXT09) [AI12](#AI12) [READ07](#READ07) [LIB01](#LIB01) | [代码] global/book；插件启用后才进入工具集；来源 plugins/dictionary/src/agent-tools.ts |
| `plugin_dictionary_get_vocabulary` | [EXT09](#EXT09) [AI12](#AI12) [READ07](#READ07) [LIB01](#LIB01) | [代码] global/book；插件启用后才进入工具集；来源 plugins/dictionary/src/agent-tools.ts |
| `plugin_dictionary_save_word` | [EXT09](#EXT09) [AI12](#AI12) [READ07](#READ07) [LIB01](#LIB01) | [代码] global/book；插件启用后才进入工具集；来源 plugins/dictionary/src/agent-tools.ts |
| `plugin_rss_reader_list_feeds` | [EXT10](#EXT10) | [代码] 仅 global；插件启用后才进入工具集；来源 plugins/rss-reader/src/agent-tools.ts |
| `plugin_rss_reader_subscribe_feed` | [EXT10](#EXT10) | [代码] 仅 global；插件启用后才进入工具集；来源 plugins/rss-reader/src/agent-tools.ts |
| `plugin_rss_reader_refresh_feed` | [EXT10](#EXT10) | [代码] 仅 global；插件启用后才进入工具集；来源 plugins/rss-reader/src/agent-tools.ts |
| `plugin_workspace_profiles_workspace_profiles` | [UI02](#UI02) [UI04](#UI04) [CFG01](#CFG01) [CFG10](#CFG10) [EXT02](#EXT02) [EXT05](#EXT05) [SYS02](#SYS02) | [代码] global/book；插件启用后才进入工具集；来源 plugins/workspace-profiles/src/index.ts |

### Plugin setting declaration

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `plugins.rss-reader.articleLimit` | [CFG09](#CFG09) | number；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.sentence-reader.unitId` | [CFG09](#CFG09) | choice；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.sentence-reader.tapToAdvance` | [CFG09](#CFG09) | toggle；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.sentence-reader.scrollToStep` | [CFG09](#CFG09) | toggle；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.sentence-reader.showProgress` | [CFG09](#CFG09) | toggle；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.sentence-reader.sessionTimer` | [CFG09](#CFG09) | toggle；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.tts.vendor` | [CFG09](#CFG09) | select；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.tts.elevenlabs-api-key` | [SYS04](#SYS04) | secret；不进入 Agent/普通 settings catalog |
| `plugins.tts.elevenlabsVoice` | [CFG09](#CFG09) | select；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.tts.elevenlabsModel` | [CFG09](#CFG09) | text；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.tts.fishaudio-api-key` | [SYS04](#SYS04) | secret；不进入 Agent/普通 settings catalog |
| `plugins.tts.fishaudioVoice` | [CFG09](#CFG09) | select；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.tts.fishaudioModel` | [CFG09](#CFG09) | text；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.tts.openai-api-key` | [SYS04](#SYS04) | secret；不进入 Agent/普通 settings catalog |
| `plugins.tts.openaiVoice` | [CFG09](#CFG09) | select；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.tts.openaiModel` | [CFG09](#CFG09) | text；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.tts.custom-api-key` | [SYS04](#SYS04) | secret；不进入 Agent/普通 settings catalog |
| `plugins.tts.customEndpoint` | [CFG09](#CFG09) | text；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.tts.customVoice` | [CFG09](#CFG09) | select；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.tts.customModel` | [CFG09](#CFG09) | text；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.webdav-sync.serverUrl` | [CFG09](#CFG09) | text；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.webdav-sync.username` | [CFG09](#CFG09) | text；非敏感配置；字段存在不等于其功能有 Agent 工具 |
| `plugins.webdav-sync.password` | [SYS04](#SYS04) | secret；不进入 Agent/普通 settings catalog |
| `plugins.webdav-sync.basePath` | [CFG09](#CFG09) | text；非敏感配置；字段存在不等于其功能有 Agent 工具 |

### Native bundled plugin

| 当前注册项 | 矩阵行 | 说明 |
| --- | --- | --- |
| `dictionary` | [EXT09](#EXT09) [AI12](#AI12) [READ07](#READ07) [LIB01](#LIB01) | [代码] Rust BUNDLED 编译内置清单；不是用户当前安装/启用状态 |
| `editorial-themes` | [EXT08](#EXT08) | [代码] Rust BUNDLED 编译内置清单；不是用户当前安装/启用状态 |
| `rss-reader` | [EXT10](#EXT10) | [代码] Rust BUNDLED 编译内置清单；不是用户当前安装/启用状态 |
| `sentence-reader` | [READ15](#READ15) [READ16](#READ16) | [代码] Rust BUNDLED 编译内置清单；不是用户当前安装/启用状态 |
| `tts` | [READ17](#READ17) [READ18](#READ18) | [代码] Rust BUNDLED 编译内置清单；不是用户当前安装/启用状态 |
| `jumper` | [TXT02](#TXT02) [TXT07](#TXT07) [READ06](#READ06) [EXT02](#EXT02) | [代码] Rust BUNDLED 编译内置清单；不是用户当前安装/启用状态 |

## 旧基线反向索引

| 验收项 | 本矩阵行 |
| --- | --- |
| A01 | [CON01](#CON01) |
| A02 | [TXT13](#TXT13) |
| A03 | [TXT13](#TXT13) [TXT02](#TXT02) |
| A04 | [TXT13](#TXT13) [LIB11](#LIB11) |
| A05 | [READ01](#READ01) [READ03](#READ03) [CON08](#CON08) |
| A06 | [CON07](#CON07) [ANN08](#ANN08) |
| A07 | [MORE03](#MORE03) |
| B01 | [LIB01](#LIB01) |
| B02 | [LIB02](#LIB02) [LIB03](#LIB03) [LIB04](#LIB04) [LIB05](#LIB05) |
| B03 | [LIB15](#LIB15) [LIB16](#LIB16) [LIB17](#LIB17) [LIB18](#LIB18) |
| B04 | [LIB06](#LIB06) |
| B05 | [LIB08](#LIB08) [LIB09](#LIB09) |
| B06 | [LIB11](#LIB11) |
| B07 | [LIB12](#LIB12) [LIB13](#LIB13) [LIB14](#LIB14) |
| B08 | [LIB07](#LIB07) [LIB10](#LIB10) |
| C01 | [TXT01](#TXT01) [TXT02](#TXT02) |
| C02 | [TXT03](#TXT03) |
| C03 | [TXT04](#TXT04) [TXT05](#TXT05) |
| C04 | [TXT07](#TXT07) |
| C05 | [TXT06](#TXT06) |
| C06 | [TXT08](#TXT08) |
| C07 | [TXT09](#TXT09) [TXT10](#TXT10) |
| C08 | [TXT11](#TXT11) [TXT12](#TXT12) |
| D01 | [READ07](#READ07) |
| D02 | [READ01](#READ01) [READ02](#READ02) |
| D03 | [READ03](#READ03) |
| D04 | [READ04](#READ04) |
| D05 | [READ05](#READ05) |
| D06 | [READ06](#READ06) |
| D07 | [READ06](#READ06) [READ20](#READ20) |
| D08 | [READ09](#READ09) [READ10](#READ10) |
| D09 | [READ12](#READ12) |
| D10 | [READ20](#READ20) |
| D11 | [READ08](#READ08) |
| D12 | [READ07](#READ07) |
| E01 | [READ13](#READ13) |
| E02 | [READ13](#READ13) |
| E03 | [READ14](#READ14) |
| E04 | [READ14](#READ14) [CON03](#CON03) |
| E05 | [TXT11](#TXT11) [TXT12](#TXT12) |
| E06 | [TXT13](#TXT13) |
| F01 | [ANN01](#ANN01) |
| F02 | [ANN02](#ANN02) [ANN03](#ANN03) [ANN04](#ANN04) [ANN05](#ANN05) |
| F03 | [ANN08](#ANN08) |
| F04 | [ANN02](#ANN02) [TXT13](#TXT13) |
| F05 | [ANN06](#ANN06) [ANN07](#ANN07) |
| F06 | [ANN09](#ANN09) |
| G01 | [STAT01](#STAT01) |
| G02 | [READ19](#READ19) |
| G03 | [STAT02](#STAT02) [STAT03](#STAT03) |
| G04 | [STAT05](#STAT05) |
| G05 | [STAT04](#STAT04) |
| H01 | [CFG01](#CFG01) [CFG10](#CFG10) |
| H02 | [CFG04](#CFG04) [CFG05](#CFG05) |
| H03 | [UI02](#UI02) [UI04](#UI04) |
| H04 | [CFG06](#CFG06) [CFG07](#CFG07) [CFG08](#CFG08) |
| H05 | [CFG02](#CFG02) [CFG03](#CFG03) |
| H06 | [CFG09](#CFG09) |
| I01 | [UI01](#UI01) |
| I02 | [UI03](#UI03) [UI04](#UI04) |
| I03 | [UI03](#UI03) |
| I04 | [EXT01](#EXT01) [EXT02](#EXT02) |
| I05 | [MORE04](#MORE04) |
| I06 | [READ10](#READ10) [READ11](#READ11) [EXT03](#EXT03) |
| I07 | [MORE05](#MORE05) |
| I08 | [UI05](#UI05) [EXT03](#EXT03) |
| J01 | [EXT04](#EXT04) |
| J02 | [EXT05](#EXT05) |
| J03 | [EXT04](#EXT04) [EXT06](#EXT06) |
| J04 | [MORE05](#MORE05) |
| J05 | [MORE05](#MORE05) |
| J06 | [EXT06](#EXT06) |
| J07 | [EXT06](#EXT06) |
| J08 | [TXT12](#TXT12) [SYS09](#SYS09) [MORE07](#MORE07) |
| J09 | [EXT07](#EXT07) |
| J10 | [EXT03](#EXT03) |
| J11 | [MORE08](#MORE08) |
| J12 | [CON04](#CON04) |
| K01 | [READ15](#READ15) |
| K02 | [READ16](#READ16) |
| K03 | [READ17](#READ17) |
| K04 | [READ18](#READ18) |
| K05 | [READ17](#READ17) [READ18](#READ18) |
| K06 | [CON03](#CON03) [CON06](#CON06) |
| L01 | [AI06](#AI06) |
| L02 | [AI07](#AI07) |
| L03 | [AI01](#AI01) |
| L04 | [AI02](#AI02) |
| L05 | [AI03](#AI03) [AI04](#AI04) |
| L06 | [AI10](#AI10) [AI11](#AI11) [AI12](#AI12) [MEM03](#MEM03) |
| L07 | [AI08](#AI08) [AI09](#AI09) [CON02](#CON02) [CON06](#CON06) |
| M01 | [MEM01](#MEM01) |
| M02 | [MEM10](#MEM10) [MEM11](#MEM11) |
| M03 | [MEM02](#MEM02) [MEM03](#MEM03) |
| M04 | [MEM04](#MEM04) [MEM05](#MEM05) |
| M05 | [MEM06](#MEM06) [MEM07](#MEM07) [MEM08](#MEM08) |
| M06 | [MEM13](#MEM13) |
| N01 | [EXT08](#EXT08) |
| N02 | [LIB14](#LIB14) |
| N03 | [OPS04](#OPS04) |
| N04 | [MORE06](#MORE06) |
| N05 | [CON03](#CON03) [CON06](#CON06) |
| N06 | [MORE06](#MORE06) |
| O01 | [SYS01](#SYS01) [SYS02](#SYS02) |
| O02 | [CON08](#CON08) [SYS01](#SYS01) [SYS02](#SYS02) |
| O03 | [SYS04](#SYS04) |
| O04 | [MORE07](#MORE07) |
| O05 | [SYS03](#SYS03) [EXT12](#EXT12) |
| O06 | [SYS05](#SYS05) [OPS08](#OPS08) |
| P01 | [SYS11](#SYS11) [SYS13](#SYS13) |
| P02 | [SYS10](#SYS10) |
| P03 | [SYS06](#SYS06) |
| P04 | [SYS07](#SYS07) |
| P05 | [SYS08](#SYS08) [SYS09](#SYS09) [SYS12](#SYS12) |
| P06 | [SYS07](#SYS07) [CON02](#CON02) |
| Q01 | [CON07](#CON07) |
| Q02 | [CON07](#CON07) [READ07](#READ07) |
| Q03 | [MORE01](#MORE01) |
| Q04 | [MORE02](#MORE02) [CON06](#CON06) |
| Q05 | [MORE02](#MORE02) [CON02](#CON02) |
| Q06 | [CON03](#CON03) [CON06](#CON06) |
| R01 | [CON01](#CON01) [CON03](#CON03) [SYS03](#SYS03) |
| R02 | [CON02](#CON02) |
| R03 | [CON03](#CON03) [CON09](#CON09) |
| R04 | [OPS01](#OPS01) |
| R05 | [OPS08](#OPS08) [OPS09](#OPS09) [SYS15](#SYS15) [SYS16](#SYS16) [EXT12](#EXT12) |
| R06 | [SYS15](#SYS15) [CON05](#CON05) |
| R07 | [CON01](#CON01) [CON10](#CON10) |
| R08 | [CON10](#CON10) |

## 验证边界

- [代码] 原盘点基于 5dc7f7a2 及 2026-09-07 工作区；2026-09-08 在 1d97e2e4 后工作区补 CFG11–13 并分开源码/编译内置插件库存。后续阅读/搜索/Jumper 实现与隔离 Tauri 验收见执行账本。矩阵生成器自身只构造与枚举 ctx，不 activate/promote，不执行安装、备份、同步或写入用户数据。
- [代码] 生成器实际运行 Agent 工具构造器（内存 deps）、全权限 plugin ctx 构造器、settings catalog；TypeScript AST 枚举菜单、命令、事件、快捷键与插件工具声明；Rust generate_handler 名单独立反查。
- [代码] 129 个旧验收项全部映射到新矩阵；已注册库存未映射、失效来源、重复 ID、设置可写性漂移或生成文档不一致会使 --check 失败。目录映射只是人工审计入口，不是所有语义的形式化证明。
- [环境] 尚未完成所有能力的 Tauri E2E。隔离 release .app 的 Annotation Desk 安装/导出/重启/卸载见 docs/evidence/packaged-annotation-desk-2026-09-09.json。另在 macOS release 复现并修复零权限插件的原型 fetch、子 blob Worker、HTTP 模块加载联网，三路零新增请求且授权宿主网络仍 200，证据见 docs/evidence/packaged-sandbox-network-2026-09-09.json；不代替其余绕行、执行中撤权、Windows/Linux、完整跨设备、第三方服务及全部格式验收。
- [环境] HTML 是静态文档，Geist/Tailwind/Lucide/Mermaid 固定 CDN 资源需网络；核心表格和自带样式不依赖远端业务服务。文档浏览器检查不等于产品验证。
- [历史验证，2026-09-07] 相关单元/契约测试 62 通过、0 失败（17 文件，324 assertions）。库存/生成一致性与两组文档 pair validator 通过；无 Mermaid 图的矩阵得到预期提醒，旧基线图正常渲染。不是本次新模型测试结果。
- [历史验证，2026-09-07] 两个 HTML 均检查 1440×1000、1024×768、390×844 截图与横向溢出；矩阵搜索、状态过滤、零结果、Esc、移动目录焦点、主题刷新保留通过；浏览器无 console/page errors。此项只验证当时文档。

可重复执行：

```sh
bun scripts/build-host-capability-matrix.ts
bun scripts/build-host-capability-matrix.ts --check
bun test packages/agent/src/tools apps/web/src/domain/registry.test.ts apps/web/src/domain/settings/domain.test.ts apps/web/src/features/plugins/runtime/plugin-capabilities.test.ts apps/web/src/features/plugins/runtime/plugin-worker-host.test.ts apps/web/src/features/plugins/runtime/plugin-update-transaction.test.ts
git diff --check
```

### 维护规则

1. 新增/改变宿主能力时，先登记此表 current/两个 target、来源、消费者；不能只在插件请求时补入口。
2. 新增工具/公开方法/原生 handler/设置路径/菜单或事件时，库存必须有人工映射，不允许兜底归入“其他已支持”。删除入口同样复查失效映射。
3. 新增用户可见原语可更新基线；已有行为只是没开放或组合语义坏了，应当登记缺陷而不是新能力。
4. 接通目标需要同源业务入口、权限/作用域、参数与引用、回执与失败、取消与生命周期以及真实消费者验证；一个新增导出或通过类型检查不够。
5. Agent 自动管线、模型工具、插件提供者、实际插件工具分别审查；允许明确有意不开放，不把敏感底层能力拿来冲覆盖率。
6. 此生成器是局部库存和文档一致性门禁，不是已经接入全仓 CI 的“所有行为防漏”系统。新增 UI 内联逻辑仍需 reviewer 按功能 owner 清点并补语义测试。
