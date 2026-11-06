# 命令行 ReadAware（设计已确认）

> 状态：第 1–4 阶段已实现（2026-11-07）：`crates/store` 共享存储、两进程协调、统一原生导入、Rust 版 `ra`（`cargo run -p read-aware-cli -- <命令>`）。第 5 阶段的运行时验收见第 9 节。用户可读版见 [cli.html](./cli.html)。
> 下文的"现状"描述的是设计时（实施前）的代码。

## 1. 目标与边界

`ra` 是没有 Agent 的无界面 ReadAware：读写桌面端的同一份数据，导入书籍。

- **独立运行**：桌面 app 没开也能用；app 开着时也是同一个 CLI、同一条数据路径，直接打开同一个 SQLite。
  不做"app 在线走 IPC、离线直连"两套模式，也不复用只读的 `local_api.rs`。
- **同一套写入契约**：写入走 domain events → `commit_events_in_transaction` → `apply.rs`，事件追加与投影同事务。
  CLI 不裸写投影表，不另起一份写入实现。
- **不在范围内**：Agent、模型调用与密钥；同步推送（由 app 的同步调度负责，CLI 写入的事件会进入同一个 outbox）；
  移动端；阅读引擎（foliate 需要 webview）；CLI 的安装与分发（单独一期）。

## 2. 为什么是纯 Rust

| 事实 | 位置 |
| --- | --- |
| 写入规则、迁移、blob 存储、格式元数据与封面提取、封面归一化全部在 Rust（存储层约 4.8 万行） | `apps/desktop/src-tauri/src/storage`、`import.rs`、`covers.rs`、`*_metadata.rs` |
| 存储代码对 Tauri 的依赖基本只在命令包装层；存储模块不向 webview emit 任何事件 | 179 个 `#[tauri::command]`，0 处数据变更 emit |
| 导入事件现在由 webview 组装，TS 侧的领域逻辑绑在 `platform/ipc` 上，不是可直接复用的纯库 | `features/library/lib/book-import.ts` |

用 Bun 写 CLI 仍然要挂一个 Rust 子进程或动态库，得到两个运行时、两套分发。Rust CLI 直接链接存储 crate，产物是一个独立二进制。

## 3. 代码结构：Cargo workspace 与存储 crate

```
Cargo.toml (workspace, 新增于仓库根)
├── crates/store            read-aware-store：不依赖 Tauri 的存储与导入核心
├── apps/desktop/src-tauri  read-aware-desktop：Tauri 外壳、命令包装、OS 集成
└── apps/cli                read-aware-cli：命令行二进制 `ra`
desktop → store ← cli
```

### 3.1 搬进 `crates/store` 的内容

以写入路径的依赖闭包为界，一次搬完、行为不变：

- 打开数据库：`init_db(app)` 改为 `Store::open(data_dir: &Path)`。它负责 pragmas、自定义 SQL 函数（`ra_fts_segment` 被批注 FTS 触发器使用，`ra_progress_compare` 被投影使用）、`backup_restore_files::recover`、迁移和 `ensure_local_device`。
- 事件与投影：`events.rs`、`apply.rs` 与 `apply/*`、`checkpoints`（frontier）、`local_event_guard.rs`，以及它们引用的存储模块。
- blob 注册与复制、书库读取（`BOOK_SELECT`、`row_to_library_book`；`library_load` / `library_get_book` 目前把 SQL 写在命令体里，抽成 `*_inner`）。
- 导入核心：`hash_file`、`extractor_for`、`find_book_by_sha_inner`、`register_blob_inner`、`normalize_cover` / `store_cover`、`metadata.rs` 与各格式提取器（`pdf_metadata.rs` 带着 macOS 的 PDFKit 绑定，按 `cfg(target_os = "macos")` 保留）。
- `error.rs`：`CommandError` 只派生 `Serialize`，可原样搬。唯一例外是 `From<tauri::Error>`：搬走后受孤儿规则限制，改由桌面端在少数调用点 `map_err`，store crate 不引入任何 Tauri 依赖。

### 3.2 留在桌面端的内容

- 全部 `#[tauri::command]` 包装、`State<Db>` 管理与 `spawn_blocking`。
- 与 OS 或 webview 绑定的部分：`native_path`（Android content URI，经由 `tauri-plugin-fs`）、`resources`、`ExternalOpenQueue`、`rablob://` 协议处理、`desktop_preferences::commit_entries`（开机启动、文件关联等副作用）、插件内置包、备份导出与导入的对话框和任务、`local_api.rs`、`secrets.rs`。

### 3.3 规则

- CI 检查 `cargo tree -p read-aware-store` 里不出现 `tauri`。
- 其余存储模块等 CLI 需要时再搬，每次整模块搬走，不复制。

### 3.4 workspace 带来的构建改动

- 根 `Cargo.toml` 接管 `[patch.crates-io]`（vendored `auto-launch`）、各 `[profile.*]`（sha2、image 等 `opt-level = 3`）和唯一的 `Cargo.lock`。成员 manifest 里的 profile 和 patch 会被 Cargo 忽略，所以必须搬，否则审计过的补丁会静默失效。
- `target/` 移到仓库根：`release.yml` 里写死的 `apps/desktop/src-tauri/target/<triple>/release/...` 路径、`turbo.json` 的 build outputs、`Swatinem/rust-cache` 的 `workspaces:` 都要跟着改。
- CI 的 rust job 改为 `cargo fmt --all --check`，`clippy` 和 `test` 按 `-p` 逐个包运行，不扫 `vendor/`。macOS 和 Windows 的 native job 加上 store 与 CLI 的测试。
- `tauri dev` 只监听桌面 crate 及其路径依赖（`crates/store`），CLI 改动不会触发重编，不需要 `.taurignore`（已实测）。
- 搬文件时注意相对 `include_str!` 路径：`plugin_sandbox_policy.rs`、`external_open.rs`、`file_associations` 的测试。
- 移动端：`tauri android build` 和 `tauri ios build --no-sign` 通过 `cargo metadata` 定位 target。Tauri 2 早期版本在 workspace 下有过问题，这一阶段必须实测两端构建。
- 删除 Bun 骨架（`apps/cli/package.json`、`tsconfig.json`、`src/*.ts`）并重新生成 `bun.lock`。

## 4. 只有一个导入实现

现状：Rust 的 `library_stage_import` 负责暂存，事件由 TS 组装后经 `commit_events` 提交。如果 CLI 在 Rust 里再组装一遍，就会出现两份导入实现。

设计：在 store 里实现 `import_book`，按顺序做完整个导入：

1. 记录导入意图。
2. 按文件名加大小做廉价去重（现在用的是内存里的书架列表，改成查询 `books.file_name` / `file_size`）。
3. 判定格式：先看扩展名或 MIME，再嗅探文件前 64 KB。
4. 流式算 sha，再按 sha 去重；遇到同步过来但本机缺文件的"空壳书"就补齐文件。
5. 复制进 blob 存储，运行提取器，存封面。
6. 标题和作者缺失时从文件名推断，组装 `book.imported` 和 `book.coverExtracted`。
7. 在 `BEGIN IMMEDIATE` 事务里铸造时钟戳并提交。

- **桌面端**：新命令 `library_import` 包装 `import_book`，`useBookImport` 改为调用它。TS 里只服务于导入的逻辑（payload 组装、按名判格式与嗅探、标题作者回退）随之删除。拖拽和插件写入的 `bookfile:`、`Resource` 来源、外部打开的准入仍由桌面包装层处理，处理完交给同一个 `import_book`。
- **CLI**：直接调用 `import_book`。
- **两种语言都需要的纯逻辑**：例如 `parseFileName`，元数据补全的判断仍会用到它。沿用 `reading_progress_cases.json` 的做法，用一份共享 JSON 用例表，`bun test` 和 `cargo test` 都跑。格式扩展名表留在 `packages/core` 给文件选择框用，Rust 侧用同一份用例校验。
- **时钟回传**：原生提交返回实际写入的 HLC 戳，TS 时钟调用 `observe`，保证 app 后续铸造的戳排在后面。
- **补测试**：`stage_import` 本身和"空壳书补文件"路径目前都没有直接测试，这次补上。

## 5. 两个进程共用一个库

代码目前假设只有一个进程打开数据库（`lib.rs` 的 single-instance 注释）。下面这些问题必须先解决，CLI 才能写入。

### 5.1 HLC 冲突会静默丢事件（现存隐患，必须先修）

- 事件插入用的是 `INSERT OR IGNORE`（`events.rs`），而 `(hlc_wall_ms, hlc_counter, hlc_device)` 上有唯一索引。id 不同、戳相同的事件会被当成重复投递静默跳过：不应用投影、不进 outbox，TS 侧也不检查 `appended`，界面照样显示成功。
- app 的时钟只在启动时从数据库 frontier 播种一次，看不到 CLI 写入的戳。两个进程共用同一个设备 id（`local_device` 表），这种冲突是现实风险。
- **修法**
  - `insert_event_row` 区分两种情况：id 已存在属于幂等重投，照旧跳过；戳冲突但 id 不同，返回新的稳定错误码 `event/hlc-conflict`，整笔事务回滚。
  - TS 的 `commitDomainEventBatch` 收到这个错误后，从 frontier 重新播种时钟、重铸戳，重试一次；同时校验 `appended` 必须等于提交的事件数。
  - 原生铸造（CLI 和第 4 节的 `import_book`）统一在 `BEGIN IMMEDIATE` 事务内读取 frontier 后再铸造，沿用备份恢复写入器的规则。

### 5.2 进程锁

数据目录下放一个 `store.lock`，用标准库的 `File::lock_shared` / `try_lock`（Rust 1.89 起稳定，项目工具链为 1.98）。

- 打开存储的进程（app 和 CLI）全程持有**共享锁**。
- 以下操作需要**独占锁**：执行迁移、完整恢复的应用阶段（它在一个 IMMEDIATE 事务里替换 `blobs/*`、`plugins/*` 和 `secret.key`）、清空数据、`VACUUM` 与 `externalize_inline_blobs`。
- app 做这类操作时，先放下自己的共享锁、非阻塞地尝试独占锁。拿不到就报 `store/in-use`（"另一个 ReadAware 进程正在使用书库"），操作完成后恢复共享锁。
- 现在的 `DomainWriteGate` 只能暂停本进程内的写入。备份暂停改为以独占锁为准。

### 5.3 schema 版本保护

现状：数据库版本高于二进制已知版本时，`run_migrations` 静默跳过并继续启动。改为两端都拒绝打开，报 `store/schema-newer`。

| 情况 | app | CLI |
| --- | --- | --- |
| 数据库版本 = 二进制版本 | 正常打开 | 正常打开 |
| 数据库较旧 | 拿独占锁迁移；拿不到（CLI 在跑）就提示后重试 | 拿独占锁迁移；拿不到（app 在跑）就报错，提示先更新或退出 app |
| 数据库较新 | 拒绝打开，提示更新 app | 拒绝打开，提示更新 CLI |

### 5.4 导入意图的归属

- 现状：`recover_import_cleanup` 把所有不属于本进程 `ImportSession` 的意图都当成残留，删掉对应文件。app 启动时如果 CLI 正在导入，会删掉 CLI 的文件，反过来也一样。
- 修法：每个进程的 owner id 对应 `locks/<owner>.lock`，进程存活期间持有独占锁。恢复时只回收锁已释放（进程已退出或崩溃）的 owner 留下的意图。
- 其他启动期恢复（插件更新与资源、书籍与字体删除、`finalize_staged_events`）CLI 第一期不会触及。之后每给 CLI 加一类写操作，都要单独评审它和这些恢复流程的跨进程关系。

### 5.5 app 察觉外部写入

- 现状：存储层不 emit 任何数据变更事件。界面只在本进程提交后通过 `broadcastDomainEventDrafts` 刷新，CLI 写入后 app 界面不会变。
- 修法
  - app 每秒在自己的连接上读一次 `PRAGMA data_version`。这个值只在**其他连接**提交后变化，所以 app 自己的写入不会误触发。
  - 发现变化后读取 `capability_changes` 的 seq 区间（触发器对任何写入者都生效），emit `store-changed-externally`。
- 前端复用同步拉取后的那套刷新：`projections-invalidated`、`library-changed`、`conversations-changed`、`refreshRoamingPreferences`。另外三件事：
  - 从 frontier 重新播种 HLC；
  - 重新加载 `localKV` 快照，否则 app 会用旧快照覆盖 CLI 写的 KV；第一期 CLI 不写 KV，但机制一并补上；
  - 唤醒同步调度，让 CLI 的事件按本地写入的 3 秒防抖推送，而不是等 5 分钟一轮。
- 书架刷新会触发 `scheduleCatchUpEnrichment`，CLI 导入的书由此补齐封面和元数据。

## 6. 元数据补全：持久化"待补"状态（已确认）

- CLI 跑不了 foliate，凡是推迟给阅读引擎补的项（所有 PDF 的标题和作者、非 macOS 上的 PDF 封面、cbr 漫画）都要等 app 补。
- 封面没有问题：追补扫描按持久化的 `cover_status='unchecked'` 选书。
- 元数据靠启发式判断：只挑"标题仍等于文件名推断出的标题"的 PDF。于是 cbr 的元数据永远不补，PDF 提取出了标题但没提取出作者时也不补。app 内导入时会立刻补，所以这原本只是中途退出时的兜底；而 CLI 导入的书每次都会落进这个缺口。
- **决定**：持久化元数据状态。在 `book.imported` 里加一个可选字段 `metadataStatus`（新增字段，旧事件视为已完成），投影到 `books.metadata_status`。追补扫描改为按这个状态选书，补全结束（无论有没有找到新信息）提交一条结论事件把它清掉。具体事件形状在实施时对照 `book.metadataEdited` 定。该改动随第 3 阶段（统一导入）落地。

## 7. 数据目录与身份

- 默认数据目录与 Tauri 的 `app_data_dir` 一致，即系统数据目录下的 `com.readaware.app`：
  - macOS：`~/Library/Application Support/com.readaware.app`
  - Windows：`%APPDATA%\com.readaware.app`
  - Linux：`$XDG_DATA_HOME/com.readaware.app`
- `--dev` 对应 `com.readaware.app.dev`。`--data-dir <path>` 或环境变量 `READAWARE_DATA_DIR` 指定任意目录，用于测试和多份书库。
- 目录里没有 `read-aware.db` 时报错，并提示先打开一次 app，或用 `ra init` 显式创建。避免路径写错时凭空建出一份空书库。
- 设备身份读自同一个 `local_device` 表，所以 CLI 写的事件归属本机设备，同步时与 app 写的事件没有区别。

## 8. 第一期命令

```
ra [--data-dir <path> | --dev] [--json] [-v] <command>

  books list            列出书架（标题、作者、格式、阅读进度、封面状态）
  books show <id>       单本详情
  import <path>...      导入一个或多个文件，逐个报告：新增 / 重复 / 补齐空壳 / 失败
  init                  在指定目录创建新书库
```

- 默认输出给人看；`--json` 输出稳定结构，错误带 `CommandError` 的 `code`，便于脚本使用。
- 退出码：0 成功；1 运行错误；2 用法错误。`import` 部分失败时返回 1，并逐项报告每个文件的结果。
- 用 `clap` 解析参数。日志走 `log` 门面输出到 stderr，`-v` 打开。不向用户打印 Rust 的 panic 或调试信息。

## 9. 实施阶段与验收

每个阶段单独提交，前一阶段验收通过后再开始下一阶段。

1. **workspace 与 store crate（行为不变）**：三平台 native 测试通过；`tauri dev` 正常；`bun run build:desktop` 正常；`tauri android build` 与 `tauri ios build --no-sign` 构建通过；release 产物路径按新的 `target/` 核对。
2. **两进程基础**：第 5 节全部落地。用"两条连接 / 两个进程"的 Rust 测试覆盖 HLC 冲突、锁、schema 保护和意图归属；TS 测试覆盖 `hlc-conflict` 重铸和 `appended` 校验。
3. **统一导入**：`import_book` 与 `library_import` 落地，app 改用新命令，删掉 TS 中重复的逻辑，补上共享用例表和 `stage_import` / 空壳路径测试。
4. **CLI 第一期命令**：第 8 节，CI 跑 CLI 测试。
5. **运行中 app 的验收**（Tauri app 实测）：
   - app 关闭时用 CLI 导入 epub 和 pdf，打开 app 后书架、封面、PDF 元数据都齐全；
   - app 开着时用 CLI 导入，书架在一两秒内出现新书，之后在 app 内导入和做批注都正常（没有 HLC 冲突）；
   - CLI 导入过程中在 app 里发起恢复，得到 `store/in-use`，数据无损；
   - 同步开着时，CLI 导入的书被推送到另一台设备。

   2026-11-07 在开发版书库上实测的结果：
   - app 关闭时 `ra` 导入一本 epub 和一本 pdf（书库同时由 v56 迁移到 v57）；打开 app 后两本都在书架上、封面在本地，pdf 的书名与作者由补全流程填上，状态变为 `settled`。
   - app 开着时 `ra` 导入，书架在 3 秒内出现新书；随后 app 自己提交的事件时钟戳排在 CLI 事件之后，没有冲突，全部进入推送队列。
   - 用持有共享锁的进程模拟正在运行的 CLI，app 发起备份采集得到 `store/in-use`，之后 app 重新持有共享锁。（恢复与清空用同一把独占锁，由单元测试覆盖，未在开发版书库上实测。）
   - 推送：CLI 写入后 app 按 3 秒防抖发起同步，本机没有可用的中继，未验证到达另一台设备。
## 10. 已确认的决定（2026-11-06）

1. 第 6 节：持久化元数据"待补"状态。
2. 二进制名为 `ra`，提供 `init`。
3. 分发方式等功能完成后再定；在此之前只要求 `cargo run -p read-aware-cli` 可用。
