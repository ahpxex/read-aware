# 同步引擎

同步把多台设备的阅读数据连接起来：本机保存业务数据，中继或传输插件保存和搬运
加密事件与文件。检索、记忆整理和业务状态合并仍在本机执行。
文档整理于 2026-09-15，依据下列源码；没有重新核验线上服务配置或跨设备运行。

## 代码按什么职责划分

| 职责 | 入口 |
| --- | --- |
| 编排事件推送、拉取、文件和检查点 | [sync-engine.ts](../../apps/web/src/platform/sync/sync-engine.ts) |
| 定时及唤醒调度 | [sync-scheduler.ts](../../apps/web/src/platform/sync/sync-scheduler.ts) |
| SQLite 与原生存储适配 | [sync-store.ts](../../apps/web/src/platform/sync/sync-store.ts)、[storage/sync.rs](../../crates/store/src/storage/sync.rs) |
| 默认中继协议访问 | [relay-client.ts](../../apps/web/src/platform/sync/relay-client.ts) |
| 传输提供者注册及会话 | [transport-registry.ts](../../apps/web/src/platform/sync/transport-registry.ts)、[transport-session.ts](../../apps/web/src/platform/sync/transport-session.ts) |
| 加密信封 | [sync-envelope.ts](../../apps/web/src/platform/sync-envelope.ts) |
| 登录、连接及密钥准备 | [connect.ts](../../apps/web/src/platform/sync/connect.ts) |
| 中继服务及部署说明 | [apps/relay](../../apps/relay/)、[relay 配置](../../apps/relay/wrangler.jsonc) |

## 一轮同步做什么

1. 从本机 outbox 取出待发送的事件，加密后交给传输层。
2. 分页拉取远端事件，观察远端时钟，解密后交给原生 `apply_remote_events`。
3. 原生存储去重并按事件顺序更新投影；遇到落在当前处理位置之前的事件，走既有重放
   或暂存后统一完成的路径。不能先推进游标再假装数据已落库。
4. 同步文件登记及必要字节；书籍文件可按需获取，本地缺文件和远端拒绝都必须显式处理。
5. 按现有策略验证远端记账、生成或发布检查点，并分批补齐新设备的旧日志。

引擎本身编排注入的存储和传输端口，计时器、原生调用和网络请求分别由外层负责。
插件传输复用这一套引擎，不在插件里另写一套业务合并规则。

阅读进度按同一本书最后一次观察到的位置合并：比较的是翻页本身的时钟
（`progress.observedAt`），不看事件的上传顺序、重放顺序或会话关闭时间，往回翻
与往前翻同样成立，所以任何设备重开书都落在读者最后停留的页。时钟相同时才按书内
位置决胜：位置数量的比例优先于四舍五入的百分比，同一位置内再比较 CFI 的起点；
定位锚点、章节和进度一起更新。设备本地的未提交阅读会话同样记录最后一次翻页，
其时钟只进不退，阅读时长继续独立累加。

v53 曾改为保留最远位置，导致往回翻的进度无法保存（0.6.0 至 0.6.2）；v54 迁移
按最后观察规则从已有日志重新结算位置，不重复累计时长或重建无关的历史数据，
v53 及更早的检查点不能作为重放基础。尚未补齐日志的设备保留当前数据，待正常
回填完成后按新规则重放。没有留在日志或现存数据中的旧位置无法凭空恢复。

调度节奏按后端区分：中继连接由调度器自动运行（启动一轮、聚焦拉取、本地写入后
延迟推送、定时轮询、失败退避）；插件传输（WebDAV 等）没有自动节奏，调度器只绑定
连接并报告状态，每一轮都来自用户或 Agent 的显式“立即同步”。传输的连接、状态、
立即同步与断开全部放在提供该传输的插件自己的设置页，“数据与同步”只保留指向
该页的一行（插件被停用或卸载时才在此处提供断开）。

## 身份、加密和新设备

登录会话用于访问服务；加密口令和密钥用于解开阅读数据。两者职责不同，WebDAV 等
传输的登录凭据也不能代替阅读数据的加密口令。事件与文件使用版本化加密信封，
算法和载荷以实现与 [共享同步协议](../../packages/core/src/sync.ts) 为准。

空设备可以使用兼容的远端检查点引导，再补充日志。检查点需要验证 schema、来源与
完整性，不能把任意数据库文件当作可信快照。不具备检查点能力的中继有明确兼容路径；
已有数据的合并与完整备份恢复遵守各自入口的前置条件。

## 本地开发隔离

从仓库根目录运行 `bun run dev`，桌面入口固定加载
[开发配置](../../apps/desktop/src-tauri/tauri.dev.conf.json)：应用名为 `ReadAware Dev`，
包标识为 `com.readaware.app.dev`。SQLite、blob、插件与 `secret.key` 使用该标识对应的
应用数据目录；正式版使用 `com.readaware.app`。原生启动在插件和数据库初始化之前检查
身份，漏用开发配置的 `tauri dev` 会拒绝启动；已有独立 capability-e2e 验收身份仍可使用。

开发版默认连接 `http://localhost:8787`，设备调试可使用开发机的 LAN 地址。
缺少环境变量、清空本地设置或误留生产 Relay 地址都不会让开发版回落到生产 Relay；
应用身份读取失败会停止启动。正式构建的开发包仍按开发身份处理，正式版忽略开发环境
变量。地址选择集中在 [relay-url.ts](../../apps/web/src/platform/sync/relay-url.ts)。

在 `apps/relay` 运行 `bun run dev` 使用 Wrangler 本地 D1、DO 和 R2，认证回显只在本地
启用。开发 Relay 的 OAuth 回调地址来自本地配置，回到 `readaware-dev://`；正式版使用
`readaware://`，两者不接收对方的登录回跳。开发版也不检查或安装正式软件更新。

## 失败、退出与恢复

网络故障、登录失效、额度限制、不可恢复的文件拒绝和用户取消是不同结果。
后台同步失败和登录失效不在顶栏主动提示；错误说明与重试、重新登录入口保留在
“数据与同步”设置中，插件传输的状态保留在对应插件的同步设置页。
`unverified` 表示需要向远端核对是否已收到，不能一律当作必须重新上传。
同步暂停或取消不能声称撤销已经完成的远端写入；退出和恢复需协调已有持久工作。

同步不是完整备份。目标设备身份、会话、同步游标和运行队列在备份恢复中的处理见
[完整备份](../features/full-backup.md)。插件能发现和调用的同步控制见
[插件系统](../plugins/plugin-system.md)。

## 验证与历史

历次原生、桌面和同步观察保留在 Git 历史中；
单进程 loopback、测试端口和实际跨设备同步分别证明不同边界。
阅读进度的 [桌面验收入口](../../apps/web/tests/desktop/desktop-progress-acceptance.ts) 使用
隔离 Tauri、真实 SQLite 和 Foliate 阅读器，传输使用加密回环中继；覆盖往回翻后重开、
较新的落后记录合并、较旧的更远记录被拒、重放和重启恢复，不代表实体平板或生产中继验收。
部署操作以 relay 配置、项目脚本和当次环境为准，不沿用旧文档中的 OAuth、邮件或线上状态。

[早期同步设计](../archive/designs/sync-engine.md) 保留协议演进、分阶段实施、旧部署
runbook 和历史性能数据，仅供追溯。
