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
