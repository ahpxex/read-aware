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
