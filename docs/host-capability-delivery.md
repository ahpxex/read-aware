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

## 2026-09-08：Q2 回调数据保真与注册释放

[代码] Worker → host 的参数和回调结果统一使用 `plugin-callback-wire.ts`。函数通过独立 callbacks 元数据中的对象引用关联到 data，占位对象的 identity 由 structured clone 保持；不读取业务对象里的 `__fn` 等字段来决定是否执行代码。host → Worker 的 disposable 句柄也改为回执元数据，不再混进业务返回值。

- 普通 `__fn` / `__disposable` / `callbacks` 字段原样保留。对象/数组/Map/Set 的循环、别名、重复函数、Map 函数键、稀疏数组和 null-prototype 输入记录可跨桥；`__proto__` 与 `constructor` 作为普通自有数据属性处理。原型与原生类型的其他行为仍遵循 structured clone，不承诺搬运自定义类方法。
- 每次编码单独拥有回调句柄，同一函数在本次图里复用，在不同消息里独立持有。图遍历/元数据失败不提交暂存句柄；postMessage clone 失败回滚本次句柄；stale invoke 返回 `plugin/unavailable`。
- 图遍历最多 1,000,000 次 visit、对象深度 128、每消息最多 100,000 个 callback；限制保留现有大型虚拟列表的空间，不把累计存活总数伪装成已受控。非法图/metadata 为 `plugin/invalid-input`，callback 超额为 `plugin/busy`；原生不可克隆类型仍可能返回原生 clone 错误，通用错误治理继续开放。
- 普通 host 调用的参数回调在调用结束后释放；注册回调转交返回的 disposable，在 dispose 时释放。同步取得的 registration promise 与 await 后的 disposable 都能释放，重复 dispose 幂等；失败/不授权/非法参数/并发额度拒绝有参数清理路径。
- host 不再解码已经超时/结算的 invoke 结果，而是释放其中句柄；非法 callback 结果也先释放再拒绝 pending。Worker 对无人等待的 registration 回执补发 dispose，避免迟到成功留下注册。

[环境] 验证与范围：

- 新增 8 个 codec 单测、2 个真实 Bun Worker 集成测试、2 个真实 host context + 故障传输测试；既有网络/取消/迁移、RPC 与贡献形状测试继续回归。codec 包括 5,000 次编码/释放归零、clone 失败回滚、深度/额度拒绝、重复释放和独立持有者；这不是整个 app 堆内存验收。
- 隔离 Tauri `com.readaware.app.capability-e2e` 的真实 WebKit Worker、host 注册表与原生插件文档存储连续完成 20 轮：特殊字段文档往返不变，临时 command 可执行，返回 view 的 action 能释放它，宿主注册立即消失，保存的旧 callback 调用返回 `plugin/unavailable`。探针结束后该插件没有残余贡献。[结构化证据](./evidence/plugin-callback-wire-2026-09-08.json)。
- 同一隔离应用回归真正内置的 Jumper：不存在章节不移动，搜索 Beta paragraph 17、返回 Alpha、前进恢复相同 CFI；实际 Agent 端口搜索并导航 Gamma paragraph 23，旧版本拒绝。没有远端模型调用，不把端口测试算作模型决策测试。
- 首次 fixture 导入分别触发 `@tauri-apps/api/path` / `pdf-lib` 依赖优化重载；旧句柄消失且日志确认重载后才重跑。成功结果取得后，开发重载中另观察到 `useWindowMaximized.ts` 调用 Tauri unlisten 的 `listeners[eventId].handlerId` rejection；不能把全部窗口生命周期标成通过，需在后续前台/重载验收定位。此次没有用修改用户权限或生产配置掩盖它。
- 全仓 test 17 个任务、typecheck 20 个任务通过，Vite production frontend 构建通过；现有大 chunk/混合静动态 import、Rust objc/dead-code 警告保留。frontend 构建不是 packaged Tauri/CSP 验收。
- 更新矩阵 CON03/CON04 与两份生成文档；215 行 / 547 库存映射不变，没有把部分状态改绿。两对生成器/pair validator 与 7 个建模门禁测试通过。独立文档浏览器检查两份 HTML 的 1440/1024/390 宽度无页面横向溢出，中英文搜索、Escape、窄屏目录、主题切换及刷新保持通过；1440/390 截图已人工检查，无重复 id。文档截图 `/tmp/readaware-callback-{matrix,model}{,-mobile}.png` 不作为产品视觉证据；文档仍使用外部字体/图标 CDN。
- 已停止本轮隔离 Tauri 应用及 5184/9224 服务，不触碰原应用端口或原用户数据。

仍未完成：视图 push/pop/replace/关闭的自动 callback lease；provider 返回 session 的关闭；host lifecycle 中已处置登记的强引用清理；完整消息 schema、字节及累计存活资源配额；普通任务挂起/取消与撤权收敛；packaged CSP 和前台绘制验收。本轮关闭的是业务字段碰撞与上述注册/调用清理路径，不关闭整组 Q2、全部 GAP 或完整目标。

## 2026-09-09：Q2 宿主注册 scope 与失败回滚

[代码] `PluginLifecycleController` 现在拥有一个未处置注册集合；外部插件实例只保留一个 scope 清理句柄，不再为每次 register 永久追加记录。单项 dispose 先移除集合成员、清空 factory/live 引用，再调用实际 disposer；即使 disposer 抛错或重入，记录也不重新出现，重复释放不会重试已执行的 disposer。

- activating 阶段的登记仍在 promote 前保持无外部效果；取消的登记不执行 factory。active 阶段 factory 抛错会退掉本次及其同步创建的子登记，不影响原有登记，不留到下一次 promote 重试；子 factory 的异常被上层捕获时，子调用也独立回滚。
- promote 的事务覆盖同步重入创建的登记。失败时逆序尝试所有本轮资源的 disposer，汇总失败而不是在第一个异常处停止；失败尝试产生的新登记会丢弃，原声明保留以便重试，避免下一轮出现旧子登记和新子登记双份。回滚过程中拒绝新登记或切换迁移阶段。
- factory 执行期间发生 dispose/stop，随后才返回的资源也会被关闭；不能把已停止实例重新激活。scope stop 先关入口和取消任务，再逆序尝试全部登记释放；即使个别失败，其余清理仍执行。
- Worker 终止在 scope 清理失败后仍等待已接受的持久写排空，并执行 Worker/pending 清理；错误不被吞掉。外层激活失败也先 await sandbox 终止，再做兜底清理，避免提前关闭写入入口而拒绝已经从 Worker 发出的写。此机制服务于插件贡献及被 Agent 消费的插件工具，不意味着 Agent 自身全部任务生命周期已统一。

[环境] 新增 10 个 lifecycle 测试与 1 个 host 故障测试：5,000 次待激活取消加 5,000 次 active 注册/释放后，集合归零，外部清理句柄保持 1；覆盖失败释放、兄弟资源继续清理、factory 重入、嵌套回滚、promotion 回滚/重试与停止竞态。host 故障测试用真实 context/注册表，注入 observer 清理失败及延迟 drain，确认排空前 Worker 不终止、排空后仍报告失败并结束 Worker；不是原生存储故障注入，真实安装/升级失败界面仍待完整验收。

[环境] 隔离 Tauri 的真实 WebKit Worker 和原生文档存储完成 20 轮注册/执行/释放，外部 cleanup owner 每轮均为 1，旧 callback 均拒绝。`terminate()` 返回前贡献已清空，不再依赖 fixture 后续遍历 disposables 才撤下菜单。[结构化证据](./evidence/plugin-registration-scope-2026-09-09.json)。应用与 5184/9224 服务已停止，未触碰原用户数据。

[环境] 全仓 test 17 个任务与 typecheck 20 个任务通过；两对文档生成器/pair validator 和 7 个建模门禁测试通过，215 行 / 547 库存映射不变。两份 HTML 的 1440/1024/390 宽度无横向溢出，中英文搜索、Escape、窄屏目录、主题及刷新保持通过；1440/390 截图已检查，文件为 `/tmp/readaware-registration-{matrix,model}{,-mobile}.png`。文档仍依赖字体/图标 CDN；这些截图不是产品前台视觉验收。

仍未完成：同 ID 贡献替换的自动所有权转移、视图栈 lease、provider session 关闭、普通任务取消与累计资源配额、窗口重载错误、全部组合插件和 packaged/前台端到端验收。CON03 保持部分状态，本轮不关闭整组 Q2 或完整目标。

## 2026-09-09：C5 / Q2 同步传输会话所有权

[代码] `contributions.syncTransports` 升为 2.0.0，返回的 session 必须提供 `close(): Promise<void>`；WebDAV 升为 0.2.0 并要求 network 1.1 的取消契约，已重建内置 dist。关闭不撤销已经提交到远端的写入。

- 宿主包装每个 session：关闭立即阻止新调用并拒绝在途等待者，迟到结果不能变成成功；close 幂等，最多等待 5 秒，成功、失败或超时都释放该返回对象的 Worker 回调，不误释放 provider 的 open 回调。
- 注册表持有 session；注销、替换、配置换代关闭已有实例，迟到 open 或不完整 session 在发布前关闭并释放。旧 provider 引用不能重新 open，旧 disposer 不删除新注册。本轮没有实现通用 blue-green 失败后恢复旧贡献的事务。
- engine 缓存按 provider 身份、配置 generation、endpointId 匹配；失配关闭会话并返回 transport-mismatch，失败不缓存。scheduler 停止/重启退休整个缓存，旧 engine 不能再次打开它；异步解析旧 engine 也拒绝发布。
- settings KV 的变动/回滚先同步到 Worker，再让 transport generation 失效。插件密钥成功写入/删除发出不含值的 plugin-storage-changed，关闭持有旧凭据的连接；其余插件命名空间不受影响。
- 连接检查与口令协商使用短期 session，成功或失败都关闭；连接绑定在关闭成功后持久化。操作本身失败时保留原错误，额外关闭失败记日志，不能把错误口令掩盖成清理故障。
- lifecycle 在停止网络前退休会话，等待异步资源清理及持久写之后才终止 Worker。WebDAV 取消并排空在途请求；在途取消使用 plugin/cancelled，新调用旧会话使用 plugin/unavailable。退出清理失败记日志并向关闭调用者报告，不跳过后续清理。

[环境] 新增 15 个定向测试（session/registry/cache/scope 10、callback 1、lifecycle 1、WebDAV 3），覆盖并发关闭、错误/超时、回调别名与独立所有权、非法/迟到 session、替换、配置失效、endpoint mismatch、旧 engine、短期协商清理和拒绝取消的请求。

[环境] 隔离 Tauri 使用真正的内置 WebDAV 0.2.0 bundle、WebKit Worker 与原生 HTTP，依次测试手动 close、settings 改路径、密钥变更和 terminate，每组两个并发请求。8 个服务端请求全部 `aborted: true / completed: false`；新 session 使用 changed 路径，所有旧 session 均拒绝额外请求，终止后注册消失且旧 provider 不能重开。[结构化证据](./evidence/plugin-transport-session-2026-09-09.json)。未使用真实凭据或远端账号，测试密钥已删除。

[环境] 首次真实测试暴露两处取消语义错误：WebDAV 把宿主取消重包为 sync/network；close 把 plugin/unavailable 用作在途 abort reason，导致 quiescence 当成退出失败。已分别保留宿主取消码、分开在途取消与失效句柄，并在修复后重跑成功；不把首次失败隐藏为测试通过。

[环境] 全仓 test 17 个任务、typecheck 20 个任务通过；真实桌面 callback 探针再次通过 20 轮注册/释放，cleanup owner 保持 1。两对文档生成器与 pair validator、7 个建模门禁测试通过；库存增加 close 一个入口，为 215 行 / 548 映射。两份 HTML 在 1440/1024/390 宽度无横向溢出、无重复 id，中英文搜索、抽屉/Escape、主题切换和刷新保持通过，截图 `/tmp/readaware-transport-{matrix,model}{,-mobile}.png` 已检查。文档使用既有字体/图标 CDN，不包含 Mermaid 图，不把文档浏览器证据当产品验收。隔离应用、5184/9224/18884 服务与本次文档浏览器均已停止。

仍未完成：Agent/普通插件受控同步状态与连接入口；连接 UI/真实跨设备、packaged CSP、真实 WebKit close 超时故障注入、同 ID 升级失败回滚、其他 provider 会话、视图 lease、普通任务/资源配额，以及完整 W01–W32 实用组合插件验收。此夹具不算新增实用插件；只推进 C5/Q2，完整目标继续保持未完成。

## 2026-09-09：V1 / Q2 视图实例与回调所有权

[代码] 视图栈改由独立 `PluginViewSession` 管理，React renderer 只订阅并呈现。每个已规范化 frame 持有自己的回调 lease；push 保留父 frame，back/replace/reset/关闭释放离栈 frame，嵌套对话框独立持有和释放。共享 callback 别名直到最后一个 owner 释放才失效；未被规范化保留的字段、非法视图及迟到结果不留下句柄。

- Worker 解码的声明和回调携带宿主侧 owner 信号，未向插件泄露信号或 DOM。Worker 退休时关闭所属视图，含纯 markdown 和尚未返回 view 的 pending dialog；旧 generation 不误关新实例。注册函数仍由注册 scope 拥有，不与返回视图的局部 lease 混同。
- 页面与 header popup 统一使用根视图加载 hook，按 source 身份和书籍上下文刷新。同 key 的新注册会重载；失效源、刷新竞态、关闭后迟到的成功或失败不会替换当前视图或弹通知。
- 动作结果按源 frame、epoch 和 request 校验；旧 finally 不清除新请求的 busy；关闭/返回/替换立即拒绝迟到结果。这里取消的是 UI 接受资格，不撤销动作已发起的持久写或 HTTP 副作用，也不是普通任务的端到端取消协议。
- React StrictMode 清理立即使在途结果失效，实际 lease 延至下一 microtask 释放；同步重复 setup 可复用，真实 unmount 会释放。渲染期间不创建带回调资源的 frame。
- 对话框请求层也拥有尚未挂载的原始结果；关闭、替换、失败和旧 request resolve 都释放未消费回调。selection action 包装调用显式保留原始注册函数的 owner，不能仅跟踪宿主闭包。

[环境] 新增 14 个测试，连同既有 contribution 测试共 16 个通过：覆盖图别名、非法/未知字段、1,000 次 replace 后回调有界、模态框竞态、Worker 退休、无 callback 声明、非模态迟到失败提示，以及真实 React DOM StrictMode 的同 key 换源/刷新/卸载。全仓 test 17 个任务、typecheck 20 个任务通过。故障用例预期日志保留，不把注入异常误报为测试失败。

[环境] 隔离 Tauri `com.readaware.app.capability-e2e` 中，真实 WebKit Worker 和宿主 DialogHost/Renderer 完成 push/back、嵌套对话框、replace、reset、动作迟到关闭、10 轮开关释放及 terminate 关闭 pending dialog；保存的离栈 callback 均拒绝为 `plugin/unavailable`，cleanup owner 为 1。[结构化证据](./evidence/plugin-view-lifetime-2026-09-09.json)。夹具使用 SDK 声明，但不是 W01–W32 的实用组合插件。

[环境] 真正内置 Jumper 的章节不存在不移动、Beta paragraph 17 精确搜索、后退/前进恢复相同 CFI，以及实际 Agent 端口搜索/导航 Gamma paragraph 23 和 stale 版本拒绝再次通过；没有远端 LLM 调用。另在宿主真实表单派发 input/click：99999 显示字段错误；Book text 查询显示命中列表，点击后关闭对话框并导航。应用此轮为 `visible / focused`，1200×800 逻辑视口的根表单与结果页截图 `/tmp/readaware-view-jumper{,-results}.png` 已检查，布局未重叠；不外推到全部窗口尺寸/原生键盘/焦点恢复/PDF。MCP DOM snapshot 因当前 bridge 缺少 `resolveAll` 不可用，未升级或注入补丁绕过，以上事件由 execute_js 派发，不称为真实物理键鼠测试。

[环境] fixture 首次依赖优化和一次开发源修改触发 Vite 重载，旧句柄消失；日志确认重载后重跑，最终保留完整成功结果。两对生成器/pair validator 和 7 个建模门禁通过，215 行 / 548 库存不变。矩阵更新 EXT03/CON03，统一模型 Markdown 的现状映射随源更新，人读模型的目标表述无变化。两份 HTML 的 1440/1024/390 宽度、搜索中英文、抽屉/Escape、主题刷新保持、重复 id/锚点和截图检查通过，无浏览器错误；依赖既有字体/图标 CDN，无 Mermaid。文档浏览器已关闭。

[环境] 本轮隔离 Tauri 已正常退出，5184/9224 不再监听；未触碰原应用与原用户数据。

仍未完成：全消息 schema/字节和累计存活额度、任意任务取消、同 ID 升级失败回滚、其他 provider 会话、全部页面/popup/表单辅助回调的实机矩阵、packaged CSP、完整双端能力与 W01–W32 实用插件验收。本轮只关闭上述视图局部所有权路径，不关闭整个 GAP06/10 或完整目标。

## 2026-09-09：D3 标注参数与精确查询双端接线

[代码] `domains.annotations` 升为 1.1.0，新增 `queries.get(annotationId)` 与面向写权限的 `commands.removeAsk(askId)`。get 直接使用原生 `annotation_get`，未找到返回 null，存储异常继续抛出；不再为了取一条标注加载全部列表。空或非字符串 ID 返回 `annotations/invalid-input`。

- Agent `create_annotation` 增加 `style=highlight|underline`，AnnotationsPort 与宿主 adapter 原样传递，默认仍为 highlight。域层拒绝非法 style，不让非 TypeScript 插件绕过 enum。未新增“下划线专用”模型工具。
- Agent `get_annotations` 增加 annotationId 和 kind；精确 ID 查询仍返回零/一元素数组，保持原列表结果形状。annotationId 与全文 query 互斥；kind 与书籍过滤仍生效。书内默认本书，但沿用现有显式跨书检索能力，未把 ThreadScope 虚构成新的全局权限隔离。
- `edit_annotation`、`delete_annotation`、按标注 `open_book` 及宿主删除 adapter 全部改用 get。导航仍核对标注 bookId 等于请求目标，不让别书 anchor 被当作当前书的位置。
- 插件 read 只获得 queries/events，write 才有 removeAsk；插件不能调用 createAsk。removeAsk 校验 kind，缺失或错误类型返回 `annotations/not-found`；非 Agent 调用宿主 createAsk 返回 `annotations/forbidden`。三个错误码均加入 8 语言错误呈现，原始错误仍仅用于日志。
- Agent 删除批准未弱化：依旧先请求 `delete-annotation` 批准，再调用删除端口。此处未解决批准等待期间的版本变化，后续 CAS/批次协议仍需覆盖。

[环境] 新增 12 个定向测试（Agent 标注 6、宿主域/adapter/权限 5、导航目标书籍 1）；覆盖下划线默认与显式参数、kind、无列表扫描的精确查询/编辑/删除、缺失/失败区分、书籍过滤、只读/停用写拒绝、禁止伪造 ask、批准与拒绝。全仓 test 17 个任务、typecheck 20 个任务通过。

[环境] 隔离 Tauri 中运行真实 Agent 工具、共享域、原生 SQLite 和 WebKit Worker：Agent 创建蓝色 underline；read-only 插件按 ID 回读完整样式且无 commands；write 插件查询并删除 ask、收到带 plugin origin 的 ask.removed，缺失和错误类型回调携带稳定错误码。Agent 真实交互端口先 decline 保留，再 approve 删除。批准由测试代码经实际交互端口回答，没有远端模型或聊天批准 UI，不外推为模型决策/完整批准界面验收。[结构化证据](./evidence/annotation-capability-2026-09-09.json)。测试标注原生回读均为 null，插件测试 KV 已删除，贡献已注销。

[环境] 首次完整结果取得后 WebView 再次 boot，旧窗口句柄消失；日志核对 boot 后重跑并取得结果与原生清理证据，没有仅因观察超时重启进程。该重载的触发原因本轮未确定。隔离 app 已正常退出，5184/9224 不再监听；未触碰原 app、真实书库或密钥。

[环境] 能力矩阵 ANN01/03/06/08 和生成模型映射更新，215 行 / 550 库存，129 旧验收项不变；ANN03 的 Agent 接线和 ANN06 的插件接线改为接通，ANN08 仍为部分。两对生成器/pair validator、7 个建模门禁通过。矩阵 HTML 的 1440/1024/390 宽度无页面横向溢出，中英文搜索、抽屉/Escape、主题刷新保持、重复 id/锚点、截图检查通过，无浏览器错误；截图 `/tmp/readaware-annotations-matrix{,-mobile}.png`。模型 HTML 目标描述未变，仅更新 Markdown 的现状映射。文档依赖既有字体/图标 CDN，无 Mermaid；不把文档截图当产品验收。

仍未完成：标注有界分页/稳定游标、批次结果与原生事务内版本条件、Range/内容版本校验、远端变更失效、实际锚定下划线的跨格式视觉与聊天批准 UI、标注整理/导出的实用组合插件，以及其他领域/服务与完整 W01–W32。此探针不计为实用插件，不关闭 D3 整组或完整目标。

## 2026-09-09 标注原生分页与双端游标

[代码] `domains.annotations` 升为 1.2.0。共享 `AnnotationPageQuery` / `AnnotationPage` 经 domain、Agent port、插件 Worker 到原生 `annotations_page`，不是 JS 全量读后切片。插件保留既有 list/get，新增 page；Agent `get_annotations` 统一返回 `{items,nextCursor,consistency:"live"}`，精确 ID 也返回零/一项的同形页，不再返回裸数组。对应测试适配器与调用测试已迁移。

- 查询参数：bookId、kind=highlight|note|ask、query、limit、cursor 均可省略；limit 默认 20，整数 1–100；bookId 非空且不超过 512 个 UTF-16 单元，query 不超过 500 个 UTF-16 单元，trim 后空字符串视为无过滤；cursor 非空且最多 8192 字符。非法参数返回 `annotations/invalid-input`，非法/错配游标返回 `annotations/invalid-cursor`，存储异常不转空结果。游标错误使用既有 8 语言标注输入错误文案，不显示原始错误。
- SQLite 按 `(created_at DESC, id DESC)` 排序，用最后一项作 keyset 边界；SQL 只取 limit+1 条，用额外一条判断 nextCursor，结束为 null。FTS 使用既有 CJK 分词与英文前缀规则，按时间而非 BM25 排序。迁移 30 新增全局、书籍、类型、书籍+类型四组对应索引。
- 游标采用版本 1 的 URL-safe Base64 JSON，绑定 bookId/kind/规范化 query 和最后 createdAt/id，不绑定 limit，不能将旧游标换书/换类型/换查询词续用。它不是签名授权票据；宿主每次仍从本次请求施加过滤和插件权限，不能靠游标获取额外权力。调用者将它当不透明值。
- `consistency:live` 明确不是冻结导出快照。边界行已删除仍可续页；插入到边界之前的新行需重新从第一页查询，后续行的删除/内容编辑/新增会改变后续结果。不可据此宣称得到某一时刻的完整导出。正常编辑不改 createdAt/id；重导入或重建改变对象身份/排序键时应重新遍历。
- Agent 的书内默认本书与显式跨书规则不变，annotationId 不得与 query/cursor 混用。模型工具、插件和宿主共用原生游标语义；测试用内存 adapter 只模拟分页，不作为 SQLite FTS 语义或性能证据。

[环境] 5 项原生测试覆盖 253 个同时间戳行的多页不重不漏、删除边界/新增之后继续读取、中文 FTS/英文前缀/书籍/类型组合、游标过滤错配和非法限额、数据库故障保持失败，以及过滤游标查询的索引计划无需临时排序。4 项新增 TS 测试覆盖输入规范化、Agent 分页不调用 legacy list、domain/Agent/插件同形结果与错误保真。全仓测试 17 个任务和 typecheck 20 个任务通过；原生全量 118 通过、1 个百万事件压力测试仍为既有 ignored。既存 objc cfg、dead-code 与 block future-incompatibility 警告未改变。

[环境] 隔离 Tauri `com.readaware.app.capability-e2e` 中执行真实 Agent 工具、SQLite 和 WebKit Worker：五条测试笔记按 2/2/1 页全部读取，混入的同词高亮由 kind 过滤；Agent 游标直接交给插件续读；无权限插件无 annotations 域，read-only 无写命令；换书/类型/词、损坏游标及 limit=101 返回预期稳定错误码。删除第一页末项并插入新笔记后，Agent 用旧游标仍得到原后三项。所有测试标注查询为空，测试 KV 为空，贡献已注销。[结构化证据](./evidence/annotation-pages-2026-09-09.json)。此探针不经过远端模型/产品列表 UI，也不验证 packaged CSP，不计作实用组合插件。

[环境] 矩阵 ANN01/ANN08 与生成映射更新为 215 行 / 552 库存，129 验收项不变；ANN08 仍为部分。两对生成器、pair validator 与 7 个模型门禁通过；矩阵 HTML 在 1440/1024/390 宽度无页面横向溢出，中英文搜索、抽屉/Escape、主题刷新保持、重复 ID/锚点与截图检查通过；无浏览器错误，既有 CDN 资源成功加载。截图 `/tmp/readaware-annotation-pages-matrix{,-mobile}.png`。模型 HTML 未改，目标契约未变，仅 Markdown 当前映射更新。文档仍依赖 CDN，无 Mermaid 图；文档检查不作为产品验收。测试桌面进程和文档浏览器均已关闭。

仍未完成：单条超长标注的文本/字节预算（行数限制不等于消息体限制）、原子批次/逐项结果、事务内 CAS 及批准等待期间版本保护、Range/内容版本校验、远端变更观察、全格式视觉和聊天批准 UI、实用标注整理/导出插件，以及其余 D/C/S/V/Q 能力和完整 W01–W32。此提交只接通分页，不关闭 D3 或完整目标。

## 2026-09-09 标注条件写与原子批次

[代码] `domains.annotations` 升为 1.3.0。新增 `queries.inspect(id)` 返回 `{annotation,revision}` 或 null；`commands.applyChanges(changes)` 对不同现有标注执行原子条件修改。Agent 与插件共用此领域入口，插件必须有 annotations:write，read 只有查询/事件，仍不能伪造 ask 或传入原始事件。

- revision 是 `ann1:` 加 64 位十六进制 SHA-256 的不透明本机观察令牌，不是 updatedAt，也不是跨设备全局版本。原生在同一读事务读取完整标注行与该标注最后本地追加事件的 ID，组合计算指纹。包含事件身份是为避免同一毫秒内 A→B→A 或删后按同 ID 重建时旧批准仍有效；旧无事件行由行状态参与指纹。令牌不作为权限，日志替换/回填可能使令牌保守失效，调用者必须重新读取。未把未记录的历史变更假装恢复出来。
- mutations 支持 `updateNote`（body）、`recolorHighlight`（color 与可选 style）、`remove`（显式 kind=note/highlight/ask）。每项必须带 annotationId 和 expectedRevision；批次 1–100 项、同 ID 不可重复，ID 最多 512 UTF-16 单元，body 最多 100000 UTF-16 单元，输入 JSON 与原生事件 JSON 分别不得超过 1 MiB。事件封装有开销，原生最终大小校验仍可能拒绝接近边界的输入。创建、任意高亮文本改写和其他领域事件不属于这个现有对象批次。
- 宿主把语义操作变成带 origin 的既有 DomainEvent 草稿，经 mintEventRows 填入事件 ID/HLC，再交给 `annotations_commit`。插件无法指定日志 envelope。原生校验事件种类/字段/目标与条件一一匹配，用 SQLite IMMEDIATE 事务先校验整批存在性、类型和版本，再调用从原 commit_events 提取的同一个 `commit_events_in_transaction`，事件、投影和同步 outbox 同生共死。未创建第二套投影写入路径、未改远端事件重放规则。
- 成功返回 `{atomic:true,changes:[{annotationId,revision}]}`，删除后的 revision 为 null；回执在事务内读取结果、提交后返回。`annotations/conflict` 表示观察后发生改变，not-found 表示目标消失或类型不符，invalid-input 表示非法批次；任一条件/事务失败不写入整批。**传输断开或回执丢失不证明事务未提交**，本轮没有耐久请求回执查询/幂等重试协议；工具说明要求先检查状态，不能自动用新令牌重试覆盖。
- Agent `get_annotations(annotationId)` 的精确页附 revision，类型/书籍过滤不匹配时 revision=null；普通分页仍不附版本。`edit_annotation` 新增必填 expectedRevision，模型应先精确读取再修改。`delete_annotation` 在发起批准前 inspect，批准后提交同一个 revision，不在批准后偷偷读取新版本。`apply_annotation_changes` 暴露批次；含删除时批准整个批次，拒绝时连带编辑也不发生。工具注册现为书内 25、全局 31，注册/输出测试随之更新。
- Worker 使用自己的 lifecycle signal，Agent 使用回合 signal；本轮保证事件 mint 之前和 IPC 发出前取消不提交。IPC 发出后进入不可撤销的短事务，不宣称后续 cancel 会回滚。提交成功后才广播事件、提升标注 UI revision；冲突与取消不广播伪成功。
- 新增 conflict/unavailable/cancelled 三个稳定码及 8 语言文案，全部不可盲目 retry；原始错误不用于界面文案。旧插件单项命令、旧 UI 编辑路径尚未迁移到调用者版本条件，不能将新增原子入口冒充所有旧路径都已安全。

[环境] 6 项原生测试：成功混合改笔记/改高亮颜色样式/删 ask 与 origin；后项版本冲突整批与 outbox 不变；同毫秒 ABA/删后重建；执行后项时触发数据库错误，前项事件和投影回滚；不存在/类型不符/重复 ID/非标注事件拒绝；两个真实 SQLite 连接持同一版本并发写，恰有一方成功、一方 conflict。原生全量 124 通过、1 项既有百万事件压力测试 ignored；原有 objc cfg/dead-code/block future-incompatibility 警告保留。

[环境] 新增 10 项 TS 测试覆盖输入与配额、Agent 过期版本/批准中变化/混合批次批准拒绝/取消、原生拒绝不广播、mint 期间撤销不发 IPC、双端 origin 与权限/生命周期信号。全仓测试 17 个任务和 typecheck 20 个任务通过。测试用内存 adapter 使用同步检查/写入与观察代次，只模拟原子契约；原生并发/回滚结论来自 SQLite 测试而非 mock。

[环境] 隔离 Tauri 中，read-only Worker 能 inspect 但无写命令；writer 接收来自 Agent 精确查询的旧 revision，混合批次 conflict 时高亮和事件均不变；用新 revision 成功更新笔记与 underline，高亮/笔记持久状态与回执 revision 一致，广播 origin 为 plugin。Agent 条件编辑成功；实际批准端口等待期间宿主修改目标，批准后删除 conflict 且新内容保留；混合批次先 decline 两项均保留，再 approve 同时编辑/删除成功。[结构化证据](./evidence/annotation-mutations-2026-09-09.json)。批准由测试代码回答实际交互端口，不代表聊天 UI 或远端模型判断已验收。首次调用后 WebView 重载、结果句柄消失；确认重载后清理一条残留测试高亮并原生验证 null，再完整重跑成功，未把首次不完整调用计为通过；重载原因未确认。最终测试标注均为 null，测试 KV 为空，贡献已清理。

[环境] 矩阵 ANN04/ANN08 和生成映射更新为 215 行 / 558 库存，129 旧验收项不变，ANN08 仍为部分。两对生成器与 pair validator、7 项建模门禁通过；矩阵 HTML 1440/1024/390 无页面横向溢出，中英文搜索、Escape/抽屉、主题刷新保持、锚点/重复 ID、截图检查通过；无浏览器错误，CDN 成功。截图 `/tmp/readaware-annotation-mutations-matrix{,-mobile}.png`；模型 HTML 未改，Markdown 现状映射更新。文档浏览器与隔离 Tauri 已关闭，文档依赖既有 CDN，未画 Mermaid 图；文档验收不代表产品验收。

仍未完成：旧单项写/UI 调用者版本迁移、跨设备离线并发的产品冲突处理（此 CAS 只限制本机提交，远端仍走既有合并）、回执丢失后的耐久请求查询、超长读结果预算、Range/内容版本校验和远端观察、实用整理/导出插件，以及全部 D/C/S/V/Q 和 W01–W32 的剩余工作。此提交不把 ANN08、D3 或完整目标标成完成。

## 2026-09-09 Annotation Desk 与真实表单组合

[代码] 新增实用第一方插件 `plugins/annotation-desk`，不是测试探针。只组合已公开的 annotations 1.3 / library 1.1 / reading 2.0 / ui 1.0、headerActions、commands 和 views；未新增宿主领域方法、模型工具或权限。书架提供完整页面，阅读 header 提供当前书弹窗，命令入口跟随当前阅读会话。8 种语言文案。编译产物随包提交；开发版 RepoDist 自动发现该目录，**release 的 BUNDLED 表未增加它**，因此它是可单独安装的可选包，不宣称已随发布版内置。

- 每页 20 条原生 keyset 查询，opaque cursor 原样往返；前后页历史归单个视图，不在插件全局保存。书籍、类型、正文搜索改变后重置游标；列表没有 legacy annotations.list 全扫描，失败不伪装为空。书籍选择器目前仍使用现有 books.list，不能把标注分页声称为全部读资源有界。
- 详情先 inspect；笔记编辑和高亮颜色/样式使用捕获的 revision。checkbox 选择页内项目后重新 inspect 所选项再展示审阅；改色、下划线、删除各以一个原子批次提交。删除必须显式勾选确认，但这个 UX 勾选不是宿主 grant。任一项冲突不重读令牌自动覆盖；字段错误保留当前草稿。写入成功但重载失败时明确告知“已保存、读取失败”，只允许重读，不诱导重复写。
- JSON/CSV 明确限定“本页”或“所选项”，不是整库冻结导出。JSON 保留原内容并标记 observed-items，包含书籍元数据、不包含本机 revision；CSV 完整引号/换行转义、UTF-8 BOM，公式或前导控制字符前加单引号，JSON 不做这种改写。exportFile 返回 false 不提示成功，失败继续交宿主错误表面。缺原始书籍/封面资源、流式输出与单次取消，W04 完整验收仍未满足。
- 有位置的项目将既有 anchor/chapterHref 原样交给 reading.goTo；无锚点则仅打开对应书，等待宿主完成后关闭插件表面，不伪造位置。此轮桌面验证的是无锚点打开，不替代所有格式的精确锚定回归。

[代码] 实用插件发现并修复两项已存在契约的宿主实现缺口，不是再为该插件发明专用 API：

1. 相同栈深度的 replace/reset 原先重用 React 表单状态，导致回调/revision 已更新而旧草稿与错误仍显示。PluginViewSession 现在给显式导航分配 frame renderKey，renderer 对整个内容子树使用该 key，覆盖 blocks/detail 中的嵌套表单；busy/fieldErrors 不换 key。普通根数据刷新保持已有草稿协调语义，不把被动刷新等同用户明确重新加载。
2. 静态 select、choice、checkbox、toggle、secret 原先漏接返回的 fieldErrors。现在逐项接通；设计系统 Checkbox/ChoiceGroup/Toggle 补 error prop、aria-invalid 与关联描述，并添加故事。真实测试确认未勾选时错误可见，过期批次错误显示在颜色选项下，而不是点击后毫无反馈。长表单首次错误的自动聚焦/滚动尚未验收，不能把错误显示完整等同焦点契约完整。

[环境] 新增 15 项插件测试、1 项 frame 身份测试、2 项可访问错误组件测试；全仓 test 18 个任务、typecheck 21 个任务通过，原生未改。实际 Tauri debug / WebKit Worker / SQLite 验证 25 条夹具的 20+5 分页及返回、类型筛选、过期笔记草稿保留、显式刷新采用并发新值并清错误、新版本保存、两条高亮同时改 pink/underline、未确认不删除、确认后两项查询为 null；另一轮过期批次维持一条 blue/另一条 yellow，未部分改成 pink。通过真实设置 toggle 停用后贡献为空。1200×800、700×800 截图已查看，窄窗无页面横向溢出；阅读弹窗有当前书筛选，原书正文可见。[结构化证据](./evidence/annotation-desk-2026-09-09.json)。

[环境] 首次夹具延迟 import 触发 Vite optimize/reload，6 条已提交夹具经明确 ID/内容验证后条件删除；后续开发 HMR 丢失内存句柄时，按原生查询核实的夹具 ID 恢复跟踪而不假装任务仍运行。最终 SQLite 中该书所有 Desk E2E 夹具数量为 0；隔离插件保持停用，测试应用与文档浏览器已停止。CUA 未识别 raw debug executable，osascript 无 assistive access；因此本轮没有打开原生导出对话框，不宣称保存/取消或磁盘文件验收。开发自动发现也不证明安装授权/升级 UI 或 packaged CSP。

[环境] 重扫为 215 行 / 559 库存映射 / 129 旧验收项，统一模型仍为 30 个责任单元、32 个场景；已有状态不因新增消费者自动改绿。矩阵与模型生成器、7 个模型门禁和两对文档校验通过。矩阵 HTML 在 1440/1024/390 宽度、搜索、抽屉/Escape、主题刷新保持、锚点与重复 ID 检查通过，无控制台错误且既有 CDN 成功；模型 HTML 未变，Markdown 更新现状映射。文档仍依赖 CDN，未增加 Mermaid 图，文档浏览器不代替产品测试。

仍未完成：W04 全资源/导出对话框验收、W05 完整只读授权与更广排序/失败场景、W28 全生命周期故障回归；其余实用组合插件与全部 D/C/S/V/Q 缺口、原生保存/安装授权/packaged CSP、精确锚定全格式与远端模型行为。本轮实现是 W04/W05 的部分真实消费者，不用“已有插件”替代这些场景的完整验收，也不关闭 ANN08、D3 或整体目标。

## 2026-09-09 隔离 Release 安装与原生导出

[环境] 使用真正的优化 release `.app`，不是 debug executable 或 Vite 页面。标识 `com.readaware.app.capability-e2e`，版本 0.5.4，CUA 读到 WebView URL 为 `tauri://localhost`；生产 CSP 未放宽，release 没有启用 MCP，9224 无监听。构建只覆盖隔离名称/URL scheme、关闭 updater 签名产物与文件关联，没有更改安全配置。未做公证/发布签名，不能当作已经发版。应用二进制与安装包哈希、原始 JSON/CSV 导出文件见[结构化证据](./evidence/packaged-annotation-desk-2026-09-09.json)。

[环境] 通过原生文件夹选择器选择 `plugins/annotation-desk/dist`。第一次安装在列出 Edit annotations / Read library / Control reading 的授权面板取消，候选目录清空、已安装列表无插件、正式插件目录不存在；第二次批准后显示安装并启用成功，出现非 Built-in 的卸载入口。插件书架页和阅读 header 当前书弹窗均正常工作，证明此可选包通过正式安装、Worker 与生产资源加载路径运行，而不是开发目录自动发现。

[环境] 在合成 FB2 中拖选 `Beta paragraph 1.`，用实际 NoteEditor 创建笔记，再用安装后的插件表单条件编辑。最终正文为 `=SUM(1,2)`、换行和含 ASCII 双引号/逗号/中文的文本，AX 输入值、SQLite 回读及 JSON 文件相同。首次 CUA typeText 没输入中文且系统智能引号改变了引号，检查落库内容后改用 paste 重做并确认，不把自动化输入差异误报为应用丢字。

[环境] 实际打开原生保存面板：取消 JSON 导出回到插件且没有成功提示；确认 JSON/CSV 导出显示 Export saved。磁盘文件由 Ruby 标准 JSON/CSV 解析器独立核对：一条笔记、ID/CFI 对应、JSON 原文不变且无本机 revision、CSV BOM 为 EF BB BF、双引号与换行转义正确、公式正文前有单引号，中文保留。导出仍是 `scope=page` / `consistency=observed-items`，不是整库或冻结快照。测试改名保留了原生隐藏扩展名，得到 `.json.json` / `.csv.csv`，证据记录真实路径而非改写宿主返回路径；仓库证据副本保留原字节和 SHA-256。

[环境] 退出并确认本轮进程消失，再打开同一 `.app`，插件菜单自动恢复并回读保存的笔记。Open in reader 展示 Beta 首段及笔记下划线；由于该处也是上次持久落点，不把它当作从异位置导航的独立证明。CUA 截图检查真实正文和插件弹窗非空、无观察到的重叠。未勾选删除确认显示字段错误，勾选后删除成功，原生按 ID 或测试正文查询剩余为 0。设置停用使 header 菜单移除该插件；两次点击卸载确认后已安装条目/正式目录消失。隔离应用与本轮文档浏览器都已关闭，用户正式应用和数据未改动。

[代码/环境] 矩阵 SYS10/CON09 与总验证边界更新，模型 Markdown 的现状映射同步；没有把整体 CSP/安全状态改绿。库存仍为 215 行 / 559 映射 / 129 旧验收项、30 单元 / 32 场景。生成检查、7 项建模门禁和两对 pair validator 通过。矩阵 HTML 在 1440×1000、1024×768、390×844 无页面横向溢出；中英文搜索、Escape、移动抽屉、主题刷新保持、锚点/重复 ID 与截图检查通过，浏览器无错误、既有 CDN 返回 200。模型 HTML 未变；文档无新增图，仍依赖既有 CDN，文档浏览器检查不作为产品证据。

仍未完成：GAP16/W31 的恶意直接消息、子 Worker、动态模块、网络/平台绕行和执行中撤权验证；升级/回滚故障、zip/marketplace 安装、二进制/磁盘失败/并发导出、全部格式异位置锚定与远端模型行为，以及全部剩余 Agent/插件能力和 W01–W32 消费者。正常插件在生产 CSP 下能运行不是隔离安全证明，本轮只补上对应正向生命周期及文本导出的实机证据。

## 2026-09-09 Worker 独立 CSP 与零权限联网回归

[环境] 上一轮正向验证之后，实际在同一隔离 macOS release `.app` 安装 `permissions: []` 的诊断包。安装确认明确显示 No extra permissions，插件的 network service 为 undefined，直接 fetch 被已有 getter 拦住；但原型链 native fetch、子 blob Worker 中 fetch、HTTP 动态 import 三路都拿到固定测试响应。仅绑定 `127.0.0.1:18886` 的本机服务分别收到三条请求，origin 都是 `tauri://localhost`，没有读取或发送任何用户数据。这是已复现的网络授权绕行，不再只是 GAP16 的未知项。[修复前后证据](./evidence/packaged-sandbox-network-2026-09-09.json)保存二进制/夹具哈希、UI 结果和服务器请求记录。

[代码] 根因是页面 CSP 不能替代 Worker 自身响应的 CSP，且 globalThis getter 不会消除原型上的原生函数或子执行环境的权限。新增共享 `apps/web/plugin-sandbox-policy.json`：connect-src/worker-src 为 none，脚本只允许宿主/插件资产与 Wasm 编译。Vite 将插件沙箱入口输出到专属 `/assets/plugin-sandbox/` 命名空间，原生 `on_web_resource_request` 只对本地 Tauri 来源的该命名空间附加独立 CSP；不改变宿主页面、Foliate 解析器或其资源的策略。开发服务在 worker 源入口响应附加同一策略。原有 getter 保留友好拒绝信息，但注释不再宣称它是完整安全边界，也不再将不可配置属性误说成一定不可用。

[代码] 产品构建缺失/重复受保护入口会直接失败，避免改打包规则后悄悄失去保护；Storybook 不要求完整产品入口。增加 3 项 Vite 测试（入口命名、缺失/重复构建失败、真实开发 HTTP 响应策略）与 2 项原生测试（macOS/Windows/Linux 来源匹配与策略内容、不改变其他资源）。新 build 模块纳入 node tsconfig，并使用工作区 TypeScript 5.8 单独检查。源码第一方插件未发现 Worker/SharedWorker/importScripts/eval/new Function 使用；此扫描不替代全部第三方插件兼容性判断。

[环境] 重建优化 release 后，原样保留已安装的零权限诊断包再执行：原型 fetch 返回 Load failed，子 Worker 返回错误，HTTP 模块 import 失败；服务器仍可通过 control 访问，但三路没有新增请求。随后通过正式安装授权 `service:network` 的正向对照，`ctx.services.network.fetch` 返回 200 和固定标记，服务器只新增 host-network 一条。因此不是关掉服务器或禁掉全部合法联网造成的假通过。正向夹具初稿误用 network 权限 ID，被安装验证正确拒绝；改为正式 service:network 后才批准执行，未放宽验证。

[环境] 全仓 test 18 个任务、typecheck 21 个任务通过，web 为 626 项；原生全套 126 通过、1 个既有 ignored。实际 web 生产构建和 release `.app` 构建通过；保留既有 chunk/dynamic import、objc cfg、unused/dead code 与 block future-compatibility 警告。打包测试包含独立响应策略与资产命名空间；随后增加的构建门禁和解释性注释不改 worker 运行字节，门禁另经真实 web 生产构建验证。没有发布/推送，也未启用 release MCP。

[环境] 两个诊断包经设置的二次确认卸载，正式目录不存在；应用与本机测试服务已停止。它们位于 scripts/fixtures，有可复现操作说明，不计为用户要求的实用组合插件。矩阵 CON09 与总验证边界更新，模型 Markdown 现状映射同步；仍是 215 行 / 559 库存 / 129 旧验收项、30 单元 / 32 场景。两对生成器/pair validator、7 项建模门禁通过。矩阵 HTML 的 1440×1000、1024×768、390×844 无横向溢出，中英文筛选、Escape、抽屉、主题刷新保持、锚点和截图检查通过，无浏览器错误，既有 CDN 返回 200；模型 HTML 目标未改，不新增图。文档浏览器不是产品验证。

仍未完成：Windows WebView2/Linux WebKitGTK 实机策略验证、其他全局对象/存储/平台绕行、直接消息的全 schema/参数边界、执行中撤权和资源耗尽、全部 provider 生命周期，以及剩余双端能力与 W01–W32 实用组合。此次关闭的是三条已复现的联网路径，不把修复它们称作完整沙箱认证或整体目标完成。

## 2026-09-09 共享朗读控制与 Listening Desk

[代码] reading 2.1 将 READ18 的启停和播放状态接到两端：Agent `control_read_aloud`，插件 `reading.commands.controlPlayback`，共同读取 `session.playback` 并通过既有 session observation 获得变化。实际工具栏、Agent 和插件使用同一个 ReadAloudController，不再各自维护播放真相。启动回执等到 Web Audio resume/source.start 或系统语音 onstart；合成请求已发出不算开始。快照含状态、unavailableReason、backend、fallback、owner 和单元 CFI，不额外暴露正文。播放不是逐字时间定位，不含暂停恢复。

- 开始、停止和自动续读有代次隔离；换单元、换 voice、停用发起插件、换书和关闭会话取消当前音频，迟到合成/回调/预取不得启动旧音频或污染新缓存。发起插件生命周期信号在初次回执后继续拥有该次播放；用户接管后旧信号不能停止用户的播放。底层 provider 合成尚不支持通用中止，不能将隔离迟到结果声称为取消了远端工作或费用。
- start 最多等 30 秒；自动续读跨章节的临时无单元状态最多等 6 秒，没有新单元返回 reader/timeout，而不是擅自认定全书读完。读不到模式/单元/声音时明确 unavailable。系统 voiceschanged 更新可用性，不能只以 speechSynthesis 对象存在认为声音可用。后台降级记录日志，失败走稳定码和八语言 toast。
- Agent 使用当前 book/session guard，插件写权限与 lifecycle gate 保留；read-only Worker 可查状态但没有 commands。会话替换解绑旧控制器，旧 disposer 不得清除新绑定。最后复核另补每个自动单元都必须收到 onStart、重复 onEnd 不重复步进两项回归；这两项异常回调的最终增量由单元测试验证，未再次作为原生语音故障注入。

[代码] 新增可选实用插件 `plugins/listening-desk`，组合已公开的朗读、会话和导航历史，带阅读 header 弹窗及命令入口、8 种语言和打包产物。开始/停止、前进/后退按捕获的会话执行；缺当前段落时不显示虚假的 Start。它展示按需加载的状态快照，操作后或显式 Refresh 才重读，不声称实时刷新外部操作。最终桌面截图核对已去除重复内部标题并显示 Play/Stop 图标。开发 RepoDist 会发现它，release 的 BUNDLED 表没有增加它，不宣称发布版已内置。

[代码/环境] 实际桌面测试暴露并先独立提交两项基础修复：

1. `880bd4a3`：开发 Vite 向 Worker 注入 @vite/client，与刚加固的独立 CSP 冲突，导致插件启动失败。开发入口改为直接提供独立打包的 Worker，不带 HMR/WebSocket；仍用同一响应 CSP，没有放宽 connect-src/worker-src。HTTP 中间件测试检查策略以及未注入客户端，真实 Tauri 插件恢复启动。生产策略逻辑不变。
2. `6bac2b17`：声音列表的不可变更新替换了登记对象，旧 identity disposer 因而漏删停用后的 voice。注册表改以登记 token 维护所有权，快照更新不改变 owner，旧 disposer 不影响同 ID 新登记；禁止更新 ID/pluginId。回归测试与真实清理的 remainingVoices=0 验证修复。

[环境] [结构化桌面证据](./evidence/reading-playback-2026-09-09.json)：隔离 macOS Tauri debug / WebKit Worker，用实际产品 Agent 工具和 Listening Desk 互相启停；两秒 PCM 测试声音结束后自动推进到不同 CFI；provider 故意拒绝后实际系统声音启动并报告 fallback=true；发起插件停用后贡献为空、播放停止；延迟合成期间停用返回 plugin/cancelled，等待迟到结果后仍停止；合成期间关闭阅读返回 reader/superseded，随后会话 idle/no-session。原生 header 弹窗、Start/Stop 和工具栏状态已截图核对。这证明真实播放 API 启动，不是麦克风录音证明物理扬声器可听，也不是远端模型决策或远端 TTS 验收。

[环境] 测试过程的失败没有省略：Vite 优化/HMR 导致页面重载与 hook-order 错误；一次直接动态导入 plugin-host 的诊断用了不一致模块图，没有正确停用命令，不能作为通过；之后冷启动并由夹具静态导入同一宿主实例重跑。一次探针首次启动失败，显式重试后成功。最终探针命令/声音均为 0，TTS 启用状态已恢复，阅读已关闭；隔离应用及文档浏览器已停止，5184/9224 无监听。正式用户应用、数据和 9223 进程未修改。

[环境] 最终强制全仓测试 19 个任务通过（无缓存；web 643 项），typecheck 22 个任务通过，生产 web 构建通过，保留既有 chunk/dynamic-import/Node DEP0205 警告。原生代码未改，本轮没有重跑 release 音频验收。两个文档生成器、7 项建模门禁、两对 pair validator 通过；重扫为 215 行 / 563 库存映射 / 129 旧验收项、30 责任单元 / 32 场景。两份 HTML 在 1440/1024/390 宽度、搜索、Escape/抽屉、主题刷新保持、锚点和截图检查通过；最终矩阵结论文案修正后另复检三个宽度与中英文筛选，截图为 `/tmp/readaware-playback-matrix-final-{1440,390}.png`。无浏览器错误、既有 CDN 返回 200；未增加图，文档仍依赖 CDN，文档浏览器不作为产品证据。

仍未完成：READ16 模式启停/步进/恢复双端入口、完整 provider 取消与所有权策略、跨平台/release/真实远端 TTS/全部格式音频回归、动态插件视图，以及其余双端能力与 W01–W32 组合消费者。READ18 当前限定的控制已接通，不把本轮改动当作 D2、Q2 或完整目标完成。

## 2026-09-09 阅读模式异步分段与失败语义

[代码] 开始 READ16 双端接入时确认底层尚不能给可靠完成结果：分段器拒绝被逐 block 吞成空数组，整个章节又有一层空数组 fallback；旧构建返回当前数组会让旧调用者继续做落点；load 只等待未来的 relocate，Worker 回答晚于 relocate 时可能一直没有当前单元。先修复这些真实前置问题，没有把新增模式 API 包在原有假成功行为外面。

- `contributions.readerModes` 升至 1.1，公开 `segmentText` 正式允许 Promise，与已有 Worker 等待行为一致；同步第一方插件仍兼容。失败与合法 `[]` 分开，offset 非法或一个 block 失败使整章构建失败，不静默遗漏正文。错误为 reader/segmentation-failed，八语言安全文案与日志相互分离。
- 章节分段按顺序遍历，最多 8 个在途 Worker block 请求，返回顺序可不同但最终 Range 顺序仍按原文。失败/撤销后不继续发送剩余 block，不再以整章 Promise.all 一次性提交所有请求。整章最终 Range 数组仍驻内存，本轮不是累计字节/内存配额实现。
- 新 TextUnitBuild 管理整次构建及调用者后续落点的代次和 AbortSignal，30 秒截止；被替换的永不返回 provider 不再挂住宿主等待。底层已发出的 provider 计算不强制中断，迟到结果不再获得状态写权限。换书、停用、换单位、同 key provider 换代、同 index 新 Document 和卸载均撤销旧构建。
- navigator 将 inactive/building/ready/empty/error 分开；分段失败或构建中不跨到下一章，界面 Previous/Next/Read aloud 保持位置但禁用。分段和 relocate 两种先后顺序均能落点；旧文档 relocate 不控制新文档。相同模式/单位停用再启用保留兼容 resting 单元；改单位/策略则重新锚定，不将旧 ordinal 直接保存为新单位的落点。

[环境] 新增 11 项测试，覆盖有界并发与返回顺序、合法空结果/拒绝/非法 offset、取消后无新请求、悬挂 provider 的替换与超时、迟到失败、实际 React effect 中两种事件顺序、同 index 文档替换、失败后步进不跨章、停用后无回写以及重新启用仍停在第二个单元。全仓 test 19 个任务通过，web 654 项 / 103 文件；typecheck 22 个任务通过，实际 web 生产构建通过。保留既有 Node DEP0205、chunk 和 dynamic-import 警告。未改 Rust 业务代码，隔离 debug 原生重编译成功，不把它当作原生全量测试或 release 验收。

[环境] [真实 Tauri 证据](./evidence/reading-segmentation-2026-09-09.json)：原生阅读器打开合成 FB2，诊断 Worker 的每 block 500ms 延迟后出现实际当前 CFI、句子计数和 wash；切段落且故意 reject 后记录稳定错误并显示本地化 toast，当前 CFI 为空，点击步进没有跳章。补齐按钮状态后再次验证 Previous/Next/Read aloud disabled，单位切换和退出仍可用。改回成功分段恢复段落 CFI、20/41 计数与原文 wash；延迟任务期间退出后 toolbar 消失、playback 为 mode-inactive，等待迟到结果仍不恢复。截图 `/tmp/readaware-segmentation-recovered.png` 已查看，真实正文和强调均非空。最后的兼容位置恢复防回归由 React 测试验证，未另做原生停用再启用流程。

[环境] 初始连接在隔离 app 尚未启动时误连默认 9223，立即断开，没有读取或操作该 app；此后工具显式指定 9224。初次夹具缺 reader:modes，注册被正确拒绝并清理；补正式权限后重试。新增文件/契约改动触发 Vite reload 和一次 module import boot failure，重新核实 5184 已完成 boot 后才测试；toolbar HMR 后又重跑失败/禁用检查。这些失败保留在证据里，不计为成功。探针是底层验收夹具，不计实用组合插件；清理后 commands/modes 均为 0，Sentence Reader 启用状态已恢复，阅读会话关闭为 idle，隔离 app 与文档浏览器已停止，5184/9224 无监听。测试只改变隔离合成书的模式偏好，未改变正式数据。

[环境] READ15/READ16 和生成文档更新，READ16 两端继续为未接。库存保持 215 行 / 563 映射 / 129 旧验收项、30 单元 / 32 场景；两个生成器、7 项建模门禁、两对 pair validator 与 diff 检查通过。矩阵 HTML 1440/1024/390 无横向溢出，segmentText/分段筛选、Escape、抽屉 inert、主题刷新保持、锚点/重复 ID 和 1440/390 截图检查通过，无浏览器错误或 CDN 失败；模型 HTML 未改，Markdown 仅同步现状行。没有新增图，仍依赖既有 CDN；文档检查不代替产品验证。

仍未完成：模式发现/选择、共享 mode 快照与双端启停/步进/回当前入口、内容版本化恢复、跨节与全书末尾的确定完成回执、单次命令取消和所有其他能力/组合插件/平台验收。下一步仍是 READ16 的公共模式控制器，不把这组底层修复标成该能力或完整目标完成。

## 2026-09-09 当前阅读模式的双端配置与真实完成

[代码] `domains.reading` 升至 2.2。公共 `ReadingModeSnapshot` 描述当前宿主选择的 text-unit mode：`status` 为 unavailable/inactive/preparing/ready/empty/error，`unavailableReason` 区分 no-session/unsupported-format/no-provider；包含 requestedActive、modeKey、label、unitId、声明的 units、章节内零基 ordinal/total 与当前 cfiRange，不额外暴露正文。`get_reading_session`、插件 `queries.session` 和 `observeSession` 共用此快照。`ready` 表示本节分段索引完成，不是页面导航/全书结束/磁盘持久成功回执。

[代码] Agent `configure_reading_mode` 与插件 `commands.configureMode` 共用 ReadingModeController 和实际 navigator。输入 active、可选 unitId/modeKey；modeKey 只防止错误 provider 操作，当前产品仍取第一个受支持模式，不宣称任意 provider 选择。调用以 session/book guard 限定，读权限不包含 commands。启用等实际分段 ready/empty，失败返回稳定码；停用等实际 inactive。配置代次与分段反馈匹配，旧 ready 不能确认新配置。35 秒控制器截止覆盖下层 30 秒分段截止；不支持、未知单位、过期 provider 分别拒绝，不静默无操作。

[代码] 未完成配置被调用方取消/插件停用时，只撤回该请求自己的 active/unit 偏好；被后续 actor 或用户接管时旧取消不回滚新选择，连续替换也不以旧未完成请求为回滚基线。已完成的配置是用户模式偏好，不因发起插件停用自动关闭；与持续占有音频播放的 READ18 生命周期语义不同。换书/解绑取消 pending，旧 disposer 不解除新绑定。模式私有落点的内容版本校验和持久失败回执尚未实现，不能将这组配置契约当作位置恢复完成。

[代码] Listening Desk 0.2.0 的真实 header 弹窗加入开关、声明单位 ChoiceGroup 与 Apply，组合模式配置、朗读和导航历史。表单捕获 session/provider 前置条件，拒绝非法值并等待命令完成再刷新；不可用模式不显示假控制。仍为按需快照，外部改变需 Refresh，不冒充实时订阅视图。源码和 dist 同步，要求 reading ^2.2；没有增加 release BUNDLED 表项。Bun lockfile-only 未更新本地 workspace version，随后仅同步该 workspace 的版本字段。

[环境] [结构化证据](./evidence/reading-mode-2026-09-09.json)：实际隔离 macOS Tauri debug 中，Agent 开启句子模式返回 56/121 与实际 CFI；原生 header 的 Listening Desk 表单启用段落后显示 20/41 和段落 wash，再关闭成功。500ms/block 的真实 Worker 成功配置约 3066ms 完成，拒绝约 531ms 返回 reader/segmentation-failed、mode=error、CFI=null。Agent 中途取消回到 inactive；索引期间点击实际原生 Paragraph mode 按钮后，旧调用 reader/superseded，旧 abort 没有撤销新段落选择；关闭阅读使 pending superseded，迟到后仍 idle/no-session。只读 Worker 收到 mode 但 commands 不存在。真实 PDF 返回 unsupported-format，开启被 reader/unavailable 拒绝且状态不变。

[环境] Listening Desk 停用回归先确认宿主 mode=preparing，再停用插件，Worker 回调得到 plugin/cancelled，迟到后 mode=inactive、unit 回到旧值、插件 commands 为空。第一次按固定 100ms 停用时尚未到达配置调用，得到 plugin/unavailable，不算在途取消证明。另一次打开的是未重建 dist 的旧面板，没有表单；重建并重启该插件后才进行上述 UI 验收。

[代码/环境] 实机 provider 替换暴露了本轮初稿的 Maximum update depth exceeded：两个 effect 以不同渲染快照反向同步单位偏好。改为一个 controller 请求订阅写出最新值，外部偏好协调读取实时值，移除 Foliate 重复写入；新增真实 React provider 替换、外部设置与取消回滚回归，并重新执行原生 provider 切换/成功/失败。诊断文件修改触发 Vite reload 时已有探针已清理，重新导入并打开合成书后再验只读、插件取消和 PDF，不把旧 JS 句柄算作持续任务。

[环境] 新增 7 项控制器、3 项领域绑定、1 项 React 协调、1 项 Agent 完成/guard、2 项插件表单测试，并扩展其他断言。全仓 test 19 个任务、typecheck 22 个任务和生产 web 构建通过；保留既有 chunk/dynamic-import/Node DEP0205 警告。Rust 业务未改，隔离 debug 重编译成功；未跑 release 模式控制、Windows/Linux、远端 LLM/TTS 或磁盘失败验证。截图 `/tmp/readaware-mode-listening-desk.png` 已查看，正文/强调/表单可见且无观察到的重叠。

[代码/环境] 最后复核补上退役时的偏好撤回：不能只拒绝 pending，而让中途开启的 active 在下次打开自动恢复。退役恢复请求前的 active/unit，由 owner 在 navigator 已卸载时仍写回撤回值，内容不兼容的 resting 不保留；新增 React 关闭断言。重新冷启动隔离 Tauri，在 preparing 时关闭再打开同一 FB2，观察 ready session、mode=inactive、unit=sentence，并重跑成功配置与 provider 拒绝。此次冷启动因 lockfile 变化重做依赖优化，过早诊断 import 引发一次 boot module failure；确认挂载后 reload 再测试。书架顺序变化导致先点开合成 PDF，已关闭并重新选择 FB2，没有对其执行模式配置。

[环境] 重扫为 215 行 / 566 库存映射 / 129 旧验收项，30 个责任单元、30 个 catalog、32 个场景；READ16 两端从未接改为部分，不改绿。两个生成器、7 项模型门禁、两对 pair validator、diff 检查通过。矩阵与模型 HTML 在 1440×1000、1024×768、390×844 无页面横向溢出；中英文搜索、Escape/抽屉 inert、主题刷新保持、锚点/重复 ID 和截图检查通过，无浏览器错误，既有 CDN 返回 200。无新增图，文档仍依赖 CDN，不将文档浏览器当产品证据。诊断 commands/modes 为 0，Sentence Reader 恢复，Listening Desk 启用，阅读关闭；本轮隔离应用/文档浏览器已停止，5184/9224 无监听，正式数据未改。

仍未完成：READ16 公共上下一单元/跟随/回当前、内容版本化恢复、任意 provider 选择与跨节/全书末尾真实完成，模式偏好的持久失败契约，以及其余全部双端缺口、W01–W32 组合消费者和跨平台/release 验收。本轮完成的是模式配置这一可用契约，不是 READ16、D2 或整体目标完成。

## 2026-09-09 版本化模式位置与双端返回

[代码] `reading` 2.3 新增 `mode.position`，由 bookId/contentVersion/CFI/modeKey/unitId 组成；跨节普通导航不丢失 resting address。Agent `navigate_reading(return-to-unit)`、插件 `reading.commands.returnToMode(guard?)` 与原生回当前按钮共用会话控制器。它们等待真实页面落点、异步分段及已提交的模式反馈，全部满足后才确认成功并记导航历史。不能把原生移动已发生后的取消解释为 undo。

[代码] 私有模式状态新增内容版本；旧无版本位置不恢复，启用/单位偏好保留。当前版本来自实际文件 hash 或虚拟内容版本，加载器确认之前不写入未知版本。恢复重新调用引擎 CFI 解析并寻找包含其起点的单元，不再用旧 ordinal 钳制到新索引。内容版本变更废弃旧文档正在进行的分段；加载期间退出模式的偏好，在版本获知时完成保存，不会复活旧 active。

[代码] 返回遵守书籍/会话 guard，模式变更、取消、更新导航、关闭与截止时间均可终结等待；失败不提交返回历史。等待器监听实际 navigator 状态，不轮询或猜测固定延迟。Listening Desk 0.3.0 通过正式 Worker 命令组合模式表单、朗读、导航历史和 Current passage，支持 8 种语言；离开 resting 所在章节仍提供返回入口。实际消费者未增加专属 Agent 工具，沿用共享意图工具；release BUNDLED 名单不变。

[环境] [结构化证据](./evidence/reading-mode-return-2026-09-09.json)与[实际运行快照](./evidence/reading-mode-return-snapshots-2026-09-09.json)：隔离 macOS Tauri debug、合成 FB2，Agent 和实际 header 插件按钮从 Gamma 返回 Alpha 第 19 段，mode ready、CFI 与 19/41 索引匹配。最终 Agent 约 47ms；500ms/block 的真实 Worker 返回约 3102ms；拒绝约 523ms 返回 reader/segmentation-failed，随后 mode=error；中途关闭模式返回 superseded。关闭后从书架重开，自动恢复到相同版本化位置。探针清理后 commands/modes 均为 0，Sentence Reader 恢复。

[代码/环境] 实机先复现两个提前完成问题：页面已返回而 mode.cfiRange 仍 null；补上分段等待后，插件刷新仍读到旧的 No current passage。最终改为同时等待 navigator 与 React 已提交的 mode 反馈，实际按钮返回后直接出现 Stopped/Start，无需额外 Refresh。API 不将一次手工 publish 当作下游播放状态已就绪的证明。图标初稿使用未注册 crosshair，改为已有 book-bookmark，不为新插件添加宿主图标权力。

[环境] 全仓 test 19 个任务、typecheck 22 个任务、生产 web 构建通过；新增/扩展回归覆盖 CFI 边界、旧 Document、内容版本、分段变化、等待/取消、提交顺序与插件 guard。模型重扫为 215 行、567 入口映射、129 旧验收项、30 个责任单元/catalog 与 32 场景；两对文档生成检查、7 项模型门禁和 pair validator 通过。HTML 两份均验证 1440×1000、1024×768、390×844 无页面横向溢出，中英文搜索、Escape、移动抽屉 inert、主题刷新保持与重复 ID 检查通过，无浏览器 console/page errors。文档仍使用既有 CDN，无新图；此浏览器验证不是产品 E2E。

仍未完成：READ16 公共上下一单元、跟随、跨节/全书末尾完成、任意 provider 选择和模式偏好持久失败回执；其余双端缺口、完整 W01–W32 组合插件与全部桌面/release/跨平台验证仍在目标内。READ16 保持部分，不宣告整体能力齐全。

[环境] 最后重新编译并冷启动隔离 debug 实例，复测最终版本的 header 插件返回；正文恢复、Stopped/Start 与 book-bookmark 图标均在 `/tmp/reading-mode-return-plugin-cold.png` 核对。曾尝试的本地覆盖安装被 RepoDist builtin 保护拒绝，不算升级成功；临时直接 import 产生的重复模块/registry 诊断也不算产品证据，已用干净进程重验。Rust 保留既有 37 项 warning 与 block future-incompat 提醒，未改 Rust 业务。最终阅读已关闭。

[环境] 本轮文档浏览器与隔离 Tauri 已停止，5184/9224 均无监听；正式实例与正式数据未操作。未推送。

## 2026-09-09 双端单元步进与真实书尾

[代码] `reading` 2.4 新增 `commands.stepMode(next|previous, guard?)`；Agent `navigate_reading` 新增 next-unit/previous-unit。原生文本单元控件与自动朗读也调用同一会话控制器。回执包含 completed、sessionId、实际 mode 和 moved/start-of-book/end-of-book，不把页翻动或消息派发当作新单元完成。单元步进不添加显式跳转历史。

[代码] 遍历从版本化 resting CFI 开始，即使 viewport 已离开该章节，也先恢复再步进。每次跨节等待引擎页面、实际分段索引和 React 已提交的模式消费者；相邻节按 spine 顺序跳过 linear=no，成功空索引继续跨节，失败不当空节。首尾返回业务结果，无法解析、内容版本变化、分段失败与取消分别拒绝。沿用全来源导航最新意图优先、同引擎串行、30 秒截止；模式更换/解绑也取消等待。引擎不能 undo 已完成的页面移动，取消保证不再提交迟到的单元成功，而不是回滚物理页面。

[代码] ReadAloudController 消费步进 Promise，而不是等待六秒猜下一段。中间 section load 的空单元/旧反馈不能启动下一次音频，也不能取消自己正在等待的步进。moved 必须有不同 CFI 的实际单元；end-of-book 正常停止。停止、换声源、调用方取消会终止在途 advance；迟到结果不得复活音频。advance 的 35 秒截止覆盖阅读控制器的 30 秒截止。

[代码] Listening Desk 0.4.0 增加上下单元按钮、8 种语言的书首/书尾反馈，继续组合模式表单、朗读、回当前与跳转历史；所有动作捕获会话/书籍 guard，失败不刷新成成功结果。使用宿主已有 arrow-left/right 图标，不新增渲染权力。源码、dist、manifest 与 workspace lock 版本同步；仍是按需刷新视图，未新增 release BUNDLED 条目。

[环境] [运行证据](./evidence/reading-mode-step-2026-09-09.json)：隔离 macOS Tauri debug、合成 FB2；Agent 同节步进、书首、书尾，真实 Worker 从异章 viewport 回 resting 后继续，Alpha 末段到 Beta 首段再反向返回均观察实际 CFI/ordinal。冷启动下 500ms/block 的真实分段 Worker 跨节用时 3098ms，完成后才返回 moved；拒绝约 556ms 返回 reader/segmentation-failed；先观察 preparing 再取消，旧调用拒绝且未落新的 resting 单元、未增加历史。失败后的 error 快照与即时 preparing 快照属于不同提交时点，不混称同步完成。

[环境] 真实 Web Audio 播放探针的两秒音频，观察到倒数第二段 playing → 最后一段 playing → stopped，后端 plugin、无 fallback、无 timeout；最后一段单独启动也正常结束。此前系统声音 fallback 的初步运行不冒充插件声音证明。原生 Previous paragraph 按钮实际回到上一段；最终真实 header 的 Listening Desk 连点 Next unit，从 40/41 到 41/41，再出现 End of book。最终箭头图标和正文落点已在 `/tmp/reading-mode-step-plugin-final.png` 核对。

[环境] 首次桌面构建因磁盘不足失败，使用 `cargo clean -p read-aware-desktop --profile dev` 清理本仓库可再生编译产物后重建成功，未清理应用数据。开发 HMR 曾留下独立 plugin-host 模块，使探针停用未移除旧提供者；这段 provider 替换尝试不计证据。冷启动后明确仅剩诊断 mode/voice 再验慢分段与音频。一条长 MCP 前台脚本超出桥接器执行时限，其未完成跨节不计成功；后续用命名 stepJob 记录 running/终态后再继续。最终图标改动后再次重启，并在依赖优化 reload 后重新打开书籍完成视觉验收。

[环境] 全仓 test 19 个任务、typecheck 22 个任务、生产 web 构建通过；最后图标调整另跑 Listening Desk 6 项测试。新增/扩展测试覆盖跨空节/全空书/首尾、取消/误导航、不加历史、等待真实反馈、引擎串行、Agent scope、插件 guard 与音频终态。保留既有 Node DEP0205、chunk/dynamic-import、37 项 Rust warning 和 block future-incompat 提醒。重扫 215 行、568 入口、129 旧基线、30 单元/catalog 与 W01–W32，生成检查、7 项模型门禁与两对文档 validator 通过。两份 HTML 在 1440×1000、1024×768、390×844 检查无页面横向溢出，中英文搜索、Escape、抽屉 inert、主题刷新保持、无重复 ID/浏览器错误，仍使用既有 CDN，无新增图；不将文档浏览器当产品 E2E。

仍未完成：READ16 跟随、任意 provider 选择、模式偏好持久失败回执；空节/非线性及其他格式的实际桌面步进证据；完整单次插件取消契约、其余双端缺口、全部组合插件与 W01–W32、release/跨平台/远端 LLM 与 TTS 验收。READ16 保持部分，整体目标继续，不宣告能力全齐。

[环境] 最终探针 commands/modes/voices 已清空并恢复原插件，阅读关闭；文档浏览器与本轮隔离实例已停止，5184/9224 无监听。正式实例/数据未操作，未推送。

## 2026-09-09 双端模式提供者发现与显式选择

[代码] `reading` 2.5 扩展现有模式契约，不新增平行 registry。`session.mode.availableModes` 列出当前 reader 的注册 key、可区分的 label、units 与 defaultUnitId，不传递 executable provider。Agent `get_reading_session` 和插件 session/observeSession 共用该快照；无阅读会话时列表为空。`configure_reading_mode` / `commands.configureMode` 新增 `selectModeKey`，与 active、可选 unitId 一次配置；原 `modeKey` 仍为当前选择的前置条件，不改成目标参数。

[代码] 目标必须已注册，unit 必须属于目标 provider；省略 unit 时使用目标自己的有效偏好，否则使用声明默认值。首次没有 provider identity 才选注册列表第一项；之后按书保留选择，包括 inactive 和 provider 暂时失效时，不偷偷换到另一个插件。失效选择返回 no-provider，availableModes 仍列出可显式选择的替代者。旧无 modeKey 的单位偏好在首次采用 provider 时仍保留，但 provider 已保存的显式单位优先；此迁移分支有新增单测，未另做旧版本真实磁盘迁移 E2E。

[代码] 注册无关 provider 只更新发现快照，不取消当前请求或重建当前索引；当前实现换代、卸载或格式变化才使进行中的配置失效。取消撤回未完成请求前的 provider/active/unit，连续替换不以已被替换的中间请求作回滚基线；旧代反馈不确认新请求。完成仍等待实际 navigator 反馈，分段失败保留所选 provider 的 error 状态，不假装成功或静默换源；取消不是恢复此前物理页面或旧 resting CFI。

[代码] 原生 reader header 增加提供者 Select，在多个选项或失效选择仍有替代者时显示；继续遵守用户配置的 navigator 菜单位置。选择请求由稳定的 ReaderShellOverlay 层拥有，不由短命的 picker 拥有。Listening Desk 0.5.0 增加提供者表单，组合已有配置/步进/返回/朗读/历史；两个表单分别负责 provider 与 active/unit，捕获 session/book/provider 前置条件，失败不刷新成成功视图。8 语言、本地源码、dist、manifest 与 lock 版本同步，要求 reading ^2.5；未增加 release BUNDLED 项。

[环境] [结构化运行证据](./evidence/reading-mode-selection-2026-09-09.json)区分初稿与修复后的冷启动。隔离 macOS Tauri debug、合成 FB2：两个真实 Worker 提供者并存，Agent 选择 500ms/block 的诊断提供者，最终冷启动约 3073ms 才返回 ready/真实 CFI；Listening Desk Worker 能选择回 Sentence Reader。初稿实际 header 插件表单也完成选择，关闭/重开仍保留非第一项 provider 和 inactive。观察 preparing 后取消回到原 provider/unit，迟到分段没有抢回；拒绝约 535ms 返回 reader/segmentation-failed。只读 Worker 获得两个 availableModes，但 commandsAvailable=false。此为实际工具端口调用，不是远端 LLM 语义 eval。

[代码/环境] 实机发现原生恢复按钮的生命周期缺陷：最后一个可用选项被选中后，picker 不再需要显示并卸载，自身 cleanup 取消了尚未完成的选择。把请求所有权移到稳定 reader 层，新增真实 React 条件控件消失回归；冷启动重新卸载当前诊断 provider，确认保留 missing key/no-provider，再用原生 Select 选择唯一剩余项，最终 inactive、modeKey=sentence-reader:guided-reading，未回滚到 missing。初稿失败快照留在证据中，不计为通过。

[环境] 原生 picker 在 1200×800 和 800×600 检查，窄窗 panel 边界 x=366/right=686/bottom=138.5，页面 scrollWidth=800；截图 `/tmp/reading-mode-provider-native-final.png` 已查看。实际 Listening Desk 表单截图 `/tmp/reading-mode-provider-plugin.png` 已查看，两个表单/底部关闭可用，无观察到的遮挡。Vite 首次导入诊断路径触发依赖优化 reload；重取模块、重新打开合成书后才记录冷启动测试，没有把失效的 JS 引用算作活跃任务。

[环境] 全仓 test 19 个任务、typecheck 22 个任务与生产 web 构建通过，保留既有 Node/chunk/dynamic-import/Rust warning；web 构建不等于 packaged Tauri 验证。新增 6 项控制器测试、1 项 native owner React 测试、1 项插件表单测试，并扩展 Agent 参数及 React 协调断言。同步校正文档中句读/TTS 已有通用宿主工具却仍写“无直接操作”的旧汇总。矩阵重扫 215 行、568 入口、129 旧验收项；模型 30 单元/catalog 与 32 场景；生成检查、7 项模型门禁、两对 pair validator 通过。

[环境] 两份 HTML 在 1440×1000、1024×768、390×844 检查无页面横向溢出，中英文提供者查询可筛选、Escape 清空/关闭抽屉、inert 恢复、主题刷新保持；无重复 ID/浏览器错误，既有 CDN 请求 200，没有新增图。该文档浏览器检查不是产品 E2E。探针清理为 0，原插件未停用，阅读已关闭，隔离应用已停止，正式实例与正式数据未操作。

仍未完成：READ16 跟随、模式偏好持久失败回执；其他格式/空节/非线性实机覆盖，通用 provider broker、其余全部双端缺口、完整 W01–W32 组合消费者、release/跨平台/远端服务验收。READ16 与整体目标保持未完成，不以本次提供者选择通过宣称宿主能力全部齐全。

## 2026-09-09 双端设置原子保存与真实回执

[代码] `domains.settings` 1.1：Agent `update_settings` 与插件 `settings.commands.update` 的单条已验证命令，由 `domain/settings/persistence.ts` 编码为宿主私有 KV 批次，经同一个写队列调用 Rust `set_kv_batch`。general、appearance、reading、readerOverrides、AI preferences、非敏感 AI config、menus 和已声明插件设置跨记录全部提交或全部回滚。没有向插件开放任意 KV/SQL/事务句柄；AI 配置编码与 native save 共用，不触碰秘密存储。目录未开放的设置没有因此变成已接通。

[代码] 回执等待 SQLite commit，失败保留 IPC 稳定错误码并且不发 `settings.changed`。跨 actor 的领域命令先等前一命令结算；读取草稿前还等待已经接收的原生 UI/远端 KV 写入结算，无微任务空隙地读取并入队新事务。后续命令不会带入前次失败的乐观字段，也不会把尚未提交但相同的 UI 值误判成已保存的 no-op。仍不承诺无限连续写流下的公平性/期限或跨设备事务。

[代码] 通用设置与菜单的 base atom 跟随 KV 乐观镜像和回滚，不经 public setter 二次写入。语言切换由同一镜像驱动；插件声明设置从实际 KV 变化合并失效通知，在所有 KV 观察者更新 Worker 镜像之后再通知表单、模式与提供者。原生插件设置 form 返回精确 write Promise，而不是立即成功；写失败通知在回滚后触发。受限插件 update 的返回快照补上与 read 相同的路径过滤，防止仅有一个设置写权限却收到全部设置。

[环境] [结构化证据](./evidence/settings-durability-2026-09-09.json)：仅使用隔离 macOS Tauri debug `com.readaware.app.capability-e2e`，5184/9224，正式应用与数据未操作。调用实际产品 Agent 工具端口与 `settings-probe.ts` 的真实 Worker，不是模拟 Worker/浏览器存储；没有远端 LLM 语义评估。SQLite 临时 `settings_e2e_reject` trigger 拒绝 theme=light 或 probe enabled=true。跨 general/appearance 命令在后一条记录失败时，两端均返回 db/error，前一条 general=startView 的改动也回滚，未新增成功事件；直接读取隔离数据库确认 dark/resume 保持。失败后插件 motion=reduced 正常提交，返回值只有三个授权路径；无权限修改 crashPrompt 被拒绝且无事件，但该拒绝目前仍无稳定 code，已保留在证据边界。

[环境] 原生声明表单的真实 Worker storage.onChange 观察序列为 enabled=false → true → false；表单自身返回 db/error，磁盘仍为 false。清除 trigger 后恢复成功。初稿运行、统一失效通知后的冷启动以及最终 afterPending 读屏障后的冷启动分别留存；最后再次验证 Agent 故障与 Worker 恢复，不拿旧进程结果替代最终代码。MCP 原生截图查看了实际 dark 应用，没有把文档浏览器算作产品验证。

[环境] 5 项独立进程的 native-IPC 控制测试覆盖延迟回执、整批失败、两端并发、表单回滚通知、原生 UI 写入失败与 no-op；采用子进程以免 Tauri 检测和全局事件时钟污染其他套件。Rust 事务测试用真实 SQLite trigger 验证 insert/update 全部回滚及恢复；全 Rust lib 测试 127 通过、既有百万事件压力测试 1 项 ignored。全仓 test 19 个任务、typecheck 22 个任务、生产 web build 通过；保留现有 Node/chunk/dynamic-import 与 Rust warning。该 web build 不等于 packaged Tauri 验证。

[代码/环境] 重扫 215 行、569 入口映射、129 旧基线、30 单元/catalog 与 W01–W32，7 项模型门禁通过。补正摘要中遗漏的 Annotation Desk，源码九插件与编译内置六插件分开计数。矩阵、统一模型与插件架构三对文档同步；pair validator 通过，三页均检查 1440×1000、1024×768、390×844 无横向溢出，中英文搜索与 Escape 可用，现有模型/矩阵抽屉和主题保持有效；无重复 ID/浏览器错误。既有 CDN 依赖不变，无新增图。

仍未完成：CFG10 全来源带 revision/origin 的设置领域广播、所有 UI 字段草稿和系统效果验收、权限/校验错误统一 code、远端漫游持久完成；READ16 模式专有持久回执不属于 settings.commands.update，本次没有关闭。其余双端缺口、完整组合插件/W01–W32、packaged/跨平台/远端服务验收继续保持未完成。探针贡献清理为 0，偏好恢复，临时 trigger 与 probe KV 清空，隔离应用和文档浏览器停止；未推送。

## 2026-09-09：九项真实偏好的双端入口与效果

[代码] `domains.settings` 1.2 将 CFG04/05/06/11/12/13 接入同一目录、授权、校验和 SQLite 原子批次：`reading.textAlign`、`reading.fixedLayoutColor`、`general.whatsNewDialog`、`appearance.contentTypography.followReader/fontFamily/fontSize/lineSpacing`、`annotations.defaultColor`、`general.updateChannel`。前两项支持 global/book/all-books，其余仅 global。新增 annotations section，Agent 的 get_settings schema 与工具说明同步；插件仍需精确路径或对应通配授权。原 SET01–SET46 保持 ID，新增 SET47–SET55。

[代码] 内容字体跟随的是全局阅读偏好，不是本书 override；独立字体/字号/行距只在 followReader=false 生效，fontFamily=null 表示应用 sans 字体而不是删除覆盖。内容字体 base atom 跟随 KV 变化与回滚。默认标注色和更新通道保留现有原始字符串存储，不误写成带引号的 JSON。已挂载阅读器在高亮/下划线动作发生时读取默认色，不再捕获初次挂载颜色；原标注不重染。原生改色的默认偏好写入返回真实 Promise，拒绝进入原有错误表面，不产生未处理 rejection。AboutPanel 用外部存储订阅读取当前通道；设置通道既不漫游，也不会自动检查、下载、安装或重启。

[环境] 隔离 macOS debug Tauri（com.readaware.app.capability-e2e，5184/9224）的证据见 [settings-content-preferences-2026-09-09.json](./evidence/settings-content-preferences-2026-09-09.json)。复用真实 Worker 探针，以九条 settingsAccess 写授权组合更新；Agent 使用真实 buildSettingsTools/update_settings 和运行时端口，未使用远端模型：

- Worker 更新九字段后，根节点字体为 Georgia、字号 1.0625rem、行距 1.9；Agent 切 followReader=true 后，实际恢复 Inter/0.875rem/1.65。随后 Worker 写 fontFamily=null，根节点行内字体属性被移除，实际采用应用 sans。
- AboutPanel 已挂载时，Agent 改 stable、Worker 改 beta，按钮 aria-pressed 随之切换，没有触发更新检查。
- FB2 正文实际 computed text-align 从 justify 变为 start。阅读器挂载后 Agent 将默认色改 pink，通过真实高亮工具栏创建的标注落入 SQLite 为 pink，截图 `/tmp/settings-content-native-reader.png` 显示对应高亮。随后 Worker 将默认色改 blue，旧标注仍 pink。选区用 DOM Range 创建，高亮动作走真实宿主 UI，不冒充完整鼠标拖选测试。
- PDF 固定版式四张已渲染页面均有 2400×3200 非空 canvas；theme 背景像素为 [245,241,232,255]，Agent 切 original 后为 [255,255,255,255] 且文档背景清空。此处验证真实重新绘制，不以设置回执替代效果证据。
- 在隔离 app_kv 上用 BEFORE INSERT trigger 拒绝默认色写入。Worker 的内容字体/通道/默认色批次和 Agent 的内容字体/默认色批次均返回 db/error；字体、原始字符串 KV 与颜色回滚，成功事件增量为 0。移除 trigger 后正常写入恢复。
- Worker 混入未授权 appearance.motion 的批次被拒绝，允许的默认色也未改变，成功事件增量为 0；拒绝 code 仍为 null，不能算稳定错误码已完成。

[环境] 五项新增回归覆盖九路径发现、实际枚举/范围、按书覆盖与全书更新、独立字体与 null、缺失插件字体、标量编码、已订阅通道刷新、返回授权过滤及非法值整批拒绝。最终全仓 test 19 个任务通过（17 缓存，web 695 项及 Agent 任务重跑），typecheck 22 个任务通过（20 缓存），生产 web 构建重新执行通过。没有修改 Rust，本次未重跑 Rust 全量；web build 不算 packaged Tauri 验收。保留既有 Node/chunk/dynamic-import 与 Rust 编译警告。

[代码/环境] 重扫为 224 行、578 入口映射、129 旧基线、30 责任单元/catalog、32 场景，生成检查、7 项模型门禁、三对文档 validator 通过。统一模型中仍称 CFG11–13 路径不存在及 Jumper 未实现的历史模板文案已纠正。矩阵、模型、插件架构 HTML 均检查 1440×1000、1024×768、390×844，页面无横向溢出、重复 ID 或失效页内锚点；中英文检索、Escape，以及矩阵/模型已有抽屉 inert 和主题刷新保持通过。插件架构搜索关键词补入九项路径名。截图 `/tmp/settings12-{matrix,model,plugin-system}-{1440,390}.png` 已检查。无浏览器 console/page error；现有 CDN 返回 200，不增加图，文档仍依赖网络，不能把文档浏览器算产品证据。

[代码] 再查设置契约，CFG03 仍没有 reset/inherit/provenance；CFG10 仍没有全来源带 revision/origin 的领域广播。对 AI 执行目录和 packages/agent/src 再检索，buildMemory、sendHighlightedText、sendSurroundingContext、localOnly 仍仅在偏好存储/目录定义中出现，没有执行消费者。其余六个旧无效果路径仍保持部分，不因本批增加九字段而改绿。下一步优先处理这些隐私开关的真实执行约束，再补设置覆盖/观察和其他双端缺口。

仍未完成：上述十个无效果设置、reset/inherit、完整观察和稳定错误、其他全部双端缺口与 W01–W32 实用组合、这九项的更新后重启/packaged/跨平台验收及远端服务验收。本批探针是诊断性组合，不冒充新增已交付的第一方实用插件。九项偏好已恢复，测试标注通过事件路径删除，贡献为 0、probe KV 与临时 trigger 清空；隔离应用与文档浏览器已停止，正式数据未触碰，未推送。

## 2026-09-09：双端宿主推理的实时仅本地策略

[代码] `ai.preferences.localOnly` 不再只保存值。产品唯一的 `createAgentRuntime` 接入 live InferencePolicy，smart/fast 的 complete/stream、自动管线调用以及 Worker `services.llm.ask` 普通/结构化/流式均经共享模型边界。原生连接测试也接入同一策略。缓存 runtime 不缓存偏好结果；每次调用和实际 fetch 前重查，启用后返回非 retryable 的 `ai/local-only`，在途调用取消原生 transport signal，独立终结等待并抑制迟到结果和旧请求重试。恢复只允许新调用。当前产品没有本地模型后端，Custom loopback 也拒绝，不凭 URL 猜测运行地点。

[代码] SDK 会将错误压为字符串，稳定 `[ai/local-only]` 标记在模型错误分类时恢复 code；八语言 `describeError` 提供本地化提示和 AI 设置动作，原始文本不直接进入 UI。流式累计消息按已接受事件取快照，防止 provider 在取消后原地修改对象污染返回结果；调用终态释放偏好与取消监听。仅本地策略不新增模型工具、不授予插件配置凭据的权力，开关仍走原有精确路径授权。

[环境] [结构化证据](./evidence/inference-local-only-2026-09-09.json)来自隔离 macOS debug Tauri `com.readaware.app.capability-e2e`（5184/9224）和受控 OpenAI-compatible SSE 服务（19843），不是浏览器代替产品，也不是远端模型语义 eval：

- 五次正向调用完成：实际 Agent ask、原生连接测试、真实 Worker 的普通/结构化/流式 ask。
- Agent 设置 localOnly=true 后，Agent ask/sendTurn、连接测试及 Worker 三种 ask 均返回 `ai/local-only`；服务请求数保持 7（其中最初两次属于失效准备尝试，不计有效正向案例）。
- Worker 设置恢复后并发启动 Agent 与 Worker 的 HOLD 请求，服务记录 9 次；Worker 再启用仅本地后两者均终结为失败，两个连接 cancelled=true。Worker 只保留取消前的 first，release 后没有 late delta。再次恢复后两个新请求成功，旧调用仍为失败。
- 实际设置 UI 的 Test Connection 显示本地化拒绝提示，服务请求数未增加。截图 `/tmp/inference-local-only-native-visible.png` 已查看。
- 对隔离 `app_kv` 的 AI 偏好 UPDATE 注入 SQLite trigger 拒绝。Worker 设置返回 db/error，成功领域事件为 0，localOnly 回滚 false；之前已启动的两个 HOLD 仍被取消、不复活，随后 Agent/Worker 新调用成功。trigger 已移除。

[环境/修复] 初次探针只有内存备份，Vite 优化 reload 后丢失原隔离配置备份。这次尝试不计恢复成功，只移除了精确匹配的测试配置与测试密钥；不能声称初始隔离配置原样恢复，正式应用数据未接触。探针现已在变更前将备份存入原生加密 secret store，重复准备拒绝覆盖备份；实际 prepare → WebView reload → 重导入 cleanup 验证恢复到清理后的基线并删除备份。故意 reload 还出现一次 `useWindowMaximized` 的 Tauri listener cleanup rejection，保留为未覆盖的开发生命周期问题，不称全程零错误。

[环境] 最终七项策略回归覆盖 preflight、迟到结果/重试、已接受 partial 的对象隔离、调用者取消、重启新调用、loopback 连接及 per-stream fetch/SDK signal；既有五项 complete 测试保留。全仓 test 19 个任务、typecheck 22 个任务和生产 web 构建通过；八语言错误 key 校验通过。没有 Rust 业务代码改动，未重跑 Rust 全量或 packaged 构建。原生验证早于最后的 partial 对象快照加固，该加固有专门单测，不冒充再次全量原生验收。

[代码/环境] 重扫仍为 224 行、578 入口、129 旧基线、30 责任单元/catalog 和 32 场景，七项模型门禁、生成检查、三对文档 validator 通过。矩阵将“无效果消费者”降为九条，但 SET27 保留部分，不改变双端状态计数。三份 HTML 在 1440×1000、1024×768、390×844 检查无页面横向溢出、重复 ID、无名按钮和失效页内锚点；中英文搜索/Escape、已有抽屉 inert 与主题刷新保持通过。新增说明的嵌套搜索标记曾让父节隐藏，已把关键词放回父节并复检可见性。截图已查看；浏览器无 console/page error，现有 CDN 200，无新增图，文档仍依赖网络。

仍未完成：任意已授权插件 HTTP、TTS、同步等不在此推理策略中，不能宣称全局禁止远端处理；`buildMemory`、`sendHighlightedText`、`sendSurroundingContext` 仍仅在偏好和目录定义，无执行消费者。其他六个无效果设置、reset/inherit/观察/权限稳定错误、其余双端缺口、W01–W32 的实用组合插件与全部原生/packaged/跨平台验证继续未完成。本批 Worker 是诊断性组合，不冒充实用插件交付。最终两探针贡献为 0，配置/测试密钥/加密备份/探针 KV/trigger 清空、localOnly=false；隔离应用、受控服务和文档浏览器停止，5184/9224/19843 无监听，未推送。

## 2026-09-09：双端记忆构建策略与 Reading Goals 组合插件

[代码] `ai.preferences.buildMemory` 接入 live MemoryBuildPolicy，不再只保存值。唯一产品 runtime 的依赖和显式 remember 工具共享策略，覆盖 onboarding seed、旧历史领养、轮后抽取/强化、插件候选提升、滚动摘要、巩固/衰减、章节 digest 和自动叙事分类。调用租约在任务入队时建立；关闭时立即拒绝新操作，取消在途模型请求和排队任务，返回稳定 `ai/memory-disabled`，重开不复活旧任务。复用上一批推理策略的取消原语，没有新建第二套模型传输或按插件 ID 特判。八语言错误提示已补齐。

[代码/边界] 开关不删除旧记忆、不阻断旧记忆检索、普通聊天/原始历史、标注、用户删除或插件自己的目标存储。重开后的新任务可以处理保留下来的历史，不是永不回溯的隐私标记。已经派发的底层写不承诺事务撤销；已运行插件 provider 的自身副作用不随宿主取消而回滚，但宿主停止等待且拒绝提升迟到结果。画像/实体投影和产品 onboarding 闭环没有因此完成。既有抽取/摘要的降级路径仍会记录策略取消 warning，不声称运行时零告警。

[代码/修复] 追查实际持久端口发现摘要 put/clear 与画像 put 虽声明 async，却调用同步 fire-and-forget KV。摘要现在先等待此前 KV 写入结算，再读取/修改聚合记录并等待本次 SQLite 提交；清除失败向 discardThread 调用者传播，不提前确认删除。画像 put 同样等待持久 Promise。画像端口增加单测，但不把这项单行修复算作已重新完成原生画像 E2E。取消中的巩固还增加晚到读回归，不能在 lease 已失效后把 dirty revision 标记为已巩固。

[代码] 新增 Reading Goals 0.1.0：reader header 弹窗/命令、按书私有目标、可选的书内记忆候选、每轮上下文 provider 和宿主记忆开关，组合现有正式能力。目标表单捕获显示时的书籍，书切换后仍保存原目标；provider 按宿主请求 scope 读取，不偷用当前 reader。保存目标与更新宿主策略是两个独立提交，失败不刷新成成功视图。清除仅删除私有目标，不删除之前已提升的记忆。八语言、manifest/dist/lock 同步，源码插件十个、编译 BUNDLED 仍六个。本插件没有专属 Agent 目标编辑工具，模型消费其上下文/候选并通过通用 settings 控制策略；没有把注册 header action 当成模型工具。

[环境] [结构化证据](./evidence/memory-build-policy-2026-09-09.json)来自隔离 macOS Tauri debug（`com.readaware.app.capability-e2e`、5184/9224）、两个仅供测试的合成 FB2 和 19843 受控 SSE 服务。正式实例、正式书库及真实外部模型未操作：

- 真实 Reading Goals Worker 注册四项贡献。原生表单保存目标并选择候选；受控服务确认 chat 带有目标，开启构建后候选经真实宿主事件路径成为书内 preference，摘要入 SQLite。
- 关闭构建后，原生聊天 UI 仍显示回答并保存两条消息，已存记忆/摘要保留；实际 remember 工具返回 ai/memory-disabled，新的构建模型请求不发起。直接 runtime 探针的 append 是产品刻意 no-op，不能用它的 turns=0 推断 UI 历史丢失；历史证据单独来自 UI。
- 挂起一次抽取后由 Agent 设置关闭策略，服务观察连接 cancelled=true，flush 结束；重开并 release 后旧目标没有入库，改用新目标启动新轮才成功提升。单测另外覆盖挂起插件候选与排队轮次的 off/on 同时失效。
- SQLite 临时 trigger 分别拒绝目标、宿主 AI 偏好和摘要写。目标草稿保留，数据库旧值未变，原生 UI 给出本地化失败；策略写返回 db/error 并保持关闭，remember 仍拒绝；摘要 put/clear 都返回 db/error，清除失败保留旧摘要。移除 trigger 后新写成功。诊断 SELECT 曾误用 value 字段，重新查 schema 后改为 value_json；未把该失败记为读库通过。

[环境] 原生弹窗 1200×800、800×600 截图已查看；窄窗界限 x=176/right=624/top=73/bottom=527，页面宽度 800，body 可滚动（295/444），表单文本无水平溢出。初次截图只是 loading，待真实 form 出现后替换。合成 Tab 未建立真实键盘遍历证据，一次滚动定位用了不存在的 selector；因此不声称屏外控件与完整键盘验收通过。目标保存的真实 UI 成功/失败已验，策略主要通过真实 Worker 表单回调检验，不能冒充所有控件都点击过。

[环境] 最终全仓 test 20 任务通过（18 缓存；web 698 项）、typecheck 23 任务通过（21 缓存），生产 web 构建重新通过；构建仍有既有 Node/chunk/dynamic-import 警告。无 Rust 业务改动，未重跑 Rust 全量或 packaged Tauri；web build 不算打包验证。新增/扩展的策略、排队、晚到巩固、摘要/画像持久和插件作用域测试均进入全仓运行。

[代码/环境] 重扫为 224 行、579 个库存映射、129 个旧验收项、30 个责任单元/catalog 与 32 个场景。生成器先正确拒绝未映射的新源码插件，补上实际消费行后通过；没有通过空映射消除错误。SET23 构建开关接通，八项无效果设置仍保留；修正旧汇总误把 localOnly 写成 SET27 的编号（实际 SET26）。三对 MD/HTML、七项模型门禁与生成检查通过；HTML 在 1440×1000、1024×768、390×844 检查无页面横向溢出、重复 ID/失效页内锚点/无名按钮。中英文查询、Escape、已有抽屉 inert 和主题刷新保持已检验；CDN 200，浏览器无 console/page error，文档不增加图且仍依赖网络。文档浏览器不是产品验收。

仍未完成：sendHighlightedText/sendSurroundingContext、其他六项无效果设置、插件候选公共接受/拒绝回执、目标的专属模型操作、Reading Goals 安装重启/packaged/跨平台/完整键盘验证，以及其他双端缺口和 W01–W32 全组合。不能据本批候选入库就关闭 MEM03 的全部插件契约或总体目标。三个探针贡献最终为 0，测试书、私有目标、摘要及 marker 清理；记忆用事件路径遗忘，测试配置/密钥备份恢复，buildMemory=true/localOnly=false，trigger 清空，隔离应用与服务停止，5184/9224/19843 无监听，未推送。

## 2026-09-09：模式配置精确持久回执与回滚归属

[代码] `configure_reading_mode` 与 `reading.commands.configureMode` 保持原 public schema，复用同一个 ReadingModeController。配置意图先等待已有 KV 写入结算，再把书内 active/modeKey/unitId 与所选提供者单位偏好编码为一批 `set_kv_batch`，任一记录拒绝则整批回滚。无提供者时仍可保存书内停用意图，但不写未注册提供者的设置。未向插件开放原始 KV、SQL 或事务权力。

[代码] ReadingModeWrites 按请求 revision 保留精确写 Promise，早于索引反馈的失败不会被晚到的 flush 遗忘。配置完成需同时满足实际索引反馈、该请求配置提交及已注册首次位置保存。位置写由宿主控制器延迟派发，先等待配置成功，再核对 revision/modeKey/unitId，避免旧 React effect 把失败或取消的状态写回。保存期间取消/截止仍生效；同值配置的等待也有截止。已派发的原生写不能强行撤销，不能把取消解释为整个操作的事务回滚。

[环境/修复] 初稿在真实 SQLite 故障下注入失败，实际 Agent 返回 reader/superseded 而非 db/error，requestedActive 还停留 true。原因是插件设置的乐观回滚被协调 effect 当成了新选择。修复后该 effect 等待当前写结果，再读实时偏好；持久失败直接向原操作拒绝，并恢复先前请求，未完成的原生选择也不能成为后继失败的恢复目标。并非只给工具 catch 包一层错误。

[环境] [结构化证据](./evidence/reading-mode-durability-2026-09-09.json)：仅操作隔离 macOS debug Tauri `com.readaware.app.capability-e2e`（5184/9224）及已有合成 FB2。实际 Agent 工具端口与已安装 Listening Desk Worker 表单回调，分别遇到书内记录、提供者偏好记录拒绝时，均返回 db/error，模式/SQLite 保持 inactive + paragraph。移除 trigger 后 Agent 启用 sentence、Worker 切 paragraph/停用正常；落盘 resting CFI 与回执一致，关闭重开后同一位置恢复。最终代码编辑后重跑两端偏好故障与恢复，未拿旧进程结果冒充最终测试。无远端模型语义 eval。

[环境] 真实慢分段 Worker 500ms/block：Agent 选择诊断提供者时先观察到 preparing 且未完成；取消并等 600ms 后仍是原 Sentence Reader、inactive、paragraph。新提供者已提交的单位偏好并未随选择取消全部撤销，已明确保留跨提供者补偿缺口，清理时恢复其备份。原生模式按钮的 MCP selector 调用触发了本地化 Change not saved / 数据库错误 toast，截图已查看；工具报告坐标 y=-24，不能算可见控件的物理指针命中或完整键盘验收。

[环境] 另一 SQLite 连接持有 BEGIN IMMEDIATE 时，MCP 观察超时；释放锁后同一 app 恢复，操作返回 db/locked。没有按超时重启进程，也没有把这次锁测试记为原生 UI 响应性或延迟成功回执通过。受控 IPC + 实际 React hook 的独立进程测试另外覆盖延迟回执、两记录原子失败、回滚不是新意图、配置失败/取消不派发旧位置写。它们不等同真实 SQLite 锁时的 UI 性能测试。

[环境] 全仓 test 20 个任务通过，web 710 项（另有子进程 3 项 React/IPC 场景）；typecheck 23 个任务、生产 web build 通过。新增 7 项 controller、4 项精确写屏障回归；保留既有 i18n 测试警告、Node/dynamic-import/chunk 构建 warning。无 Rust 实现改动，未重跑全 Rust 或 packaged build。最后仅将测试中的 Promise<any> 收紧为 Promise<unknown>，并重跑相应测试/类型检查。

[代码/环境] 重扫仍为 224 行、579 入口、129 旧验收项、30 责任单元/catalog、W01–W32。7 项模型门禁与生成检查通过。READ16 不改为接通，细分跟随、后续步进/返回持久回执、旧偏好迁移失败及跨提供者取消补偿缺口；同时纠正 plugin-system 双版本中“模式/播放全部未接”的过时汇总。三对 MD/HTML validator 通过；三份 HTML 在 1440×1000、1024×768、390×844 无页面横向溢出/重复 ID/失效页内锚点，中英文查询与 Escape 可用，模型/矩阵已有抽屉 inert 和主题刷新保持正确，CDN 200、无浏览器 error，抽查截图已查看。无新增图，文档仍依赖网络；文档浏览器不算产品 E2E。

仍未完成：上述 READ16 子项、8 个无效果设置、其他双端缺口、完整实用组合插件/W01–W32、全部格式、packaged 与跨平台验收。实际复用了 Listening Desk，本批没有新建实用插件。隔离书已关闭，测试 trigger 清空、分段探针贡献为 0，书内模式/原插件/诊断插件偏好恢复备份；已有合成书未删除，测试过程的阅读会话/进度未倒写。正式应用及书库未操作。隔离 app 与文档浏览器已停止，5184/9224 无监听；未推送。

## 2026-09-09：双端步进与返回的位置持久回执

[代码] `ReadingModeController` 将后续位置保存与配置保存分开建模：步进和返回先等待实际页面/分段/React 反馈，再等待对应 bookId/contentVersion/modeKey/unitId/CFI 的精确 SQLite 写 Promise。配置尚未完成时首次位置失败仍使配置失败；配置成功后的移动失败不再污染整个模式 revision。已有失败仅由下一次明确动作重试，新失败必须传给本次调用者；同目标重写等待最新回执，不同目标、模式退出、取消或新导航拒绝旧等待。普通步进不添加跳转历史，返回仅在持久成功后记录历史。未新增插件特判、公开 SQL 或第二套 Agent 实现。

[代码/边界] `mode.status=ready` 仍表示索引完成，不表示已保存。失败不会撤销已发生的页面移动，取消也不能强行撤销已派发的原生写；但等待者可以及时释放，不被不响应的存储 Promise 占住导航队列。自动朗读消费同一公共步进回执，下一段位置保存失败时停止并保留数据库 code，不继续播放未保存单元。

[环境] [结构化证据](./evidence/reading-position-durability-2026-09-09.json)来自隔离 macOS debug Tauri（5184/9224）和已有合成 FB2。实际 Agent 工具与 Listening Desk Worker 的步进/返回均在 SQLite trigger 拒绝位置写时返回 db/error，移除故障后无需重新配置即可恢复。最终源码再次复测步进：Agent/Worker 先后落到 ordinal 15/16 但磁盘保持 14；移除 trigger 后 Agent 到 17、Worker 回 16，磁盘与后者 CFI 一致。原生返回测试的 history 布尔值不证明栈深，失败不记历史由领域时序测试独立确认。两秒本地 PCM 诊断声源的真实播放轨迹为 playing → advancing → error/db/error，没有第二次 playing；不是远端 TTS 或模型语义 eval。

[环境] 实际可见 Next paragraph 控件在 1200×800 的 rect 为 x=470.5/y=747/w=28/h=28，MCP 点击中心后出现本地化保存失败，移除故障再次点击恢复。截图 `/tmp/reading-position-save-error.png` 已查看，包含三条故障测试 toast，不声称一次点击只产生一条通知或完整键盘体验通过。启动曾记录 web content process terminated，随后正常 hydrate/mount 并完成测试，不声称零启动错误。

[验证] 五个聚焦文件 41 项、153 次断言通过，覆盖延迟持久、早到失败、明确重试、同目标覆盖、目标/内容变化、退出、取消与历史提交；已有 i18n 测试 warning 保留。全仓 test 20 任务和 typecheck 23 任务通过，最后复检均命中相同源码缓存，web 为 719 项；生产 web 构建通过，但不等于 packaged Tauri。无 Rust 业务改动，未重跑全部 Rust 测试。矩阵/模型生成与七项反例门禁通过，仍为 224 行、579 库存映射、129 验收项、30 责任单元/catalog、32 场景。三对文档 validator 通过，三份 HTML 在 1440×1000、1024×768、390×844 无页面横向溢出、重复 ID、失效页内锚点或无名按钮；中英文搜索/Escape、已有抽屉 inert 与主题刷新保持通过，无浏览器 console/page error 或已观察资源 HTTP 错误。初次浏览器停在 about:blank，确认同一活动 session 后重新导航才计入验证。移动截图已查看；无新增图，文档仍依赖 CDN，浏览器检查不是产品 E2E。

仍未完成：READ16 的跟随控制、旧偏好迁移失败、跨提供者取消补偿，以及其他双端缺口、8 个无效果设置、完整实用组合插件/W01–W32、全格式/packaged/跨平台验收。本批复用 Listening Desk 和诊断声源，不冒充新增实用插件。隔离书已关闭，两个探针贡献清零，原 TTS 恢复，书内模式与 Sentence Reader 偏好经原生 KV 恢复备份；临时 trigger 清空。保留已有合成书，不倒写测试产生的阅读进度/会话。隔离 app 进程确认退出、5184/9224 无监听，文档浏览器关闭；正式应用未操作，未推送。总体目标继续。

## 2026-09-09：旧阅读偏好的原子迁移与所有权

[代码] 移除 `readTextUnitModeSettings` 中异步写新设置、立即删旧设置的副作用。读取只合成有效旧值与现有插件值，现有值优先；带有其他 modeKey 的旧记录不复制、不消费。配置把书内状态、合并后的插件设置、旧记录删除交给同一个 SQLite transaction；宿主内部 `set_kv_batch` 扩展 null 删除语义，仍不向 Agent/插件暴露 KV 或 SQL。行为设置 patch 等待前序写入提交/回滚后再读和合并，避免从未结算的旧快照重写。坏 JSON/null/数组等不贡献偏好，仅在成功提交时清理。

[环境] [迁移证据](./evidence/reading-mode-migration-2026-09-09.json)：重新编译并运行隔离 macOS debug Tauri，真实 Agent configure_reading_mode 与 Listening Desk Worker 表单分别遇到 `app_kv` 的 BEFORE DELETE trigger 拒绝旧记录删除。两端都返回 db/error，SQLite 旧记录与原插件设置保持不变，书内仍 inactive/paragraph；持续故障下回滚配置也失败，快照诚实地停在 error，不算正常 inactive 成功。移除 trigger 后 Agent 启用 sentence，Worker 停用/切 paragraph 均成功，旧记录才消失；新注入的旧值不能覆盖已迁移插件值。关书重开保持设置。原生验证不包含全部 UI 点击、模型语义或跨提供者切换故障。

[验证] Rust 全量 lib 测试 128 通过、1 忽略；新增删除失败回滚测试与原目标写入拒绝测试均通过。React/受控 IPC 的四项场景证明三记录回执在延迟时不提前完成、删除失败与持续回滚失败保留源记录、明确重试恢复。初版断言忽略了后继回滚事务的乐观删除，已改为分别核对磁盘和该事务结算后的镜像，未把乐观删除误判为持久丢失。纯读、异主保留、无效 JSON、批次 tombstone 提交通知均有测试。全仓 test 20 任务（web 721 项）、typecheck 23 任务及生产 web build 通过；保留现有 i18n/Node/chunk/Rust 警告。真实 debug 重编译不等于 packaged release，未宣称跨平台完成。

[代码/环境] 重扫仍为 224 行、579 库存映射、129 验收项、30 责任单元/catalog、32 场景；生成一致性与七项模型门禁通过，READ16 保持部分。三对文档 validator 通过，三份 HTML 在 1440×1000、1024×768、390×844 无页面横向溢出、重复 ID、失效页内锚点、无名按钮或已观察资源 HTTP 错误；中英文搜索/Escape、已有抽屉 inert 与主题刷新保持通过，无 console/page error。初次 about:blank 不计验证，重新导航后才检查；截图只检查了首页，不冒充展开详情截图。无新增图，文档仍依赖 CDN，文档浏览器不是产品 E2E。

仍未完成：READ16 跟随与跨提供者取消补偿、其他双端缺口、8 个无效果设置、实用组合插件/W01–W32 全覆盖、全格式/packaged/跨平台验收。本批复用 Listening Desk，没有新增实用插件。隔离书已关闭，三项偏好备份经原生 KV 恢复并读库比对，临时 trigger 清空；保留合成书，不倒写测试阅读进度。隔离 app 确认退出、5184/9224 无监听，文档浏览器关闭，正式应用未接触，未推送；总体目标保持进行中。

## 2026-09-09：共享环境快照、观察与实际插件消费

[代码] session 服务升级为 1.1.0，新增 environment/observeEnvironment；产品 Agent 在全局和书内都有 get_host_environment，读取同一个 HostEnvironmentStore。字段为 revision、runtime、platform、locale、timeZone、utcOffsetMinutes、networkHint。查询总是刷新，观察先发当前快照再发变化版本；语言、online/offline、focus/pageshow 触发刷新，时区/DST 无通用 WebView 事件，因此有观察者时每 30 秒复核。没有观察者不保留 timer；回调独立副本、失败记录日志、dispose/卸载释放监听，重入刷新不向后续观察者交付更旧 revision。

[代码/边界] 使用已有平台探测，不采用窗口装饰的 debug OS 覆盖。networkHint 仅 OS/WebView 提示，不能断言目标 URL 可达、账户/模型就绪或格式支持；revision 是本实例版本，不是跨重启游标。该元数据不带书籍、账户、密钥或设备标识，无需 reading 权限。旧 session 四种阅读事件迁移、格式与实际 availability 仍未完成，MORE03 保留部分。

[代码] Listening Desk 升至 0.6.0，声明 session ^1.1.0，八语言离线提示进入真实视图。它只在请求/刷新视图时读取，不阻止本地朗读、不做每次在线事件强制重建表单。此批复用实用插件，不新增无用途的能力展示壳；源码插件十个、bundled 六个保持不变。

[环境] [结构化证据](./evidence/host-environment-2026-09-09.json)：隔离 macOS debug Tauri（com.readaware.app.capability-e2e，5184/9224）中实际 Agent 工具和零权限 Worker 首次读到相同 revision 2、en、Asia/Singapore、UTC+480、online。受控 navigator.onLine/offline 注入与实际 i18n 切换后均为 revision 4、zh-Hans、offline；Worker 收到 2/3/4。dispose 后切 ja，查询更新至 5，观察历史保持 2/3/4。插件 hasReading=false，未借元数据服务暴露阅读域。时区变化由注入 store 单测覆盖，不冒充真实系统设置变化；未断开机器网络。

[环境] Listening Desk 的编译产物以独立诊断身份启动 Worker，返回中文离线提示。随后真实宿主弹窗显示英文提示，恢复 native navigator 属性后点击 Refresh，提示消失；截图 /tmp/host-environment-listening.png 已查看。没有打开书籍/启动声音，离线 Start 不被禁用由插件动作测试证明。未替换已有安装，不宣称升级、重启或模型语义 eval 通过。第一次诊断错误使用独立 Jotai 导入没找到命令，另一次启动撞上 Vite reload；改用实际 store 并在同一 app mounted 后复测成功，没有把失败算通过。

[验证] 五个聚焦测试文件 20 项、274 次断言通过，含初始订阅窗口、变更去重、时区/偏移刷新、观察者拒绝/隔离/释放、重入版本，以及 Agent 读取前和读取中取消。全仓 test 20 任务、typecheck 23 任务通过，Listening Desk build 和生产 web build 通过。未改 Rust 业务逻辑，未重跑 Rust 全量；debug/前端构建不等于 packaged。环境快照当前生产调用链已有证据，不据此推断全部平台或服务 ready。

[代码/环境] 重扫为 224 行、583 库存映射、129 验收项、30 责任单元/catalog、32 场景。新增工具和服务映射到已有 MORE03，不扩张 catalog 责任数。两份生成检查、七项模型门禁与三对文档 validator 通过；三份 HTML 在 1440×1000、1024×768、390×844 无页面横向溢出、重复 ID、失效页内锚点、无名按钮或已观察资源 HTTP 错误。中英文环境搜索、Escape、已有抽屉 inert 和主题刷新保持通过；console/page error 为空，移动首页截图已查看。初次 about:blank 不计验证，重新导航后才检查。无新增图，文档仍依赖 CDN；文档浏览器不算产品 E2E。

仍未完成：MORE03 的支持格式/真实 availability、旧阅读事件迁移，READ16 跟随与跨提供者取消补偿、8 项无效果设置、其余双端缺口、W01–W32 全组合、全格式/packaged/跨平台验收。测试恢复 en 与原生 online 属性，两种诊断命令均为 0，预览 Worker 终止时宿主弹窗也被清理；未写测试业务数据。隔离 app 进程已退出，5184/9224 无监听，文档浏览器已关闭，正式实例未操作、未推送，总体目标保持进行中。

## 2026-09-09：删除无授权阅读事件旁路，统一 reading 状态

[代码] session 服务升级 2.0.0，仅保留 environment/observeEnvironment。删除 services.session.subscribe、PluginSessionEventMap/Name、App 的三个 open/close/chapter/progress 广播 effect 及内部事件类型；没有保留返回空值或互相兜底的兼容层。旧 ^1 要求在能力协商时明确拒绝。当前阅读信息统一走 reading 授权域，snapshot/observeSession 的 bookId/sessionId/status/location/history/mode/playback/revision 表达当前事实与变化；Agent 继续使用同一控制器，无需另一份事件实现。

[代码] Dictionary 1.2 声明 reading:read/library:read，以查询组合代替事件维护的书名缓存。读取元数据后复核 book/session/status，换书、重开、关闭则不使用旧标题；读库失败向调用者传播，不当成“没有书”。按需读取修复迟启用与改名不刷新的问题。查词缓存补入 bookTitle 这个实际 prompt 输入，避免不同书籍上下文共用词条；新 cache key 不复用旧缓存，但保存的生词本不变。Listening Desk 0.7 同步声明 session ^2.0.0。源码十插件、bundled 六插件未变；内置更新仍按既有宿主政策，未新增绕过安装许可的流程。

[环境] [结构化证据](./evidence/reading-session-boundary-2026-09-09.json)来自隔离 macOS debug Tauri（5184/9224）。先打开已有合成 FB2，再启用三个真实 Worker：零权限的 session 服务只含 environment/observeEnvironment，无 reading 域/写命令且 seen 始终为空；reading:read Worker 立即收到 revision 10 的 ready 快照，没有写命令。切到已有合成 PDF 收到 loading/ready 与位置变化，到 revision 17；关书收到 revision 18 idle/null。没有靠已废除的 App 广播驱动测试。

[环境] 实际 Dictionary 编译产物在独立诊断身份运行；三条私有缓存分别用 FB2 标题、PDF 标题和无标题作为 key，实际 lookup_word 工具连续返回对应三条 marker 定义。宿主 localOnly 在整个测试中设为 true，避免 cache miss 意外触发远端推理，结束恢复 false。此证据验证正式查询/缓存/工具 Worker 组合，不是远端模型语义或原生词卡 UI，不宣称安装升级同意流程已验收。改名、元数据缺失/失败、读标题途中换书/重开/关闭由单测覆盖；没有冒充这些全部都做了原生故障注入。

[验证] 五个聚焦文件 13 项、34 次断言通过；包含旧合约拒绝、元数据不授予 reading、read grant 正常协商、查询和缓存输入隔离。全仓 test 20 任务、typecheck 23 任务、Dictionary/Listening Desk build 和生产 web build 通过。初次 typecheck 指出 App 删除 effect 后 useRef 未使用，已清理后重跑通过。Rust debug 重编译通过，保留 37 个既有 warnings 与启动 web content process terminated 后 mounted 记录；未改 Rust 业务、未重跑 Rust 全量或 packaged 构建。

[代码/环境] 库存从 583 降为 578：删除一个旧公开方法和四个重复内部广播，不是删除可观察阅读行为。现为 224 证据行、578 库存映射、129 验收项、30 责任单元/catalog、32 场景。生成器先正确拒绝失效的 subscribe 映射，移除过期映射并登记 Dictionary 真实 domain 消费后通过。三对文档 validator、两份生成检查、七项模型反例门禁通过。三份 HTML 的 1440×1000、1024×768、390×844 无页面横向溢出、重复 ID、失效页内锚点、无名按钮或已观察资源 HTTP 错误；中英文搜索/Escape、已有抽屉 inert 和主题刷新保持通过，console/page error 为空，移动首页截图已查看。初次 about:blank 不计证据；文档仍依赖 CDN，无新增图，浏览器不是产品验收。

仍未完成：READ08 origin/reason 与完整执行中撤权/跨平台，MORE03 格式/服务真实就绪，READ16 跟随与跨提供者取消补偿、8 个无效果设置、其他双端缺口、W01–W32 全组合与全格式/packaged/跨平台验收。本批复用实用 Dictionary，不用诊断 Worker 充数。三条诊断文档已删除，诊断命令/工具均为 0，书关闭，localOnly 恢复；已有测试阅读轨迹不倒写。隔离进程退出、5184/9224 无监听，文档浏览器关闭；正式 app 未操作、未推送，总体目标继续。

## 2026-09-09：D5 / Agent 阅读上下文隐私执行

[代码] SET24/25 不再是只保存值：Agent 设置工具与授权插件 settings 写入同一实时策略。选区关闭后，自动附件、历史水化和历史检索/匹配不发送选区；周边关闭后跳过 grounding；任一关闭都移除可能包含选区的整个 viewport，包含 get_reading_session 的文本。保留本地附件、手写问题、位置和原始剧透围栏，不用猜测性的字符串替换实现隐私。

- 每轮捕获授权；扩大权限只作用于新轮次。策略变化使缓存模型上下文重建；历史工具沿用本轮授权，不因中途重新开启而泄露旧附件。
- 收紧以 ai/context-changed 终止准备中/进行中的回合，原生模型传输收到取消，排队和在途轮后记忆任务及插件候选一并失效；重开不复活旧请求。旧历史领养过滤附件后才提炼/摘要。
- 修复共享 policyCall 的已完成 Promise 竞态：等待前与取值后复核取消，不能由 fulfilled 结果抢赢已撤销授权。准备阶段失败/取消不再卡住 busy；线程销毁中止准备任务，迟到读取不会启动模型。
- 核心稳定错误码、模型错误分类和 8 语言 UI 文案同步；错误为可重试，用户可按当前隐私设置发起新请求。

[环境] 17 个聚焦测试、73 次断言覆盖四组合、grounding、历史/全局水化/旧历史领养、开关 off/on、准备阶段失败/取消/销毁、工具授权固定、插件候选与排队任务取消。全仓 test 20 个任务与 typecheck 23 个任务通过；此单元不会靠这些测试宣告其余能力接通。

[环境] 隔离 macOS debug Tauri（5184/9224）实际渲染 FB2，Agent 和真实 settings Worker 交替写两个开关，经实际产品 Agent runtime 向本机 SSE 端点发出四种组合。SQLite 附件保留，历史检索及会话文本隐藏；在途请求被插件关闭设置取消，服务端 observed cancelled=true，重新开启后只有新请求成功。见[结构化证据](./evidence/reading-context-policy-2026-09-09.json)。截图 /tmp/readaware-reading-context-policy.png 确认合成书正文渲染；选区附件由 fixture 提供，不是完整选区手势/UI 聊天验收。单屏合成书没有额外 grounding，正向 grounding 证据来自运行时测试。

复现：运行 bun scripts/reading-context-probe-server.ts，再运行隔离 tauri.capability-e2e 配置。通过 9224 导入 desktop-settings-probe.ts，prepareSettingsProbe 显式备份 sendHighlightedText/sendSurroundingContext/buildMemory/localOnly 四路径，禁用 buildMemory、关闭 localOnly；desktop-inference-probe.ts.prepareInferenceProbe 备份并设置受控模型；desktop-reading-context-probe.ts.prepareReadingContextProbe 导入/打开合成书。交替 agentSettings/pluginSettings 后调用 readingContextProbeTurn，查询 19843/state；seedReadingContextHistory/readingContextHistorySnapshot 验证持久与推理副本；/hold 后发起回合，在服务端确认 held 请求后关闭/重开文本设置，再 /release 并验证下一回合。长场景放在 WebView 明确状态句柄中轮询，不在观察超时后重复执行。完成后依次 cleanupReadingContextProbe、cleanupInferenceProbe、cleanupSettingsProbe，停止自有进程。

[环境] 首次 fixture 编辑导致 Vite 重载，首轮序列作废；实际检查重载日志后清理旧书/密钥备份，并按变更前 preference.changed 记录恢复四设置，重新准备后四组合完整通过。最终配置/密钥恢复，两个 Worker 贡献为 0，测试书/聊天清理，四隐私设置恢复原值；自有 app/服务器已停止，5184/9224/19843 无监听。不要在桌面探针中途编辑 fixture 或重建 Foliate。

[仍缺] SET24/25 保持部分：插件 selection/lookup 回调、插件自组装 LLM/HTTP/TTS、独立正文/标注检索与旧回答/记忆/纪要不受此输入过滤自动清除或禁用。已发出的字节与已派发写不能撤回，完整隐私流、打包/Windows/Linux、完整设置 UI 与 W01–W32 其余组合插件未完成。矩阵无效果设置由 8 降为 6，但没有把两个文本设置改绿；保持 224 行与 578 库存映射，未改变完整目标或关闭原 GAP。

[环境/最终复核] 最终全仓 test 20/20、typecheck 23/23、生产前端 build 通过。其间既有 Foliate clean-build 测试在全仓和独跑各出现一次 30 秒超时，后续完整复跑通过；未修改测试或放宽超时，也不把失败运行算通过。三个文档对 validator 与两份生成器 --check 通过；1440×1000、1024×768、390×844 截图/无横向溢出/锚点/按钮命名/资源错误检查，中英文搜索与 Escape 均通过，矩阵/模型目录 inert/焦点及主题刷新保留通过；文档仍使用 CDN，不是离线资源验证。独立浏览器已关闭。

## 2026-09-09：S6 / 插件结构化阅读上下文与 Dictionary 1.3

[代码] LLM capability 升至 1.1.0，services.llm.ask 与 AgentRuntime.ask 共用 one-shot 执行。新增 readingContext 的 selection/surrounding/required，宿主在组装模型请求时按实时阅读隐私策略过滤。任一文本开关关闭均不发送可能重叠的 surrounding；必需文本被禁止在推理前报 ai/context-withheld；未知字段、非字符串与缺失/空的必需字段报 ai/invalid-reading-context。两错误均有稳定分类及八语言 UI 文案。普通、结构化重试、流式共享固定授权，收紧取消传输并拒绝迟到结果/回调/重试；重新打开只影响新请求。

[代码] Dictionary 1.3 声明 llm ^1.1.0、settings ^1.2.0 与两个文本偏好的精确读取权限。选区来源和正文分开交给宿主，不插入 prompt/system/schema。所有实际传入片段都声明 required，设置竞态直接拒绝，避免按错误上下文写缓存；周边被禁止时使用独立的无上下文缓存身份。已缓存结果仍是可本地读取的数据，不因为禁止外发而失效。保存 source，旧生词再生成时保守视为 selection；用户/模型明确提供的词仍是普通输入，不假装宿主能追踪任意字符串来源。

[环境] [结构化证据](./evidence/structured-reading-context-2026-09-09.json)来自隔离 macOS debug Tauri 5184/9224 与 loopback SSE 19843。两 actor × 三调用模式 × 四设置组合，共 24 次请求，与服务端 selection/surrounding marker 逐项一致。实际编译 Dictionary Worker：两次冷查分别发送选区加周边、仅选区；禁止选区的冷查返回 ai/context-withheld，零额外请求且私有文档计数不变；关闭两开关后已有缓存仍成功，零额外请求。一次故意损坏 JSON 导致结构化重试，两次请求均只含允许的选区。

[环境] 同时挂起实际 Dictionary、Agent 普通 ask 与插件流式 ask，服务端确认三个 held 请求后由 settings Worker 关闭并重开两开关。三个调用均返回 ai/context-changed，服务端三个 cancelled=true，Dictionary 缓存/生词数仍为 2/2。解除服务端 hold 后新查词成功变为 3/3，总共 32 次请求。输入通过注册动作的 fixture 提供，不冒充真实选区手势/词卡 UI 或模型语义验收；fixture 也不计作新的 W01–W32 组合插件。

复现：先启动 bun scripts/structured-reading-probe-server.ts 与隔离 tauri.capability-e2e 配置；prepareSettingsProbe 备份四个隐私路径，关闭 buildMemory/localOnly，再 prepareInferenceProbe 和 prepareStructuredReadingProbe。structuredReadingProbe 支持 agent/plugin 与 plain/structured/stream；dictionaryReadingProbe 的后缀隔离缓存。/malformed-next 控制下一回答，/hold 与 /release 控制在途取消，/state 只返回 marker 布尔值，不记录 prompt 或凭证。长序列在 WebView 状态句柄内执行并轮询，不在观察超时后重启。最后依次 cleanupStructuredReadingProbe、cleanupInferenceProbe、cleanupSettingsProbe。

[验证] 聚焦 7 文件、23 测试、84 次断言通过；新增覆盖字段验证/复制、四组合、必需字段、重试、已完成 Promise 撤权竞态、流式迟到回调、宿主 runtime 接线和 Dictionary 缓存/普通输入。全仓 test 20/20、typecheck 23/23、Dictionary build、生产前端 build 通过；保留既有 Rust cfg/dead-code 与 Vite 大块/混合导入警告，未修改 Rust 业务或重跑 Rust 全套。三个文档对 validator、两个生成器 --check 与 diff --check 通过。改变的矩阵和插件说明 HTML 在 1440×1000、1024×768、390×844 无横向溢出/重复 ID/坏锚点/无名按钮/已观察资源错误；中英文搜索与 Escape、矩阵目录和主题刷新保持通过。模型 HTML 概览事实不变，生成器未改该文件；Markdown 的逐项证据同步更新。文档浏览器已关闭，仍依赖 CDN。

[清理/仍缺] 插件 lookups/words、选择动作、命令与探针贡献均归零；原模型配置/密钥和四设置恢复，两个自有进程组退出，5184/9224/19843 无监听。正式实例未操作、未推送。保持 224 行、578 库存、129 验收项、30 责任单元/catalog、32 场景；SET24/25 仍是部分，任意自组装 prompt/HTTP/TTS、独立检索和旧衍生内容没有全局来源治理。公开取消/任务预算/用量回执、其余双端接线、全组合插件和 packaged/Windows/Linux 仍待实现或验收，总目标未关闭。

## 2026-09-09：D5 / 书架偏好与 Workspace Profiles

[代码] settings 升至 1.3.0，shelf.layout/group/sort 接入现有目录、Agent get_settings/update_settings 与插件精确路径授权。布局 grid/list，分组 none/status/author/format，排序 recent/added/title/author/progress，均为 global/device-local。写回原 shelf-view KV，与其他偏好同批原子提交；shelfViewAtom 跟随外部写入及失败回滚，即使书架没有挂载也更新。没有改变当前筛选、集合、多选或书籍数据。

[代码] 插件补公开 queries.snapshot，沿用宿主已有快照与权限过滤，不把七次 read 拼成伪快照。等待此前排队命令和 KV 写结算后一次读取；此前 UI 写失败时返回回滚后的值，不捕获已失败的乐观状态。discover-only 不获得值，未授予路径的 overrides 也过滤。该快照不是 revision 锁或跨后续动作的事务；read/discover 的乐观读取行为没有冒充同等保证。

[代码] 新增实用插件 Workspace Profiles 0.1.0。七项精确读写授权覆盖三项书架设置、应用主题/动效、全局阅读字号/行距；组合私有 profiles 文档、书架 header、命令、声明式列表/表单及双域 workspace_profiles Agent 工具。保存创建 UUID，名称校验 1-80 字符；应用检查版本/路径/全局目标，以当前目录原子验证提交，过期主题不部分应用；删除预设不改变宿主设置。全局阅读设置保留已有本书覆盖，工具回执包含 overrides。源码插件十一项，Rust bundled 六项；dev-installed 实例不等于生产内置或安装审批通过。

[环境] [桌面证据](./evidence/workspace-profiles-2026-09-09.json)来自隔离 macOS debug Tauri 5184/9224。实际表单保存 Native Reading Workspace、空名称显示字段错误；实际 Agent 设置工具改为 list/author/title/reduced，点击预设 Apply 恢复 grid/none/recent/system。设置 Worker 改为 list/format/progress，插件注册 Agent 工具保存、应用、删除同样生效。最终从真实书架 More 入口打开诊断 Worker，检查 plus/cards/refresh 图标、七字段详情和 Delete；生产身份与诊断身份各有一个 header，不误判为重复注册。

[代码/环境] 列表状态暴露了原无封面缩略图的标题挤压，新增 compact 呈现：44×64 内只放 Phosphor 书籍图标和格式，标题留在行正文；完整封面不变，增加长标题/AZW3 Story。真实 Tauri 测得缩略图无横纵溢出，1200×800 弹窗无横向溢出；最终列表/菜单/详情截图已查看。早期截图处在加载/关闭过渡，不计作完成证据。开发重建触发一次模块加载失败后同进程重新 mounted，截图保留诊断通知；不宣称启动零错误。没有真实模型调用或语义 eval；没有注入真实 SQLite 锁、修改本书覆盖或验安装重启，相关语义只按下述测试范围计证据。

[验证] 聚焦 3 文件 11 个外层测试、38 次断言通过，其中独立 native IPC 持久化子进程有 7 项用例；涵盖双 actor 排队合并、权限/非法值/目标拒绝、跨记录失败回滚、失败后快照、过期预设与覆盖回执。全仓 test 21/21、typecheck 24/24、新插件 build、生产前端 build 通过；首次 test 因能力版本断言仍为 settings 1.2 失败，更新为真实 1.3 后重跑成功。保留 Vite 体积/混合导入和 Node 弃用警告；未改 Rust 业务，未独立重跑 Rust 全套或 packaged 构建。

[文档] 重扫为 227 行、584 库存、58 设置路径、129 原验收项、30 责任单元/catalog、32 场景。七项模型门禁、两个生成器 --check 和三个文档对 validator 通过。矩阵、模型、插件说明 HTML 在 1440×1000、1024×768、390×844 无页面横向溢出、重复 ID、坏锚点、无名按钮或已观察资源 HTTP 错误；中英文 Workspace/书架搜索与 Escape、已有目录 inert 和主题刷新保持通过，console/page error 为空。文档仍依赖 CDN，无新增图；文档浏览器不算产品验证，已关闭。

[清理/仍缺] 各轮诊断 profiles/tools/commands 与设置贡献归零，七项偏好恢复；自有进程组 55573 已退出、5184/9224 无监听，正式实例未操作。UI02 的搜索/当前集合/选择集、UI04 快捷键、CFG10 全来源观察、六项无效果设置、其余双端缺口、W01-W32 全组合及 packaged/Windows/Linux 验收仍未完成。原 GAP 没有因新增插件或字段关闭，总目标保持进行中。

## 2026-09-09：D5 / 双端快捷键与 Workspace Profiles 0.2

[代码] settings 1.4 新增 shortcuts section、key-chord kind 和运行态元数据，覆盖 16 项内置可编辑绑定及当前注册插件命令。Agent get_settings/update_settings 与插件同用目录、有效绑定和原子提交。插件命令 key 编码为单一路径片段，manifest 支持 uppercase percent escape；没有开放任意命令执行。默认值、是否覆盖、提供者可用性、冲突路径可查询；只读授权下 writable 为 false，discover 不给值或快捷键运行态，冲突引用按可读路径过滤。

[代码] 修饰键数组使用 mod/alt/shift 加 KeyboardEvent.key；null 删除覆盖、恢复注册默认，不等于禁用。无效键返回 settings/invalid-shortcut，冲突返回 settings/shortcut-conflict；对最终批次验证，允许两键交换，不会先应用半批。既有无关冲突不阻挡其他修改。快捷键 KV 同其他设置原子保存，atom 跟随外部写入及回滚，排队命令不会基于前次未结算值重复分配键位。

[代码] Workspace Profiles 0.2 只新增自身 shortcuts.plugin.workspace-profiles%3Aopen 的精确授权，用宿主表单选择默认/自定义、修饰键和按键；七字段预设模型不变。原生测试发现已穿过 Worker 的稳定错误码被视图动作 catch 丢弃，导致具体冲突变成泛化插件失败。修复动作结果/视图 session 到 toast 的 code 传递；桥只渲染已知本地化错误文案或泛化 fallback，不传原始错误文本。提交失败保留原表单状态和绑定，不关闭、不提示成功。

[环境] [证据](./evidence/keyboard-shortcuts-2026-09-09.json)来自隔离 macOS debug Tauri 5184/9224。实际 Agent 工具把搜索设为 mod+shift+k，键盘打开真实命令搜索；真实 settings Worker 单项抢占报冲突，整批交换搜索/设置成功，同一按键随后打开 Settings，原生快捷键页显示新值。实际安装身份 Workspace Profiles 表单设自身 mod+shift+p，键盘重新打开插件；默认选项恢复 null/overridden=false。错误修复后再次表单提交冲突，已观察并截图具体英文提示，输入 k、空绑定及零成功事件均保留。所有备份按原 override 缺席状态恢复，诊断贡献归零；不把调试调用产品工具算成真实模型推理。

[验证] 新增纯解析/冲突测试 5 项、设置域 5 项、原子持久化子进程第 8 项、插件表单 3 项及错误传递 2 项；已有 manifest 测试补编码路径。最终全仓 test 21/21（web 742 tests / 8465 assertions，Workspace Profiles 8 tests / 28 assertions）、typecheck 24/24、生产前端 build 通过。中途类型检查指出插件 ES lib 不支持 Array.at、toast 描述函数参数不匹配和测试 union 字段读取未收窄，均修复后重跑成功。保留既有构建体积/混合导入及 Node 警告；未改 Rust 业务或重跑 packaged 构建。真实数据库锁/跨记录持久失败由 IPC 测试覆盖，不冒充本轮桌面注入。

[文档] 重扫 243 行、600 库存映射、74 静态设置路径、30 责任单元/catalog、129 原验收项、32 场景。生成器 --check、七项模型门禁、三个文档对 validator 通过。三份 HTML 在 1440×1000、1024×768、390×844 无页面横向溢出、重复 ID、坏页内锚点、无名按钮或已观察资源 HTTP 错误；中英文快捷键搜索/Escape、已有抽屉 inert 和主题刷新保持通过，console/page error 为空，移动首页截图已查看。文档仍依赖 CDN，无新增图；浏览器验证只证明文档。

[清理/仍缺] 自有进程组 64569 已退出、5184/9224 无监听，文档浏览器关闭，正式 app 未操作。UI04 仍为部分：停用插件遗留覆盖未公开，激活可引入冲突，原生设置页仍走旧验证/写入路径；全来源 revision/origin、所有键盘布局/阅读及原生菜单路由、packaged/Windows/Linux 尚未闭合。初始 debug 启动曾报告 web content process terminated 后恢复，早期忙态/旧帧截图不计完成证据。其余双端缺口、六项无效果设置、W01-W32 全组合与完整桌面验收继续，未推送、未关闭总目标。

## 2026-09-09：D5 / 原生快捷键统一写入与停用绑定

[代码] 原生 Shortcuts 页移除独立冲突判断和整份 atom/KV 写入，重绑、单项恢复、全部恢复均使用 settings 域的 user 来源命令；等待持久提交，忙时禁用控件，失败以稳定错误本地化 toast 告知。shortcutBindingsAtom 仅提供读取，外部写入和回滚继续实时刷新 UI。reset-all 读取结算后的目录，以一个 null 批次清理内置和停用插件覆盖；这不是 CAS，也没有引入全局 revision 锁。

[代码] 已保存但未注册的插件命令现在可被 Agent/按精确路径授权的插件查询、修改和清除：available=false、overridden=true、defaultBinding=null 表示注册默认未知，不是禁用命令。停用项不占用键位，清除后目录行消失，不能用未知路径任意创建。原生页增加 Unavailable commands 和单项恢复。解析器忽略未知内置 ID 与空 plugin: ID，保留非空插件遗留 ID，避免存在无法从目录清除的无名覆盖。超长 opaque ID 使用换行约束，未做极端长度原生截图验收。

[环境] [证据](./evidence/shortcut-editor-2026-09-09.json)来自隔离 macOS debug Tauri 5184/9224。原生重绑 search 为 mod+shift+j 后真实键盘打开搜索；冲突拒绝保留原绑定并显示具体本地化错误。实际 Agent reset 更新已挂载原生页；原生单项 reset 恢复默认。Workspace Profiles 真实 Worker 注册后保存自有键位、停用后目录与原生页保留该项；精确授权 settings Worker 修改停用绑定，原生单项清除。最后原生 reset-all 同批清除 search 与停用项，load_kv_all 核实 read-aware-shortcuts 为 {}，仅一次 user 事件包含两项变更。没有远端模型推理或实际 SQLite 锁注入。

[验证] 聚焦 16 项、52 次断言通过；独立 React/原生 IPC 子进程验证持久等待、忙态拒绝重复操作、排队的 user/plugin 写无丢失、失败回滚与不泄漏 raw error 的 toast、单批恢复全部。最终全仓 test 21/21（web 746 项、8478 次断言）、typecheck 24/24、生产前端 build 通过；保留既有体积、混合导入、Node 警告。未改 Rust 业务，debug 启动已有 37 warnings，初始 web content process terminated 后恢复；不宣称无崩溃或 packaged 验证。

[文档] 243 行、600 库存、74 静态设置、30 单元/catalog、129 验收项和 32 场景保持。两份生成器检查、七项模型测试、三对文档 validator 通过。三份 HTML 在 1440×1000、1024×768、390×844 无横向溢出、重复 ID、坏锚点、无名按钮和已观察资源 HTTP 错误；中英文搜索/Escape、已有抽屉 inert 和主题刷新保持通过，截图已查看。浏览器自动化两次丢失目标标签，失败运行不计证据；重新确认 URL/DOM 后复检，部分交互通过 DOM 事件而非物理按键验证。诊断 10 项通过但未查明标签切换原因。文档依赖 CDN，不算产品验收。

[清理/仍缺] 诊断命令/工具/文档归零，快捷键覆盖恢复原空状态，自有进程组 68041 停止、5184/9224 无监听，文档浏览器关闭，正式 app 未操作。UI04 仍为部分：重新激活冲突尚无统一执行裁决，全来源 revision/origin、所有按键布局/阅读及原生菜单路由、packaged/Windows/Linux 未闭合。六项无效果设置、其余双端缺口、W01-W32 全组合继续，不推送、不关闭总目标。

## 2026-09-09：D5 / 激活冲突统一暂停与 settings 1.5

[代码] 全局快捷键、插件命令、Foliate 阅读器共用实时目录与同一 dispatch 裁决；设置域和原生页也从同一 provider availability 读取。重新激活引入冲突时暂停所有匹配项并消费事件，不按监听或注册顺序选赢家，不改写持久绑定；停用/重绑后恢复。同步读取当前命令避免注册/释放后等待 React effect 的旧回调窗口。已消费事件不重复执行，插件/全局占用的键不落入阅读器 PageDown 等兜底；未启用的模式/无选区仍保留既有垂直翻页兜底。组合输入与 Escape 不执行可配置键，输入框裸字母保持输入。

[代码] settings 升至 1.5，shortcut.conflicted 独立于按 grant 过滤的 conflicts 路径数组，避免隐藏冲突方后谎报无冲突。available 仍是提供者注册态而非当前焦点可执行态；discover 不给这份运行态。原生页用 InlineError 和八语言文案显示每一冲突项，重新分配/停用后提示随目录消失。沿用保守全局冲突空间，不引入另一套焦点优先级或擅自让插件覆盖内置命令。

[环境] [证据](./evidence/shortcut-dispatch-2026-09-09.json)来自隔离 macOS debug Tauri。实际 Workspace Profiles Worker 保存覆盖、退休，再由实际 Agent 工具占用原键；退休态搜索可运行，重启 Worker 后两项均 conflicted 且原生按键不打开任一面板。原生设置页显示双方冲突，录制新键后两条提示消失，旧键打开真实插件面板。实际 settings Worker 重置翻页后插件也可恢复。阅读器 window 与正文 iframe 的冲突键均保持位置，退休插件后 iframe 同键实际翻页；插件的唯一绑定打开面板不同时翻页。iframe 事件是在真实 Foliate 文档构造并派发，不冒充物理焦点输入。

[验证] 最后复核发现初版兜底判断会误阻止“模式已注册但未启用”的 ArrowDown 翻页，已收窄到真正由全局/插件拥有的键，并补反例。第二轮原生明确验证 inactive 模式下物理 ArrowDown 前进、正文合成 ArrowUp 返回，以及唯一 PageDown 插件打开不移动书页。聚焦 11 项、54 次断言通过，子进程覆盖两种挂载顺序、window/frame、两个插件冲突、即时释放、Agent 修复、授权隐藏路径仍 conflicted=true。最终全仓 test 21/21（web 751 项、8503 次断言）、typecheck 24/24、生产前端 build 通过；早期测试把 SettingsQuery 错写成 paths 和一次未使用 import 已修复，不把失败运行算通过。

[文档] 243 行、600 库存、74 设置、30 单元/catalog、129 原验收和 32 场景保持。七项模型门禁、两个生成器 --check、三个文档对 validator 通过。矩阵与插件说明 HTML 在 1440×1000、1024×768、390×844 无页面横向溢出、重复 ID、坏页内锚点、无名按钮或已观察资源 HTTP 错误。conflicted/冲突搜索与 Escape、矩阵抽屉 inert 和主题刷新保持通过；交互使用 DOM 事件验证，移动截图已查看，console/page error 为空。模型 HTML 未改，MD 仅反查事实同步；文档仍依赖 CDN，不算产品验证。

[清理/仍缺] 两轮诊断贡献/工具/文档归零、原覆盖空态与 SQLite {} 恢复、书关闭；既有合成书阅读轨迹不倒写。自有进程组 72110/73357 均退出，5184/9224 无监听，文档浏览器关闭，正式 app 未操作。保留既有 Rust 37 warnings、初始 WebContent 终止后恢复、bridge 版本提示；带 selector 的 DOM snapshot 报 resolveAll 不存在，改用完整 snapshot 验证，无业务代码绕过。UI04 仍部分：全来源 revision/origin、所有键盘布局/格式/选区与模式路由、原生菜单、packaged/Windows/Linux 未完成。其他双端缺口与六项无效果设置、W01-W32 组合继续，总目标保持进行中，未推送。

## 2026-09-09：D2 / 阅读控制层共享状态与 Reading 2.6

[代码] READ09 从双端未接改为接通。ReadingSessionSnapshot.controls 返回最后一次 React DOM 提交的 visible，无绑定时为 null；reading.commands.setControls 和 Agent set_reader_controls 使用同一会话控制器。UI 的空格、内容点击、滚动、打开面板等原有路径也写同一 owner。命令仅控制 header/已选 docked panels 显示，不修改已保存面板选择、位置、历史、模式或播放。重复值也等待本次 DOM 提交，不按派发就报成功，也不宣称 CSS 动画或物理绘制已结束。

[代码] 写要求 ready 和 reading:write，读取/观察只需 reading:read。会话/书籍 guard 阻止旧视图控制新书；更新意图、替换/关闭/失败/解绑使在途请求 superseded。Agent signal 和插件实例生命周期取消等待，十秒无提交报 timeout；取消丢弃未提交意图，迟到 ack 忽略，不保证撤销已呈现状态。观察者失败隔离，重入变化不改写原请求的完成快照。Listening Desk 0.8 使用已有表单/动作组合，按显示时快照提供显式 show/hide，成功后关闭视图，不新增专属 Agent 工具。

[环境] [证据](./evidence/reader-controls-2026-09-09.json)来自隔离 macOS debug Tauri，实际 Agent 工具和当前构建的 Listening Desk Worker 双端显示/隐藏，原生空格与只读 Worker 状态一致；只读 Worker 无 commands。header More 菜单打开插件，关闭并重开同书后旧按钮被拒绝、保留视图并显示不含 raw error 的通用插件错误提示；Refresh 重新取得 guard 后恢复。控制操作前后 CFI/历史/模式/播放一致；错误、预取消和错误会话不改状态。未调用远端模型，也未在桌面注入 pending timeout/退出故障，这些边界由控制器与 React 测试覆盖。

[验证] 聚焦 34 项、315 次断言通过；全仓 test 21/21（web 760 项、8553 次断言）、typecheck 24/24、生产前端 build 通过。首次全量测试指出新增工具数量断言未更新，补两端名单后重跑成功。截图发现 sidebar 不在既有图标目录，改用已支持 rows，重建后第二轮原生查看稳定截图并重测隐藏。首次导入旧阅读探针使 Vite 预构建 pdf-lib 后 reload；通过 revision 归零和启动日志确认，再准备诊断 Worker，未把旧状态当成连续运行。一次 rAF 观察超时，重新前置测试 app 后取得真实错误提示；保留既有 Rust/Node/bridge 警告和启动 WebContent 终止后恢复记录。

[文档] 重扫 243 行、603 库存映射、74 设置、30 单元/catalog、129 原验收、32 场景，新增两种 scope 的 Agent 工具和一个插件方法均可反查 READ09。三对 validator 和七项模型门禁通过。矩阵/插件说明 HTML 在 1440×1000、1024×768、390×844 无页面横向溢出、重复 ID、坏页内锚点、无名按钮或已观察 HTTP 资源错误；中英文 setControls/控制层搜索和 Escape 通过，矩阵抽屉/主题刷新保持通过。移动截图已查看，console/page error 为空；模型 HTML 无共享摘要变化，仅 MD 反查行更新。文档仍依赖 CDN，浏览器检查不计作产品验收。

[清理/仍缺] 诊断贡献归零，书关闭；两轮自有进程组 78262/79393 均退出，5184/9224 无监听，文档浏览器关闭。正式 app 和设置未修改，合成书阅读轨迹不倒写。READ10 指定面板选择仍未接，单次插件取消句柄、packaged/Windows/Linux 未验；其余双端缺口、六项无效果设置和 W01-W32 全组合继续，未推送、不关闭总目标。

## 2026-09-09：S3 / 面板持久化与生命周期前置修复

[代码] READ10 双端仍为未接，本次没有新增公共 API 或提高 capability version。原生目录/聊天开关从独立 React 状态加静默保存改为 useSyncExternalStore 观察共享 KV 镜像，反映外部更新和失败回滚；updateReaderPanelLayout 等前次写结算后计算本次意图，保留其他书记录，返回该次 SQLite 写入的真实 Promise。失败码在宿主 helper 保留，UI hook 记录日志并复用全局 LocalWriteFailureToasts，不重复提示。窄窗两面板互斥切换一次写入；聊天聚焦只由最新且仍有效的成功意图续接，不以派发或乐观呈现作为保存完成。

[代码] book owner 在 layout effect 建立，切书/卸载取消排队操作；新书首帧直接取自身布局，不等旧书 effect。取消立即终结调用方等待，但不谎称撤销已进入 IPC 的写。畸形旧 JSON/数组回落默认，opaque book ID 不走对象原型；新写入验证布尔字段。同值请求在前序写结算后直接返回，不额外写盘。既有 panelIntent 与 Ask AI 入口复用同一互斥保存路径。注释/外观的临时状态、统一面板 DOM 完成回执、隐藏/overflow 菜单入口仍待公共服务实现。

[环境] [证据](./evidence/reader-panel-persistence-2026-09-09.json)来自实际隔离 macOS debug Tauri。仅向隔离 app_kv 的目标 key 安装临时 INSERT/UPDATE 拒绝触发器，点击真实目录按钮：面板回滚关闭、SQLite 无新行、只有一次英文“Change not saved”提示，无 raw trigger 文本。去掉触发器重试，1200px 窗口目录/聊天同时打开且 SQLite 一致；关闭并重开同书保留选择。外部宿主 helper 写入立即刷新已挂载面板。600×844 窄窗从聊天切目录，真实数据库拒绝后恢复聊天；解除故障重试得到目录开/聊天关且无横向溢出，截图已查看。单次写计数、延迟提交与换书排队取消由 React/IPC 控制测试证明，不冒充本轮真实 SQLite 调度测试。

[验证] 独立 StrictMode/i18n/原生 IPC 子进程 10 项、54 断言通过；全仓 test 21/21（web 761 项、8555 断言）、typecheck 24/24、前端生产 build 通过，保留既有 Node/混合导入/体积警告。重扫 243 行、603 库存、74 设置、30 单元/catalog、129 原验收、32 场景，七项模型门禁与两生成器 --check 通过。矩阵 MD/HTML 同步证据与未接边界，统一模型 MD 仅更新反查，HTML 共享摘要未变；两对 validator 通过。矩阵 HTML 三尺寸、中英文筛选/Escape、抽屉 inert、主题刷新保持通过，无重复 ID/坏页内锚点/无名按钮/已观察资源错误；console/page error 为空。文档依赖 CDN，浏览器检查不代表产品验证。

[新发现/清理] 关闭重开时观察到 platform/wheel-phase.ts 的 Tauri unregisterListener 未处理拒绝（listeners[eventId].handlerId），保留为独立未解决生命周期缺陷，不能称整个阅读器无错误。清理期间一次 close 观察在 Vite HMR/boot 重启时超时，重新检查真实 app 已回 Library 且无阅读面板；未据超时重启进程。目标偏好恢复原缺席状态，两故障触发器删除，SQLite 行/触发器均为 0，窗口恢复 1200×800，自有进程组 81626 终态 143、5184/9224 无监听，文档浏览器关闭。正式 app 未操作，合成书阅读轨迹不倒写。READ10 双端接口及其组合插件、滚轮退订缺陷、其余部分/未接项、W01-W32 全组合与 packaged/Windows/Linux 仍继续，未推送、不关闭总目标。

## 2026-09-09：S3 / 四面板共享服务与 Listening Desk 0.9

[代码] READ10 双端接通：services.ui 1.1 的 reader.snapshot/observe/setPanel 与 Agent get_reader_panels/set_reader_panel 共用 ReaderPanelsService；reading:read 可查询/观察，reading:write 才有命令，零阅读权限不获得面板或书籍元数据。四种 panel 为 toc/annotations/appearance/chat，快照区分已选择 open 和当前 visible，携带 session/book/revision，不返回内容。打开先显示控制层；目录/聊天精确持久提交后再等待新的 React DOM commit，瞬时注释/外观不写 KV。同值仍等待本次提交、不重复写盘；观察者副本和失败隔离，回调重入不污染已完成回执。

[代码] 原生按钮与面板/Ask AI 意图也使用同一服务，移除 useReaderSession 独立 reveal 和旧 useReaderPanelLayout owner。意图等待 ready，StrictMode 重放取消未完成工作后可重新接入；完成确认存于共享 Jotai store，防止重开同书重新打开旧 Ask AI 请求，不消费 ChatPanel 独立的附件信号。取消/换书/隐藏/更新意图阻止迟到续接，十秒无提交报 timeout；取消不撤销已派发 IPC 或已经显示的控制层。窄窗目录/聊天互斥一次保存，数据库失败保留原 code、回滚且复用本地化提示。外观移到 More 后改为普通命令打开共用字段的 Dialog，而不是依赖已卸载的内联 Popover。

[环境] [证据](./evidence/reader-panels-2026-09-09.json)来自两轮隔离 macOS debug Tauri。实际 Agent 工具、三个空/读/写权限 Worker、当前构建 Listening Desk 0.9 和原生按钮都跑通；四面板操作前后 CFI/历史/会话/模式/播放一致。真实 SQLite INSERT/UPDATE 拒绝触发器使双端返回 db/error，窄窗回滚为聊天开/目录关；解除后重试成功，观察者状态一致。旧 Listening Desk 视图在同书新会话拒绝操作并保留视图/提示错误，Refresh 后成功且关闭。没有远端模型推理。

[发现与修复] 真实截图暴露 More 外观 Dialog 原先高 1128、top=-142，改为 max-h-full overflow-y-auto；600x844 下位于 24..820，滚动可到最后阅读模式控件；1200x800 下位于 32..768，无横向溢出。合成 PDF 显示自己的 Page Rendering/Reading Mode，隐藏不可用字体编辑，截图可见真实页面。重开测试又暴露已完成 Ask AI 重放，修复后新会话 controls=false/chat=false，后续查询仍一致。测试直接导入未带 Vite 版本的 Jotai 依赖未触达真实 store，改用源码诊断模块的规范 import；模块编辑导致确认的 Vite reload，重新建会话与 Worker 后才采信结果。

[验证] StrictMode/IPC 子进程 13 项、65 断言；服务 9 项、49 断言；权限适配 2 项、9 断言；Agent/注册表/Listening Desk 26 项、124 断言。新增工具表面遗漏被全量门禁发现，补真实执行参数后通过；新面板工具在缺 surface/错书时也保留稳定错误码。最终全仓 test 21/21（web 772 项、8613 断言）、typecheck 24/24、前端生产 build 通过；既有 Node/混合导入/体积与 37 Rust warnings 保留。

[文档与重扫] 243 行、610 注册入口库存、74 设置、30 单元/catalog、129 验收、32 场景；新入口均反查 READ10，七项模型门禁与两生成器 --check 通过。矩阵和插件规范双版本同步，统一模型只更新 MD 反查，未改无共享摘要变化的 HTML；三对 validator 通过。两份变更 HTML 三尺寸、中英文搜索/Escape、矩阵抽屉 inert/主题刷新保持通过，无页面横向溢出、重复 ID、坏页内锚点、无名按钮、已观察 HTTP 资源错误或 console/page error。浏览器只验文档，不代表产品；文档仍依赖 CDN。

[清理与仍缺] 两轮进程组 89403/91565 均已退出，诊断贡献归零、原始缺席的 panel/menu KV 恢复、故障触发器删除、5184/9224 无监听、文档浏览器关闭，正式 app 未操作。快速原生重开再次复现 wheel-phase 的 listeners[eventId].handlerId 退订未处理拒绝，仍是独立未解决缺陷。READ10 不承诺动画、物理栅格、实际焦点或面板数据加载完成；单次 Worker 取消、packaged/Windows/Linux 尚未验收。其余部分/未接项、完整 W01-W32 组合与全目标继续，不推送、不关闭目标。

## 2026-09-09：阅读器原生滚轮输入生命周期修复

[代码/推论] 旧 wheel-phase.ts 在组件先卸载、listen 后返回的分支调用 unlisten，真实堆栈在 Tauri unregisterListener 读取不存在的 listeners[eventId].handlerId。核对安装的 Rust Tauri 2.11.3 与 JS API 2.11.0：原生 listen_js eval 注入注册，没有等待 JS 注册确认便返回事件 ID，JS 退订先读该登记。堆栈和实现支持注册/退休竞态推论；未对原生调度交错做插桩，不把推论写成已证明的具体时序。

[代码] 滚轮阶段是当前主文档输入，不是持久领域事件。AppKit monitor 保持 app 所有权，分类逻辑不变，迁入 wheel_phase.rs；只对主 WebView 投递 touch/momentum/end 三个封闭常量 CustomEvent 脚本，不插入外部文本。阅读器同步 add/remove 自己的 DOM listener，捕获原 window，验证载荷并记录消费者同步/异步异常，不再申请或延迟释放原生 listener。没有 SDK 补丁、私有登记表修改、计时等待、全局 rejection 抑制或永久前端监听；不新增插件权力/能力版本。

[环境] [结构化证据](./evidence/wheel-phase-lifetime-2026-09-09.json)：隔离 macOS debug Tauri 中 200 个真实前端监听即时退休后无回调；同一 FB2 十次重开，加 PDF/FB2 交替十次重开，共二十个不同 ready session，没有捕获原退订异常。经原生 MCP eval 投递与 monitor 相同的三个固定语句，当前消费者依序收到三阶段，退订后不再收到 touch；实际 Agent reader port 重开后可显示目录/聊天。MCP 自身使用 WebviewWindow.eval，证明投递与消费而非物理 NSEvent。PID 定向 Swift CGEvent 尝试的 posting 权限为 false、未收到阶段，不计成功，未改变系统辅助功能权限。

[验证] 新增前端 7 项/13 断言、Rust 3 项分类/封闭脚本测试；全仓 test 21/21（web 779 项/8626 断言）、typecheck 24/24、前端生产 build 通过。最终 Rust 全量重跑 131 通过、1 项既有 ignored，38 个既有测试 warning 保留。收尾再次运行前端新测试与模型门禁共 14 项/22 断言通过；243 行/610 库存/30 单元与 catalog/129 验收/32 场景未变，两生成器 --check 和三文档对 validator 通过。更新矩阵与插件说明双份，统一模型仅同步 MD 反查，HTML 无共享摘要变化。

[文档/清理] 两份变更 HTML 在 1440×1000、1024×768、390×844 无页面横向溢出、重复 ID、坏页内锚点、无名按钮或已观察 HTTP 资源错误；wheel-phase/滚轮搜索、Escape、矩阵抽屉 inert/主题刷新保持通过。初次截图发生在平滑滚动尚未结束，未采信为变更内容视觉证据；改为即时滚动后查看矩阵桌面与插件说明移动端实际变更段落，console/page error 为空。文档仍依赖 CDN，浏览器已关闭。写文档时磁盘仅余 191 MiB，删除本仓库可重建 .turbo/cache 后恢复写入，未删除用户数据。原生 observer/error listener/global 已清，原 panel KV 缺席态恢复，测试触发器/面板菜单 key 为零；窗口恢复 1200×800，进程组 95367 终态 143，5184/9224 无监听，正式 app 未操作。

[仍缺] 物理触控板送达/时序、packaged 和 Windows/Linux 输入回归未验，启动 WebContent 终止后恢复和既有 bridge/IMK 警告保留。不宣称所有 Tauri 事件安全，不替代面板焦点/动画/数据完成或全部双端与 W01-W32 验收。完整目标继续，未推送。

## 2026-09-09：后续接线前的源码反查

[代码/待修] READ16 的既有宿主实际包含模式启停、单位切换、上/下一单元与 returnToCurrent；TextUnitNavigatorBar 没有“跟随开关”，useTextUnitNavigator 明确保留 resting unit，不让手动翻页移动它。useReadAloud 的播完自动下一单元也不是可独立切换的 viewport-follow。旧 K02 目标把“跟随”与已有控制放在一行，不能因此推断已有对应宿主按钮或内部函数。该目标需明确语义与宿主建设，不能发明一个方法名后标记 API 漏接已修；本轮未实现跟随。

[代码/待修] 接 TXT04/TXT05 前发现抽取事实本身不可靠，来源是 book-text-store.ts 与 domain/library.ts，以下为源码路径推导，尚未做专门故障运行，未标记修复：

- extract 在缺源文件时返回 chapters=[]、sectionsFailed=0；ensureBookTextExtracted 允许这种结果写 complete=true，getBookTextStatus 随后报告 textless。应区分 missing source / not-found 与成功抽取零文本。
- sectionsFailed>0 但 chapters 非空仍满足终局写入条件；getPersistedBookText 和共享 chapterCache 会继续使用这个不完整结果。局部失败不能宣称全书已抽取，也不能让后续查询永久失去重试机会。
- checkpoint 将失败 section 的空文本和已前进 nextSection 一起存储，恢复路径直接采信原料，不带失败集合；一次暂时失败可能在续跑后被遗忘。需要保存可重试状态，不能只改最终 complete 条件。
- 合并章节时丢弃短于 40 字符的文本，再以“章节为空”推断“无文字层”；短文本不等于无文本。没有支持的 section 读取器也不能等同成功读到空。
- PDF 冷查询对后台 pending 使用空 catch，getTextStatus 只有 ok/unextracted/textless，没有进行中、部分失败或后台错误状态。只增加两端查询入口会把这些不准确的事实直接扩散。

[下一实现单元] 先统一正文抽取的可用性/完成/失败/断点事实、内容身份和缓存失效，再接通受授权的 Agent/插件状态查询及正文准备任务，补真实 Tauri 故障与恢复证据；不会将新状态类型或静态端口计作消费者闭环。此记录是当前缺口的新增依据，不关闭 TXT04/TXT05、READ16 或完整目标。

## 2026-09-09：正文事实修复与 TXT04 双端状态查询

[代码] 将上述正文事实缺陷修复后再开放查询。BookTextRepository 成为唯一抽取/持久结果所有者；原 domain/library 的无版本 chapterCache 删除。v5 记录 source hash、必需节、成功原料、失败 code、unsupported 和 finalized，v3/v4 惰性失效，不将旧不完整结果升级为完整。短正文与无文字独立判断，保留原 40 字符章节策略；部分结果不向 Agent/digest 发布可能重编号的章节。连续五次失败停止并保存断点，恢复只补失败/未读节；每节进度是固定大小快照，不再每节复制/排序全书。缺文件、无书、不支持、准备中、部分失败、读取错误与真实空文本分开。

[代码] 进一步修复最后一节恰好触发 checkpoint 的窗口：所有节读完不等于最终章节索引已落盘，finalized 只随完整章节结果保存。最终保存失败后的断点即使 completed=total 仍是 partial，新 repository 重启恢复会完成合并而不重读成功节。显式重试读回已最终化持久记录时，清除先前进程内失败，不永久显示旧错误。换源/删书淘汰旧任务，持久写/删按书 FIFO 且前后复核所有者和 source；非通用 SQLite 事务，不能强行中断正在执行的解析器 read。

[代码] Library 1.2 的 queries.books.getTextState 与 Agent get_book_text_status（书内/全局）共享 BookTextSnapshot：七种准备状态、三种文本存在性、章节数、源版本、分节进度、可选稳定错误码。查询无抽取、下载或写副作用。library:read 可读，write 包含读，无授权没有域；get_toc 空结果保留状态，失败不伪装空目录。PDF 冷查询后台拒绝现在被记录和日志捕获，完整缓存立即可读。新增两错误的八语言提示。

[组合插件] 新增 Text Desk 0.1，组合书籍列表、每页至多 20 个状态读取、详情/刷新与 reader header/command、明确 Open book；开书完成后才关闭，失败由宿主错误面呈现。列表本身仍一次枚举书库，不宣称原生分页。源码插件变为 12，Rust 内置仍 6，本插件通过 fixture 启动真实编译 Worker，并未加入内置清单。Bun lock 同时校正既有 Listening Desk/Workspace Profiles workspace 版本元数据，未升级它们的依赖。

[环境] [结构化证据](./evidence/book-text-state-2026-09-09.json)：隔离 macOS debug Tauri 的 dataDir 为 com.readaware.app.capability-e2e，5184 前端，本轮 9223 的监听 PID 明确为自有 3726（不是沿用前轮 9224 假设），全部 MCP 调用显式指定。两轮均验证实际 Agent 双 scope 和 empty/read/write 三个 Worker，状态查询后 booktext blob 仍缺席；注入一节 fs/permission 后，双端报告 partial、completed=2/total=3/failed=1，成功节不重读、失败节读两次，恢复 ready。注入点是注册 Foliate 内容的 section getter，原生 blob 持久化和 Worker/Agent 为真，不冒充 OS 权限故障。

[环境] 真正解析短 FB2 得 ready/available/0 章，普通 FB2 得 ready/available/1 章，空白一页 PDF 得 ready/textless/0 章；源 blob 删除得 unavailable/unknown，替换 hash 得 unprepared，随后恢复自有源。实际 reader More → Text Desk → 短正文详情 → Open book，loading 时仍有对话框，ready 后关闭且 visibleText 为 Short text.。1200×800 的列表与短正文详情、800×650 的空白 PDF 详情截图已查看。初次若干截图只捕获到隐藏 WebView 的旧正文，不计视觉证据；OS 定向自有进程置前后取得最终详情图。使用 DOM click 而非物理键鼠；未修改 Tauri set_focus 权限。

[验证] 最终 repository 12 项/94 断言、Agent 状态 6 项、Text Desk 3 项/15 断言；全仓 test 22/22（web 791 项/8720 断言）、typecheck 25/25、前端生产 build 通过。最后补的进程内错误清理用依赖注入测试验证，不冒充新增原生故障测试。没有 Rust 业务修改，保留原生启动的既有 37 warnings、WebContent 首次终止后恢复、bridge 版本提示与 IMK 警告；前端保留大 chunk/动态导入既有构建警告。

[文档/扫描] 更新矩阵和统一模型事实源及生成双份、插件说明双份：243 行、614 库存映射、30 单元/30 catalog、129 旧验收/32 场景反查通过，两生成器 --check、7 项模型门禁及三对 validator 通过。三份变更 HTML 在 1440×1000、1024×768、390×844 无页面横向溢出、重复 ID、坏页内锚点、无名按钮或已观察资源失败；中英文搜索与 Escape、矩阵抽屉 inert 与主题刷新保持通过，console/page errors 为空。移动端矩阵沿用表格内部横滚；已查看 TXT04、模型库存、插件新契约段落截图。仍依赖 CDN，无 Mermaid 图，文档浏览器已关闭。

[清理] 两轮四个 probe/desk Worker 均退休、贡献归零、共六本自有合成书删除；SQLite 书名匹配为零。六个 booktext 不是删除 registry 行，而是按原生契约保留 tombstone：storage_uri 全空、deleted_at 全有值、sync_required 全零。事件历史不倒写。自有进程组 3560 终态 143，5184/9223/9224 均无监听，窗口恢复 1200×800；正式 app、书库及凭证未操作。

[仍缺/下一单元] TXT04 限定的只读状态已双端接通，TXT05 仍未接：prepare/rebuild/cancel/observe 的显式任务契约与真实组合消费要继续实现，不能让取消一个插件请求误杀共享阅读器准备。setup/parser/write 错误尚无耐久任务历史，虚拟正文索引、短章索引政策和旧错误 digest 引用未重建；所有格式、大书性能、真实物理输入、marketplace 安装/升级、packaged 与 Windows/Linux 未验。其余部分/未接能力和 W01-W32 全组合继续，未推送、不关闭完整目标。

## 2026-09-09：正文请求控制与 Text Desk 0.2

[代码] Library 1.3 接入 prepareText / cancelTextTask / getTextTask / listTextTasks / observeTextTask。BookTextTaskOwner 归属插件激活代或进程内单一 Agent 所有者，句柄同时绑定书籍；查询/观察需 library:read，写需 library:write，激活期写仍被宿主生命周期拒绝。任务五态与递增 revision、ISO 时间、最后正文快照和稳定 errorCode 分开表达。上限为每所有者 16 活跃/64 保留、每任务 16 观察者；慢回调合并至最新快照，显式退订与退休释放观察，观察者失败记录日志。

[代码] BookTextRepository 对每个调用维护共享作业租约：取消一个请求不取消已加入的其他 Agent/插件/宿主读取者，最后一个租约离开才中止逻辑工作，晚到结果不能发布。不能强行撤回派发中的 section read/native write/download，取消不是回滚。prepare 默认续用成功节或完整索引；rebuild 清派生索引重读，已有共享任务时以 library/text-busy 失败，不抢占阅读器。回执可以仍处于 source preflight，既不代表完成，也不代表已拿到解析租约；初始快照可能来自已有作业，原生共享测试因此等待 revision >= 2 的仓库回调后才断言只读三节一次。

[代码] Agent 新增 prepare_book_text、get_book_text_tasks、cancel_book_text_task，书内/全局共用实际 library 端口；书内支持 current，跨调用保留进程级任务。列表按最新优先分页，默认 10/最多 20 条，返回 total/offset/nextOffset；64 条历史分页测试验证单次结果不超过 16000 字符。其他宿主未提供 preparation port 时不注册虚假工具。新增四个稳定任务错误的八语言文案。已有 domain registry 增加可选 lifetime，settings 工厂保留其独立访问策略参数而不误传 signal。

[组合插件] Text Desk 0.2 升级到 library:write/^1.3，消费明确准备、复选确认重建、请求列表/详情、刷新与取消。请求取消文案不宣称全局停止；快照行标为 Last text state，避免将过去结果冒充当前状态。真实截图发现 list 不属于宿主图标集，改成 list-bullets 后重新编译验证。失败详情仅显示安全本地化状态/原因，不显示原始异常。没有新增专属宿主 UI，也未重复注册已有 Agent 工具；仍是 12 个源码插件、6 个 Rust 内置，Text Desk 不在内置清单。界面自动推送仍欠，显式刷新没有被称作实时订阅。

[环境] [原生结构化证据](./evidence/book-text-tasks-2026-09-09.json)：隔离配置 com.readaware.app.capability-e2e，前端 5184，桥监听确认为自有 PID 18209/端口 9223/进程组 17993。真实 Worker 的空/读/写权限形状、激活期拒写、异 actor 与同 ID 重启后的旧句柄拒绝均通过。两 Worker 获得共享租约后取消 A，B 继续且三个 section 各读一次；最后请求取消后释放挂起的 section，原生 booktext 不出现。宿主 ensure 正在读取时重建被拒；活跃 Worker 退休不误停共享者，末 Worker 退休不发布晚结果，显式退订后的回调数量不再增长。挂起只注入在已注册 Foliate section getter，源版本/原生存储/实际 RPC 与生命周期不模拟。

[环境] 实际 Agent 双 scope 对短 FB2 重建均为 completed/ready/available/0 章，真实普通 FB2 的 Worker rebuild 为 completed/1 章。编译 Text Desk 经 reader More 打开，重建未勾确认得到字段错误，勾选后生成请求、刷新显示 completed；挂起 section 下由界面准备/刷新/取消，晚读释放后原生索引仍缺席。1200×800 确认表单、800×650 完成与取消详情截图已查看，最终标签和列表图标再次运行/截图核对，无页面溢出。采用 MCP DOM click 和定向自有进程 OS focus，不冒充物理键鼠或模型自主选工具验收。

[验证/扫描] 聚焦 31 项/232 断言通过；最终全仓 test 22/22（web 801 项/8782 断言）、typecheck 25/25，通过前端 build 与 Text Desk 编译。模型 7 项门禁与两生成器 --check、三文档对 validator 通过：243 能力行、625 入口映射、30 所有权单元/30 catalog、129 旧验收/32 场景。矩阵、统一模型、插件说明三份 HTML 均在 1440×1000、1024×768、390×844 检查无页面横向溢出/重复 ID/坏锚点/无名按钮/已观察资源错误；中英文搜索、Escape、矩阵和模型抽屉 inert/主题刷新保持通过。三份变更内容截图已查看，文档浏览器关闭；无 Mermaid 图，CDN 依赖不变。

[清理/边界] 所有自有合成书已通过正式命令删除，SQLite 的 Text State Probe 计数为 0；probe/desk 贡献与观察释放，窗口恢复 1200×800，进程组终态 143，5184/9223/9224 无监听。正式 app/书库/凭证未操作。原生既有 37 warnings、初始 WebContent 终止后恢复、bridge 版本提示、IMK 警告与前端大 chunk/混合导入警告保留。TXT05 从未接推进到部分，不宣告关闭：显式 pause/resume/优先级、耐久任务历史/超时、公开 reader-demand、虚拟索引、全格式/大书、安装升级、packaged/跨平台与 MORE05 动态视图仍缺；其余双端能力和 W01-W32 完整目标继续，未推送。

## 2026-09-09：实时插件视图与 Text Desk 0.3

[代码] UI 1.2 / views 1.1 增加 live.subscribe 与 publishView。宿主签发只属于当前 Worker 激活代和可见帧的通道，接受非负安全整数 revision 的完整静态视图快照；不接受在更新中替换 live source 或导航。foreign/retired/unknown 统一 inactive，旧 revision 为 stale，applied 仅是宿主会话接收，不是 DOM/绘制或持久化完成。每激活最多 16 可见通道，沿用双向 256 RPC 和 120 秒截止；不是耐久流、exactly-once 或源节流器。

[代码] push/modal/suspend/close 立即撤销通道并异步 dispose；back/resume 新通道要求重发当前快照，晚 ACK 仍释放。源失败保留最后画面，安全 InlineError 仅在可重试时提供 Retry，坏视图使用 plugin/invalid-input；清理失败日志保留。更新维持帧身份与现有表单草稿协调，不误丢在途动作的有效导航。Worker 普通调用参数从强制释放改为可转移回调租约，宿主只持有已绘制与最新未绘制画面，中间回调立即释放；注册仍将完整参数租约转给 disposable。

[发现/修复] 新测试暴露了旧 owner watcher 的独立性错误：相邻视图使用同一个 session.close 注册 abort listener，EventTarget 去重后，旧租约 unwatch 会移除新租约的监听。改为每次观察创建唯一 listener identity，增加回调为空视图与重叠释放回归；真实激活退休也关闭当前实时画面。没有修改私有平台登记表或绕过生命周期。

[组合插件] Text Desk 0.3 请求详情将 library.observeTextTask 的立即快照/后续 revision 组合为 live publication；终态自动移除取消按钮。关闭只退订，不取消请求；列表仍显式刷新。使用版本化 manifest 依赖 ui ^1.2 / views ^1.1，编译产物同步。Agent 既有准备/查询/取消工具不变，不因插件呈现协议新增模型可执行 UI 权力。源码仍为十二插件，内置六插件，不混算运行期测试探针。

[环境] [结构化证据](./evidence/plugin-live-views-2026-09-09.json)：隔离 macOS debug PID 24237/PGID 24090，Vite 5184/桥 9223，appDataDir 实查为 com.readaware.app.capability-e2e。真实 WebKit Worker 验证跨 actor 拒绝、旧 revision、普通 RPC 返回后新按钮可调用、草稿不被更新覆盖、push/back/modal 订阅释放与新通道、坏内容安全失败、关闭后的迟到更新与 ACK、Worker 退休和贡献清理。编译 Text Desk 从 reader More 打开，Prepare 后 0/3 Running，在已注册 section getter 的屏障释放后无需 Refresh 即 3/3 Completed、1 章且取消按钮消失。没有模拟原生存储、源身份或 RPC。1200×800、800×650 画面截图已看，无页面横向溢出；长合成书名沿用截断，窄窗正文可滚动、底部操作可达。

[验证/扫描] 聚焦 wire/host/live/Text Desk 29 项/376 断言通过；随后增加 live 声明校验，normalizer 16 项/44 断言通过。最终全仓 test 22/22（web 811 项/9043 断言）、typecheck 25/25，前端生产 build 与 Text Desk 编译通过。模型 7 项门禁、两生成器 --check、三文档对 validator 通过；243 能力行、626 入口映射、30 责任单元/30 catalog、129 旧验收/32 场景。MORE05 同时映射 UI 服务 owner 与视图 schema 责任，不新增平行能力目录。

[文档/清理] 矩阵、统一模型、插件说明双份同步。三份 HTML 在 1440×1000、1024×768、390×844 无页面溢出/重复 ID/坏页内锚点/无名按钮/已观察资源失败；中英文搜索与 Escape、矩阵/模型的抽屉 inert 和主题保持已核对，变更段落截图已看，console/page errors 为空。矩阵“实时”搜索命中六项而不命中 MORE05，因为该行用“推送”；publishView 精确命中 MORE05，未将不匹配谎报为通过。文档浏览器已关闭，固定 CDN 依赖不变，无 Mermaid。自有 Worker 贡献/视图归零，三本合成书按正式命令删除，SQLite Text State Probe 计数 0。窗口恢复 1200×800，PGID 终态 143，5184/9223/9224 无监听，正式 app 未操作。

[仍缺] MORE05 保留部分：贡献 visible/enabled/checked 和 Agent 统一 enablement 尚未实现；全部表单 schema/焦点/locale、大数据/持续更新负载、物理输入、安装升级、packaged 和 Windows/Linux 未验。TXT05 其余调度/耐久任务/虚拟索引等缺口仍在。既有 Rust 37 warnings、启动 WebContent 终止后恢复、bridge 版本提示及前端 chunk/混合导入警告保留。此单元不关闭完整双端能力与 W01-W32 目标，未推送。

## 2026-09-09：交互贡献动态状态与 Jumper 0.2

[代码] commands/headerActions/selectionActions/agentTools 升至 1.1，register 返回精确注册句柄 updateState；完整 revision/visible/enabled/checked 快照经宿主校验。旧版本 stale，同 ID 替换或释放的句柄 inactive；不按公开插件 ID/命令名更新，避免旧异步结果污染新注册。Worker 更新等待注册 ACK，await 后仍可更新，dispose-before-ACK 不再发更新；非交互 disposable 不接受状态写，权限和 RPC 限额/截止沿用。宿主回调包装保留私有 activation identity。

[代码] 书架/阅读 header、选区工具栏及溢出、命令面板、快捷键和查词入口消费状态。每次执行复核精确注册和当前状态，禁用或隐藏都不执行；Agent 两 scope 的插件工具发现过滤状态，缓存的旧工具同样复核。checked 只呈现，不自动切业务。菜单自定义继续列出注册，不把用户隐藏菜单当作撤销命令。已开始的操作不因禁用而取消；打开页面按稳定 view 回调识别来源，状态更新不重载草稿。隐藏完整页面会退出，独立打开的 Dialog 仍遵循自己的 view/activation lifetime。新增 plugin/action-disabled 的八语言文案。

[组合插件] Jumper 0.2 直接组合 observeSession 和四个注册句柄，初始禁用，ready 时开放搜索/header，back/forward 还须对应宿主 history flag。manifest 要求交互贡献 ^1.1，源码与编译产物同步；不复制导航历史，不新增专属宿主分支。仍为十二个源码插件、六个原生内置插件，运行期探针不计产品插件。

[环境] [原生证据](./evidence/plugin-action-state-2026-09-09.json)：隔离 macOS debug PID 30590/PGID 30436，5184 前端/9223 桥，appDataDir 实查正确，正式 app 未操作。真实 Worker 六注册/四贡献点完成禁用、隐藏、恢复和 stale；缓存 Agent 工具与已在途工具分别拒绝新调用和正常完成。实际快捷键监听、书架/阅读 More、命令面板全禁用 Enter、真实 FB2 选区按钮均验，选区禁用 click 调用数保持 3，恢复后变为 4；打开页面草稿 Retained draft 不变，view 源仅调用一次。编译 Jumper 经真实 FB2 导航、back/forward、关闭重开，状态匹配宿主 revision 和历史。

[探针修正] 初次 Jumper 探针错误假设关书总是清空历史，并曾将 loading 时两边都禁用当作 ready 匹配，导致测试失败。修正探针为要求预期 ready/idle 与同 revision，再按宿主真实 history 比较；没有为了过测试改阅读历史。编辑新 fixture 导致 Vite reload，丢弃过期脚本并重新激活后最终通过。退休时在途观察日志 plugin runtime stopping 保留；原生 37 warnings、初始 WebContent 终止后恢复和桥版本提示保留。

[验证/扫描] 聚焦 28 项/183 断言、全仓 test 22/22（web 819 项/9138 断言）、typecheck 25/25、前端生产 build 与 Jumper build 通过。库存扫描增加返回句柄的继承成员解析及四组 updateState/dispose 映射，现为 243 行/634 入口；统一模型 30 单元/30 catalog、129 验收/32 场景，7 项门禁、两生成器与三对文档结构校验通过。模型 C4 补 MORE05 归属，未新增能力目录。三份 HTML 在 1440×1000、1024×768、390×844 检查无页面溢出、重复 ID、坏页内锚点、无名按钮或已观察资源错误；updateState/禁用搜索、Escape、矩阵/模型抽屉 inert 和主题刷新保持通过，截图已看，文档浏览器已关闭。固定 CDN 依赖不变，无 Mermaid。

[清理/剩余] 原生 1200×800、800×650 截图已看；自有 probe/Jumper 贡献均归零，阅读 session idle，窗口恢复 1200×800，PGID 终态 143，5184/9223/9224 无监听。复用隔离环境既有合成 FB2，没有导入或删除书籍。MORE05 仍为部分：宿主内置 Agent 工具统一 availability、在已构建回合中新增工具、完整表单/焦点/locale、持续负载、物理输入、安装升级、packaged/Windows/Linux 尚未完成；其他双端能力缺口与完整组合验收目标继续，未推送。

## 2026-09-09：Agent 逐请求工具刷新与退休检索保护

[代码] AgentThread 每次模型请求前重新构建当前 scope 的完整工具集合。首请求在 prompt 前装配，后续用 pi 支持的 prepareNextTurnWithContext 同时更新发现和执行上下文；不只替换发给 provider 的 schema。新建 Agent 不额外读取一次工具，发现失败发生在安装输入 abort listener 之前。工具和检索注册变化不再通过产品单例 invalidateAgents 清空章节会话；显式上下文失效仍保留原机制。

[代码] 已发出模型请求继续绑定旧定义和回调；注册停用或替换后，旧调用在执行入口失败，不转交同名新实现。agentTools 复用上一轮交互注册保护；检索适配器新增精确注册身份复核，注册时复制身份对象，因此即使重复提交相同定义对象也不能让旧工具复活。退休检索报 plugin/unavailable。已经开始的操作不因刷新取消；scope、剧透批准、文本政策、窗口裁剪和旧结果压缩没有放宽。这里没有新增宿主内置操作的统一 availability。

[环境] [原生证据](./evidence/agent-tool-refresh-2026-09-09.json)：真实隔离 macOS Tauri Worker 注册 arm/target 工具及控制命令，使用产品 AgentThread、脚本模型 stream 和内存 conversation ports，九次模型请求验证初始禁用、同回合启用/调用、等待响应时停用、再启用、下一用户回合的同名替换与新实现执行。旧调用两次失败，实际 target 调用仅三次；前一轮答复保留。不是自主远端模型、正式聊天 UI 或 SQLite 对话持久化验收。检索退休/替换由单测覆盖，未冒充本次原生探针的内容。

[探针修正] WebKit 首次导入暴露测试依赖中的 node:crypto；原生推理夹具改为标准 pi 事件流，不导入 Node-only faux/compat，已有内存标注夹具的 CAS 改为 Web Crypto 生成的 opaque revision，仍按内容与 generation 稳定/失效，原生数据库未改。HMR 与手动 reload 一度交错导致导入/启动失败，重新加载恢复后两次探针通过；最终代码再用全新进程 PID 38475/PGID 38299 重验九次请求通过。前次 PID 35488/PGID 35341 的后台截图只有 header，前置窗口后重新截图显示两本既有合成书；没有把空白截图当通过。

[验证/扫描] 聚焦工具刷新与插件适配器 7 项/54 断言；标注与刷新聚焦曾跑 15 项/72 断言。最终全仓 test 22/22（web 820 项/9143 断言）、typecheck 25/25、前端生产 build 通过。模型门禁 7 项、两个生成器 --check、三文档对 validator 通过；243 能力行、634 入口、30 单元/30 catalog、129 验收/32 场景保持。运行期探针不是新产品插件，源码插件数量不变。

[文档/清理] 矩阵、统一模型与插件说明双份同步，MORE05 仍为部分。三份 HTML 在 1440×1000、1024×768、390×844 无页面横向溢出、重复 ID、坏页内锚点、无名按钮或已观察资源失败；中英文搜索与 Escape、矩阵/模型抽屉 inert 与主题刷新保持通过。修复插件说明搜索子项关键词时父 section 被隐藏的缺陷，updateState 现在显示父项和匹配子项。截图已看，文档 console/page errors 为空，浏览器已关。固定 CDN 依赖不变，无 Mermaid。自有 Worker 贡献归零，两次进程组均终态 143，5184/9223/9224 无监听；正式 app/凭证/书库未操作，隔离书籍未导入或删除。

[剩余] 宿主内置工具统一可用性、其他双端部分/未接能力、完整组合场景、持续负载、远端自主模型、安装升级与 packaged/Windows/Linux 仍需完成。Rust 37 warnings、初始 WebContent 恢复、bridge 版本及前端大 chunk/混合导入警告保留。本单元不关闭完整目标，未推送。

## 2026-09-09：虚拟书删除失败与绑定持久回执

[代码] removeVirtualBook 不再捕获删除错误后继续解绑并返回成功。removeOwnedVirtualBook 负责有序流程：等已有 KV 写结算、按调用插件的 binding 找书、等待共享 library 删除、等待精确绑定清理持久化。共享 book-removed 监听可能先清理，方法等待其结算后再判定；失败回滚的绑定可以显式重试。新的不同绑定不被旧清理删除，报 plugin/unavailable；已无绑定是幂等 no-op。注册表 JSON 或字段结构损坏报 db/error，不伪装空表或被下一次写覆盖。

[边界] 不是把书籍事件、blob 释放、设备本地绑定和 RSS 私有文档合成一个事务。删除提交后若清理失败，书不会被伪造地恢复，调用仍失败；重复调用可完成剩余清理。Agent 核心 delete_book 原有批准路径未改；本次验证的是 Agent 插件工具经真实 Worker 调用这一公开命令。RSS 缓存删除、专用退订工具与批准、并发 add/remove、崩溃恢复、创建/绑定原子性仍未闭合，LIB13 保留部分。

[环境] [原生证据](./evidence/virtual-book-removal-2026-09-09.json)：隔离 macOS debug PID 40303/PGID 40137、前端 5184/桥 9223，appDataDir 实查正确。创建单本 Virtual Removal Probe，SQLite trigger 精确拒绝该书的 book.removed 事件，两条入口均返回 db/error，书和绑定保留。改为拒绝注册表 app_kv 写，两条入口仍返回 db/error，书已删而绑定回滚保留。撤去故障后 Agent 插件工具重试完成，插件命令再次调用 no-op 成功。直接 SQLite 核验书计数 0、绑定缺失、故障 trigger 0；Worker 贡献 0。没有发起自主模型调用或修改正式 app/凭证/书库。

[验证/扫描] 聚焦 5 项/34 断言覆盖原错误传播、清理失败与重试、延迟删除、其他 owner、同 ID 新绑定及损坏 JSON/字段结构；全仓 test 22/22（web 825 项/9177 断言）、typecheck 25/25、前端 build 通过。三文档对 validator 通过，矩阵和插件说明的 HTML 检查 1440×1000、1024×768、390×844，无页面溢出/重复 ID/坏锚点/无名按钮/已观察资源失败；中英文搜索与 Escape、矩阵抽屉 inert 和主题重载保持通过，截图已看。统一模型 HTML 未改，生成 Markdown 反查事实跟随矩阵更新。文档浏览器曾变为 about:blank，等待中的命令终结为元素/求值错误；doctor 通过，同一会话重新打开目标文档并核对 URL 后重验通过，最后 console/page errors 为空，浏览器已关。

[审计修正] READ16 的“跟随开关”没有当前宿主实现；当前逐单元导航保留 resting 位置，手动翻页不移动它。自动滚到当前单元与手动翻页后单元跟到页面是两个不同产品行为，已提出异步澄清，未擅自选择或把它当已有漏接。目标仍保留，未因没有实现而删掉需求。

[清理/剩余] PGID 40137 终态 143，5184/9223/9224 无监听，自有书、绑定、触发器与贡献归零。既有 37 Rust warnings、WebContent 初始恢复、bridge 和前端 chunk/混合导入提示保留，故障注入产生的预期 KV 日志保留。本单元不关闭整体双端能力、完整组合插件/场景或 packaged/跨平台目标，未推送。

## 2026-09-09：共享正文检索与 Text Desk 组合搜索

[代码] library 1.4 新增 books.searchText，Agent BookTextPort 不再独立枚举书架/扫描正文，改为消费同一共享领域。纯章节与对话匹配移到 core，Agent 保留原导出，匹配算法未重写。读权限可查询、写权限蕴含读、无权限不可见；声明版本和库存均更新。输入限制 1–12 个非空变体、每个至多 1024 字符、1–100 个结果（默认 16），非法参数在读库前拒绝。章上界允许 -1，Agent 原有 scope、剧透批准和证据收集保留；Agent 取消信号及插件激活代信号接入异步读边界。

[边界] 单书仍可能准备正文，跨书只读已持久且源版本有效的索引，不触发批量抽取。按当前书架顺序截取结果，不是全局相关性排序或所有出现次数；无索引书被跳过不等于书内不存在查询词。章内 offset/snippet 不是版本化 Location/Range，不能直接导航。输入校验、读取/抽取失败、缺书、取消都有明确拒绝，不返回假空表或局部成功。分页、扫描预算、同步章节内部让步取消和任务句柄仍属 TXT08，未宣告完成。

[组合插件] Text Desk 0.4 在已有 library/reading/UI 原语上增加本书与已索引书架搜索，换行输入多查询，最多 40 条结果，精确/词元标记放在副标题开头避免被长章名遮住；选择后显示原始纯文本片段，可明确开书或继续搜本书。没有为插件新建专用搜索域或允许原生逃生口。现有详情测试改按动作 ID 而非数组下标选择动作，避免新增功能误测其他按钮。

[环境] [原生证据](./evidence/book-text-search-2026-09-09.json)：隔离 macOS debug PID 44363/PGID 44218，前端 5184、bridge 9223、appDataDir 实查正确。两次真实 Worker no-grant/read/write 和产品 Agent 端口探针均通过：单书/跨书、非法 limit、缺书、-1 围栏；未准备书前后状态均未准备。原生阅读 More 菜单打开编译 Text Desk，空表单校验、多变体精确结果、片段详情、本书词元结果和无匹配文案已验证；1200×800 与 800×650 截图已看，无页面/弹窗横向溢出。最后一次 Open book 虽点击，但清理前未取得完成终态，不宣称该动作原生验收通过。没有自主模型调用或正式 app 数据操作。

[验收新发现] 结果返回搜索表单时观察到空查询草稿，跨帧草稿保留需继续补证/修复，MORE05 不因此关闭。最初一次未限定 dialog 的工具输入写到合成书的未发送聊天草稿，随后改用 dialog 内 textarea；未发送聊天，合成书已删除。插件重建前已完成清理，但 Vite 重载仍出现旧 useWindowMaximized 的 listeners[eventId].handlerId 取消监听异常；没有为本次搜索绕过或吞掉它。重新导入探针后双端检查与最终 UI 重验通过，不把 HMR 恢复当作无错误启动。

[验证/扫描] 共享检索和旧算法聚焦 13 项/48 断言，Text Desk 9 项/67 断言；新增宿主错误映射及八语言文案 2 项/33 断言（在原生运行后加入，未声称原生错误渲染已验）。全仓 test 22/22（web 832 项/9240 断言）、typecheck 25/25、前端生产 build 通过。库存现为 243 行/635 入口，TXT06 插件由未接改为接通，其限定范围之外的 TXT08 等缺口保留；统一模型 30 单元/30 catalog、129 验收/32 场景，7 项门禁、两生成器 --check 与三文档对 validator 通过。

[文档/清理] 三份 HTML 在 1440×1000、1024×768、390×844 检查，无页面横向溢出、重复 ID、坏页内锚点或无名按钮；中英文搜索、Escape、矩阵/模型抽屉 inert 和主题刷新保持通过。文档截图已看，console/page errors 为空，固定 CDN 依赖不变，无 Mermaid；文档浏览器已关。两组合成书共六本经 SQLite 核验均已删除，探针与 Text Desk 自有贡献归零；进程组终态 143，5184/9223/9224 无监听。既有 Rust 37 warnings、WebContent 初始恢复、bridge 版本和构建 chunk/混合导入提示保留。本单元未关闭整体目标，也未推送。

## 2026-09-09：导航帧拥有表单草稿

[根因/代码] 上轮 Text Desk 返回丢查询并非插件缺少存储，而是 PluginViewSession 只保留声明与回调，表单值仍只活在被 push 卸载的 React 组件里。新增帧所属的内存草稿，由 renderer context 提供给根表单和 detail/section/group/columns/row 内嵌表单；组件渲染与状态协调分离。push/back 保留各自草稿，replace/reset、离栈、关闭和停用清理；根数据刷新与 live publication 复用草稿，只采纳未编辑字段的新默认值。字段删除或类型改变丢弃旧值；嵌套表单按结构路径区分，不同帧的相同 field ID 不串值。没有让 Text Desk 自己复制宿主导航状态。

[边界] secret adapter 字段不进入普通值，password 文本输入在隐藏帧中清空。视图结果入口绑定来源 frame key，隐藏父页/已离栈页面的迟到提交不再作为当前子页执行。字段错误只对应其校验值，编辑后清除且不因重新输入旧值复活，迟到校验不覆盖新编辑。草稿不是持久保存回执；本次没有解决全部 debounce 写完成、焦点、滚动、动态选项编辑状态或任意结构重排身份。模型工具仍消费业务域，不为 UI 草稿新增 Agent 权力。

[原生] [证据](./evidence/plugin-form-drafts-2026-09-09.json)：隔离 macOS debug PID 49465/PGID 49318，5184/9223 与 appDataDir 实查正确。真实 Worker 嵌套表单在 live 默认值更新、push/back、重新订阅之后保留 User draft；隐藏/外部/过期发布、嵌套 modal、非法更新、关闭后迟到 ACK、Worker 退休均复验。编译 Text Desk 从阅读 More 打开，新增可重复桌面夹具完成两层查询的独立草稿、连续返回、空值校验与清除；800×650、1200×800 均无页面/弹窗横向溢出。本次等到了 Open book 的弹窗关闭及目标 session ready，补足上轮未确认终态。关闭重开为空、截图人工检查通过。真实插件权限与 Agent 单书围栏/全局搜索端口再次通过，未调用自主远端模型。

[验证/清理] 聚焦 17 项/1092 断言；全仓 test 22/22（web 838 项/9277 断言）、typecheck 25/25、前端生产 build 通过。两个生成器 --check 与模型门禁 7 项通过；243 行/635 入口、30 单元/30 catalog、129 验收/32 场景保持，不把库存检查当作无遗漏证明。只补交付日志与原生证据，已有三份模型/矩阵/插件说明 HTML 未改。六本自有合成书经 SQLite 核验归零，探针与 Text Desk 贡献归零，窗口恢复 1200×800，自有进程组终态 143，5184/9223/9224 无监听；未操作正式 app 或既有隔离书籍。

[剩余] 最初在运行中编辑源码触发整页 reload，旧 ref 和脚本失效；最终在代码和构建稳定后重跑夹具。已有 useWindowMaximized HMR unlisten 异常再次出现，未吞掉或当成本次修复完成；Rust 37 warnings、WebContent 初始恢复、bridge 与构建提示保留。EXT03/MORE05 的其他生命周期、全部双端部分/未接、完整组合用途与 packaged/跨平台验收继续，整体目标未完成，未推送。

## 2026-09-09：批量删书双端契约与 Library Desk

[根因/代码] LIB05 原来只有宿主多选支持一次事件批次，Agent 和插件只能循环单删。library 1.5 现在共享 removeMany/retryRemovalCleanup，核心契约接受 1–1000 个非空字符串 ID、每个至多 256 字符，复制去重、不强制转换，稀疏数组也拒绝。事件/投影为一个 SQLite 事务，提交失败不通知或清文件；提交后先通知记录已删，再释放原文件/封面。committed:true 与 files.released/pending 分开，失败保留稳定 code，不把部分文件释放伪装成数据库回滚。文件重试不再写删除事件；Rust 持锁预检全部 ID，任何现存书都拒绝整次清理，保护已恢复书籍。

[Agent/插件] 全局 delete_books 固定 ID 批次、列全部标题、一次用户批准；新删除拒绝未知书，cleanupOnly 拒绝现存书并走文件重试。拒绝及派发前取消不写入；书内不注册全局管理工具，已派发事务不因 abort 撤销。Plugin library:write 可直接调用，两端调用同一领域而非重复业务流程。Library Desk 0.1 在书架 More 中组合查询、实时选择、完整标题审阅、删除与文件清理重试；它的审阅不是宿主权限票据。源码插件变为 13，Rust 内置仍 6，未自动加入内置包。

[真实组合发现] 列表每次收到新 view 对象时重置 query，导致勾选一项就清空搜索。宿主已有 frame renderKey 控制导航重挂载，移除多余的按对象重置，实机验证 live 更新保留筛选。插件刷新增加 generation，旧结果/关闭后的请求不覆盖新快照；单测覆盖逆序与释放。删除审阅改用可换行文本，避免列表标题省略号隐藏实际书名。并非所有列表返回、焦点和滚动草稿都已解决。

[原生证据] [批量删除验证](./evidence/book-batch-removal-2026-09-09.json)：隔离 macOS debug PID 55065/PGID 54917，前端 5184、bridge 9224，appDataDir 实查正确；另一既有 dev app 占 9223，未操作或停止。真实 Worker 验 no/read/write、非法批次、数据库第二事件拒绝下两端整批回滚（2 书/0 删除事件）。文件元数据写拒绝时记录已删（0 书/2 事件），Agent 文件重试仍 pending 且事件不增加。恢复一书，把已删 ID 排前、现存 ID 排后重试，原生拒绝且两份文件前后仍 636/566 字节。Agent 拒绝、派发前取消、批准成功均已验；批准组件为真实产品组件，但由隔离夹具挂载，不是自主模型或持久聊天回合。实际 Library Desk 通过 More 选择两书、审阅、故障删除、清理重试到完成；修复后再验搜索保留、完整标题和成功结果。800×650、1200×800 无页面/弹窗横向溢出，截图已看；初次后台截图空白，聚焦正确 PID 重拍后才计入证据。

[扫描/验证] 全仓 test 23/23（web 845 项/9366 断言）、typecheck 26/26、前端生产 build 通过；Rust debug 在原生启动前编译通过。首次全测暴露工具数量及 catalog 版本两个旧断言，按实际全局注册/书内不注册与 library 1.5 更新后全量重跑通过。八语言稳定错误/完整批准 subject 65 断言通过。矩阵 243 行/639 入口，LIB05 双端由部分改为接通；模型仍 30 单元/30 catalog、129 验收/32 场景，7 项门禁与两生成器 --check 通过。同步三文档对，修正新插件库存并补 Text Desk 既有任务/搜索消费者映射；LIB13 明确保留通知先于文件清理后，虚拟书绑定可能已清除、须保留 ID 才能文件重试的缺口。

[文档/清理] 三 HTML 在 1440×1000、1024×768、390×844 无页面横向溢出、重复 ID、坏页内锚点或无名按钮；中英文搜索/Escape、矩阵与模型抽屉 inert、主题刷新保持通过，截图已看，console/page errors 为空。固定 CDN 依赖不变，无 Mermaid，文档浏览器已关闭。各次合成书（含早期 HMR 遗留两本）和故障 trigger 已清除，自有 Worker 贡献归零；SQL 只剩两本原有隔离 Probe，未碰其内容。自有进程组终态 143，5184/9224 无监听，9223 的非自有进程保留。

[剩余] 这不是完整数据擦除、耐久清理队列或跨设备版本审批；旧单删/虚拟书的文件失败恢复、1000 项真实负载、完整组合场景、其他双端部分/未接能力及 packaged/Windows/Linux 仍需完成。既有 Rust warnings、bridge 版本、HMR unlisten 和前端 chunk/混合导入提示未宣告修复。整体目标保持未完成，未推送。

## 2026-09-09：宿主持久文件清理与双端恢复发现

[根因] 旧流程只在删除回执保留待清理 ID；提交后的通知可先清虚拟书绑定，插件/页面/进程重启后即使有文件重试方法也无法重新找到目标。恢复意图属于宿主删除事务，不应该要求每个插件另存一份删除状态。上一轮确认模型的问答没有推进实现；本单元继续此前未提交的恢复实现并完成验证。

[代码] migration 31 新增设备本地 book_removal_cleanup；books 删除触发器在记录事务内保存 ID/最后标题/本机删除时间，事务回滚不遗留意图，恢复插入取消意图。重放中仍存在的书会在同事务取消清理，队列不进入投影/检查点。原生文件释放持锁预检整个批次及投影新鲜度，blob 元数据与意图确认同事务；文件字节仍可能部分删除，失败保留意图并允许缺字节重试。启动每页 100 项逐项恢复、每项释放锁；单项失败不饿死后页，无周期调度。全数据清除明确把队列排在书籍之后，避免删除触发器重新留下队列。原生 cursor 校验与 TS 对齐非空白及 256 UTF-16 单元。

[双端/组合] library 1.6 增加只读 listRemovalCleanup，limit 1–100 默认 50，实时 ID keyset，不是假冻结快照。Agent 全局 list_book_removal_cleanup 使用同一领域，查询不写入、不批准，删除仍走已批准 cleanupOnly；书内不暴露全局积压。无权限不可见，读权限只查询，写权限可重试。Library Desk 0.2 用公开 API 组合待清理列表/翻页/完整标题与 ID 详情/单项重试，不依赖原回执。实际 UI 发现 file 图标不在宿主映射，改为 file-text 后重拍确认；旧刷新与草稿语义不改。八语言补稳定错误与工具名称。

[原生] [恢复证据](./evidence/book-removal-recovery-2026-09-09.json)：隔离 macOS debug 5184/9224，appDataDir 实查。保留数据库故障退出再启动，仍有两条持久意图；新 Worker/生产 Agent 端口能查询原 ID/标题/时间，读权限分页可走到末页。实际 More > Library Desk 清理列表/详情/失败重试，移除故障后插件清一条、真实产品批准组件的 Agent 清另一条，删除事件仍为 2。虚拟书绑定消失时队列仍保存 ID，移除意图确认故障再启动后队列归零，删除事件仍为 1；该虚拟书无源字节，不把此项称为虚拟文件 I/O 验收。

[退出窗口/恢复保护] 后续实机恢复操作在 blob 元数据故障下拒绝，但书行已经恢复、566 字节源文件仍在，清理意图被取消；移除故障后启动保护这本现存书。随后用精确 ID/标题及隔离目录保护，在真实 commitDomainEvents 完成删除后不调用文件释放，确认队列存在且磁盘仍有 566 字节，再终止进程。下一次启动队列归零、文件不存在、blob 元数据标记删除，事件数前后仍 3。这是提交后的受控退出窗口，不是提交中断电证明。最后新 Agent/Worker 均读空队列；800×650、1200×800 截图已看，无已检查的页面/弹窗横向溢出。

[验证/扫描] Rust lib 137 pass / 1 ignored；新增 6 项覆盖事务回滚、重开、恢复预检、输入/过期投影、105 条跨页单项失败及 reset。全仓 test 23/23（web 846 项/9403 断言）、typecheck 26/26、前端生产 build 通过。两生成器 --check、统一模型 7 项门禁、三文档对 validator 通过；库存现为 243 行/642 入口，30 责任单元/30 catalog、129 验收/32 场景不变。新 Agent/插件/原生入口均反查，LIB13 仍保留 RSS/绑定恢复缺口，没有用文件恢复把整行标成接通。三 HTML 在 1440×1000、1024×768、390×844 截图已看，未见页面溢出/重复 ID/坏锚点/无名按钮；中英文搜索/Escape、矩阵和模型抽屉 inert/主题刷新保持通过，观察到资源 200、console/page errors 为空。插件说明原本没有主题或抽屉，不虚称测了这两项；文档浏览器已关闭。

[清理/剩余] 自有进程组 63982/64577/65673/68744/69699 均终态 143，5184/9224 无监听；既有 dev PGID 89360、bridge 9223 未操作或停止。自有书/绑定/故障触发器/贡献和待清理队列归零，保留两本既有测试书，未操作正式数据。迁移前孤立文件不回填，RSS 私有缓存和绑定持久恢复、晚到 blob 写入、跨设备竞争、完整自由组合覆盖、1000 项实机负载、packaged/Windows/Linux 仍待完成。既有警告、较早启动的 HMR unlisten 错误与测试故障如实保留。整体目标继续，未推送。

## 2026-09-09：一致阅读时长快照与 Reading Goals 实时组合

[根因/进度] 上一个确认模型的问答只核对文档，没有推进实现。本单元接续未提交的 STAT03：原来宿主已持久的 pending sessions 不在两端统计读模型，单独读取 settled/pending 又会在 flush 时重复计数。原生 reading_time_snapshot 用同一 SQLite 读事务取得已结算、待结算、总时长、全 scope 桶数、采样时间与有界 keyset 页。按书/记录日期过滤，默认 50/最多 100 桶；缺书、非法参数、过期投影及读取失败明确拒绝，没有新增计时写入或强制 flush 权力。

[双端] reading 2.7 的 stats.time / observeTime 对 reading:read/write 开放，零权限无领域。观察首读后等待读取与回调完成，再至少一秒重采样；每订阅 revision、全局 64 订阅上限、输入复制、幂等退订及迟到结果抑制。已派发 SQLite 不声称被取消。Agent 两 scope 注册 get_reading_time，书内默认当前书，allBooks 明确聚合；默认/最多 10 桶，时长输出秒数、时钟 ISO。JSON 转义导致超长时进一步缩页并保留末项游标，结果上限 16000 字符。已结算旧统计入口不改语义。该读模型只包含已持久样本，不外推 tracker 尚未写入的约 20 秒间隔，也不是跨设备同步证明。

[组合] Reading Goals 0.2 沿用真实插件私有目标/上下文/记忆候选，并增加书架菜单、命令和书内目标详情中的时长入口；组合日期/全部时间、实时详情、待结算分页和活动/位置时钟。主详情自动观察，列表显式刷新。views 1.2 新增仅含稳定 code 的 error 块，宿主 InlineError 本地化，未知码安全降级，不渲染原始 message、不另开错误弹窗；失效时保留上次成功样本，恢复后移除错误。八语言工具/错误/插件文案齐全；本轮检查发现字符串数字下标难以维护，改为与插件既有模式一致的命名字段，随后重新构建及验证。

[桌面] [原生证据](./evidence/reading-time-snapshot-2026-09-09.json)：隔离 appDataDir、前端 5184、bridge 9224，真实 Worker no/read/write、生产 Agent 双 scope、编译插件以独立身份预览。合成两个小时桶 20s+5s，两页各报告全 scope 25s；flush 追加两个事件后总量仍 25s。插入仅用于本次故障的 disabled sync_profile stale 行，观察 revision 18–25 报 reading/stats-stale，UI 保留 25s pending 和安全恢复文案；删除精确 marker 行，revision 26 自动恢复。停止观察后 revision 103 不再增长。实际前台 FB2 阅读先后产生 20.001/40.003s pending，位置观测时间不随 tick 改变；关闭后含 partial tick 共结算 43.7s，加合成 25s 为 68.7s，pending 归零。合成 accrual 不冒充真实阅读，直接执行工具不冒充自主模型决策。

[UI/环境] 实际 More > Reading time、失败恢复、Pending sessions 空态、Today 和关闭通过，1200×800、800×650 截图已看，未见横向溢出；第一次窄窗截图处于打开动画，等待后重拍才计入。首个夹具动态加载 pdf-lib/path 触发 Vite 优化和整页重载；从日志确认终态，清理精确的两个尝试导入 ID（blob 元数据均标记删除），稳定后重做，不因单次超时盲目重启。最终三个自有合成书/四个 Worker 贡献归零，SQLite 只剩原有两书，pending 与临时 sync_profile 行均为零。自有 PGID 76157 终态 143，既有 PGID 89360 未操作或停止。没有操作正式 app 数据。

[验证/扫描] Rust lib 140 pass / 1 ignored，新增日期/分页/无写入/过期投影、并发 tick 与 flush、两个 WAL 连接并发快照回归；37 个既有 warnings 保留。全仓 test 23/23（web 851 项/9478 断言）、typecheck 26/26、前端生产 build 和 Reading Goals 独立 build/typecheck/tests 通过；工具表面格式/转义长度与分页游标回归通过。三个文档对同步，243 行/647 入口、30 单元/30 catalog、129 验收/32 场景，模型 7 项门禁与生成器 --check 通过。STAT03 双端改接通，但 EXT07 仍保留 toast/统一任务批准缺口。三份 HTML 在 1440×1000、1024×768、390×844 无横向溢出/重复 ID/坏页内锚点/无名按钮；中英文搜索、Escape、矩阵与模型抽屉 inert/主题刷新保持通过，截图已看，浏览器 errors 为空。插件说明原本无主题/抽屉；CDN 依赖未改变，未新增图，文档浏览器已关闭。

[剩余] STAT02 的历史小时分布、其他部分/未接能力、完整自由组合覆盖、长时/并发/撤权验收及 packaged/Windows/Linux 继续。此单元不把可调用入口或局部桌面成功当整体完备，不标记总目标完成，未推送。

## 2026-09-09：阅读趋势双端查询与正式会话事件

[进度/根因] 上一轮只回答建模范围，没有改变实现。本单元继续工作区 STAT02/STAT05：统计页已有的周期、小时分布和成就未进入两端正式读模型；sessionRecorded 已实发却未在公开插件 union 内。reading 2.8 新增 stats.insights，core 同源事件名单同时供 runtime gate 和 SDK 类型推导。没有把每种图表变成单独宿主能力。

[代码] 原生 reading_time_scope 在同一只读 SQLite 事务加载指定书/聚合 totals、daily、hourly，验证非空/256 UTF-16 ID、书存在、投影未 stale，读取不 flush。宿主复用统计页纯推导：week/month/year 为最近 7/30/365 天，all 图最多 36 个自然月；7 槽 weekday 随周期，24 槽小时和成就始终 all-time。asOfDay 是日历参考，不是过去数据库快照；聚合包括仍有历史的已删书。修复年度图把范围外整月混入的问题，并移除统计页 DEV 自动持久化模拟历史。边界补测还实际复现 0100 年读取结果 0 而非 3：统一补四位日期键、setFullYear/setUTCFullYear，跨 0099/0100 的周、月柱与连续天数通过回归，没有靠缩小有效日期范围绕过。

[双端/组合] Agent 两 scope 注册 get_reading_insights，书内默认当前书，allBooks 明确聚合，输出秒数和明确命名的 allTime 字段；查询前后检查取消，不承诺取消已发出的 SQLite。Reading Goals 0.3 用公开能力组合周期表单、日/月列表、小时列表、成就与刷新；主详情订阅 sessionRecorded/timeRecorded，按书过滤、合并重读、错误保留带说明的成功样本、离开退订。子视图为快照，返回后重新订阅；不冒充删除/远端/跨日完整观察。八语言工具名/插件文案齐全；不新增计时写权限。

[桌面] [原生证据](./evidence/reading-insights-2026-09-09.json)：隔离 macOS debug 5184/9224，真实 no/read/write Worker 与生产 Agent 端口。合成四桶 130s 在 flush 前不进入 insights，正式提交四事件后，周/月/年/全部为 30/100/100/130s；两个 Agent scope 与插件一致，Worker 收到四份类型化正式会话 payload。编译插件 More > Reading time > Reading trends 切年度、日期列表、小时列表滚动至 23:00、成就、返回均通过；真实合成 60s 结算令可见聚合恰增一分钟，不点刷新。

[失败/恢复] 第二次预览插入精确 disabled sync_profile marker 令投影 stale，两端拒绝 reading/stats-stale；仅注入一条非持久通知触发插件故障重读，不假称它是事件日志。UI 显示宿主本地化错误及 Last successful sample；移除精确 marker，再真实结算合成 25s，错误自动消失且数值更新。800×650、1200×800 截图已看，页面/弹窗未见横向溢出。合成时长不是实际用户经过时间，直接工具执行不是自主模型推理。

[验证/扫描] Rust 141 pass / 1 ignored，含作用域只读/错误及 WAL 并发读写一致性；全仓 test 23/23（web 856 项/9511 断言）、typecheck 26/26、前端生产 build、插件 build 通过。最大转义 ID 与完整 36 柱/24 小时/7 星期工具结果低于 16000 字符。三文档对 validator、生成器 --check 和 7 项模型门禁通过；243 行/651 入口、30 单元/30 catalog、129 验收/32 场景。STAT02 双端接通，STAT05 插件接通、Agent 保持自动读取；CON07 全来源事件一致性等原缺口仍保留。

[文档/清理] 三份 HTML 在 1440×1000、1024×768、390×844 截图已看，无页面溢出/重复 ID/坏页内锚点/无名按钮；中英文搜索和 Escape、矩阵/模型抽屉 inert 及主题刷新保持通过，观察资源 200、errors 为空。模型搜索作用于责任/裁决条目，小时分布命中 R8；不是全文证据表搜索。插件说明原本无主题/抽屉。首个文档浏览器 CLI 明确错误退出，诊断确认 Chrome 页面连 CDP 求值也无响应；只终止自有 Chrome/daemon，重新从 about:blank 启动后检查通过，非因单次观察超时重启。全部自有浏览器已关闭。

[清理/剩余] 初次 Vite 优化在导入中重载，另一次修改工具描述触发明确整页重载；只按日志中的精确 ID 清理本次书，稳定后重新预览。最后原有两本隔离书保留，新书/四 Worker 贡献、pending、临时 profile、文件清理队列均归零。自有 PGID 82485 终态 143，5184/9224 无监听，既有 PGID 89360/9223 未操作；正式数据未动。全来源观察、宿主内部大历史全量加载的性能、其他未接/部分能力、完整自由组合与撤权/并发验收、packaged/Windows/Linux 继续；旧 Rust/bridge/chunk/混合导入警告未宣告修复。整体目标未完成，未推送。

## 2026-09-09：工作区导航、命令搜索和选择集双端闭环

[进度/根因] 上一轮只确认当前建模范围，没有推进实现。本单元完成 UI01/UI02 已有工作区行为的双端接线：原先 activeTopNav、命令搜索和选择集散落在 React/Jotai，写 atom 不代表目标界面已经提交。新增共享 WorkspaceService 与宿主 adapter，Agent 和插件不直接依赖 Router、DOM 或 UI atoms。

[代码] UI 1.3 提供 snapshot/observe/navigate：书架根或集合、Agent、统计、九个内置设置节及启用插件设置节、现有命令面板搜索。快照含实际 reader 状态但无书 ID/正文/凭据；搜索最多 4096 UTF-16 字符。选择查询默认 100/最大 1000，按 ID 码元序分页并返回全量 total/revision/cursor；导航最多 1000 个至多 256 字符的 ID，全属目标集合，省略 selection 清空，不跨集合隐选。已提交视图观察、64 订阅上限、慢回调合并、退役 null、幂等释放；关闭页面订阅不应积累后台回调。

[执行边界] library:read/write 可读，library:write 可导航，离开活跃阅读另需 reading:write；设置/搜索覆盖层不关闭阅读。目标存在、revision、异步查库期间原生新意图、阅读 handoff 后新会话都校验；等待现有书库 UI 副本赶上导入/同步后再施加选择，不另建缓存。新请求/取消/退役终止旧等待，10 秒期限。目标组件在 Suspense/error boundary 内 layout commit，再匹配新 token 和状态才返回 completed。不是动画结束、焦点归属、后台数据加载、阅读时长结算或同步完成；取消不回滚已经派发的 UI/关闭副作用。读库失败不伪装目标不存在。

[双端/组合] Agent 两 scope 新增 get_workspace/navigate_app，生产端口调用同一服务；模型查询最多 25 项，查询文本明确为 256 字符预览，转义后预算缩页且保留可用 cursor。Library Desk 0.3 用公开 API 组合工作区入口、实时已选计数、设置/统计/Context 跳转和搜索表单；插件勾选跨集合时先按集合分组，用户明确点一组才显示，不自动删除。集合列表是打开时快照，不冒充完整集合观察。八语言工具/错误/插件文案与编译 dist 同步。

[桌面] [原生证据](./evidence/workspace-navigation-2026-09-09.json)：隔离 macOS debug 5184/9224，真实无权/只读/写入/阅读控制 Worker、生产 Agent 双 scope 和编译插件。两本合成 FB2 进入原生多选、只读分页总量 2、Agent 相同 ID；不存在集合/隐藏选择均 ui/target-not-found。实际命令搜索文字和结果点击、真实 FB2 ready/有权关闭/无权拒绝通过；统计页可见时将一书移出集合，选择自动由 2 变 1。实际 Library Desk 跨集合分组选择、Workspace > Search > Open、并发旧请求 superseded、新请求完成、旧 revision 拒绝及取消均有证据。最终重跑修正后的图标，800×650 截图已看，查询 input maxLength 4096，页面无横向溢出；此前 1200×800 选择截图也已看。工具直接执行不冒充自主模型推理，测试夹具合成书不涉及正式数据。

[验证/扫描] 最终全仓 test 23/23（web 871 项/9599 断言）、typecheck 26/26、前端生产 build 通过；新增共享服务、真实 adapter、权限、Agent 预算/双 scope、插件组合测试覆盖错误/退役/超时/延迟副本。无 Rust 改动，本单元未重跑 Rust 全套；已有编译 37 warnings、bridge 版本提示、chunk/混合导入警告保留。三文档对 validator、两生成器 --check、7 项模型门禁通过；243 行/658 入口、30 责任单元/30 catalog、129 验收/32 场景，UI01/UI02 双端接通但只指本行限定行为。

[文档] 三份 HTML 在 1440×1000、1024×768、390×844 截图已看，无页面横向溢出/重复 ID/坏页内锚点/无名按钮。矩阵 workspace 命中 6 行、中文导航命中 32 行含 UI01；工作区不是矩阵既有中文标签，搜索该词为 0，不当成测试成功。模型 workspace/工作区命中 2/1 条，插件说明两词均命中 2 节。Escape 清空、矩阵/模型抽屉 inert 与主题刷新保持通过，errors 为空；资源观察为 200，仍依赖原有 CDN，无新增图。插件说明没有主题/抽屉，不虚称验收。文档浏览器已关闭。

[清理/剩余] 夹具方法名修正、验证重建引起的明确 Vite reload 曾中断预览；均核验隔离路径并按本次精确 ID 清理后重做，没有因为观察超时盲目重启。最终两本自有书、集合与五 Worker 贡献清零，原有两本测试书保留。自有 PGID 90456、93846 均终态 143，既有 PGID 89360/9223 未操作；reload 中已有 useWindowMaximized unlisten 错误未声称修复。1000 书实机负载、远端竞态、全部焦点/弹窗流程、packaged/Windows/Linux、其余部分/未接和完整自由组合覆盖继续。整体目标未完成，未推送。

## 2026-09-10：设置提交观察与 Workspace Profiles 实时组合

[进度/根因] 上一轮确认问答仅核对模型，没有推进实现。本单元完成工作区内设置观察的复核与交付：旧 settings.changed 只由领域命令发出，原生设置页、同步覆盖和恢复不经过它；读取还可能遇到未落盘的乐观值。新增基于实际 KV 事务完成的观察通道，不将原生 UI、Agent、插件分别建成独立设置存储。

[代码/双端] settings 1.6 的 queries.observe 返回授权投影与进程内 revision，覆盖 local/remote/restore/catalog，合并时 source 可为 mixed；已知领域 actor 带 origin，旧原生写入、远端身份未知与目录变化明确 null。snapshot/read/discover 等待 KV 与凭据队列同时结算；Agent 两 scope 的 get_settings/update_settings 使用同一时钟与持久边界，不新增后台模型观察循环。每次成功事务只发一次新 feed，失败不发布乐观值，隐藏字段变化不推送投影；64 订阅上限、慢读取/回调串行合并、稳定错误和恢复、幂等退订与退役抑制。激活期间保留只读查询，观察到 promote 才启动；已保存的查询函数与排队写入不能在退役后重新获取权力。已派发操作不承诺回滚，旧 settings.changed 保持命令事件语义。

[持久边界] host secret snapshot 改用有序写队列，旧请求失败不再覆盖新请求的值，观察只含槽位配置状态而非密钥。KV 备份合并改为原子批次，同时保持既有本地漫游发布策略；前缀恢复仍不当成新编辑发布。凭据队列及双队列竞争由隔离模拟 IPC 测试验证，没有访问实际用户密钥。AI 配置现有远端凭据发布仍未统一等待本地提交，不把本单元当作该链路闭合。

[组合/桌面] Workspace Profiles 0.3 新增 Current workspace，直接组合公开 settings 观察与 live view，显示七个预设字段，错误时保留上次成功值、恢复后清除错误。[原生证据](./evidence/settings-observation-2026-09-10.json) 覆盖隔离 macOS debug 的无权/只读/写入 Worker、生产 Agent 双 scope、已编译插件：原生设置页实际 Dark 点击、领域写入、远端覆盖路径、前缀恢复和动态主题注册/释放都更新同一视图与递增时钟。SQLite 定向 UPDATE 故障让 Agent 返回 db/error，观察计数不增，视图保留 dark，SQL 原始错误未显示；删除触发器后恢复。停止观察后计数保持 12，无权 Worker 始终只有一次空投影。1200×800 与 800×650 截图已查看。远端测试是实际本地 overlay 路径而非联网同步；Agent 是确定性工具执行而非自主推理。

[验证/扫描] 全仓 test 23/23（web 878 项、9636 断言、150 文件）、typecheck 26/26、前端生产 build 通过。新增生命周期、观察合并/错误/上限、事务来源、失败乐观值、退役排队写入与凭据顺序回归。无 Rust 源码变更，本单元未重跑 Rust 全套；此前原生编译与既有 37 warnings 保留。两生成器 --check、7 项模型门禁、三文档对 validator 和 git diff --check 通过。库存 243 行/659 入口、30 单元/30 catalog、129 验收/32 场景；CFG10/UI04 保持部分，明确剩余来源身份完整性、旧事件、实际效果及环境验证，不因一个 observer 关闭整个能力族。

[文档/清理] 三 HTML 在 1440×1000、1024×768、390×844 截图已看，无页面横向溢出、重复 ID、坏页内锚点、无名按钮。矩阵 observe/设置 命中 12/98 行，模型命中 2/12 条；矩阵 observation 为 0（既有搜索字段未含该词），未当作通过。插件说明 observation/设置 命中 2/4 节。Escape 清空，矩阵/模型抽屉 inert 与主题刷新保持通过，观察到 CDN 200、errors 为空；没有新增图，插件说明没有主题/抽屉。文档浏览器已关闭。自有原生 PGID 99677 终态 143，复查 5184/9224 无监听，旧 PGID 89360/9223 未操作；原始设置记录已恢复，备份 marker、故障触发器、贡献归零，原有两本隔离书保留。正式数据未动。

[剩余] 全设置效果与来源身份、完整备份流程、真实网络凭据/同步、其他部分/未接能力、全量自由组合及并发/撤权/长时验收、packaged/Windows/Linux 继续。局部桌面成功不是整体完备，目标保持进行中，未推送。

## 2026-09-10：凭据漫游的本地持久边界

[进度/根因] 上一目标轮提交 31774ae9，属于实现进展。本单元继续 CFG10 已标出的凭据时序：saveAIConfig 在 secret_set 完成前直接发布 sealed preference，失败凭据可能先进入同步日志；同步覆盖也在本地加密写入尚未成功时就报告 moved。不是新增密钥读取 API，而是修复两端依赖的宿主事实边界。

[代码] 新 host-only onLocalSecretWrite 从有序队列接收精确的成功提交值，漫游策略统一订阅，AI 配置调用点不再自行发布。失败新增/替换/删除无凭据事件，remote 写入不回发；元数据观察仍不接收密钥。KVWriteQueue.readDurable 支持读取尚有新乐观写入时的持久前值，封装采用持久主密钥而非排队中的新值；连接回补等凭据写成功或回滚后采样。setSecretAsync/deleteSecretAsync 提供精确写回执，保留原 void facade 的失败日志/回滚。Relay 和 transport 连接在必要凭据成功前不执行账号接管或 profile 激活；远端 secret overlay 等保存完成才列入 changed keys，失败后可在下一 refresh 重试。普通 KV overlay 未借此声称全部完成。

[桌面] [凭据证据](./evidence/credential-roaming-2026-09-10.json)：隔离 macOS debug 5184/9224、sync disabled，测试专用 slot 和原先为空的合成主密钥。真实 SQLite BEFORE INSERT/DELETE 分别拒绝新增、替换、删除和覆盖，返回 db/error，旧值保留且无额外发布。删除故障后本地 first 写入生成一个 sealed 事件，数据库密文与事件 payload 均无合成明文；远端标签写入不回发，真实投影覆盖失败不发 moved，恢复后 changed 变为 1 而发布仍为 1。成功删除生成 null tombstone，最终发布为 first/deleted。晚些时候 body 无原始 SQL 文案；没有以此宣称已看见早先短暂 toast。没有使用正式凭据、网络 relay、自主模型或新增插件组合。

[验证] 全仓 test 23/23（web 879 项、9638 断言、151 文件）、typecheck 26/26、前端 build 通过；隔离 IPC 内含三个测试，覆盖延迟写的精确旧值发布、失败 catch-up、待提交主密钥、远端等待/不回发与连接凭据拒写后不接管账号。最终复核新增逐条远端凭据的结算屏障，防止前一行等待期间新接收的本地乐观值误判后一行已相等；回归证明本地失败回滚后仍会执行所需远端写。修改后全仓测试/类型与构建重跑，重新启动原生测试再次通过封装发布、远端覆盖故障/恢复、不回发与清理。无 Rust 源码改动，本单元未重跑 Rust 全套；既有编译 warnings、bridge 版本提示和 build warnings 保留。

[文档/扫描] CFG10 和 R10 更新实际代码及边界，仍标部分；243 行/659 入口、30 单元/30 catalog、129 验收/32 场景不变。两生成器 --check、7 项模型门禁、三文档对 validator、git diff --check 通过。三个 HTML 的 1440×1000、1024×768、390×844 截图已看，无页面横向溢出/重复 ID/坏页内锚点/无名按钮；outbox/凭据 搜索分别在矩阵命中 2/8 行、模型 1/4 条、插件说明 2/3 节。Escape、矩阵/模型抽屉 inert 和主题刷新保持通过，errors 为空、观察 CDN 200。未新增图，插件说明无主题/抽屉；浏览器关闭。

[清理/剩余] 测试 slot、合成 master、精确所属事件/投影及两个故障触发器均清除，原有两本隔离书保留；自有 PGID 4590/6515 终态均为 143，5184/9224 无监听，正式数据未动。凭据保存与日志追加仍是两个事务：日志 best-effort 不是持久 outbox，崩溃/追加失败重放、原子账号切换、旧密钥迁移、过期投影竞争、普通 KV 覆盖回执、全部草稿/效果、真实网络和 packaged/Windows/Linux 仍缺。完整双端接线与组合验收目标继续，不标记完成，未推送。

## 2026-09-10：宿主命令双端执行与 Library Desk 组合

[进度/根因] 上一轮只确认建模范围，属于无实现进展；本单元继续已有 UI03 工作区改动，完成一个可验证的双端命令子集。宿主菜单回调不是公共执行契约，插件注册自己的命令也不授予调用宿主动作的权限。新增有限语义目录，不开放任意字符串到宿主函数的反射。

[代码/双端] UI 1.4 的 commands.list/execute 与 Agent 两 scope 的 list_host_commands/execute_host_command 共用服务。16 个无参数导航/书架命令提供固定 ID、空参数 schema、授权可见的 checked、可用条件和 workspaceRevision。library:read 查询，library:write 执行；书架设置另需字段授权，离开阅读另需 reading:write。请求复制、未知 ID/多余参数拒绝、执行复核 revision；设置先真实提交，再等目标组件提交。布局/排序/分组保留当前集合和最多 1000 项选择；超限在写入前拒绝。目标存在、空库选择及异步 handoff 仍由工作区执行时验证，enabled 不是成功保证。

[完成边界] 设置和导航不构成原子事务。设置提交前失败拒绝；提交后导航失败或退休返回 partial、completed:[settings] 和稳定错误码，Agent 不用一次晚到取消覆盖这个回执。完整完成沿用既有持久与组件提交边界，不代表动画、焦点、书籍加载、同步或时长结算。旧原生命令面板仍有自己的回调；本轮只将排序/分组词表同源，不冒充原生入口都使用新 executor。

[组合/桌面] Library Desk 0.4 在 Workspace 中增加 Host commands，组合搜索、checked/不可用原因、显式刷新、revision 守卫、成功关闭和部分完成错误详情；八语言齐全，编译 dist 已更新。页面是快照，不假称 live observer。[原生证据](./evidence/host-commands-2026-09-10.json) 覆盖隔离 macOS debug 的真实无权/只读/写入/完全授权 Worker，生产 Agent 双 scope、两书选择保留、过期 revision、真实 FB2 阅读权限、设置覆盖层不关闭阅读，以及 SQL 定向拒写时不导航、恢复后完成。编译插件实际搜索并执行 list view 后关闭且列表生效；再次 SQL 拒写时视图保留，移除触发器后点击 grid 完成并关闭。没有把直接调用工具当成自主模型决策。

[验证] 全仓 test 23/23（web 887 项、9755 断言、152 文件）、typecheck 26/26、前端生产 build、Library Desk 显式 build 通过。服务测试覆盖全部 16 映射、字段权限、持久等待、设置失败无导航、导航失败 partial、请求复制、选择超限、退休及错误保持；工具表面门禁补齐新工具和成功/部分回执。无 Rust 源码变更，本单元未跑 Rust 全套。旧 native 编译、bridge 版本、Node deprecation 与 chunk/混合导入警告未宣告修复。

[扫描/文档] 243 行/665 注册入口、30 单元/30 catalog、129 验收/32 场景；两生成器、7 项模型门禁、三文档对 validator 通过。UI03 Agent 从未接改为部分，插件保留部分，动态书籍/集合、导入任务、跨插件命令、原生回调统一和完整可用性/观察继续列缺口。三 HTML 的 1440×1000、1024×768、390×844 截图已看，无页面横向溢出/重复 ID/坏页内锚点/无名按钮；commands/命令分别命中矩阵 16/46 行、模型 1/8 条、插件说明 4/8 节。Escape、矩阵/模型抽屉 inert 与主题刷新保持通过，errors 空、观察资源 200；插件说明原无主题/抽屉，没有新增图。浏览器已关闭。

[恢复/清理/剩余] 首次预览发现非内置 Library Desk 的编译文件仍是 0.3，未将它误计成新插件成功；清理自有预览后显式构建 0.4，再实际验证。最早截图早于原生重绘，仅后续可见截图被用于 UI 证据；1200×800 命令页、800×650 搜索/结果截图已看。后看的失败截图没有瞬时 toast，未宣称观察到了它。两轮自有书/集合与 Worker 贡献归零，原有两本隔离书保留，设置还原、SQL 触发器移除；PGID 10981 终态 143，5184/9224 无监听，未操作既有 PGID 89360/9223，正式数据未动。全部部分/未接、完整自由组合及并发/撤权/长时验收、packaged/Windows/Linux 仍需继续；整体目标未完成，未推送。

## 2026-09-10：类型化资源命令与原生命令面板同源执行

[进度/根因] 上一条建模确认答复没有实现进展，本轮复核并完成此前工作区中的 UI03 接线。旧原生命令面板的十种回调绕过公共执行器，动态书籍/集合显示行也没有可复用的语义参数。现改为有限类型化命令，而不是开放任意回调或显示 ID。

[代码/双端] UI 1.5 保留 16 个无参数命令，新增 open-book/bookId 与 open-collection/collectionId；精确单字段参数、非空且至多 256 UTF-16 字符，接收时复制、执行时验证权限/资源/revision。两 scope 的 Agent execute_host_command 标为 sequential，插件复用同一命令服务，开书始终需要 reading:write。开书等待实际 ready，返回 completed:[reading]，不关闭无关覆盖层；集合导航清除选择，继承工作区提交回执。原生命令面板映射这 18 类动作到 user 执行器，等待、忙碌禁重、Escape/卸载取消、帧归属阻止迟到结果关闭新面板；自己导航导致的关闭不取消目标提交。导入和插件贡献仍沿用分发，其他原生入口未宣称全迁移。

[修复] 延迟 shell 开书查询在请求取消后仍能 begin 的测试先失败，随后从 ReadingSessionController 修复：abort/deadline 作废当前 intent，关闭尚未创建 session 的 opening 也会作废；工作区跳到非覆盖层时识别 pending opening，并要求阅读控制权限。单元验证延迟 begin 被拒绝、新会话不被旧取消影响；不把它当成取消可回滚已发生的呈现/历史副作用。

[组合/桌面] Library Desk 0.5 从书库/集合查询组合可搜索资源选择器，复用发现时 revision 与 guarded execution，成功才关闭自己的视图。[桌面证据](./evidence/command-routing-2026-09-10.json) 覆盖真实无权/只读/写入/完全授权 Worker、缺书/缺集合稳定错误、生产 Agent 双 scope、真实 FB2 ready、原生命令面板动态书和集合结果，以及编译插件两个选择器。原生 list view 在定向 SQLite 拒写时保留面板、busy=false、grid 不变且无 settings.changed；恢复重试后关闭并发出一个 origin=user 事件，证明实际走共享领域。失败同时出现存储/命令两条本地化 toast，已列 UI03 待修，未以无 raw SQL 冒充呈现完全正确。

[验证/扫描] 全仓 test 23/23（web 893 项、9789 断言、153 文件）、typecheck 26/26、前端生产 build 与 Library Desk 显式 build 通过；最终测试复跑 22 个缓存任务、插件测试重新执行。新增脚本回归与模型门禁合计 9 项通过。扫描发现旧 CommandActions 从 11 降到 1，不能让回调迁移造成库存漏项；补独立 Host semantic command 库存与逐 ID 映射，新增未映射 ID 测试明确失败。现为 243 行、673 注册映射、30 单元/30 catalog、129 验收/32 场景。无 Rust 变更，本单元未跑 Rust 全套。

[文档] 三文档对更新，生成器与 pair validator 通过。三份 HTML 的 1440×1000、1024×768、390×844 截图已看，无文档横向溢出/重复 ID/坏页内锚点/无名按钮。open-book/开书搜索分别命中矩阵 1/5 行、模型 1/2 条、插件说明 2/4 节；Escape 清空，矩阵/模型抽屉 inert 和主题刷新保持通过。errors 空、观察 CDN 返回 200；无新增图，插件说明仍无主题/抽屉。文档浏览器已关闭，非产品验证。

[清理/剩余] 原生截图 1200×800 动态集合结果、800×650 插件选择器和 reader 已看；首张 reader 截图早于重绘，有旧书架残影，未用作最终证据。自有两书、集合与五 Worker 贡献清零，原有两本隔离书保留，设置还原、定向 SQL 触发器移除。自有 PGID 16412 终态 143；既有 PGID 89360/9223 未操作，正式数据未动。重复错误呈现、导入任务、跨插件调用、其余原生入口与完整 availability/观察/焦点、剩余部分/未接、全部自由组合验收及 packaged/Windows/Linux 仍需继续。整体目标未完成，未推送。

## 2026-09-10：命令状态观察与错误呈现所有权

[进度/根因] 上一条确认答复没有推进实现，本单元继续核验并完成既有工作区改动。此前 fc1db48e 将 18 个命令接到同源执行器，但插件仍只能手动刷新可用性，真实 SQLite 拒写暴露了存储与调用方同时报错。此次分别补观察契约和逐操作错误呈现归属，不用全局抑制开关隐藏失败。

[代码/双端] UI 1.6 新增 commands.observe：授权快照、订阅内 revision、稳定错误、下一次失效后恢复；工作区、已提交 shelf 设置与语言变化触发重读。64 订阅上限、串行读取/回调、失效合并、过期读取丢弃、授权投影去重、注册失败释放及退订取消均有回归。Agent 两 scope 既有 list/execute 按需读取相同服务，不增加常驻模型循环。观察 revision 不是工作区 revision、CAS 或执行预约；enabled 仍是粗粒度权限/工作区条件，而非具体书籍/集合必定成功。

[失败所有权] 设置领域 batch 标记 caller，其 Promise 拒绝、日志、回滚和失败事件仍保留，由命令界面/插件 RPC/Agent 工具反馈。旧 void localKV 写入默认 store，仍显示全局失败提示；并发排队的不同操作不会相互抑制，回滚先于失败事件。其他异步存储 facade 没有借此宣称全部迁移。

[组合/桌面] Library Desk 0.6 组合公开观察与 live view，更新 checked/可用性而保留搜索；读取失败保留旧行、内联错误并移除动作，恢复后重启交互。每个点击回调冻结该次快照的 workspaceRevision，书籍/集合选择器仍是查询快照。[桌面证据](./evidence/command-observation-2026-09-10.json) 覆盖真实 Worker 的授权过滤、设置提交、隐藏字段不推送、退订、真实 FB2 阅读权限变化与语言变化；编译插件的 Selected 随实际提交及 remote-tagged 本地写变化，搜索不清空。原生命令与编译插件各在定向 SQLite 拒写下只显示一条本地化提示、保留界面，恢复重试成功；独立旧 void 写入仍显示一条全局提示。没有将远端标签当成联网跨设备同步，也没有把直接 Agent 工具执行当自主推理。

[验证/扫描] 全仓 test 23/23（web 896 项、9880 断言、154 文件）、typecheck 26/26、前端生产 build 与 Library Desk 显式 build 通过；9 项库存/模型脚本测试通过。矩阵新增观察入口后为 243 行/674 注册映射，30 单元/30 catalog、129 验收/32 场景。两生成器 --check、三文档对 validator 与 git diff --check 通过。读取错误/恢复、慢回调、64 上限、注册失败与并发所有权主要是单元证据，没有虚称全部注入 Tauri；无 Rust 源码变化，本单元未跑 Rust 全套。

[文档/清理] 三 HTML 的 1440×1000、1024×768、390×844 截图均查看；页面无横向溢出、重复 ID、坏页内锚点、无名按钮。observe/观察搜索分别命中矩阵 13/16 行（含 UI03）、模型 2/7 条（含 C1）、插件说明 4/7 节；Escape、矩阵/模型抽屉 inert 与主题刷新保持通过，errors 为空、观察资源 200。插件说明原无主题/抽屉，没有新增图；自有文档浏览器已关闭。原生两张截图已查看，晚拍的失败图只证明面板保留，提示计数以当时 DOM 为证。两本自有书、集合及贡献清零，设置与语言还原、SQL trigger 移除，原有两本隔离书保留；PGID 21768 终态 143，复查 5184/9224 无监听，既有 PGID 89360/9223 未操作，正式数据未动。

[剩余] UI03 保持双端部分：目标级 availability、导入任务、跨插件调用、其余原生入口和完整焦点仍缺。其余能力族、完整自由组合/并发撤权/长时验证、packaged 与 Windows/Linux 继续；原生/bridge/build 既有警告未宣称修复。整体目标未完成，未推送。
