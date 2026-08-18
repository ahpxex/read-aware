# ReadAware — 同步引擎（设计）

> **状态：** 方向已定（2026-08-13），五个阶段已全部落地（同日）。
> 阶段 1：`hlc.observe()`、`apply_remote_events`（含越界回放兜底）、blob
> 清单物化、`sync_profile`/`sync_cursors` 表（迁移 v12）、双设备收敛性质测试。
> 阶段 2：`platform/sync-envelope.ts`（XChaCha20-Poly1305 + Argon2id + key
> check）。阶段 3：`apps/relay/`。阶段 4：`storage/sync.rs` 本地缝 +
> `platform/sync/` 引擎（迁移 v13 修 `booktext:`）。阶段 5：DataSyncPanel
> 连接流、启动调度器、懒取 blob、`book.progressed` 节流。
> 实现与本文的偏差已就地以「**落地偏差**」标注。**已生产部署**（同日）：
> relay 上线 `relay.readaware.app`，Google/GitHub OAuth 已配置（Resend
> 未配，邮件门暂 501）。**双设备真机验收通过**（macOS 桌面 + Android
> 模拟器，同一生产 relay）：双向收敛至同一书架、新设备事件 bootstrap、
> 打开书触发懒取 blob 解密。实测抓出并修复：connect 期 publishKeys 未带
> 新 session（401 烧令牌）、密钥文件首建竞态（首装双写必现、密封值永久
> 不可读）、4xx blob 无限重传、合并后 UI 无刷新。
> 基于 `docs/data-model.md` §9 的同步模型与 `docs/sqlite-schema.sql` 预留的
> `sync_*` 表。本文档把"同步引擎"从规范落成可实施的方案：协议、服务端形态、
> 身份与密钥、客户端改造点、实施阶段。凡与 `data-model.md` §9 重叠之处，
> 以该节已定的合同为准，本文只做落地展开。

## 目录

1. [目标与非目标](#1-目标与非目标)
2. [已有地基](#2-已有地基)
3. [协议：编号的密文邮筒](#3-协议编号的密文邮筒)
4. [服务端形态：Cloudflare Worker + D1 + R2](#4-服务端形态cloudflare-worker--d1--r2)
5. [身份与密钥：账号薄、密钥重](#5-身份与密钥账号薄密钥重)
6. [E2E 信封](#6-e2e-信封)
7. [客户端改造点](#7-客户端改造点)
8. [Blob 同步](#8-blob-同步)
9. [新设备 bootstrap](#9-新设备-bootstrap)
10. [实施阶段](#10-实施阶段)
11. [风险与开放问题](#11-风险与开放问题)

## 1. 目标与非目标

目标：

- **多设备合并。** 任意两台设备各自离线积累事件后，双向同步收敛到同一份
  日志，从而（由投影纯函数性质保证）收敛到逐字节相同的投影。
- **新设备 bootstrap。** 新设备用账号 + E2E 口令登录后，从中继重放全量
  事件日志，惰性拉取 blob，恢复完整书架。
- **服务端零知识。** 中继只保管密文，看不到事件类型、内容、书名——只看得到
  密文大小、设备号与到达顺序。
- **离线优先。** 断网时一切照常，outbox 积压；恢复网络后自动追平。
  同步是后台行为，永远不阻塞本地读写。

非目标（与 `CLAUDE.md` 一致）：

- 服务端不做业务逻辑、不做冲突解决、不解读事件——它是哑中继。
- 不做实时协作/多人共享；单用户多设备是唯一场景。
- 第一版不做非对称密钥的设备信任与撤销（`sync_devices` 的 `public_key`
  字段留给 v2，见 §11）。
- 不同步投影、向量索引、device-local 配置——只有 `domain_events` 和
  blob 过网（`data-model.md` §9 的表分类照旧）。

## 2. 已有地基

同步引擎大半的地基已经在跑，设计时按"已存在"对待：

| 组件 | 位置 | 状态 |
|---|---|---|
| 事件身份：UUID + HLC 三元组 | `packages/core/src/events.ts`、`storage/schema.rs` | ✅ 每行都有，`UNIQUE (hlc_wall_ms, hlc_counter, hlc_device)` |
| 幂等插入 | `storage/events.rs` `insert_event_row` | ✅ `INSERT OR IGNORE`，返回是否新行 |
| 事件 outbox | `event_sync_state` 表 + pending/failed 部分索引 | ✅ 只有生产者，等消费者 |
| Blob outbox | `blob_sync_state` 表 | ✅ 同上 |
| 游标读取 | `read_events_since(after: Hlc)` | ✅ change feed 的读原语 |
| 设备身份 | `local_device` 表（UUIDv4，一次生成） | ✅ |
| HLC 时钟 | `apps/web/src/platform/hlc.ts` | ✅ `seed()`/`next()`/`observe()`（§7.1，阶段 1 补齐） |
| 本地密钥库 | `src-tauri/src/secrets.rs`（AES-256-GCM） | ✅ E2E 主密钥的落脚点 |
| 分块传输 | `platform/blob-store.ts`（桌面流式 / 移动 256 KiB 分块） | ✅ 直接复用于中继上下行 |

## 3. 协议：编号的密文邮筒

服务端逻辑模型就一张表：

```
events(account_id, server_seq, event_id, hlc_device, ciphertext, byte_size, received_at)
  PRIMARY KEY (account_id, server_seq)
  UNIQUE (account_id, event_id)        -- 幂等去重
```

`server_seq` 是**每账号单调递增的整数**，由服务端分配。这就是
`data-model.md` §9 E2E 信封合同里预留的"its own server sequence"。

### 端点

三个数据端点（auth 端点见 §5）：

- **`POST /v1/events`** — 批量推送 outbox 里的 pending 事件（密文信封数组）。
  服务端按 `event_id` 幂等去重，为每个新事件分配 `server_seq`，
  返回 `{ event_id → server_seq }`。重复推送返回既有 seq，不报错。
- **`GET /v1/events?after=<seq>&limit=<n>`** — 按 `server_seq` 拉增量，
  返回 `{ events: [...], next: <seq> }`。分页游标就是整数 seq。
- **`PUT / GET /v1/blobs/<key>`** — 加密 blob 上下行（§8）。

### 为什么拉取游标用 server_seq 而不是 HLC

HLC 负责**合并排序**（事件在日志里的先后），但不能当**拉取进度**用：
事件到达服务端的顺序与 HLC 顺序无关（设备 A 先写的事件可能后上传），
用"给我 HLC > X 的事件"做增量会漏掉 HLC 小但晚到的事件。
整数 seq 按到达顺序发号，"我拉到 4832 号了"绝对不漏。
两个顺序各司其职：**seq 管传输完整性，HLC 管日志语义顺序**。

### 拉取合并流水线（客户端）

```
GET /v1/events?after=<sync_cursors.remote_cursor>
  → 逐条解密信封（§6）
  → hlc.observe(event.hlc) 推进本地时钟（§7.1）
  → apply_remote_events()：append + apply，跳过 outbox（§7.2）
  → 更新 sync_cursors.remote_cursor = next
```

合并**没有冲突解决步骤**——这是本架构最重要的省力点。投影是日志的纯函数
（`verify_projections` 已在强制执行这一性质），合并 = 把对方的事件插入
日志按 HLC 排序，"冲突语义"已经由每个投影的 apply 规则承担
（例：`ai_messages.seq` 撞号时以 HLC 为准，`data-model.md` §9 已定）。

### 触发时机

第一版轮询即可，不做服务端推送：

- 应用启动 / 从后台回到前台时拉一次；
- outbox 非空时推送（写事件后短暂 debounce）；
- 前台期间低频定时拉（如 5 分钟）。

阅读类应用不需要秒级同步。将来若要即时性，Durable Object 的
WebSocket 顺手就有（§4），协议不用改。

## 4. 服务端形态：Cloudflare Worker + D1 + R2

选型理由：landing（readaware.app）已在 Cloudflare Pages 上，DNS 同在；
单人维护成本趋近于零；免费/低价额度覆盖早期用户；事件行小（密文通常
< 1 KiB），D1 的行储模型合适；书文件走 R2 不占数据库。

| 职责 | 件 |
|---|---|
| 三个数据端点 + auth | Worker |
| 账号表、magic-link token、session | D1（token/session 只存 SHA-256 哈希） |
| 事件密文 | **每账号一个 Durable Object 的自带 SQLite**（见下方落地偏差） |
| 加密 blob（书文件） | R2，key = `<account_id>/<blob_key>` |
| `server_seq` 发号 | 同一个 Durable Object（单线程执行，天然串行化） |
| Magic link 邮件 | Resend HTTP API（一个 fetch，无 SDK；Cloudflare Email Sending GA 后换回，只动 `src/email.ts` 一个文件）；dev 用 `MAGIC_LINK_ECHO=1` 直接回显 token |
| 用量与滥用防护 | Worker 内配额检查（§5 账号表记 `bytes_used`）+ Cloudflare 自带的 rate limiting |

> **落地偏差**（2026-08-13）：事件密文没有存 D1，而是存进每账号邮筒 DO
> 自己的 SQLite——发号与存储合一，单条 `AUTOINCREMENT` 即是 `server_seq`，
> 无跨件竞态、无 seq 空洞（重投递走查后插，不烧号）；D1 只管账号与凭据。
> 另外响应全带 CORS 头（webview fetch 需要预检；auth 是显式 bearer，
> `*` 无 cookie 风险）。relay 的业务面（router）与存储 SQL 完全跑在
> bun:test 下（bun:sqlite 通过 D1/DO 形状的适配器执行同一份 SQL）。

服务端代码放 `apps/relay/`（workspace 内新 app，wrangler 项目）。
**服务端不持有任何业务逻辑**：它不解密、不校验事件 schema、不理解
`type`——收密文、发号、按号吐回，仅此而已。这既是隐私姿态，也意味着
客户端事件 schema 演进（加事件类型、改 payload）永远不需要动服务端。

## 5. 身份与密钥：账号薄、密钥重

两层各管一件事，互不越界：

- **账号（服务端认得）**：只回答"你有没有资格占用我的存储与流量"。
  Email magic link，无密码。
- **E2E 主密钥（服务端永远摸不到）**：只回答"密文能不能打开"。
  由用户口令派生，密钥不出设备。

### 登录方式：magic link + Google / GitHub OAuth（2026-08-13 增补）

OAuth 在本设计里只替代一件事——**"证明你拥有这个邮箱"**。回调不直接发
session，而是铸造一个与 magic link 同表、同 TTL、同哈希存储的一次性登录
令牌，之后统一走 `/v1/auth/verify`：session、E2E 口令派生、key check 对
两条路一视同仁；同邮箱经 Google/GitHub/magic link 登录自动落同一账号。

- `GET /v1/auth/oauth/{google|github}/start?client=app|web` → 302 到
  provider（state 单次使用、哈希存储、15 分钟过期，防 CSRF/重放）；
- 回调按 state 里记录的 `client` 收尾：`app` = 展示令牌页（桌面端在系统
  浏览器完成登录后贴回应用——未注册深链前的最稳路径）；`web` = 302 带
  `#token=` 回 `WEB_APP_ORIGIN`（**只回配置的固定 origin**，不存在开放
  重定向）。这是为计划中的 web 客户端预留的即插即用缝。
- 标准机密客户端 code flow（secret 在 Worker secrets 里），不需要 PKCE；
  provider 是端口，测试用假 provider 跑全流程。
- **不引入 better-auth**：它面向 cookie/同源 Web 应用形态，而这里两端都
  是 bearer + 一次性令牌收尾；auth 全部藏在 `AccountStore` 端口后面，
  将来若做真正的 Web 端 cookie 登录体系再评估。

> **Web 客户端方向的含义**（记录，未实施）：web 端应作为"又一台设备"——
> 拉密文日志、浏览器内解密、内存投影、按需拉 blob——E2E 保持、中继保持
> 哑。代价要写明：web 端每次加载都在信任服务器下发的 JS（Proton/Bitwarden
> web 版同款妥协），弱于桌面端的安装时固定代码。届时 `CLAUDE.md` 的
> desktop-only 表述与"无 web 客户端故无 E2E 权衡"一句需要修订。

### Magic link 流程

1. 用户输 email → Worker 生成一次性 token（随机 256-bit），存 D1，15 分钟过期；
2. Email Sending 发链接（深链回 app，`readaware://auth/<token>` + 网页兜底）；
3. app 携 token 调 `POST /v1/auth/verify` → Worker 验证并作废 token，
   签发长期 session token（opaque，存 D1，可服务端吊销）；
4. 之后所有请求带 `Authorization: Bearer <session>`。

session 被盗的最坏后果是**配额被人占用**，而非数据泄露——小偷拿到的
只是一堆打不开的密文。这是"auth 可以这么薄"的根据。

### 口令派生密钥

- **KDF：Argon2id**（内存难解，抵御离线爆破），参数从 OWASP 当前推荐取，
  盐随账号生成、存服务端（盐不是秘密）。
- 派生出的主密钥本地封存进 `secrets.rs` 的 AES-GCM 密钥库——该模块的
  文件头已说明为何不用 OS Keychain（adhoc 签名问题），本文档确认这一
  取舍延伸到 E2E 主密钥；`docs/sqlite-schema.sql` 里"secrets only in
  Keychain"的旧注释应随实现修订。
- **口令强度在前端把关**（zxcvbn 类强度估计 + 最低门槛），弱口令问题
  以 UX 手段缓解，不引入服务端托管密钥的后门。
- **口令即数据**：忘记口令 = 云端密文永久不可读（本地明文数据仍在，
  可改口令重新全量上传）。这一条必须在 UI 里用大字讲清楚。
- 派生用的 KDF 参数与盐随账号返回，跨设备同口令 ⇒ 同密钥，
  新设备无需任何密钥传递仪式。

### 客户端状态

`sync_profile` 单行表（`docs/sqlite-schema.sql:62` 起已画好）：
`sync_enabled`、`remote_account_id`、`encryption_key_ref`（指向
`secrets.rs` 条目）、`last_push_at` / `last_pull_at`。

## 6. E2E 信封

合同已定于 `data-model.md` §9（2026-07），此处只落格式。

**加密覆盖一切描述行为的字段**：`type`、`schema_version`、
`aggregate_type` / `aggregate_id`、`payload_json`、`created_at`、
`actor_id`、`origin`。明文只留路由所需：

```
{
  "id":         "<event uuid>",          // 幂等键
  "hlc":        { wallMs, counter, deviceId },  // 合并排序键
  "v":          1,                        // 信封版本
  "nonce":      "<24B base64>",
  "ciphertext": "<AEAD(明文信封 JSON)>"
}
```

- **算法：XChaCha20-Poly1305**（AEAD；大随机 nonce 免计数器管理，
  纯 TS/wasm 实现成熟，libsodium 系）。
- AAD 绑定 `id` + `hlc`，防止密文被搬到别的事件身份下重放。
- HLC 必须明文：服务端不用它，但**接收设备要在解密前用它推进时钟、
  解密后按它排序**；`hlc_device` 顺带让"哪台设备产生的"可诊断。
  这与 `data-model.md` §9 列出的明文集一致。
- 信封版本 `v` 为将来换算法/换密钥留位。
- 加解密是纯函数模块（`apps/web/src/platform/sync-envelope.ts`），
  独立测试，不依赖网络与存储。

## 7. 客户端改造点

按"咬人程度"排序的现状缺口，全部属于本地工作，不依赖服务端存在。

### 7.1 `hlc.observe()` — 对表

`hlc.ts` 只会发号不会合并远端时间戳。不补的后果：本地钟慢的设备拉取到
"未来"的远端事件后，继续按慢钟发号，本地新事件会排序到已合并事件
**之前**——因果倒置。补一个标准 HLC receive 规则：

```
observe(remote): wallMs = max(local.wallMs, remote.wallMs, now)
                 counter 按三方比较推进
```

纯函数，加进现有 `hlc.test.ts` 的性质测试。

### 7.2 `apply_remote_events` — 远端事件入口

`commit_events` 是本地路径：`insert_event_row` 对每个新行无条件写入
`event_sync_state`（outbox）。远端拉下的事件若走这条路会被再推回中继
（echo 循环）。新增 Rust 入口 `apply_remote_events`：

- 与 `commit_events` 同事务结构（append + `apply::apply_event` 原子），
- 但**跳过 outbox 登记**，
- 重复事件（本地已有）静默跳过 apply——`insert_event_row` 的返回值
  已经支持这个判断。

### 7.3 Replay 补 blob 清单（bootstrap 前置）

`data-model.md` §9 的 blob bootstrap 合同要求：apply 遇到携带 blob key
的事件（`book.imported.sourceBlobKey`、`book.coverExtracted.coverBlobKey`）
时，先/同时 upsert `blob_objects` 行，`storage_uri = NULL`（"远端已知、
本地未取"）。**`apply.rs` 目前完全没做**——不补，新设备重放完日志后
书打不开。`NULL storage_uri` = cache miss，读方永远不当错误处理。

### 7.4 `replay_into` 改 UPSERT/merge

现状 DELETE-then-replay 违反 rebuild 合同（今天无事故只因 device-local
卫星表尚未与投影同名键交叉），且全量日志进内存。同步落地前改为：
按合同 UPSERT/merge、只触 `[projection]` 表、分块流式读日志。

### 7.5 新表与消费者

- 建 `sync_profile`、`sync_cursors`（schema 照 `docs/sqlite-schema.sql`）；
- outbox 消费者：TS 侧同步循环（`apps/web/src/platform/sync/`）扫
  `event_sync_state` pending → 加密 → 推送 → 按返回标记 synced；
  失败标 `failed` 带 `last_error`，指数退避重试。partial index 已备好。

## 8. Blob 同步

- **上行**：`blob_sync_state` pending 的 blob，整块加密
  （同主密钥，XChaCha20-Poly1305，AAD 绑定 blob key 防串挪）后
  `PUT /v1/blobs/<key>`。**落地偏差**：v1 采用整文件单次 AEAD 而非分块
  流式——书文件在传输两端本就整块在内存里，分块此刻不省任何东西；
  线格式首字节是版本号，将来需要分块格式时从那里演进。
- **下行是惰性的**：bootstrap 只重放事件；`storage_uri = NULL` 的 blob
  在**首次被需要时**（打开书、展示封面）拉取。书架先可见，书按需到位。
  封面（小）可在 bootstrap 后台预取，书文件（大）严格惰性。
- `sync_required` 语义照旧：`font_face` 不同步；**顺手修**：`booktext:`
  前缀目前落进 `unknown` kind 导致这个可推导缓存会被同步
  （`blobs.rs blob_kind()`），应显式映射为 `sync_required = false`。
- 删除：`book.removed` 事件是删除语义的载体；中继侧 blob 由推送方在
  事件推送成功后发 `DELETE /v1/blobs/<key>`（尽力而为，残留密文无隐私
  代价，可由服务端定期对账清理）。

## 9. 新设备 bootstrap

1. 登录（magic link）→ 输入 E2E 口令 → 派生密钥并验证。**落地偏差**：
   验证不靠试解密事件，而是账号随盐值发布一个 **key check**（用主密钥
   密封的固定常量，`sync-envelope.ts makeKeyCheck/verifyKeyCheck`）——
   空账号也能验、错口令一次给出干净提示；首台设备发布 key material 时
   若与并发设备撞车（409），以对方发布的为准重新验证；
2. `GET /v1/events?after=0` 分页拉全量 → 解密 → 按 HLC 排序批量
   `apply_remote_events`（§7.3 保证 blob 清单行就位）；
3. 书架、高亮、笔记、记忆全部可见；blob 惰性到位（§8）；
4. 本设备此后正常双向同步。

全量重放的性能预算：日志在数千量级时秒级完成（`replay_into` 现状即
如此）；§7.4 的分块化保证量级增长后内存不爆。

## 10. 实施阶段

每阶段独立可交付、可测；1–2 不依赖任何服务端决策。

1. **本地地基**（纯本地，无网络）：§7.1 `observe()` + §7.2
   `apply_remote_events` + §7.3 blob 清单 + §7.5 新表。
   验收测试：**两个内存日志互灌的收敛性质测试**——任意事件交错下，
   双方合并后投影逐字节相同。
2. **E2E 信封**：§6 加解密 + Argon2id 派生，纯函数模块独立测。
3. **Relay Worker**（`apps/relay/`）：三个数据端点 + magic link auth，
   D1 + DO 发号；本地 `wrangler dev` 起两个客户端跑通双设备来回。
4. **Blob 同步**：outbox 消费 + 惰性下行 + `booktext:` kind 修正。
5. **打磨与发布**：`sync_profile` 设置页接线（`DataSyncPanel.tsx` 的
   两个 `PendingBadge` 换成真开关）、退避与错误呈现、配额、
   `book.progressed` 节流（§11）。

## 11. 风险与开放问题

- **`book.progressed` 日志膨胀** —— **已定案并落地**（阶段 5）：commit 前
  节流（`features/reader/lib/progress-throttle.ts`）。章节边界与首个位置
  按原 250ms 去抖立即提交（真实路标）；章内翻页合并为每 30 秒最多一条，
  永远提交最新位置；关书时 flush（顺带修掉了旧实现卸载即丢弃待写进度的
  问题）。不做事后 compaction——它破坏"日志不可变"的心智模型，且与 E2E
  中继的 append-only 存储冲突。
- **设备信任 v2**。对称口令派生密钥下，"撤销一台设备"只能靠改口令 +
  全量重加密重传。`sync_devices` 的 `public_key`/`trusted` 字段留给
  将来的非对称方案；第一版明确不做。
- **改口令 / 密钥轮换**。信封 `v` 字段已留位；第一版实现"改口令 =
  新密钥全量重传"，增量重加密留待需要时。
- **免费配额 = 运营者的账单护栏**（2026-08-13 定案）：开源客户端 + 运营者
  自付 Cloudflare 账单，意味着配额必须是硬性的、默认从紧的。默认每账号
  blob 50 MB + 事件 5 万条，双双 413 原子拒绝（重投递已知事件不算新用量、
  不受锁）；env 可调（`MAX_ACCOUNT_BLOB_BYTES` / `MAX_ACCOUNT_EVENTS`）。
  最坏情况有界：1000 个满额免费账号 ≈ 50 GB R2 ≈ $0.60/月。
- **账号档位（2026-08-18 落地）**：对外 `free` / `pro` / `max`，内部
  `staff`。账号行只存 `tier` + `tier_expires_at_ms`（D1 迁移 0006）；
  档位 → 配额的映射在代码里（`ports.ts quotasForTier`）——free 读 env
  基线，pro = 10 GiB / 100 万事件，max = 100 GiB / 1000 万事件，staff
  不限量；付费档单文件上限 100 MB（Workers 非企业版请求体上限即
  100 MB，再往上要做分片上传，不是改常数）。到期回落 free；执行只在
  写入侧——超额账号 pull 永远可用，push 被 413 拒，数据不删。写入口是
  `POST /v1/admin/tier`（`ADMIN_TOKEN` secret 鉴权，未配置则 501；
  body `{email, tier, expiresAtMs?}`），将来支付 webhook 走同一接缝。
  `GET /v1/account` 返回解析后的 `tier` + `limits` + 用量
  （`blobBytesUsed` / `eventsUsed`），客户端 Data & Sync 面板据此显示
  「方案 + 已用/上限」。事件日志 append-only 的先天约束：降级后若已超
  事件配额，push 永久只读直到重新升级——这是接受的语义，不做 compaction。
- **账号删除与 GDPR**：`DELETE /v1/account` 清 D1 行 + R2 前缀，
  服务端无明文所以无残留解读风险；需要写进隐私政策。
- **时钟严重漂移的设备**：HLC 的 wallMs 会被 `observe()` 拉齐，但一台
  钟快数年的设备会把全网 HLC 抬高。可在 push 端加合理性检查
  （wallMs 超前服务器时间过多则拒收并提示用户校时）。
- **D1 单库上限**：每账号事件行极小，D1 10 GB 上限对应数百万用户级
  事件量之前不构成约束；真到那天按 account_id 分库即可，协议不变。

## 12. 部署 runbook

一次性（在 `apps/relay/`，需先 `bunx wrangler login`）：

1. `bunx wrangler d1 create read-aware-relay` → 把输出的 `database_id`
   填进 `wrangler.jsonc`；
2. `bunx wrangler d1 migrations apply read-aware-relay --remote`；
3. `bunx wrangler r2 bucket create read-aware-relay-blobs`；
4. OAuth 应用注册：Google Cloud Console 建 OAuth Web 客户端、GitHub
   Settings → Developer settings 建 OAuth App，回调 URL 均为
   `https://<relay 域>/v1/auth/oauth/{google|github}/callback`；
5. `bunx wrangler secret put GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET`（邮件链路可选：
   `RESEND_API_KEY` + `MAIL_FROM`——有 OAuth 后可以晚配；档位管理可选：
   `ADMIN_TOKEN`，不配则 `/v1/admin/*` 一律 501。升降级示例：
   `curl -X POST https://relay.readaware.app/v1/admin/tier -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" -d '{"email":"reader@example.com","tier":"pro","expiresAtMs":1787000000000}'`）；
6. 生产 `wrangler.jsonc` 删掉 `MAGIC_LINK_ECHO`；配自定义域
   `relay.readaware.app`（Workers 控制台 Custom Domains，DNS 本就在
   Cloudflare）；
7. `bun run deploy`。

客户端默认指向 `https://relay.readaware.app`；dev 联调用 localKV 键
`read-aware-sync-relay-url` 指向 `wrangler dev` 地址。发版前的验收：两台
设备（或两份 app data 目录）连同一账号，双向写入 → 收敛，新设备
bootstrap → 书架完整、书可打开。
