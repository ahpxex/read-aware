# 宿主能力实现与验收进度

目标：实现统一模型中 Agent / 插件尚未接通或只部分接通的应开放能力，完成遗漏重扫，使用真实组合插件和 Tauri 桌面端到端验收。此文件是执行账本，不替代[统一模型](./host-capability-model.md)或[当前矩阵](./host-capability-matrix.md)。

## 完成条件

- [ ] D1–D6：书库/正文、阅读运行态、标注、对话、设置、授权记忆读及受控命令，两端接通。
- [ ] C1–C5：动作/模式/内容/声音/Agent/主题/传输的注册、宿主消费、必要的受权复用全部可组合。
- [ ] S1–S11：存储、密钥、UI、资源、网络、推理、剪贴板、调度、同步、插件目录、会话桥收敛。
- [ ] V1–V3：声明 UI、字段/主题 schema 与真实消费者及资源/焦点生命周期。
- [ ] Q1–Q4：授权、任务/RPC、观察/一致性与新增行为门禁；GAP01–GAP18 逐条提供关闭证据。
- [ ] 重新扫描所有证据行、catalog、工具、插件和消费者，检查双端参数/行为/完成语义没有漏接。
- [ ] 编写多个真实可用的组合插件（覆盖 W01–W32），数量由覆盖与用途决定，不用空壳插件凑数。
- [ ] 打开隔离数据的真实 Tauri app，验收功能、插件组合、失败/并发/取消/撤权；含 packaged CSP 的路径用打包构建。
- [ ] 同步更新能力矩阵、事实文档、测试证据并提交。未通过的项目不得靠改状态变绿。

B1 的禁止权力与未来产品边界保留；自动管线/插件可组合不强行各造一个模型工具。不把画像实体等尚未建成的产品能力伪装成现有 API 漏导出。

## 2026-09-08：S1 / Q2–Q3 持久化基础

已实施但整组桌面验收未完成：

- KV 写入按序提交，读取保持乐观；失败回到最后持久值，不覆盖较新的乐观写；只有成功持久的写进入 roaming 观察。
- 远端覆盖在入队时携带 origin，避免异步确认后失去 mute 标记而回传相同事件。
- storage v2 的 set/remove 返回 Promise，新增 flush；取消独立的无回执 storage wire，Worker 写入使用正常 RPC 并参与迁移排空。
- Worker 基础快照与未确认写覆盖分离；旧 host 同步消息和失败回滚不覆盖较新的 Worker 写。
- 升级顺序为检查候选、旧实例停写排空、快照、文件提交、迁移、提升；候选健康失败不会恢复快照覆盖仍在运行的旧实例。
- schemaVersion 等待持久化；失败迁移先停止并排空候选，再恢复数据；停止实例不能重新注册或打开写权限。
- KV 命名空间恢复也进入同一写队列，恢复与随后设置写入不会交错覆盖；增加失败批次、跨 key 同步观察者重入、远端 origin 保留测试。迁移停止先取消等待中的回执与计时器，迟到结果不能重开已停实例。

已有单元证据：KV 队列、Worker 镜像、生命周期、更新事务故障时序；仍需真实跨 Worker / SQLite / 更新安装验证，以及外部设置并发与 KV/docs 联合恢复检查。此阶段不关闭全部 GAP01–GAP03。

后续顺序：完成基础层故障/权限/取消 → 阅读定位/搜索/历史与 Jumper → 领域与服务双端补齐 → 组合插件 → 遗漏重扫 → Tauri 全链路验收。不会以这一个阶段代替完整目标。

## 2026-09-08：S5 / Q2 网络与跨 Worker 回执

- Network v1.1 使用原生 Request 的继承和覆盖规则，保留方法、Headers、二进制、FormData 边界和 URLSearchParams 编码；请求及响应体每方向限 64 MiB。宿主也检查请求体，不能靠直接 postMessage 绕过代理上限。
- 预取消不派发；进行中取消发送 call ID 到宿主 AbortController，停用时中止原生 HTTP。120 秒 RPC 截止、每方向 256 个等待调用限制、postMessage clone 失败收敛、runtime error 终结等待中的普通回调。已提交业务写/远端副作用不承诺撤销。
- 11 个网络/等待调用单元测试，另有 4 个真实 Bun Worker 集成测试：保真、预取消、取消与迟到响应、迁移中未 await 的持久写失败。它们不是 Tauri E2E 的替代。
- 真实 Tauri debug app 已启动，标识 `com.readaware.app.capability-e2e`，前端端口 5184，MCP 端口本次为 9224；数据库/secret.key/插件目录按标识隔离，空书库已核验，没有读写原账号的密钥或书库。
- 真实路径为注册 command → 宿主调用 Worker callback → Worker 网络 RPC → 原生 tauri-plugin-http → 本地服务 → Worker storage RPC → SQLite。PUT 的 `x-token: test`、字节 `[0,255]` 与返回值落盘均已核验。
- 本地服务器证据共 3 次请求：1 次 PUT `/echo` 成功，2 次 `/slow`（调用方 abort、宿主停用）均 `aborted: true / completed: false`。预取消未增加服务器请求；停用中的回调返回 `plugin/cancelled`。所有探针终止后贡献注册均为空。
- 证据：[结构化记录](./evidence/host-capability-wire-2026-09-08.json)。本次 shell 截图 `/tmp/readaware-capability-e2e-shell.png` 只证明桌面窗口启动，不证明阅读或设置效果。MCP 提示 bridge 0.12 不能报告新版本字段，但执行/截图可用；没有为验收更新产品依赖。

复现：先运行 `bun scripts/capability-network-probe-server.ts`，再运行 `CARGO_NET_OFFLINE=true bun run --filter @read-aware/desktop tauri dev --config src-tauri/tauri.capability-e2e.conf.json --no-watch`。通过该 app 的 MCP 在 WebView 中导入 `/src/features/plugins/runtime/fixtures/desktop-wire-probe.ts`，依次调用 `runDesktopWireProbe` 的 `request-storage`、`pre-abort`、`live-abort`、`stop` 场景；读取 `http://127.0.0.1:18884/evidence` 对照。探针拒绝非隔离 appDataDir。

仍未完成：Agent 直接网络授权入口；全部 callback 的局部释放/JSON marker 无冲突编码；普通宿主任务与 provider session 取消；更新跨设置并发/联合恢复；真实安装升级和权限撤销 UI；生产 packaged CSP；阅读等其余双端能力和 W01–W32 组合插件。此处探针是底层验收夹具，不计作用户要求的实用组合插件；不关闭完整 Q2 或全部 GAP04–GAP08。
