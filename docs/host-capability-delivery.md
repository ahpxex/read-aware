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

## 2026-09-08：D2 阅读会话与真实导航回执

- Reading domain v2：core 共享版本化 Location/Target、会话快照、完成回执与 book/session guard。宿主控制器拥有当前书、加载状态、实际落点、revision、有限可见文本和最多 100 个跳转历史；插件可中途读取/观察，Agent 新增 get_reading_session 与 navigate_reading。
- openBook/goTo/back/forward/step 都等待引擎完成；close 等待动画结束后的真实会话释放。旧的 requestId/atom 派发导航已删除；RSS 协调迁移到 v2 并 await 返回值。Agent 无定位信息的标注不再退化为假成功开书。
- 源文件 SHA-256 从原生 blob 元数据传到定位版本，重导入/旧位置可验证；无稳定版本的虚拟内容暂用 session 版本，跨会话旧定位明确 stale，不猜测有效。
- 同一引擎的移动串行；不同引擎互不阻塞，旧引擎挂起不会阻止打开另一书。新意图淘汰旧请求，失败不入历史，back/forward 不分支，新跳转截断 forward。Agent 的书内控制带书籍/会话 guard，不沿全局历史跨书；旧会话不能关闭新书。
- Agent 的 AbortSignal、插件实例停用会终结等待；插件取消采用稳定 plugin/cancelled 错误。仍无引擎逐次 abort 或插件单次导航取消句柄，取消不保证撤销已经发生的物理移动；旧结果不能写入成功回执/历史。
- 固定版式增加当前页渲染屏障，区分 iframe 加载和实际栅格绘制；不等待后台预加载页面。渲染失败不回成功。

验证证据：

- 15 个控制器测试、6 个 Agent 工具测试、3 个渲染屏障测试；另补生命周期取消、工具注册/输出契约与 Rust blob hash 断言。全仓 test 的 15 个任务、typecheck 的 18 个任务通过；Rust 定向测试通过，仍有既存 objc cfg/dead-code 警告。
- 在隔离 Tauri app 内原生导入确定性 FB2；真实 Worker 插件执行开书、0.45/0.8 进度跳转、back/forward、next/previous；逐次 CFI 已比对。snapshot 通过 Worker 返回真实 Gamma 文本；观察收到 revision 0–26；缺 href、stale 版本、非法进度都携带稳定错误跨桥返回。结果经 storage v2 落到 SQLite 后读回。
- reading:read 插件没有 commands，但可读同一快照；真实 Agent 工具经产品 RuntimeDeps 导航到 Beta，close 返回后再次查询为 idle。未调用远端模型，此证据不证明模型选择工具的行为。
- [结构化结果与验证范围](./evidence/reading-capability-2026-09-08.json)。桌面截图 `/tmp/readaware-reading-probe.png` 已人工检查：两栏 Gamma 正文确实显示，与快照位置一致，不是只有空壳 DOM。
- PDF **尚未通过成功绘制验收**：原生导入四页测试 PDF 后，WebView 的 document.visibilityState 为 hidden，当前 iframe 存在但没有 canvas，最终得到 reader/timeout。PDF.js display rendering 使用 rAF，与后台暂停绘制现象一致；临时尝试 app.show/window.setFocus 仍未变成 visible，测试权限修改已撤回，未放宽生产配置。必须继续验证前台绘制与后台恢复，不能据此关闭所有格式的阅读验收。
- 构建 Foliate 会触发 Vite 页面重载，导致在途 IPC/测试句柄失效；最终 FB2 测试在构建和类型检查结束后重跑通过。复现时不要把修改源码/生成静态引擎与桌面探针并发。

复现入口：沿用隔离 Tauri 配置，导入 `/src/features/plugins/runtime/fixtures/desktop-reading-probe.ts`，先 `importReadingProbeBook()`，再 `runDesktopReadingProbe(bookId)`、`runDesktopReadingProbe(bookId,true)`、`runDesktopAgentReadingProbe(bookId)`；PDF 夹具为 `importReadingProbePdf()`。这些是测试夹具，不计为实用组合插件。

仍需完成：精确搜索到 Range/TOC 定位及 Jumper；PDF 可见文本/可用性与真实绘制；全部 UI 链接/翻页入口统一历史；模式/播放/选区；旧 services.session 迁移及细粒度授权；导航单次取消、全部格式并发/失败测试。矩阵已更新为 215 行、539 库存映射，现状和目标仍分列，D2 与 Q2 整组未关闭。

## 2026-09-08：D1 精确定位与 Jumper 组合插件

[代码] Library v1.1 新增 `books.getNavigationToc(bookId)` 与 `books.searchLocations(input)`，Agent 新增 `get_navigation_toc` / `find_book_locations`，`open_book` 接收完整 `location`。两端共用解析源、搜索和版本契约，不调用会修改全局搜索高亮的 `View.search`。

- TOC 返回嵌套 entries、稳定路径 id、深度优先 1-based ordinal、sectionIndex 和可空 Location。ordinal 不代表印刷章号，也不等于抽取正文的 chapterIndex。
- 文件版本来自 SHA-256；原生读取遇到旧 registry 空 digest 时流式补算并持久化，不让旧书因新版本契约无法打开。虚拟书按标题/作者/语言/有序 sections 的规范内容计算 SHA-256，替代上一阶段 session-only 版本。
- 读操作保有 parser lease，并在前后检查书籍存在、文件版本、虚拟绑定与 provider 实例身份。活跃书重用 reader parser；不活跃书解析后释放。旧 provider 的活跃解析器不会冒充新实例内容。
- query 限 1–500 字符；limit 为 1–50，默认 20；每页最多扫描 32 个 section。cursor 绑定书籍、版本、规范查询、大小写/整词选项和允许 section 集合；不合法 cursor 为 `library/invalid-cursor`，旧版本为 `reader/stale-location`。
- `textStatus` 区分 available/textless/unsupported/unsearched/partial。未扫完无命中不等于整书无文本；下一页继承已有文本/支持性证据，不因存在 cursor 编造 available。空允许范围不搜索全书。
- 重排正文由引擎匹配器返回可恢复 CFI Range；PDF 先返回页 CFI + exact/prefix/suffix quote，渲染后在 text layer 唯一解析。quote 缺失或歧义失败，不随机选择。真实 PDF 绘制仍未通过，不能据 DOM 单测关闭格式验收。
- Agent 精确搜索使用原回合的叙事章节围栏；仅宿主验证过的明确剧透授权才允许 confirmSpoiler。未授权时 `get_reading_session` 不输出跳转后的 visibleText，避免靠先跳页再读快照绕过围栏。

[代码] `plugins/jumper` 是真实第一方插件，已加入 Rust bundled 与 desktop workspace。它仅申请 library:read / reading:write，用现有 headerActions/commands/views 组合，不持有宿主 DOM、私有数据库或第二套历史：

- 阅读 header 的 More 菜单中打开 Jumper；命令面板也能打开。
- 章节、目录序号、正文三个明确模式；章节模式按印刷阿拉伯/中文章号或标题匹配，目录序号单独解释。不存在返回字段错误；多候选让用户选择；不可导航目录标题明确提示。
- 正文支持大小写/整词、逐页结果和继续搜索；单击命中等待导航成功才关闭。后退/前进复用宿主会话历史，命令默认 Alt+Left / Alt+Right，可由宿主快捷键设置重绑。
- 8 种宿主语言文案；UI 使用宿主声明表单/列表/动作，新增两个 Phosphor 箭头名称。不重复注册已有通用 Agent 导航工具。

[环境] 本轮验证：

- 11 个新增引擎/分页/版本测试、7 个 Agent 围栏/定位/非拉丁分页测试、6 个 Jumper 业务/视图测试、1 个非法 quote 控制器测试；工具注册与输出样例同步更新。全仓 test 17 个任务、typecheck 20 个任务通过；Rust 旧 digest 补算定向测试通过。Rust 既存 objc cfg/dead-code 警告保留。
- 隔离 Tauri 标识 `com.readaware.app.capability-e2e`，端口 5184/9224。`runDesktopJumperProbe(bookId)` 调用真正已内置并启用的 Jumper Worker：99999 不存在且 CFI 不动；Beta paragraph 17 唯一命中后导航；back 回 Alpha、forward 恢复同一 Beta CFI；实际 Agent 端口搜索 Gamma paragraph 23 并定位；旧版本拒绝。见[结构化证据](./evidence/jumper-capability-2026-09-08.json)。未调用远端模型。
- MCP 实际点击阅读 More → Jumper，表单输入 99999 后出现 `Chapter not found.`；切正文搜索 Alpha paragraph 11，结果按钮点击后宿主快照包含该段落。DOM/回调/落点链路通过，不冒充视觉完成。
- **视觉验收未通过**：测试 WebView 持续 `visibilityState=hidden` / `hasFocus=false`；正文截图可见 Gamma，但 Jumper 截图没有可靠反映当前 DOM/动画，不能证明模态框布局或关闭动画完成。针对本次 PID 的系统激活未改变状态；进一步 AX 检查被 macOS assistive-access 拒绝，未绕过权限或修改生产配置。后续需要能前台绘制的隔离打包应用验收，连同 PDF/rAF/焦点/窄窗一起关闭。
- 首次动态导入 fixture 触发 Vite 依赖优化重载，旧句柄丢失；在明确重载完成后重跑记录成功结果。最终已停止本次应用和服务，未触碰原应用的 5173/9223。
- 文档双份生成器与 pair validator 通过，库存为 215 行 / 547 映射 / 129 旧验收项。矩阵 HTML 在独立浏览器的 1440/1024/390 宽度下 DOM 检查无横向溢出；截图调用持续不返回，随后仅终止本次独立会话。因此本轮不宣称两份 HTML 的完整截图/交互复验通过；历史文档浏览器证据不替代本轮验收。

仍需完成：超大 TOC 的模型输出窗口、超大 section 的协作预算、逐次 Worker 搜索/导航取消、异步结果局部回调释放、全部格式与 provider 删除/换代的真实并发故障、前台视觉/快捷键验收。Jumper 只覆盖相应组合场景，不代替 W01–W32 其余实用插件；整组 D1/D2/Q2 与最上方完整目标继续保持未完成。
