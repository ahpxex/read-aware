# ReadAware 宿主能力统一模型

人读版：[统一模型与裁决](./host-capability-model.html)。现状：[宿主 × Agent × 插件能力矩阵](./host-capability-matrix.md)。验收证据：[旧基线与 GAP](./plugin-capability-baseline.md)。

- 状态：**目标模型与现状映射；不是 API 已实现声明**。
- 最后核验日期：2026-09-09。
- 范围：当前 ReadAware Tauri 桌面宿主、已有第一方插件、产品内 Agent 工具与自动管线。排除外部 Coding Agent 的电脑权限、移动端遗留桥和未决定的新产品。
- 事实源：本轮审计以 1d97e2e4 后工作区源码为准；目标源是 [host-capability-model.data.ts](./host-capability-model.data.ts)，接线源是 [host-capability-matrix.data.ts](./host-capability-matrix.data.ts)。
- [代码] 243 条现状证据映射到 30 个责任单元；30 个当前 catalog 成员、129 个旧验收项、32 个旧场景全部反查。单元不是新 API 数，字段行不是独立产品功能。
- [设计] 本文所有目标操作与分组迁移均未冒充现有 SDK；新 namespace 需在实现时经 catalog/permission/version/schema 统一落地。

## 结论

1. 沿用三类能力：Domain 是宿主拥有的业务状态与行为，Contribution 是插件向宿主提供实现，Service 是有边界的平台操作。Schema 只约束声明，不是第四类权力。Agent 与插件是这套模型的两个消费维度，不是两套宿主模型。
2. 每项已盘点能力都已映射，但不宣称未知行为零遗漏或 API 全部可用。根因不是缺少一个万能 API，而是业务运行态未进域、生产/消费引用不闭合、接线与消费者分散、缺少行为级回归。
3. 本轮补出三组有真实消费者的设置遗漏：内容字体四字段、默认标注色、更新通道；细化模式位置恢复、聊天回合副作用与设备本地偏好；校正源码插件与编译内置插件的区别。
4. 不把每个 UI 按钮、临时计时器或内部 KV 都变成 API。先组合已有原语；仅补业务引用、状态/控制、授权、真实完成和生命周期等无法在插件可靠重建的部分。
5. 本文件是统一目标与取舍的入口；能力矩阵是当前接线事实，旧基线是验收条目与 GAP 证据。目标描述不能覆盖源码现状，原 GAP01–GAP18 没有因本轮文档关闭。

## 第一性原理

插件能重建算法，不能重建宿主的事实与权力。书籍当前落点、真实持久成功、用户授权、焦点/播放所有权与跨设备合并是宿主事实。插件私自监听 DOM、复制数据库或猜一次 setTimeout 已完成，都会制造第二套真相。API 完备的目标是让这些事实有可组合契约，不是让沙箱拥有所有内部函数。

[设计] 宿主行为集合 H 中，每个行为必须给出两端 disposition：直接操作、组合得到、自动消费、仅内部、明确拒绝、宿主未建。Agent 不必拥有每个方法的工具；插件不必拥有每个内部权限。两端共享 owner 和业务不变量，表达方式与审批策略可以不同。

[代码] 旧架构的三类划分足以容纳当前行为；不足的是落实。reading 已在架构上拥有活跃阅读，却把实现留在 React/引擎闭包；services.session 只桥接未来事件，不能替代快照；Agent ports 和 plugin context 又各自选择性接线。文件中有类型/字段、Worker 可调用、host 消费和用户效果从未是同一证据。

### 分类裁决

| 问题 | 唯一语义所有权 | 例子 |
| --- | --- | --- |
| 产品已有的业务对象/状态/动作？ | Domain | reading 当前位置与播放，不因未持久化而改归 Service |
| 插件提供新的实现/选择/内容？ | Contribution | TTS 合成、句段分段、RSS 内容、header action |
| 请求宿主完成有边界的外部操作？ | Service | 文件选择、HTTP、密钥、宿主 UI 流程 |
| 如何声明宿主呈现或配置？ | Schema，无新增权力 | 表单 onSubmit 仍经已授权 Domain/Service |
| 各边界共同需要的执行规则？ | 跨切 Contract，不是新业务 namespace | revision、取消、lease、stable errors |
| 是否应当完全开放？ | 明确 Boundary | 原始 SQL/密钥/事件写永不因“完备”而开放 |

同一证据行可以含多个责任，例如书架布局偏好归 settings，当前选择集归 ui，书籍查询归 library；不能为追求一行一个分类把三者强行塞进 shelf 域。每个最终操作却只能有一个 owner。下面的单元只做责任分段，不新增平行 registry。

## 共用契约

[设计] 以下是实现验收要求，类型名是语义角色，不是本轮已经导出的 TypeScript 类型。

| 契约 | 必须表达什么 | 不要求什么 |
| --- | --- | --- |
| 操作描述 | owner、稳定 ID/version、输入/输出 schema、actor scope/grant、风险、availability、消费者 | 每个 UI 按钮一个工具、每种算法一个宿主方法 |
| Location/Range | bookId、内容版本、可由宿主验证的引擎定位载荷；Range 可无可渲染位置，但必须说明 | 替换 Foliate CFI 标准、插件自行编译定位器 |
| 引用失效 | 不存在、无文本、不支持、stale、无权限区分；删书/重导向/换版本验证 | 旧 ordinal 在任意修订上永久有效 |
| Session/资源 | sessionId/generation、owner、scope、availability；资源有 type/size 和有效性 | 可伪造的任意文件路径、DOM 引用、无限设备信息 |
| 完成回执 | completed/result；cancelled；failed/AppError；受理与完成分开；业务空结果不是失败 | 导航派发就 opened:true；cancel 就全局回滚 |
| 进度与取消 | 长任务进度可 unknown；abort/deadline/终态；跨 Worker 失联终结 pending | 所有短操作 TaskRef、全部任务耐久恢复 |
| 观察 | snapshot + revision；本地/远端/外部变化失效；subscribe 竞态可重读收敛 | 通用事件日志重放、exactly-once 交付 |
| 写入一致性 | commit 完成才确认；会丢修改的操作有版本条件；批次明确原子或逐项 | 暴露 SQLite transaction、任意跨插件分布式事务 |
| 授权 | manifest 能力、对象/字段/资源范围、一次性用户批准分别建模；执行时复核 | UI 的 Yes 按钮等于权限票据、菜单可见就可调用 |
| 生命周期 | plugin generation / view / task / provider session 有 owner；dispose 幂等 | 仅在整个插件 deactivate 时才清局部回调 |
| 敏感信息 | 稳定错误 code；raw message 仅脱敏日志；未知费用/状态明确 unknown | 向模型或普通插件泄露 host key、log、token |

## 统一责任模型

每个单元的“目标操作、双端接入、限制、验收”均为 [设计]；对应 [代码] 现状在文末逐行反查。现有 catalog 的名称/版本仍以 packages/core 为准。

### <a id="D1"></a>D1 · Domain · library

**书库、集合与可寻址内容**

- 当前 catalog 身份：`domains.library`。
- [设计] 操作：书籍/集合 list、get、查询、元数据修改、收藏、导入、删除、合并预览/提交、成员调整；TOC 树、章节正文、文本可用性、准备/重试、带位置的精确搜索、链接目标/图片资源解析。查询返回稳定对象引用与内容版本，搜索返回 snippet + Range，目录条目返回标题、层级、目标及可用编号元数据。
- [设计] Agent：沿用书库/正文工具，补失真的参数和可定位结果；意图级工具可组合多个读取，不能绕过书籍 scope、剧透批准和删除批准。
- [设计] 插件：使用相同领域定义，经 manifest 授权取得读/写视图；提供受控原文件/封面引用，不暴露磁盘路径。虚拟书的创建与内容读取仍受 provider 所有权约束。
- [设计] 限制/不建设：章节编号解析、匹配排序、导出格式、RSS 订阅属于插件算法。章节 ordinal、书上印刷编号和 sectionIndex 不能混用。缺文件重导入目前只是普通导入流程，不承诺原 ID 原子替换。
- [设计] 通过条件：不存在章节、无文本、内容版本变化、重复导入/ID 重定向、分页耗尽分别可判定；搜索命中可交给 D2 导航，不要求插件造 CFI。
- [代码] 现状证据：[LIB01](./host-capability-matrix.md#LIB01) · [LIB02](./host-capability-matrix.md#LIB02) · [LIB03](./host-capability-matrix.md#LIB03) · [LIB04](./host-capability-matrix.md#LIB04) · [LIB05](./host-capability-matrix.md#LIB05) · [LIB06](./host-capability-matrix.md#LIB06) · [LIB07](./host-capability-matrix.md#LIB07) · [LIB08](./host-capability-matrix.md#LIB08) · [LIB09](./host-capability-matrix.md#LIB09) · [LIB10](./host-capability-matrix.md#LIB10) · [LIB11](./host-capability-matrix.md#LIB11) · [LIB12](./host-capability-matrix.md#LIB12) · [LIB13](./host-capability-matrix.md#LIB13) · [LIB14](./host-capability-matrix.md#LIB14) · [LIB15](./host-capability-matrix.md#LIB15) · [LIB16](./host-capability-matrix.md#LIB16) · [LIB17](./host-capability-matrix.md#LIB17) · [LIB18](./host-capability-matrix.md#LIB18) · [TXT01](./host-capability-matrix.md#TXT01) · [TXT02](./host-capability-matrix.md#TXT02) · [TXT03](./host-capability-matrix.md#TXT03) · [TXT04](./host-capability-matrix.md#TXT04) · [TXT05](./host-capability-matrix.md#TXT05) · [TXT06](./host-capability-matrix.md#TXT06) · [TXT07](./host-capability-matrix.md#TXT07) · [TXT08](./host-capability-matrix.md#TXT08) · [TXT11](./host-capability-matrix.md#TXT11) · [TXT12](./host-capability-matrix.md#TXT12) · [TXT13](./host-capability-matrix.md#TXT13)。

### <a id="D2"></a>D2 · Domain · reading

**阅读会话、导航、模式、播放与统计**

- 当前 catalog 身份：`domains.reading`。
- [设计] 操作：读取 session/loading/book/location/selection/history/mode/playback 快照并观察；open、close、goTo、step、seek、back/forward；Range 选择/清除、临时强调/释放、受支持版式操作；模式启停/步进/恢复、朗读启停与状态；读完标记、已结算及 provisional 统计。业务运行态不因未持久化而变成 Service。
- [设计] Agent：当前 grounding 和自动计时保留；按需查询/导航/模式/朗读使用工具，经同一 reading 控制器。模型不合成阅读时长，不将 opened:true 派发回执当 ready。
- [设计] 插件：读、导航/呈现、持久写分清授权风险；中途启用先读快照再观察；贡献模式/声音并不授权控制用户播放。临时强调带 owner，卸载即清理。
- [设计] 限制/不建设：位置恢复验证 book/contentVersion/modeKey/unitId；不把旧 ordinal 强套新分段。会话 timer 是可重置的短时 UI 状态，不是 reading_sessions_pending；不为它建立耐久调度系统。面板开关归 S3。
- [设计] 通过条件：跨书并发导航由宿主统一裁决，迟到完成不移动新会话；失败不推进历史，back/forward 不产生新分支，用户新跳转截断 forward；实际落点才算完成。模式卸载与音频 fallback 可观察。
- [代码] 现状证据：[TXT09](./host-capability-matrix.md#TXT09) · [TXT10](./host-capability-matrix.md#TXT10) · [READ01](./host-capability-matrix.md#READ01) · [READ02](./host-capability-matrix.md#READ02) · [READ03](./host-capability-matrix.md#READ03) · [READ04](./host-capability-matrix.md#READ04) · [READ05](./host-capability-matrix.md#READ05) · [READ06](./host-capability-matrix.md#READ06) · [READ07](./host-capability-matrix.md#READ07) · [READ08](./host-capability-matrix.md#READ08) · [READ09](./host-capability-matrix.md#READ09) · [READ12](./host-capability-matrix.md#READ12) · [READ13](./host-capability-matrix.md#READ13) · [READ14](./host-capability-matrix.md#READ14) · [READ15](./host-capability-matrix.md#READ15) · [READ16](./host-capability-matrix.md#READ16) · [READ17](./host-capability-matrix.md#READ17) · [READ18](./host-capability-matrix.md#READ18) · [READ19](./host-capability-matrix.md#READ19) · [READ20](./host-capability-matrix.md#READ20) · [STAT01](./host-capability-matrix.md#STAT01) · [STAT02](./host-capability-matrix.md#STAT02) · [STAT03](./host-capability-matrix.md#STAT03) · [STAT04](./host-capability-matrix.md#STAT04) · [STAT05](./host-capability-matrix.md#STAT05)。

### <a id="D3"></a>D3 · Domain · annotations

**标注、笔记和问题轨迹**

- 当前 catalog 身份：`domains.annotations`。
- [设计] 操作：list/get/filter/page；创建 highlight/underline、改色、笔记 CRUD、受控删除 ask；有业务需求的批次返回原子结果或逐项结果，明确版本冲突；本地/同步写入触发一致失效。
- [设计] Agent：保留 create/edit/delete_annotation，补 style 与精确 ID 查询；自动 recordAsk 是运行时内部能力，不是供模型伪造的问题写工具。
- [设计] 插件：使用同一命令与 Range 校验；补宿主已有 removeAsk；不能直接 append 问题轨迹、事件日志或投影。
- [设计] 限制/不建设：新标注默认色归 D5，不与当前对象 recolor 混合。格式化导出由查询 + 插件序列化 + S4 保存组成；不是新的 annotations.exportCSV API。
- [设计] 通过条件：无位置笔记可以保存；失效 Range 不落错误高亮；并发编辑不静默覆盖，删书后引用返回失效而非误指其他书；失败加载不是空列表。
- [代码] 现状证据：[ANN01](./host-capability-matrix.md#ANN01) · [ANN02](./host-capability-matrix.md#ANN02) · [ANN03](./host-capability-matrix.md#ANN03) · [ANN04](./host-capability-matrix.md#ANN04) · [ANN05](./host-capability-matrix.md#ANN05) · [ANN06](./host-capability-matrix.md#ANN06) · [ANN07](./host-capability-matrix.md#ANN07) · [ANN08](./host-capability-matrix.md#ANN08) · [ANN09](./host-capability-matrix.md#ANN09)。

### <a id="D4"></a>D4 · Domain · conversations

**对话内容、线程及回合意图**

- 当前 catalog 身份：`domains.conversations`。
- [设计] 操作：受权读取/搜索线程、消息、摘要/insights；创建、选择、清空线程；用户触发的 draft/发送/停止/重试意图由宿主控制器执行，呈现焦点由 S3 负责。
- [设计] Agent：工具查询与宿主 thread.run 分离；同一核心 Agent 不通过工具递归启动自身无限对话。重试最后用户回合沿用原附件/来源，不伪造用户新输入。
- [设计] 插件：可填入待用户确认的草稿、请求停止指定回合；不能任意指定 role 写 system/assistant/user 历史。llm.ask 不是向产品聊天发送消息。
- [设计] 限制/不建设：重试/清空聊天不撤销已完成的标注、记忆或远端 HTTP 副作用；复制聊天是查询 + 剪贴板，不需要专门 Agent 工具。书内单线程与全局多线程仍保持。
- [设计] 通过条件：停止保存已产生的部分答复；清空/切线程时旧 generation 不得回写新线程；模型回合、存储提交、展示清除的完成状态分别可验证。
- [代码] 现状证据：[AI01](./host-capability-matrix.md#AI01) · [AI02](./host-capability-matrix.md#AI02) · [AI03](./host-capability-matrix.md#AI03) · [MEM12](./host-capability-matrix.md#MEM12)。

### <a id="D5"></a>D5 · Domain · settings

**全部真实偏好及生效语义**

- 当前 catalog 身份：`domains.settings`。
- [设计] 操作：discover/read/update/reset；返回类型、可选值、可写性、scope、effective 值、值来源、持久/漫游策略；包含 reader、general、AI、menus、shortcuts、shelf、插件非敏感字段及本次新增遗漏。修改必须映射实际消费者，或明确 unavailable。
- [设计] Agent：沿用 get_settings/update_settings，不为主题/字体/每个布尔字段创建模型工具。敏感配置由 S3 打开宿主设置流程，不把 key 放进提示词。
- [设计] 插件：自有字段与跨插件路径授权分开；动态 option 来自 C1；设置选项变化不能自动执行播放、安装、连接、付款。
- [设计] 限制/不建设：明确 null 是值还是 inherit；reset override 不是写默认值；all-books 不等于清覆盖。更新通道 device-local，不被漫游；面板位置/拖动坐标/最后关闭提示不是必须向 Agent 暴露的偏好。
- [设计] 通过条件：所有可写路径有生产效果消费者；六个现有无效果设置先接线或禁用。两个文本发送设置已控制 Agent 自动附件/viewport/grounding、历史附件检索及收紧时取消；LLM 1.1 结构化 readingContext 与 Dictionary 1.3 已接同一策略和本地缓存边界；任意插件 prompt/HTTP/TTS 与独立检索/旧衍生内容边界仍未闭合。buildMemory 已约束宿主记忆构建，关闭取消在途/排队任务，保留聊天与旧记忆读取；Reading Goals 实际贡献上下文和候选。localOnly 已约束宿主模型调用并取消在途请求，但不约束任意插件 HTTP/TTS/同步，仍需完整隐私边界。切字体、reset、本书覆盖、跨设备更新与失败回滚均验证实际 UI/行为。
- [代码] 现状证据：[UI02](./host-capability-matrix.md#UI02) · [UI04](./host-capability-matrix.md#UI04) · [UI05](./host-capability-matrix.md#UI05) · [CFG01](./host-capability-matrix.md#CFG01) · [CFG02](./host-capability-matrix.md#CFG02) · [CFG03](./host-capability-matrix.md#CFG03) · [CFG04](./host-capability-matrix.md#CFG04) · [CFG05](./host-capability-matrix.md#CFG05) · [CFG06](./host-capability-matrix.md#CFG06) · [CFG07](./host-capability-matrix.md#CFG07) · [CFG08](./host-capability-matrix.md#CFG08) · [CFG09](./host-capability-matrix.md#CFG09) · [CFG10](./host-capability-matrix.md#CFG10) · [CFG11](./host-capability-matrix.md#CFG11) · [CFG12](./host-capability-matrix.md#CFG12) · [CFG13](./host-capability-matrix.md#CFG13) · [SET01](./host-capability-matrix.md#SET01) · [SET02](./host-capability-matrix.md#SET02) · [SET03](./host-capability-matrix.md#SET03) · [SET04](./host-capability-matrix.md#SET04) · [SET05](./host-capability-matrix.md#SET05) · [SET06](./host-capability-matrix.md#SET06) · [SET07](./host-capability-matrix.md#SET07) · [SET08](./host-capability-matrix.md#SET08) · [SET09](./host-capability-matrix.md#SET09) · [SET10](./host-capability-matrix.md#SET10) · [SET11](./host-capability-matrix.md#SET11) · [SET12](./host-capability-matrix.md#SET12) · [SET13](./host-capability-matrix.md#SET13) · [SET14](./host-capability-matrix.md#SET14) · [SET15](./host-capability-matrix.md#SET15) · [SET16](./host-capability-matrix.md#SET16) · [SET17](./host-capability-matrix.md#SET17) · [SET18](./host-capability-matrix.md#SET18) · [SET19](./host-capability-matrix.md#SET19) · [SET20](./host-capability-matrix.md#SET20) · [SET21](./host-capability-matrix.md#SET21) · [SET22](./host-capability-matrix.md#SET22) · [SET23](./host-capability-matrix.md#SET23) · [SET24](./host-capability-matrix.md#SET24) · [SET25](./host-capability-matrix.md#SET25) · [SET26](./host-capability-matrix.md#SET26) · [SET27](./host-capability-matrix.md#SET27) · [SET28](./host-capability-matrix.md#SET28) · [SET29](./host-capability-matrix.md#SET29) · [SET30](./host-capability-matrix.md#SET30) · [SET31](./host-capability-matrix.md#SET31) · [SET32](./host-capability-matrix.md#SET32) · [SET33](./host-capability-matrix.md#SET33) · [SET34](./host-capability-matrix.md#SET34) · [SET35](./host-capability-matrix.md#SET35) · [SET36](./host-capability-matrix.md#SET36) · [SET37](./host-capability-matrix.md#SET37) · [SET38](./host-capability-matrix.md#SET38) · [SET39](./host-capability-matrix.md#SET39) · [SET40](./host-capability-matrix.md#SET40) · [SET41](./host-capability-matrix.md#SET41) · [SET42](./host-capability-matrix.md#SET42) · [SET43](./host-capability-matrix.md#SET43) · [SET44](./host-capability-matrix.md#SET44) · [SET45](./host-capability-matrix.md#SET45) · [SET46](./host-capability-matrix.md#SET46) · [SET47](./host-capability-matrix.md#SET47) · [SET48](./host-capability-matrix.md#SET48) · [SET49](./host-capability-matrix.md#SET49) · [SET50](./host-capability-matrix.md#SET50) · [SET51](./host-capability-matrix.md#SET51) · [SET52](./host-capability-matrix.md#SET52) · [SET53](./host-capability-matrix.md#SET53) · [SET54](./host-capability-matrix.md#SET54) · [SET55](./host-capability-matrix.md#SET55) · [SET56](./host-capability-matrix.md#SET56) · [SET57](./host-capability-matrix.md#SET57) · [SET58](./host-capability-matrix.md#SET58) · [SET59](./host-capability-matrix.md#SET59) · [SET60](./host-capability-matrix.md#SET60) · [SET61](./host-capability-matrix.md#SET61) · [SET62](./host-capability-matrix.md#SET62) · [SET63](./host-capability-matrix.md#SET63) · [SET64](./host-capability-matrix.md#SET64) · [SET65](./host-capability-matrix.md#SET65) · [SET66](./host-capability-matrix.md#SET66) · [SET67](./host-capability-matrix.md#SET67) · [SET68](./host-capability-matrix.md#SET68) · [SET69](./host-capability-matrix.md#SET69) · [SET70](./host-capability-matrix.md#SET70) · [SET71](./host-capability-matrix.md#SET71) · [SET72](./host-capability-matrix.md#SET72) · [SET73](./host-capability-matrix.md#SET73) · [SET74](./host-capability-matrix.md#SET74)。

### <a id="D6"></a>D6 · Domain · memory（目标新增）

**记忆、画像与书内知识的受限读模型**

- 当前 catalog 身份：无对应现有 catalog 身份；目标责任或跨切边界，不是当前 API。
- [设计] 操作：统一 memory/profile/book-memory 现有端口的授权读模型：检索、字段来源、章节摘要/人物概念图、任务状态；记住用户确认的事实、纠错/遗忘反馈、分类纠正和重建请求交给宿主业务命令。当前公共 domain catalog 没有 memory。
- [设计] Agent：保留 search_memory/remember/query_book_graph 与自动抽取、巩固、digest；不把内部端口函数存在计作模型工具或成熟产品入口。
- [设计] 插件：新增受 scope/字段授权的只读领域；提议写由 C4 memoryCandidateProviders 或受控反馈处理，不能写权重、强化次数或画像投影。
- [设计] 限制/不建设：不拆 profile/entities/digests 成三套新域。profile/entity 事件投影仍是宿主待建；正式 context bundle 仍待建，插件现在可以组合授权读模型输出自己的格式，但不得声称宿主 bundle 产品已实现。
- [设计] 通过条件：叙事图遵守阅读边界，说明性图按 flavor；重分类后旧图版本可辨；候选被接受/拒绝有来源。当前未实现的画像与 bundle 单列，不成为 Jumper 的前置条件。
- [代码] 现状证据：[MEM01](./host-capability-matrix.md#MEM01) · [MEM02](./host-capability-matrix.md#MEM02) · [MEM03](./host-capability-matrix.md#MEM03) · [MEM04](./host-capability-matrix.md#MEM04) · [MEM05](./host-capability-matrix.md#MEM05) · [MEM06](./host-capability-matrix.md#MEM06) · [MEM07](./host-capability-matrix.md#MEM07) · [MEM08](./host-capability-matrix.md#MEM08) · [MEM09](./host-capability-matrix.md#MEM09) · [MEM10](./host-capability-matrix.md#MEM10) · [MEM11](./host-capability-matrix.md#MEM11) · [MEM13](./host-capability-matrix.md#MEM13)。

### <a id="C1"></a>C1 · Contribution · actions/options

**动作、命令与动态选项**

- 当前 catalog 身份：`contributions.selectionActions`、`contributions.headerActions`、`contributions.commands`、`contributions.settingsOptions`。
- [设计] 操作：插件声明 action/command ID、位置、参数、标题、可见/可用/checked 条件与默认键位；宿主组合菜单/快捷键/命令面板；动态设置选项提供候选而非替用户修改值。现有 header shelf/reader 保留，确有宿主插槽的上下文菜单按位置参数扩展。
- [设计] Agent：模型调用的是受 schema/权限约束的语义命令，不是点击菜单或执行 label；插件命令要模型可用需 C4 显式贡献工具或宿主明确适配。
- [设计] 插件：Jumper 用现有 reader headerActions；新增插件自己的命令不需要新增宿主分支。声明无额外 permission 不代表动作能绕过它调用的领域权限。
- [设计] 限制/不建设：不为每个菜单再建 contribution family；命令 broker 仅解析已注册类型化描述，禁止任意字符串反射到 host 函数。静态注册与实时 enablement 分开。
- [设计] 通过条件：禁用/撤权后命令不可执行；菜单状态随 session 刷新；键位冲突可诊断；插件卸载不留下快捷键或悬挂 UI 回调。
- [代码] 现状证据：[UI03](./host-capability-matrix.md#UI03) · [UI04](./host-capability-matrix.md#UI04) · [UI05](./host-capability-matrix.md#UI05) · [EXT01](./host-capability-matrix.md#EXT01) · [EXT02](./host-capability-matrix.md#EXT02) · [MORE04](./host-capability-matrix.md#MORE04) · [MORE05](./host-capability-matrix.md#MORE05) · [CFG09](./host-capability-matrix.md#CFG09)。

### <a id="C2"></a>C2 · Contribution · contentProviders/readerModes

**内容与阅读算法提供者**

- 当前 catalog 身份：`contributions.contentProviders`、`contributions.readerModes`。
- [设计] 操作：content provider 提供插件拥有的虚拟书内容/版本；reader mode 提供已支持 text-unit-navigator 分段策略。宿主负责阅读、版本切换、模式状态和资源引用。
- [设计] Agent：经 library/reading 工具消费结果，不要求模型注册算法或直接读 provider 内部数据。
- [设计] 插件：RSS 和 sentence-reader 保持插件业务；刷新当前内容应有版本失效和落点处理。跨插件消费有真实需要时通过受权类型化 provider broker，不直接访问其他插件 storage。
- [设计] 限制/不建设：不是任意格式解码器、HTML/DOM 注入或全新阅读器渲染器；OCR、新格式、新阅读交互原语属于宿主能力更新。
- [设计] 通过条件：provider 失效、disable、内容变更返回明确 unavailable/stale；旧回调不覆盖新版本；模式恢复必须验证引用仍适用。
- [代码] 现状证据：[LIB12](./host-capability-matrix.md#LIB12) · [LIB13](./host-capability-matrix.md#LIB13) · [LIB14](./host-capability-matrix.md#LIB14) · [READ15](./host-capability-matrix.md#READ15) · [READ16](./host-capability-matrix.md#READ16) · [EXT10](./host-capability-matrix.md#EXT10)。

### <a id="C3"></a>C3 · Contribution · voiceProviders

**声音与合成提供者**

- 当前 catalog 身份：`contributions.voiceProviders`。
- [设计] 操作：列出 provider/voice、能力与可用性；接受有界文本并产出可消费音频及格式元数据；宿主 reading 控制播放/预取/系统回退和取消。
- [设计] Agent：选择声音可用 settings，开始/停止必须 reading 命令；不能把设置成功当作已经出声。
- [设计] 插件：实现 vendor HTTP、voice 映射与合成；凭据通过隔离 secrets；音频资源归任务/会话所有，不泄露跨插件资产。
- [设计] 限制/不建设：不新增独立播放服务与 reading.playback 争夺同一会话；不要求音频编辑器、任意设备控制或后台常驻播放器。
- [设计] 通过条件：取消/换书/停用 provider 后不再播放迟到音频；回退状态与当前声音可读，费用/请求取消边界明确。
- [代码] 现状证据：[READ17](./host-capability-matrix.md#READ17) · [READ18](./host-capability-matrix.md#READ18)。

### <a id="C4"></a>C4 · Contribution · agent extensions

**工具、上下文、检索与记忆候选**

- 当前 catalog 身份：`contributions.agentTools`、`contributions.agentContextProviders`、`contributions.agentRetrievalProviders`、`contributions.memoryCandidateProviders`。
- [设计] 操作：工具显式声明 scope/schema/风险；上下文每轮有界注入；检索按需返回有来源片段；记忆候选由宿主去重/政策裁决。四个通道保留不同语义和生命周期，不合并成万能 agent.invoke。
- [设计] Agent：只有插件 installed + enabled + scope/grant/availability 满足时才消费。上下文与候选没有插件实例不等于宿主 API 未实现。
- [设计] 插件：Dictionary 已有 3 工具 + 1 检索；RSS 有 3 global 工具；其他源插件没有直接操作工具。删除词/CSV/退订/OPML 可以在插件补工具，不要求宿主新增词汇/RSS 领域。
- [设计] 限制/不建设：输出不成为高优先级指令；不得通过 plugin tool 规避 host 批准/剧透规则；不能把自有私有数据自动变成所有插件可见。
- [设计] 通过条件：跨 scope 不暴露工具；输入/输出有界，失败不悬挂整轮；撤权和停用失效；检索引用可追踪，候选无条件入记忆视为失败。
- [代码] 现状证据：[AI04](./host-capability-matrix.md#AI04) · [AI05](./host-capability-matrix.md#AI05) · [AI08](./host-capability-matrix.md#AI08) · [AI09](./host-capability-matrix.md#AI09) · [AI10](./host-capability-matrix.md#AI10) · [AI11](./host-capability-matrix.md#AI11) · [AI12](./host-capability-matrix.md#AI12) · [MEM02](./host-capability-matrix.md#MEM02) · [MEM03](./host-capability-matrix.md#MEM03) · [EXT09](./host-capability-matrix.md#EXT09) · [EXT10](./host-capability-matrix.md#EXT10) · [MORE06](./host-capability-matrix.md#MORE06)。

### <a id="C5"></a>C5 · Contribution · themes/fonts/syncTransports

**静态资产与密文传输扩展**

- 当前 catalog 身份：`contributions.themes`、`contributions.fonts`、`contributions.syncTransports`。
- [设计] 操作：themes/fonts 由 manifest 声明、宿主加载验证并供 settings 选择；syncTransports 提供密文连接/session 操作，宿主掌管加解密、ACK、游标、重试与同步调度。三者共用贡献生命周期，不共用业务控制器。
- [设计] Agent：主题/字体用 settings；同步用 S9 控制面或用户流程，不把 transport 当控制整套同步的工具。
- [设计] 插件：不要求给静态 manifest 贡献补 ctx.register；transport 必须有 session.close/dispose，持有连接随 owner 释放。
- [设计] 限制/不建设：不开放解密 key/事件 ACK 写/字体目录。WebDAV 在源码中但不在 Rust BUNDLED；源仓、编译内置、市场分发、安装、启用、工具可用是六种不同状态。
- [设计] 通过条件：主题/字体失效可降级；transport 重连/换配置/卸载关闭旧 session；只传密文，不绕过宿主数据合并。
- [代码] 现状证据：[EXT08](./host-capability-matrix.md#EXT08) · [SYS14](./host-capability-matrix.md#SYS14) · [OPS02](./host-capability-matrix.md#OPS02) · [OPS04](./host-capability-matrix.md#OPS04)。

### <a id="S1"></a>S1 · Service · storage

**插件私有数据与持久边界**

- 当前 catalog 身份：`services.storage`。
- [设计] 操作：隔离 KV 镜像 + durable ack/flush；文档 collection CRUD、有界查询、所需索引/分页；按业务需要提供版本条件写或批次。迁移 storage-only，quiesce→drain→snapshot→migrate→activate，失败恢复不能覆盖此前已确认的合法写。
- [设计] Agent：无通用私有 KV/文档工具；通过相应插件工具消费，权限不会因调用方是模型而扩大。
- [设计] 插件：按 plugin ID 隔离；KV、docs、secrets、blob 各自标注本地/漫游/备份/卸载保留政策；书籍索引并不自动意味着随书删除。
- [设计] 限制/不建设：不是插件业务 schema 搬到宿主，也不是开放 SQL/transaction handle；取消不回滚已持久写。自有二进制数据引用由 S4，密钥由 S2。
- [设计] 通过条件：GAP01–03 的更新时序、持久确认、镜像失败回滚通过故障注入；保存失败不能成功 toast；大数据导出不要求一次把全部内容装进 Worker。
- [代码] 现状证据：[SYS01](./host-capability-matrix.md#SYS01) · [SYS02](./host-capability-matrix.md#SYS02) · [SYS03](./host-capability-matrix.md#SYS03) · [SYS05](./host-capability-matrix.md#SYS05) · [MORE07](./host-capability-matrix.md#MORE07)。

### <a id="S2"></a>S2 · Service · secrets

**隔离凭据**

- 当前 catalog 身份：`services.secrets`。
- [设计] 操作：plugin-owned secret get/set/remove；敏感设置 UI 由宿主管理；提供 configured 状态而非向普通 settings/catalog 返回明文。
- [设计] Agent：不读密钥，不把 key 交给模型；配置意图打开用户流程。
- [设计] 插件：仅本插件 namespace，凭据值不得经日志/工具输出/诊断泄露；撤权后失去访问。
- [设计] 限制/不建设：现有插件为了自有 HTTP 可读其 secret；目标不强制新增通用凭据代理/OAuth SDK。宿主 AI key、同步解密 key、其他插件 key 永不因服务授权泄露。
- [设计] 通过条件：跨 namespace/日志脱敏/移除后缓存处理验证；密钥保存与插件非敏感偏好分开报告持久结果。
- [代码] 现状证据：[SYS04](./host-capability-matrix.md#SYS04) · [CFG07](./host-capability-matrix.md#CFG07)。

### <a id="S3"></a>S3 · Service · ui

**语义导航、视图与宿主管理流程**

- 当前 catalog 身份：`services.ui`。
- [设计] 操作：语义页面/集合/面板导航、焦点恢复、用户选择集快照；插件自有视图 push/pop/replace/close/refresh、错误/进度呈现；打开指定宿主流程（AI 配置/账号/账单/备份/诊断/更新/数据清除）并返回取消/完成或受限状态。外部 URL 有 scheme/目的约束。
- [设计] Agent：意图工具可请求宿主流程，用户完成批准；查询数据、改变屏幕、确认破坏性行为是三个不同步骤。
- [设计] 插件：不拿 DOM/Router/Jotai/原生窗口句柄；自画确认按钮不能铸造 host approval。可请求安全窗口意图，关闭前等待宿主持久屏障。
- [设计] 限制/不建设：不为每个设置页新增域；不公开拖动坐标/任意窗口/静默重启/付款。管理流程是有类型的有限集合，不是绕过领域命令的万能 dispatch。当前禁用 Reveal 不计已实现。
- [设计] 通过条件：关闭视图释放 callback/任务并恢复焦点；过期结果不打开旧弹窗；失败用 InlineError/安全 toast，不能伪装空结果；账号删除、本地 wipe、卸载各自确认且不串用。
- [代码] 现状证据：[UI01](./host-capability-matrix.md#UI01) · [UI02](./host-capability-matrix.md#UI02) · [UI03](./host-capability-matrix.md#UI03) · [READ10](./host-capability-matrix.md#READ10) · [READ11](./host-capability-matrix.md#READ11) · [EXT03](./host-capability-matrix.md#EXT03) · [EXT04](./host-capability-matrix.md#EXT04) · [EXT05](./host-capability-matrix.md#EXT05) · [EXT06](./host-capability-matrix.md#EXT06) · [EXT07](./host-capability-matrix.md#EXT07) · [SYS12](./host-capability-matrix.md#SYS12) · [SYS15](./host-capability-matrix.md#SYS15) · [SYS16](./host-capability-matrix.md#SYS16) · [SYS17](./host-capability-matrix.md#SYS17) · [OPS06](./host-capability-matrix.md#OPS06) · [OPS07](./host-capability-matrix.md#OPS07) · [OPS08](./host-capability-matrix.md#OPS08) · [OPS09](./host-capability-matrix.md#OPS09) · [OPS10](./host-capability-matrix.md#OPS10) · [CFG07](./host-capability-matrix.md#CFG07) · [CFG08](./host-capability-matrix.md#CFG08) · [AI04](./host-capability-matrix.md#AI04) · [AI05](./host-capability-matrix.md#AI05)。

### <a id="S4"></a>S4 · Service · resources（目标新增）

**文件、书籍资产与私有二进制资源**

- 当前 catalog 身份：无对应现有 catalog 身份；目标责任或跨切边界，不是当前 API。
- [设计] 操作：用户选择 FileRef、读取授权资源元数据/范围/块、创建私有临时写入、commit/abort/release、保存到用户选择位置；Book/封面/图像的业务解析由 D1，资源服务只处理授权字节。现有 ui.exportFile 语义迁移到这里，不长期维护两套保存协议。
- [设计] Agent：读写文件必须有来源和用户意图，不接受模型猜出的任意路径；资源呈现与下载不必把 bytes 输入模型。
- [设计] 插件：ResourceRef 绑定 owner/scope/type/size/有效期；包内资产只读，自有写入按配额；大书使用有界块及回压，小文本可保留便利调用。
- [设计] 限制/不建设：真实需求来自已有书文件、图片、字体和 TTS 音频，不是新增万能 filesystem；无需对每个短字符串强制建流，也不提供任意 watch 目录。
- [设计] 通过条件：用户取消选择/保存与失败区分；越界读取/跨插件 ref/撤权拒绝；未提交写 abort；丢失 worker 自动释放；不能伪造路径逃逸。
- [代码] 现状证据：[LIB08](./host-capability-matrix.md#LIB08) · [LIB09](./host-capability-matrix.md#LIB09) · [TXT11](./host-capability-matrix.md#TXT11) · [TXT12](./host-capability-matrix.md#TXT12) · [SYS09](./host-capability-matrix.md#SYS09) · [SYS10](./host-capability-matrix.md#SYS10) · [SYS11](./host-capability-matrix.md#SYS11) · [SYS13](./host-capability-matrix.md#SYS13) · [MORE07](./host-capability-matrix.md#MORE07)。

### <a id="S5"></a>S5 · Service · network

**有界 HTTP**

- 当前 catalog 身份：`services.network`。
- [设计] 操作：保留 Request 的 method/headers/body/响应 status/headers/bytes；取消、超时、大小/并发限制、授权目的地与重定向检查；重试说明幂等性，离线明确报告。
- [设计] Agent：宿主推理/插件工具可使用，但不因此添加无限制 fetch 模型工具。
- [设计] 插件：RSS/TTS/WebDAV 不各自重写跨 Worker HTTP 桥；协议、认证、业务缓存仍在插件，提供者 HTTP 不变成宿主 RSS 业务。
- [设计] 限制/不建设：不建设 WebSocket/TCP/通用离线耐久队列来修复现有 HTTP；中止请求不保证服务端没处理，更不等于撤销已付费操作。
- [设计] 通过条件：GAP04/05：Request 对象与 url+init 等价；预先 abort 不派发；途中 abort 到达 host fetch；流和重定向不能绕过额度/权限。
- [代码] 现状证据：[SYS06](./host-capability-matrix.md#SYS06) · [SYS07](./host-capability-matrix.md#SYS07)。

### <a id="S6"></a>S6 · Service · llm

**受预算约束的独立推理**

- 当前 catalog 身份：`services.llm`。
- [设计] 操作：fast/smart 文本、结构化、流式输出；task scope、timeout/abort、可获得的 usage/终止原因；请求前校验模型能力和授权预算。
- [设计] Agent：thread 与自动管线复用推理设施，但 host prompt/审批/记忆业务仍由 Agent runtime 拥有。
- [设计] 插件：llm.ask 仅独立推理；返回结构符合声明 schema，流结束/错误可判定；不能读实际 key 或默认继承用户全部聊天/记忆。
- [设计] 限制/不建设：未提供用量的 vendor 返回 unknown，不编造成本；不为此新增本地模型、向量库或第二个 Agent。
- [设计] 通过条件：超时/停用/取消后不回写新视图；schema 错误明确失败；预算拒绝在请求前发生，停止不能宣称远端绝无费用。
- [代码] 现状证据：[AI06](./host-capability-matrix.md#AI06) · [AI07](./host-capability-matrix.md#AI07) · [CFG08](./host-capability-matrix.md#CFG08)。

### <a id="S7"></a>S7 · Service · clipboard

**受权复制**

- 当前 catalog 身份：`services.clipboard`。
- [设计] 操作：文本写入；宿主已有图像复制通过授权 ImageRef 写入；操作失败用稳定错误，用户取消不等于复制成功。
- [设计] Agent：默认由用户按钮触发；确有对话意图才适配工具，不为每种内容增加复制工具。
- [设计] 插件：文本复制已接通；图像复制尚未接入插件；不自动读取系统剪贴板。
- [设计] 限制/不建设：不因为复制聊天/标注就建 conversations.copy/annotations.copy API；组合既有读能力与 clipboard 即可。
- [设计] 通过条件：不支持格式、失效图像引用、系统写入失败可判定；无输入的后台剪贴板轮询不属于本次范围。
- [代码] 现状证据：[SYS08](./host-capability-matrix.md#SYS08) · [SYS09](./host-capability-matrix.md#SYS09)。

### <a id="S8"></a>S8 · Service · schedules

**运行期间的可管理调度**

- 当前 catalog 身份：`services.schedules`。
- [设计] 操作：现有 manifest schedules/bind：补枚举、自有计划状态/暂停/恢复、上次触发与成功/失败、重入策略和 owner 清理；空闲任务按宿主资源策略执行。
- [设计] Agent：自动化意图可通过插件工具/受限设置组合，不把每个 setTimeout 都变成模型工具。
- [设计] 插件：Worker clock 足够临时计时和 Theme Schedule；需要补跑的业务明确运行窗口和去重。当前 15 分钟下限/启动扫描与 lastRun 是触发时间必须诚实报告。
- [设计] 限制/不建设：关 App 不运行；不承诺 OS 常驻、恰好一次、任意 cron 分布式执行。短时 timer 不持久化是合法设计；业务反馈循环需 origin/深度或显式限流。
- [设计] 通过条件：长任务不重入、停用清理、失败不标成功；错过触发如何补跑有可复现行为。重启恢复仅对明确声明的计划，不恢复全部 Worker promise。
- [代码] 现状证据：[MORE01](./host-capability-matrix.md#MORE01) · [MORE02](./host-capability-matrix.md#MORE02)。

### <a id="S9"></a>S9 · Service · sync（目标新增控制面）

**同步状态与用户请求**

- 当前 catalog 身份：无对应现有 catalog 身份；目标责任或跨切边界，不是当前 API。
- [设计] 操作：受限状态：连接阶段、积压/错误、上次成功、本地可用性；用户意图 connect/disconnect/requestSync 由宿主 scheduler 执行，密文 transport 仍由 C5 提供。
- [设计] Agent：只读状态或打开连接批准流程；不操纵事件游标/ACK/加密密钥。
- [设计] 插件：普通插件可按授权了解非敏感 availability；transport 插件不因提供连接而获得全局同步管理权；连接配置走宿主 UI/secrets。
- [设计] 限制/不建设：不把 checkpoint/replay/事件账本操作暴露为普通 API；健康修复由宿主流程。新控制面只覆盖现有真实同步行为，不建设第二套同步引擎。
- [设计] 通过条件：断开/换 transport 关闭旧会话；本地/远端应用后的 D1–D6 快照可刷新；只看本地单元测试不能宣称跨设备正确。
- [代码] 现状证据：[OPS01](./host-capability-matrix.md#OPS01) · [OPS02](./host-capability-matrix.md#OPS02) · [OPS03](./host-capability-matrix.md#OPS03) · [OPS04](./host-capability-matrix.md#OPS04) · [OPS05](./host-capability-matrix.md#OPS05)。

### <a id="S10"></a>S10 · Service · plugins（目标新增只读目录）

**插件可用性与受控自管理**

- 当前 catalog 身份：无对应现有 catalog 身份；目标责任或跨切边界，不是当前 API。
- [设计] 操作：查询授权可见的插件 ID/版本/安装启用状态、贡献能力与 availability；安装/启停/升级/卸载请求交给 S3 宿主批准流程，实际事务由 host 生命周期所有。
- [设计] Agent：模型按插件能力发现可调用工具，但不能静默安装新代码或授予权限。
- [设计] 插件：允许自有状态与经批准的依赖发现；跨插件调用只能使用注册接口和权限交集；不得读他人私有配置或动态字符串执行函数。
- [设计] 限制/不建设：只读目录不演变成依赖求解器/插件商店后端重写；缺消费者时先补插件，不把每个贡献都开放为跨插件 RPC。
- [设计] 通过条件：源码插件与 bundled 的库存独立核对；实际 installed/enabled 需运行态证据；失效依赖、禁用 provider 不返回可用。
- [代码] 现状证据：[EXT11](./host-capability-matrix.md#EXT11) · [EXT12](./host-capability-matrix.md#EXT12) · [MORE06](./host-capability-matrix.md#MORE06)。

### <a id="S11"></a>S11 · Service · session（仅环境元数据）

**阅读状态统一归 D2**

- 当前 catalog 身份：`services.session`。
- [设计] 操作：session 2.0 已删除 subscribe 及四种阅读事件；D2.reading 独占当前阅读快照/观察。环境保留 revision/runtime/platform/locale/timeZone/utcOffsetMinutes/networkHint，Listening Desk 0.7 消费离线提示；格式可用性和服务真实就绪仍缺。
- [设计] Agent：get_host_environment 在全局/书内查询同一快照；自动日期/语言上下文与按需查询分清，不为每个环境字段新建工具。networkHint 不是 endpoint 可达性。
- [设计] 插件：environment 每次刷新，observeEnvironment 立即快照后观察 revision；语言/网络/焦点事件与 30 秒时区复核，末个观察者清理监听。读当前书须 reading 授权，元数据不含阅读或账号状态。Dictionary 1.2 经 reading/library 查询当前标题，不靠未来事件推测；旧 ^1 service 契约不兼容并拒绝，不保留旁路兜底。
- [设计] 限制/不建设：这里不是新 session service 设计，也不是全局万能 runtime context。没有需求的设备指纹/硬件枚举不开放。
- [设计] 通过条件：读快照与订阅之间不丢更新；locale/可用性变化可刷新；撤 reading 权限后缓存/订阅不继续泄露书名与位置。
- [代码] 现状证据：[READ07](./host-capability-matrix.md#READ07) · [READ08](./host-capability-matrix.md#READ08) · [MORE03](./host-capability-matrix.md#MORE03)。

### <a id="V1"></a>V1 · Schema · views

**声明式内容、表单与交互结果**

- 当前 catalog 身份：`schemas.views`。
- [设计] 操作：保留 list/detail/markdown/blocks/form 及宿主组件；补有界异步搜索/分页、loading/empty/error、可取消进度、稳定选择和资源引用。Tree/Table 仅在 TOC 层级或比较字段真实需要时补最小语义与键盘协议。
- [设计] Agent：工具卡/问题卡由宿主呈现；不把 PluginView 树当模型可执行 UI 代码。
- [设计] 插件：声明数据与事件，宿主拥有 React/布局/焦点/本地化；每个 view instance/generation 有局部 callback lease。
- [设计] 限制/不建设：Schema 无独立权力；onSubmit 仍走 Domain/Service。当前虚拟列表已有，不冒充仍需重建；无证据的富文本编辑器/任意 canvas/iframe 不进必补清单。
- [设计] 通过条件：长中文/英文、键盘、窄窗、空数据、失效 callback、异步结果逆序验证；搜索 debounce 不等于取消和防旧结果。
- [代码] 现状证据：[EXT03](./host-capability-matrix.md#EXT03) · [EXT04](./host-capability-matrix.md#EXT04) · [EXT05](./host-capability-matrix.md#EXT05) · [EXT06](./host-capability-matrix.md#EXT06) · [EXT07](./host-capability-matrix.md#EXT07) · [MORE05](./host-capability-matrix.md#MORE05) · [MORE08](./host-capability-matrix.md#MORE08) · [AI04](./host-capability-matrix.md#AI04) · [AI05](./host-capability-matrix.md#AI05)。

### <a id="V2"></a>V2 · Schema · settings

**字段声明而非行为授权**

- 当前 catalog 身份：`schemas.settings`。
- [设计] 操作：类型、默认值、scope、约束、secret 标记、动态选项和条件可用性。字段存在、值能保存、效果有消费者分别验证。
- [设计] Agent：从受权 discover 构造工具参数，不另写全量 settings 枚举。
- [设计] 插件：插件设置声明自有数据，跨插件写仍需 D5 授权；隐藏字段不等于安全隔离。
- [设计] 限制/不建设：不为每个底层 KV 建公共字段；secret/password 不进入普通 Agent catalog。
- [设计] 通过条件：新增字段必须注册消费者/默认/范围/reset 语义；移除插件选项后的失效值可诊断。
- [代码] 现状证据：[CFG01](./host-capability-matrix.md#CFG01) · [CFG02](./host-capability-matrix.md#CFG02) · [CFG03](./host-capability-matrix.md#CFG03) · [CFG04](./host-capability-matrix.md#CFG04) · [CFG05](./host-capability-matrix.md#CFG05) · [CFG06](./host-capability-matrix.md#CFG06) · [CFG07](./host-capability-matrix.md#CFG07) · [CFG08](./host-capability-matrix.md#CFG08) · [CFG09](./host-capability-matrix.md#CFG09) · [CFG10](./host-capability-matrix.md#CFG10) · [CFG11](./host-capability-matrix.md#CFG11) · [CFG12](./host-capability-matrix.md#CFG12) · [CFG13](./host-capability-matrix.md#CFG13) · [SET01](./host-capability-matrix.md#SET01) · [SET02](./host-capability-matrix.md#SET02) · [SET03](./host-capability-matrix.md#SET03) · [SET04](./host-capability-matrix.md#SET04) · [SET05](./host-capability-matrix.md#SET05) · [SET06](./host-capability-matrix.md#SET06) · [SET07](./host-capability-matrix.md#SET07) · [SET08](./host-capability-matrix.md#SET08) · [SET09](./host-capability-matrix.md#SET09) · [SET10](./host-capability-matrix.md#SET10) · [SET11](./host-capability-matrix.md#SET11) · [SET12](./host-capability-matrix.md#SET12) · [SET13](./host-capability-matrix.md#SET13) · [SET14](./host-capability-matrix.md#SET14) · [SET15](./host-capability-matrix.md#SET15) · [SET16](./host-capability-matrix.md#SET16) · [SET17](./host-capability-matrix.md#SET17) · [SET18](./host-capability-matrix.md#SET18) · [SET19](./host-capability-matrix.md#SET19) · [SET20](./host-capability-matrix.md#SET20) · [SET21](./host-capability-matrix.md#SET21) · [SET22](./host-capability-matrix.md#SET22) · [SET23](./host-capability-matrix.md#SET23) · [SET24](./host-capability-matrix.md#SET24) · [SET25](./host-capability-matrix.md#SET25) · [SET26](./host-capability-matrix.md#SET26) · [SET27](./host-capability-matrix.md#SET27) · [SET28](./host-capability-matrix.md#SET28) · [SET29](./host-capability-matrix.md#SET29) · [SET30](./host-capability-matrix.md#SET30) · [SET31](./host-capability-matrix.md#SET31) · [SET32](./host-capability-matrix.md#SET32) · [SET33](./host-capability-matrix.md#SET33) · [SET34](./host-capability-matrix.md#SET34) · [SET35](./host-capability-matrix.md#SET35) · [SET36](./host-capability-matrix.md#SET36) · [SET37](./host-capability-matrix.md#SET37) · [SET38](./host-capability-matrix.md#SET38) · [SET39](./host-capability-matrix.md#SET39) · [SET40](./host-capability-matrix.md#SET40) · [SET41](./host-capability-matrix.md#SET41) · [SET42](./host-capability-matrix.md#SET42) · [SET43](./host-capability-matrix.md#SET43) · [SET44](./host-capability-matrix.md#SET44) · [SET45](./host-capability-matrix.md#SET45) · [SET46](./host-capability-matrix.md#SET46) · [SET47](./host-capability-matrix.md#SET47) · [SET48](./host-capability-matrix.md#SET48) · [SET49](./host-capability-matrix.md#SET49) · [SET50](./host-capability-matrix.md#SET50) · [SET51](./host-capability-matrix.md#SET51) · [SET52](./host-capability-matrix.md#SET52) · [SET53](./host-capability-matrix.md#SET53) · [SET54](./host-capability-matrix.md#SET54) · [SET55](./host-capability-matrix.md#SET55) · [SET56](./host-capability-matrix.md#SET56) · [SET57](./host-capability-matrix.md#SET57) · [SET58](./host-capability-matrix.md#SET58) · [SET59](./host-capability-matrix.md#SET59) · [SET60](./host-capability-matrix.md#SET60) · [SET61](./host-capability-matrix.md#SET61) · [SET62](./host-capability-matrix.md#SET62) · [SET63](./host-capability-matrix.md#SET63) · [SET64](./host-capability-matrix.md#SET64) · [SET65](./host-capability-matrix.md#SET65) · [SET66](./host-capability-matrix.md#SET66) · [SET67](./host-capability-matrix.md#SET67) · [SET68](./host-capability-matrix.md#SET68) · [SET69](./host-capability-matrix.md#SET69) · [SET70](./host-capability-matrix.md#SET70) · [SET71](./host-capability-matrix.md#SET71) · [SET72](./host-capability-matrix.md#SET72) · [SET73](./host-capability-matrix.md#SET73) · [SET74](./host-capability-matrix.md#SET74)。

### <a id="V3"></a>V3 · Schema · themes

**受限主题声明**

- 当前 catalog 身份：`schemas.themes`。
- [设计] 操作：宿主支持的 tokens/字体资产与 reader theme 声明，版本/资源有效性由 catalog 与 loader 验证。
- [设计] Agent：仅选择已声明主题，不注入样式或代码。
- [设计] 插件：提供资产和 tokens，不直接修改应用 DOM 或全局状态。
- [设计] 限制/不建设：新增主题内容不需改宿主；新渲染原语或未支持 token 的行为不由任意 CSS 逃生口绕过。
- [设计] 通过条件：缺字库/资产路径/插件禁用后回退可用；字号不破坏宿主交互与可访问性。
- [代码] 现状证据：[EXT08](./host-capability-matrix.md#EXT08) · [SYS14](./host-capability-matrix.md#SYS14)。

### <a id="Q1"></a>Q1 · Contract · catalog/authorization

**发现、授权和来源**

- 当前 catalog 身份：无对应现有 catalog 身份；目标责任或跨切边界，不是当前 API。
- [设计] 操作：单一 capability catalog + 域定义派生 actor 视图；每个操作记录 owner、schema、version、scope、风险、availability、来源和消费者。授权先于副作用，对象/字段/资源范围在执行时复核。
- [设计] Agent：模型工具只是授权操作的意图适配器，自动管线单独记账。批准票据绑定 actor/operation/对象/有效期，不能被不同请求复用。
- [设计] 插件：manifest consent、运行时 grant、用户一次性批准各司其职；跨插件 broker 取权限交集，不沿调用链提升权限。
- [设计] 限制/不建设：不复制第二份能力 registry；不把所有内部行为都变成公开工具。当前对象级授权/metadata policy/packaged CSP 尚未全部验收。
- [设计] 通过条件：无权限、撤权、过期批准、跨 scope、恶意插件输出和真实打包 CSP 分别测；只测类型不算通过。
- [代码] 现状证据：[CON01](./host-capability-matrix.md#CON01) · [CON02](./host-capability-matrix.md#CON02) · [CON09](./host-capability-matrix.md#CON09) · [CON11](./host-capability-matrix.md#CON11) · [AI04](./host-capability-matrix.md#AI04) · [AI09](./host-capability-matrix.md#AI09)。

### <a id="Q2"></a>Q2 · Contract · execution/lifecycle

**完成、取消和资源释放**

- 当前 catalog 身份：无对应现有 catalog 身份；目标责任或跨切边界，不是当前 API。
- [设计] 操作：短操作 Promise 直接给完成结果；长操作 request/task ID + progress + cancellation + deadline + terminal result。accepted 只表示受理，不是完成。跨 Worker envelope 有版本/类型/长度/并发界限。
- [设计] Agent：工具结束必须有真实业务结果；插件 worker 崩溃不让模型轮次无限等待。
- [设计] 插件：owner = plugin generation + view/session/task lease；停用后拒绝新调用、取消在途并清理回调/连接/临时资源；迟到 effect 在 host 提交边界再验 generation。
- [设计] 限制/不建设：cancel 不等于 undo/远端回滚；不强制所有任务耐久恢复。stable AppError code 复用项目错误契约，本文不发明与现有 code 冲突的第二套错误枚举。
- [设计] 通过条件：GAP06–08/10/12–14/17 的超时、callback、协议碰撞、旧结果/host effect、连接释放逐个故障注入；任务资源数回到基线。
- [代码] 现状证据：[CON03](./host-capability-matrix.md#CON03) · [CON04](./host-capability-matrix.md#CON04) · [CON05](./host-capability-matrix.md#CON05) · [CON06](./host-capability-matrix.md#CON06) · [READ20](./host-capability-matrix.md#READ20) · [AI07](./host-capability-matrix.md#AI07)。

### <a id="Q3"></a>Q3 · Contract · consistency/observation

**快照、变更和业务写入**

- 当前 catalog 身份：无对应现有 catalog 身份；目标责任或跨切边界，不是当前 API。
- [设计] 操作：授权 snapshot + revision + invalidation/订阅后重读，覆盖本地、同步和外部写；持久命令在 commit_events 事务完成后确认。CAS/批次只加在会丢用户编辑或部分成功的业务操作。
- [设计] Agent：每轮快照可满足多数查询，不需要让模型订阅所有事件。导航历史与业务撤销不可混用。
- [设计] 插件：事件是状态失效/业务通知而非原始 log 重放权；异步 callback 错误必须被处理。订阅注册与快照的竞态用 revision 重读收敛。
- [设计] 限制/不建设：不建设通用 durable event bus/exactly-once/跨插件分布式事务；不要求每次查询带全局快照隔离。无法撤销的外部效果如实报告。
- [设计] 通过条件：远端变更、事件乱序/重复、subscribe 首次竞态、合法新写后旧失败回滚都不静默产生陈旧 UI；依旧以存储事务为持久边界。
- [代码] 现状证据：[CON07](./host-capability-matrix.md#CON07) · [CON08](./host-capability-matrix.md#CON08) · [OPS05](./host-capability-matrix.md#OPS05) · [OPS11](./host-capability-matrix.md#OPS11) · [STAT04](./host-capability-matrix.md#STAT04) · [STAT05](./host-capability-matrix.md#STAT05) · [CFG10](./host-capability-matrix.md#CFG10)。

### <a id="Q4"></a>Q4 · Contract · coverage gate

**行为映射与语义回归门禁**

- 当前 catalog 身份：无对应现有 catalog 身份；目标责任或跨切边界，不是当前 API。
- [设计] 操作：新增宿主行为必须映射到 Domain/Contribution/Service + schema，并列 Agent/插件 disposition、实际消费者、失败路径和验收；库存新增/旧映射失效/来源丢失使生成检查失败。
- [设计] Agent：shape 测试以外还查工具参数是否被 adapter 丢失、批准是否执行、结果是否真实。
- [设计] 插件：测试同时覆盖注册、Worker wire、host 消费、卸载/撤权和用户入口；源码存在不等于部署/启用。
- [设计] 限制/不建设：本轮文档与生成器是人工审计的可追踪门禁，不会自动证明所有 React 闭包行为已经被发现；新产品行为仍需评审。
- [设计] 通过条件：本模型每条证据行/每个现有 catalog 成员/旧 129 基线均有归属；真实场景成功、失败、并发和撤权四条路径完成后才能关闭相应缺口。
- [代码] 现状证据：[CON10](./host-capability-matrix.md#CON10)。

### <a id="B1"></a>B1 · Boundary · future/internal

**明确排除与宿主尚未建成部分**

- 当前 catalog 身份：无对应现有 catalog 身份；目标责任或跨切边界，不是当前 API。
- [设计] 操作：禁止任意 SQL/FS/shell/DOM、宿主秘密、原始事件 append、伪造历史、静默付款/授权；新格式/OCR/任意编辑/实时协作/新平台在宿主能力更新时再纳入。
- [设计] Agent：Agent 和插件都不能用更高权限工具绕过产品策略；宿主内部投影修复不是普通模型行为。
- [设计] 插件：可以组合已授权读模型产生导出/插件算法，但不能把尚无的产品能力标成漏一条导出 API。
- [设计] 限制/不建设：画像实体投影、正式 context bundle、完整备份、Reveal 占位列为宿主建设/修复，不能为“插件完备”强迫先建设未来产品；移动端遗留 no-op 不计桌面缺口。
- [设计] 通过条件：需求评审能指出新增的宿主原语才算 host 更新；若只是编号规则、CSV 格式、HTTP 来源或主题内容，则应由已有原语组合。
- [代码] 现状证据：[CON11](./host-capability-matrix.md#CON11) · [CON12](./host-capability-matrix.md#CON12) · [SYS18](./host-capability-matrix.md#SYS18) · [MEM07](./host-capability-matrix.md#MEM07) · [MEM08](./host-capability-matrix.md#MEM08) · [MEM13](./host-capability-matrix.md#MEM13) · [OPS09](./host-capability-matrix.md#OPS09) · [OPS10](./host-capability-matrix.md#OPS10) · [OPS11](./host-capability-matrix.md#OPS11)。

## 本轮深挖与收敛

| 裁决 | 分类 | 证据 | 具体结论 |
| --- | --- | --- | --- |
| R1 | 已接真实遗漏 | [CFG11](./host-capability-matrix.md#CFG11) | settings 1.2 已注册 appearance.contentTypography.* 四字段 followReader/fontFamily/fontSize/lineSpacing，独立尺寸 x-small/small/medium/large/x-large，行距 compact/comfortable/relaxed；默认 true/null/medium/comfortable。跟随全局 reader，null 为应用 sans；独立字段只在解除跟随后消费。 |
| R2 | 已接真实遗漏 | [CFG12](./host-capability-matrix.md#CFG12) | settings 1.2 已注册 annotations.defaultColor，yellow/green/blue/pink，默认 yellow；宿主下一次一键标注即时读取，recolor 仍影响后续默认。不是 annotations 领域方法，不重染已有标注。 |
| R3 | 已接真实遗漏 | [CFG13](./host-capability-matrix.md#CFG13) | settings 1.2 已注册 general.updateChannel，stable/beta，默认 stable，设备本地且不漫游。已有 About 面板跟随 KV 变化；只影响下一次检查，不批准升级/重启。 |
| R4 | 细化现有契约 | [READ16](./host-capability-matrix.md#READ16) | modeKey/unitId/content version 决定恢复是否合法；恢复时重解 CFI，不钳制旧 ordinal，无版本旧位置不恢复。模式私有位置不得由插件直接写 read-aware-navigator-state:*。mode sessionTimer 从零计时，不持久化是设计，不是 durable scheduler 缺口。 |
| R5 | 拒绝重复 API | [AI03](./host-capability-matrix.md#AI03) · [SYS08](./host-capability-matrix.md#SYS08) | 聊天复制 = conversations 读取 + clipboard；retry/clear 不是业务撤销，不删除已完成的工具副作用。draft/发送仍需用户意图与回合 generation。 |
| R6 | 拒绝虚构宿主能力 | [LIB06](./host-capability-matrix.md#LIB06) | ReaderWorkspace 的重新导入按钮当前调用 library.openImportPicker，不能据此要求/宣称已有原文件原子替换引擎。 |
| R7 | 收回不必要的暴露 | [READ11](./host-capability-matrix.md#READ11) · [MORE02](./host-capability-matrix.md#MORE02) | 面板开关/焦点与用户选择集可以语义化；toc/chat 像素宽度和浮动控制 x/y 由宿主布局管理，不要求每项成为 Agent 工具或 settings 字段。 |
| R8 | 校正库存口径 | [EXT11](./host-capability-matrix.md#EXT11) | 当前源码有十二个第一方插件，Rust BUNDLED 编译清单有六个；WebDAV、Annotation Desk、Listening Desk、Reading Goals、Workspace Profiles、Text Desk 不在内置清单。Text Desk 0.2 组合 library 1.3 正文状态、准备/确认重建/请求取消、列表详情与明确开书；进度用显式刷新，任务仅属当前激活代，不宣称耐久调度或全局停止。Workspace Profiles 通过 settings 1.3 快照/原子更新组合书架与外观预设，注册双 scope 的管理工具；0.2 通过 settings 1.4 精确路径增加自身快捷键表单，批量冲突、重置与生命周期边界见 UI04。Reading Goals 实际提供书内上下文和记忆候选，并消费 buildMemory 实时设置；这不是新增宿主域或专属模型工具。源码、编译内置与用户安装态分开枚举，以矩阵生成库存反查，不沿用旧的六源码/五内置数字。 |
| R9 | 限制基础设施规模 | [CON06-08](./host-capability-matrix.md#CON06-08) · [EXT06](./host-capability-matrix.md#EXT06) · [MORE06](./host-capability-matrix.md#MORE06) | 通用耐久队列、可重放事件总线、全局事务、任意跨插件 RPC、富文本编辑器都不是当前必补；选择快照+revision、有限任务、业务批次、已声明 provider、场景所需声明 UI。 |
| R10 | 细化设置完成语义 | [CFG01](./host-capability-matrix.md#CFG01) · [CFG10](./host-capability-matrix.md#CFG10) | settings 1.1 的单个已验证命令现在等待本地 SQLite KV 批次提交；失败整体回滚且不广播成功，跨 actor 命令在前序结算后读快照。结果按授权过滤；不是远端漫游、系统设置效果、密钥或 reading.configureMode 的持久完成证明。 |

[代码] 本轮新增取证路径：

- [apps/web/src/features/settings/lib/content-typography.ts](../apps/web/src/features/settings/lib/content-typography.ts)
- [apps/web/src/features/settings/sections/AppearancePanel.tsx](../apps/web/src/features/settings/sections/AppearancePanel.tsx)
- [apps/web/src/features/settings/hooks/useContentTypography.ts](../apps/web/src/features/settings/hooks/useContentTypography.ts)
- [apps/web/src/features/annotations/lib/annotation-prefs.ts](../apps/web/src/features/annotations/lib/annotation-prefs.ts)
- [apps/web/src/features/reader/hooks/useReaderTextActions.ts](../apps/web/src/features/reader/hooks/useReaderTextActions.ts)
- [apps/web/src/features/update/lib/update-channel.ts](../apps/web/src/features/update/lib/update-channel.ts)
- [apps/web/src/features/settings/sections/AboutPanel.tsx](../apps/web/src/features/settings/sections/AboutPanel.tsx)
- [apps/web/src/features/update/lib/software-update.ts](../apps/web/src/features/update/lib/software-update.ts)
- [apps/web/src/features/reader/lib/text-unit-mode-state.ts](../apps/web/src/features/reader/lib/text-unit-mode-state.ts)
- [apps/web/src/features/reader/hooks/useTextUnitNavigator.ts](../apps/web/src/features/reader/hooks/useTextUnitNavigator.ts)
- [apps/web/src/features/reader/hooks/useSessionTimer.ts](../apps/web/src/features/reader/hooks/useSessionTimer.ts)
- [apps/web/src/features/reader/components/TextUnitReadoutChip.tsx](../apps/web/src/features/reader/components/TextUnitReadoutChip.tsx)
- [apps/web/src/features/reader/lib/reader-panel-layout.ts](../apps/web/src/features/reader/lib/reader-panel-layout.ts)
- [apps/web/src/features/reader/lib/reader-panel-sizes.ts](../apps/web/src/features/reader/lib/reader-panel-sizes.ts)
- [apps/web/src/features/reader/state/panel-intent.ts](../apps/web/src/features/reader/state/panel-intent.ts)
- [apps/web/src/features/ai/hooks/useBookConversation.ts](../apps/web/src/features/ai/hooks/useBookConversation.ts)
- [apps/web/src/features/ai/components/ChatMessageActions.tsx](../apps/web/src/features/ai/components/ChatMessageActions.tsx)
- [apps/web/src/App.tsx](../apps/web/src/App.tsx)
- [apps/desktop/src-tauri/src/plugins.rs](../apps/desktop/src-tauri/src/plugins.rs)

[代码] CFG11/CFG12/CFG13 已在 settings 1.2 接通，九项新路径的双端和 macOS debug 效果证据见执行账本；未接通的其他目标操作仍是设计，不能只修改文档或 schema 当作实现。

## 组合场景

| 场景 | 责任单元 | 当前缺口与验收重点 |
| --- | --- | --- |
| Jumper | [D1](#D1) · [D2](#D2) · [C1](#C1) · [S3](#S3) · [V1](#V1) · [Q2](#Q2) · [Q3](#Q3) | 已建第一方 Jumper：reader header/命令、分层目录与版本化精确搜索、共享会话/导航回执/历史。印刷章号、目录序号、标题匹配由插件区分；不存在章节不派发，歧义给候选。隔离 Tauri FB2 Worker 与实际 Agent 端口通过；WebView hidden 导致前台绘制/截图未通过，PDF、超大查询预算与逐调用取消仍未关闭。 |
| Dictionary | [D1](#D1) · [D2](#D2) · [C4](#C4) · [S1](#S1) · [S6](#S6) · [S7](#S7) · [V1](#V1) | 查询/保存/检索已经有工具；删词/CSV 工具缺消费者，应在插件补；当前文本上下文/存储持久屏障缺口由宿主补。复制/导出失败必须可见。 |
| RSS/OPML | [D1](#D1) · [C2](#C2) · [C4](#C4) · [S1](#S1) · [S4](#S4) · [S5](#S5) · [S8](#S8) | 订阅/刷新工具已有，退订/OPML 工具未贡献；文件选择为宿主漏接能力，OPML 解析为插件算法。正文版本更新不能把当前会话悄悄指向旧引用。 |
| 句读与 TTS | [D2](#D2) · [C2](#C2) · [C3](#C3) · [D5](#D5) · [Q2](#Q2) | reading 2.5 已共享朗读、模式快照/启停/单位配置、版本化返回、单元步进与模式提供者发现/选择；Listening Desk 组合模式表单、朗读、历史、Current passage 与上下单元。配置的书内状态/提供者偏好同批落盘，回执等待该请求精确持久结果，失败不被偏好回滚误报为 superseded；位置写在配置成功后复核 revision/key/unit。步进从 resting 继续并返回 moved/start-of-book/end-of-book，等待真实页面/分段/React 反馈与目标位置提交，不记跳转历史；返回同样等待持久完成。位置保存失败保留 db code，下一次明确操作可重试；自动朗读消费同一回执，书尾正常停止，保存失败则停止而非继续播下一段。隔离 macOS Tauri 已验跨节、慢 Worker、失败、取消、书尾及双端 SQLite 故障/恢复；空节/非线性/其他格式仍需桌面验证。模式选择通过 availableModes/selectModeKey，失效选择保留且不隐式替换，取消撤回未完成选择但不撤销所有已提交提供者偏好。旧偏好读取无副作用，迁移的新设置、书内配置和旧记录删除同批提交；不同所有者保留，删除失败两端拒绝且旧值保留。READ16 跟随和跨提供者取消补偿仍缺；release、其他系统、远端 TTS 未验。 |
| 主题与定时主题 | [D5](#D5) · [C5](#C5) · [S8](#S8) · [V3](#V3) | 主题/字体可组合，已有 settings 足以切换；短 clock 不要求耐久工作流。新增主题无需宿主改动，缺字体时回退。 |
| WebDAV | [C5](#C5) · [S2](#S2) · [S5](#S5) · [S9](#S9) · [Q2](#Q2) | 密文传输 v2 已有 session.close、宿主会话所有权和原生请求取消；受控同步状态/连接面仍缺双端入口。连接 UI、真实跨设备与升级回滚仍待完整验收。 |
| 标注批改/导出 | [D3](#D3) · [S4](#S4) · [Q3](#Q3) | 补按 ID/分页/有需求的版本条件批次；插件组合 CSV/Markdown 格式，宿主无需对应每种导出格式。中途取消报告已完成项，不能宣称全部回滚。 |
| 记忆与人物关系 | [D6](#D6) · [C4](#C4) · [Q1](#Q1) | Agent 查询/自动管线已有，插件读模型缺失；画像投影与正式 bundle 尚未实现。超前内容、候选来源和拒绝结果必须可辨；不开放原始投影写。 |
| 设置自动化 | [D5](#D5) · [V2](#V2) · [Q3](#Q3) | 覆盖真实偏好、默认/覆盖/设备本地策略；无效果字段先禁用或修复消费者。禁止以保存成功证明隐私开关真的有效。 |
| 中途启用/跨设备变化 | [D1](#D1) · [D2](#D2) · [D3](#D3) · [D4](#D4) · [D5](#D5) · [Q3](#Q3) | 先获取一致快照再观察或 revision 重读；本地/远端/外部写都使数据失效。无需 universal event replay，但不能漏通知后永久陈旧。 |
| 插件升级/崩溃/撤权 | [S1](#S1) · [S10](#S10) · [Q1](#Q1) · [Q2](#Q2) | quiesce/drain/snapshot/migrate/activate 与失败恢复；超时和 worker crash 结束 pending；旧 callback 与在途 host effect 不污染新代。GAP01–18 未因写文档关闭。 |
| 账号/备份/诊断/更新 | [S3](#S3) · [S4](#S4) · [S9](#S9) · [S10](#S10) · [B1](#B1) | 打开有边界的宿主流程并反馈真实结果；明示现有备份并非完整快照。不得静默付款、上传日志、读取凭据或 wipe；不把占位 Reveal 算可用。 |

### 旧 32 场景逐项保留

[设计] 这些是验收用例，不是已经通过的测试；W12 的树/表仅补真实呈现需求，W14 不强迫提前建设正式 context bundle，W18 只做确有消费者的类型化组合。

| 场景 | 名称 | 模型归属 | 原验收条件 |
| --- | --- | --- | --- |
| W01 | Jumper | [D1](#D1) · [D2](#D2) · [C1](#C1) · [S3](#S3) · [V1](#V1) · [Q2](#Q2) · [Q3](#Q3) | 章号识别在插件；目录层级/重号/不存在有准确结果；精确命中可定位；所有导航共享前进后退 |
| W02 | 生词出处与书签 | [D2](#D2) · [D3](#D3) · [S1](#S1) · [Q3](#Q3) | 选区保存范围；换书/重启后返回；旧位置失效不跳错书；书签不新增宿主表 |
| W03 | 全书/跨书搜索 | [D1](#D1) · [S4](#S4) · [V1](#V1) · [Q2](#Q2) | 分批查询/取消/重试；只有图片的书明示无文本；新查询不被旧结果覆盖 |
| W04 | 批量笔记导出 | [D1](#D1) · [D3](#D3) · [S4](#S4) | 已有标注+上下文+封面+定位引用组成文件；用户取消不报保存成功 |
| W05 | 批量标注管理 | [D3](#D3) · [V1](#V1) · [Q1](#Q1) · [Q3](#Q3) | 多选、排序、分页、逐项失败；读权限不能删除；无事先准备的内部 ID |
| W06 | 阅读时间报表 | [D2](#D2) · [S4](#S4) · [V1](#V1) | 指定日期/时区、当前未结算时间、真实新事件，不用累计值假装区间 |
| W07 | 主题/阅读自动化 | [D5](#D5) · [C5](#C5) · [S8](#S8) | 定时更换已选主题、对齐和固定版式原色；恢复单书覆盖；不直接写 localKV |
| W08 | 自定义快捷阅读 | [D2](#D2) · [C1](#C1) · [S3](#S3) | 开书/翻页/换章/切模式/朗读均经正式操作；焦点在输入框时不抢键 |
| W09 | RSS/课程内容 | [D1](#D1) · [C2](#C2) · [S1](#S1) · [S5](#S5) | 载入虚拟书、离线状态、更新修订、重新解析位置；禁用后明确不可用 |
| W10 | 朗读集成 | [D2](#D2) · [C3](#C3) · [Q2](#Q2) | 自定义语音并控制当前朗读；切书/禁用后无残留声音；迟到合成无效 |
| W11 | 选段翻译/解释 | [D1](#D1) · [D2](#D2) · [S3](#S3) · [S6](#S6) | 选区上下文交给 LLM、可取消、侧面板不丢阅读位置；不读无权限整库 |
| W12 | 人物/概念回顾 | [D6](#D6) · [V1](#V1) · [Q1](#Q1) | 从当前边界内摘要/关系生成树/表格，叙事不越界；图形新原语不在本基线 |
| W13 | AI 问题模板 | [D4](#D4) · [S3](#S3) · [Q2](#Q2) | 生成带位置草稿、用户确认发到正确线程、流式响应与取消，不伪造消息 |
| W14 | 自定义记忆导出 | [D6](#D6) · [S4](#S4) · [B1](#B1) | 只导出授权 scope 和来源，区分现有画像摘要与未建画像；不读取原始秘密 |
| W15 | WebDAV/其他 HTTP 同步源 | [C5](#C5) · [S2](#S2) · [S5](#S5) · [S9](#S9) | 新后端只实现密文传输协议；业务合并/密钥留宿主；网络失败可恢复 |
| W16 | 外部学习系统 | [D3](#D3) · [S1](#S1) · [S2](#S2) · [S5](#S5) · [Q2](#Q2) | 批量 HTTP 导出、幂等/重试/取消、私有凭据，不依赖任意文件系统权限 |
| W17 | 自定义设置与界面 | [D5](#D5) · [C1](#C1) · [V1](#V1) · [V2](#V2) | 动态 options、无结果、加载失败、表单错误、键盘/窄窗口、语言切换 |
| W18 | 插件之间组合 | [C2](#C2) · [C4](#C4) · [S10](#S10) · [Q1](#Q1) | 类型化贡献发现/调用；卸载依赖立即失效；不能借依赖越权 |
| W19 | 中途启用自动化 | [D2](#D2) · [S11](#S11) · [Q3](#Q3) | 书已打开后启用也有当前快照，不等待下一次翻页才知道正在读什么 |
| W20 | 升级/撤权/销毁 | [S1](#S1) · [S10](#S10) · [Q1](#Q1) · [Q2](#Q2) | 迁移失败回滚；关窗/禁用/换书释放资源；不能在旧 generation 继续写 |
| W21 | 数据管理助手 | [S3](#S3) · [S4](#S4) · [B1](#B1) | 只打开备份/诊断/更新/账户设置确认流程；取消不会仍执行危险动作 |
| W22 | 组合压力测试 | [D2](#D2) · [S1](#S1) · [S5](#S5) · [Q2](#Q2) · [Q3](#Q3) | 输入更新、导航、网络和文档写并发；断网/锁库/关闭/重开仍有真实结果，无假成功 |
| W23 | 更新时仍有合法写入 | [S1](#S1) · [Q2](#Q2) · [Q3](#Q3) | 旧实例写入与候选检查交错；候选在停旧版之前/之后失败均不丢合法写入；迁移完成必须落盘 |
| W24 | 网络参数符合性 | [S5](#S5) · [Q2](#Q2) | string/URL/Request 与 init 覆盖语义一致；POST/头/字节不丢；调用前已取消不得发到宿主 |
| W25 | 长期打开与关闭视图 | [C5](#C5) · [S3](#S3) · [Q2](#Q2) | 重复创建回调、订阅和 provider 会话后释放；句柄/任务数量回落到基线，不靠禁用整个插件 |
| W26 | 卡死、崩溃、撤权 | [S10](#S10) · [Q1](#Q1) · [Q2](#Q2) | 永不 resolve、Worker 失联、停用时已有宿主请求，各有终态；旧代不能继续影响新代 |
| W27 | 另一设备更改数据 | [S9](#S9) · [Q3](#Q3) | 同步/检查点恢复后的插件列表与查询一致；刷新不会被误当本地动作重新外发 |
| W28 | 视图请求乱序 | [S3](#S3) · [V1](#V1) · [Q2](#Q2) | 先发慢请求、再返回/换根视图/发快请求；旧响应不覆盖新视图、不关闭新窗口、不发过期 toast |
| W29 | 订阅回调异步失败 | [S1](#S1) · [Q3](#Q3) | ignoreSelf 开/关和 storage.onChange 的 async handler 拒绝均记录且隔离；无 unhandled rejection |
| W30 | RPC 数据与预算 | [Q2](#Q2) | 带 __fn 的合法业务数据不变成函数；错误消息形状、超大/深层/循环对象和并发洪水被有界拒绝 |
| W31 | 最小权限与平台绕行 | [Q1](#Q1) · [S11](#S11) · [B1](#B1) | 无阅读权限插件的观察范围明确；打包 Tauri 中检查直接消息、子 Worker、动态模块、网络和平台入口 |
| W32 | 稳定错误与证据门禁 | [Q2](#Q2) · [Q4](#Q4) | 同类错误在宿主/Worker/UI 保持 code；能力升级必须有语义和消费者证据，不只修改版本常量 |

## 缺口分级与落地顺序

| 优先级 | 工作 | 所有权 | 完成标准 |
| --- | --- | --- | --- |
| P0 | 真实效果与安全完成 | D5/S1/Q1–Q3 | 修复/禁用六个无效果设置，并补两个文本发送设置及 localOnly 的完整插件隐私边界；写持久屏障、更新回滚、稳定错误、RPC 终态/配额、取消/撤权、过期结果和资源释放。安全缺口不能被丰富 API 掩盖。 |
| P1 | 运行态闭合 | D1/D2/S3/V1 | 统一 Location/Range、可定位 TOC/搜索、session 快照、导航完成和共享历史；然后接模式/朗读/临时强调与 UI。Jumper 作为组合验收，不把编号算法迁入宿主。 |
| P1 | 已有行为对等接入 | D3–D6/S4/S9/S10 | 补已有标注参数/ask 删除、聊天意图、真实设置字段、受权记忆读、资源选择/导出、同步状态和插件目录；不等于给模型开放每个底层方法。 |
| P2 | 明确场景需要的扩展 | C1–C5/S8/V1 | 补动态入口、计划可观察性、必要分页/树表格、类型化 provider 消费；词典/RSS 缺工具优先在插件补。无需求不建通用框架。 |
| 独立产品工作 | 宿主自身未完成功能 | D6/B1/OPS08 | 画像实体投影、正式 context bundle、全量备份修复、Reveal；保留缺口，不要求先完成所有未来方向才能交付阅读插件。 |

[设计] 不做大爆炸重写：先由现有 domains/registry 提炼业务控制器，再让宿主 UI、Agent port、plugin context 共用它；随单元迁移对应 tests/schema/catalog。reading 接管 session 事件，resources 接管文件字节/保存语义，版本化迁移所有第一方消费者，不长期维持新旧两套接口。本文新增四个目标入口（memory 域、resources/sync/plugins 服务）均来自已有数据或系统行为，不是要求现在全部实现。

### 旧基线如何使用

旧 E/P/M/B 是当时接口状态，不是本轮“必须新建”的裁决；以下 129 项全保留并映射。若目标规模与旧措辞不同，以本模型的限制列为准：任务不默认耐久、观察不默认重放、批次不默认全局事务、UI 不默认任意编辑器、组合不默认任意跨插件 RPC。GAP01–GAP18 是有源码证据的失败/安全问题，仍须实际修复和验收，不能用“避免过度设计”撤销。

| 旧项 | 当前证据 | 统一模型归属 |
| --- | --- | --- |
| A01 | [CON01](./host-capability-matrix.md#CON01) | [Q1](#Q1) |
| A02 | [TXT13](./host-capability-matrix.md#TXT13) | [D1](#D1) |
| A03 | [TXT13](./host-capability-matrix.md#TXT13) · [TXT02](./host-capability-matrix.md#TXT02) | [D1](#D1) |
| A04 | [TXT13](./host-capability-matrix.md#TXT13) · [LIB11](./host-capability-matrix.md#LIB11) | [D1](#D1) |
| A05 | [READ01](./host-capability-matrix.md#READ01) · [READ03](./host-capability-matrix.md#READ03) · [CON08](./host-capability-matrix.md#CON08) | [D2](#D2) · [Q3](#Q3) |
| A06 | [CON07](./host-capability-matrix.md#CON07) · [ANN08](./host-capability-matrix.md#ANN08) | [Q3](#Q3) · [D3](#D3) |
| A07 | [MORE03](./host-capability-matrix.md#MORE03) | [S11](#S11) |
| B01 | [LIB01](./host-capability-matrix.md#LIB01) | [D1](#D1) |
| B02 | [LIB02](./host-capability-matrix.md#LIB02) · [LIB03](./host-capability-matrix.md#LIB03) · [LIB04](./host-capability-matrix.md#LIB04) · [LIB05](./host-capability-matrix.md#LIB05) | [D1](#D1) |
| B03 | [LIB15](./host-capability-matrix.md#LIB15) · [LIB16](./host-capability-matrix.md#LIB16) · [LIB17](./host-capability-matrix.md#LIB17) · [LIB18](./host-capability-matrix.md#LIB18) | [D1](#D1) |
| B04 | [LIB06](./host-capability-matrix.md#LIB06) | [D1](#D1) |
| B05 | [LIB08](./host-capability-matrix.md#LIB08) · [LIB09](./host-capability-matrix.md#LIB09) | [D1](#D1) · [S4](#S4) |
| B06 | [LIB11](./host-capability-matrix.md#LIB11) | [D1](#D1) |
| B07 | [LIB12](./host-capability-matrix.md#LIB12) · [LIB13](./host-capability-matrix.md#LIB13) · [LIB14](./host-capability-matrix.md#LIB14) | [D1](#D1) · [C2](#C2) |
| B08 | [LIB07](./host-capability-matrix.md#LIB07) · [LIB10](./host-capability-matrix.md#LIB10) | [D1](#D1) |
| C01 | [TXT01](./host-capability-matrix.md#TXT01) · [TXT02](./host-capability-matrix.md#TXT02) | [D1](#D1) |
| C02 | [TXT03](./host-capability-matrix.md#TXT03) | [D1](#D1) |
| C03 | [TXT04](./host-capability-matrix.md#TXT04) · [TXT05](./host-capability-matrix.md#TXT05) | [D1](#D1) |
| C04 | [TXT07](./host-capability-matrix.md#TXT07) | [D1](#D1) |
| C05 | [TXT06](./host-capability-matrix.md#TXT06) | [D1](#D1) |
| C06 | [TXT08](./host-capability-matrix.md#TXT08) | [D1](#D1) |
| C07 | [TXT09](./host-capability-matrix.md#TXT09) · [TXT10](./host-capability-matrix.md#TXT10) | [D2](#D2) |
| C08 | [TXT11](./host-capability-matrix.md#TXT11) · [TXT12](./host-capability-matrix.md#TXT12) | [D1](#D1) · [S4](#S4) |
| D01 | [READ07](./host-capability-matrix.md#READ07) | [D2](#D2) · [S11](#S11) |
| D02 | [READ01](./host-capability-matrix.md#READ01) · [READ02](./host-capability-matrix.md#READ02) | [D2](#D2) |
| D03 | [READ03](./host-capability-matrix.md#READ03) | [D2](#D2) |
| D04 | [READ04](./host-capability-matrix.md#READ04) | [D2](#D2) |
| D05 | [READ05](./host-capability-matrix.md#READ05) | [D2](#D2) |
| D06 | [READ06](./host-capability-matrix.md#READ06) | [D2](#D2) |
| D07 | [READ06](./host-capability-matrix.md#READ06) · [READ20](./host-capability-matrix.md#READ20) | [D2](#D2) · [Q2](#Q2) |
| D08 | [READ09](./host-capability-matrix.md#READ09) · [READ10](./host-capability-matrix.md#READ10) | [D2](#D2) · [S3](#S3) |
| D09 | [READ12](./host-capability-matrix.md#READ12) | [D2](#D2) |
| D10 | [READ20](./host-capability-matrix.md#READ20) | [D2](#D2) · [Q2](#Q2) |
| D11 | [READ08](./host-capability-matrix.md#READ08) | [D2](#D2) · [S11](#S11) |
| D12 | [READ07](./host-capability-matrix.md#READ07) | [D2](#D2) · [S11](#S11) |
| E01 | [READ13](./host-capability-matrix.md#READ13) | [D2](#D2) |
| E02 | [READ13](./host-capability-matrix.md#READ13) | [D2](#D2) |
| E03 | [READ14](./host-capability-matrix.md#READ14) | [D2](#D2) |
| E04 | [READ14](./host-capability-matrix.md#READ14) · [CON03](./host-capability-matrix.md#CON03) | [D2](#D2) · [Q2](#Q2) |
| E05 | [TXT11](./host-capability-matrix.md#TXT11) · [TXT12](./host-capability-matrix.md#TXT12) | [D1](#D1) · [S4](#S4) |
| E06 | [TXT13](./host-capability-matrix.md#TXT13) | [D1](#D1) |
| F01 | [ANN01](./host-capability-matrix.md#ANN01) | [D3](#D3) |
| F02 | [ANN02](./host-capability-matrix.md#ANN02) · [ANN03](./host-capability-matrix.md#ANN03) · [ANN04](./host-capability-matrix.md#ANN04) · [ANN05](./host-capability-matrix.md#ANN05) | [D3](#D3) |
| F03 | [ANN08](./host-capability-matrix.md#ANN08) | [D3](#D3) |
| F04 | [ANN02](./host-capability-matrix.md#ANN02) · [TXT13](./host-capability-matrix.md#TXT13) | [D3](#D3) · [D1](#D1) |
| F05 | [ANN06](./host-capability-matrix.md#ANN06) · [ANN07](./host-capability-matrix.md#ANN07) | [D3](#D3) |
| F06 | [ANN09](./host-capability-matrix.md#ANN09) | [D3](#D3) |
| G01 | [STAT01](./host-capability-matrix.md#STAT01) | [D2](#D2) |
| G02 | [READ19](./host-capability-matrix.md#READ19) | [D2](#D2) |
| G03 | [STAT02](./host-capability-matrix.md#STAT02) · [STAT03](./host-capability-matrix.md#STAT03) | [D2](#D2) |
| G04 | [STAT05](./host-capability-matrix.md#STAT05) | [D2](#D2) · [Q3](#Q3) |
| G05 | [STAT04](./host-capability-matrix.md#STAT04) | [D2](#D2) · [Q3](#Q3) |
| H01 | [CFG01](./host-capability-matrix.md#CFG01) · [CFG10](./host-capability-matrix.md#CFG10) | [D5](#D5) · [V2](#V2) · [Q3](#Q3) |
| H02 | [CFG04](./host-capability-matrix.md#CFG04) · [CFG05](./host-capability-matrix.md#CFG05) | [D5](#D5) · [V2](#V2) |
| H03 | [UI02](./host-capability-matrix.md#UI02) · [UI04](./host-capability-matrix.md#UI04) | [D5](#D5) · [S3](#S3) · [C1](#C1) |
| H04 | [CFG06](./host-capability-matrix.md#CFG06) · [CFG07](./host-capability-matrix.md#CFG07) · [CFG08](./host-capability-matrix.md#CFG08) | [D5](#D5) · [V2](#V2) · [S2](#S2) · [S3](#S3) · [S6](#S6) |
| H05 | [CFG02](./host-capability-matrix.md#CFG02) · [CFG03](./host-capability-matrix.md#CFG03) | [D5](#D5) · [V2](#V2) |
| H06 | [CFG09](./host-capability-matrix.md#CFG09) | [D5](#D5) · [C1](#C1) · [V2](#V2) |
| I01 | [UI01](./host-capability-matrix.md#UI01) | [S3](#S3) |
| I02 | [UI03](./host-capability-matrix.md#UI03) · [UI04](./host-capability-matrix.md#UI04) | [C1](#C1) · [S3](#S3) · [D5](#D5) |
| I03 | [UI03](./host-capability-matrix.md#UI03) | [C1](#C1) · [S3](#S3) |
| I04 | [EXT01](./host-capability-matrix.md#EXT01) · [EXT02](./host-capability-matrix.md#EXT02) | [C1](#C1) |
| I05 | [MORE04](./host-capability-matrix.md#MORE04) | [C1](#C1) |
| I06 | [READ10](./host-capability-matrix.md#READ10) · [READ11](./host-capability-matrix.md#READ11) · [EXT03](./host-capability-matrix.md#EXT03) | [S3](#S3) · [V1](#V1) |
| I07 | [MORE05](./host-capability-matrix.md#MORE05) | [C1](#C1) · [V1](#V1) |
| I08 | [UI05](./host-capability-matrix.md#UI05) · [EXT03](./host-capability-matrix.md#EXT03) | [D5](#D5) · [C1](#C1) · [S3](#S3) · [V1](#V1) |
| J01 | [EXT04](./host-capability-matrix.md#EXT04) | [S3](#S3) · [V1](#V1) |
| J02 | [EXT05](./host-capability-matrix.md#EXT05) | [S3](#S3) · [V1](#V1) |
| J03 | [EXT04](./host-capability-matrix.md#EXT04) · [EXT06](./host-capability-matrix.md#EXT06) | [S3](#S3) · [V1](#V1) |
| J04 | [MORE05](./host-capability-matrix.md#MORE05) | [C1](#C1) · [V1](#V1) |
| J05 | [MORE05](./host-capability-matrix.md#MORE05) | [C1](#C1) · [V1](#V1) |
| J06 | [EXT06](./host-capability-matrix.md#EXT06) | [S3](#S3) · [V1](#V1) |
| J07 | [EXT06](./host-capability-matrix.md#EXT06) | [S3](#S3) · [V1](#V1) |
| J08 | [TXT12](./host-capability-matrix.md#TXT12) · [SYS09](./host-capability-matrix.md#SYS09) · [MORE07](./host-capability-matrix.md#MORE07) | [D1](#D1) · [S4](#S4) · [S7](#S7) · [S1](#S1) |
| J09 | [EXT07](./host-capability-matrix.md#EXT07) | [S3](#S3) · [V1](#V1) |
| J10 | [EXT03](./host-capability-matrix.md#EXT03) | [S3](#S3) · [V1](#V1) |
| J11 | [MORE08](./host-capability-matrix.md#MORE08) | [V1](#V1) |
| J12 | [CON04](./host-capability-matrix.md#CON04) | [Q2](#Q2) |
| K01 | [READ15](./host-capability-matrix.md#READ15) | [D2](#D2) · [C2](#C2) |
| K02 | [READ16](./host-capability-matrix.md#READ16) | [D2](#D2) · [C2](#C2) |
| K03 | [READ17](./host-capability-matrix.md#READ17) | [D2](#D2) · [C3](#C3) |
| K04 | [READ18](./host-capability-matrix.md#READ18) | [D2](#D2) · [C3](#C3) |
| K05 | [READ17](./host-capability-matrix.md#READ17) · [READ18](./host-capability-matrix.md#READ18) | [D2](#D2) · [C3](#C3) |
| K06 | [CON03](./host-capability-matrix.md#CON03) · [CON06](./host-capability-matrix.md#CON06) | [Q2](#Q2) |
| L01 | [AI06](./host-capability-matrix.md#AI06) | [S6](#S6) |
| L02 | [AI07](./host-capability-matrix.md#AI07) | [S6](#S6) · [Q2](#Q2) |
| L03 | [AI01](./host-capability-matrix.md#AI01) | [D4](#D4) |
| L04 | [AI02](./host-capability-matrix.md#AI02) | [D4](#D4) |
| L05 | [AI03](./host-capability-matrix.md#AI03) · [AI04](./host-capability-matrix.md#AI04) | [D4](#D4) · [C4](#C4) · [S3](#S3) · [V1](#V1) · [Q1](#Q1) |
| L06 | [AI10](./host-capability-matrix.md#AI10) · [AI11](./host-capability-matrix.md#AI11) · [AI12](./host-capability-matrix.md#AI12) · [MEM03](./host-capability-matrix.md#MEM03) | [C4](#C4) · [D6](#D6) |
| L07 | [AI08](./host-capability-matrix.md#AI08) · [AI09](./host-capability-matrix.md#AI09) · [CON02](./host-capability-matrix.md#CON02) · [CON06](./host-capability-matrix.md#CON06) | [C4](#C4) · [Q1](#Q1) · [Q2](#Q2) |
| M01 | [MEM01](./host-capability-matrix.md#MEM01) | [D6](#D6) |
| M02 | [MEM10](./host-capability-matrix.md#MEM10) · [MEM11](./host-capability-matrix.md#MEM11) | [D6](#D6) |
| M03 | [MEM02](./host-capability-matrix.md#MEM02) · [MEM03](./host-capability-matrix.md#MEM03) | [D6](#D6) · [C4](#C4) |
| M04 | [MEM04](./host-capability-matrix.md#MEM04) · [MEM05](./host-capability-matrix.md#MEM05) | [D6](#D6) |
| M05 | [MEM06](./host-capability-matrix.md#MEM06) · [MEM07](./host-capability-matrix.md#MEM07) · [MEM08](./host-capability-matrix.md#MEM08) | [D6](#D6) · [B1](#B1) |
| M06 | [MEM13](./host-capability-matrix.md#MEM13) | [D6](#D6) · [B1](#B1) |
| N01 | [EXT08](./host-capability-matrix.md#EXT08) | [C5](#C5) · [V3](#V3) |
| N02 | [LIB14](./host-capability-matrix.md#LIB14) | [D1](#D1) · [C2](#C2) |
| N03 | [OPS04](./host-capability-matrix.md#OPS04) | [C5](#C5) · [S9](#S9) |
| N04 | [MORE06](./host-capability-matrix.md#MORE06) | [C4](#C4) · [S10](#S10) |
| N05 | [CON03](./host-capability-matrix.md#CON03) · [CON06](./host-capability-matrix.md#CON06) | [Q2](#Q2) |
| N06 | [MORE06](./host-capability-matrix.md#MORE06) | [C4](#C4) · [S10](#S10) |
| O01 | [SYS01](./host-capability-matrix.md#SYS01) · [SYS02](./host-capability-matrix.md#SYS02) | [S1](#S1) |
| O02 | [CON08](./host-capability-matrix.md#CON08) · [SYS01](./host-capability-matrix.md#SYS01) · [SYS02](./host-capability-matrix.md#SYS02) | [Q3](#Q3) · [S1](#S1) |
| O03 | [SYS04](./host-capability-matrix.md#SYS04) | [S2](#S2) |
| O04 | [MORE07](./host-capability-matrix.md#MORE07) | [S1](#S1) · [S4](#S4) |
| O05 | [SYS03](./host-capability-matrix.md#SYS03) · [EXT12](./host-capability-matrix.md#EXT12) | [S1](#S1) · [S10](#S10) |
| O06 | [SYS05](./host-capability-matrix.md#SYS05) · [OPS08](./host-capability-matrix.md#OPS08) | [S1](#S1) · [S3](#S3) |
| P01 | [SYS11](./host-capability-matrix.md#SYS11) · [SYS13](./host-capability-matrix.md#SYS13) | [S4](#S4) |
| P02 | [SYS10](./host-capability-matrix.md#SYS10) | [S4](#S4) |
| P03 | [SYS06](./host-capability-matrix.md#SYS06) | [S5](#S5) |
| P04 | [SYS07](./host-capability-matrix.md#SYS07) | [S5](#S5) |
| P05 | [SYS08](./host-capability-matrix.md#SYS08) · [SYS09](./host-capability-matrix.md#SYS09) · [SYS12](./host-capability-matrix.md#SYS12) | [S7](#S7) · [S4](#S4) · [S3](#S3) |
| P06 | [SYS07](./host-capability-matrix.md#SYS07) · [CON02](./host-capability-matrix.md#CON02) | [S5](#S5) · [Q1](#Q1) |
| Q01 | [CON07](./host-capability-matrix.md#CON07) | [Q3](#Q3) |
| Q02 | [CON07](./host-capability-matrix.md#CON07) · [READ07](./host-capability-matrix.md#READ07) | [Q3](#Q3) · [D2](#D2) · [S11](#S11) |
| Q03 | [MORE01](./host-capability-matrix.md#MORE01) | [S8](#S8) |
| Q04 | [MORE02](./host-capability-matrix.md#MORE02) · [CON06](./host-capability-matrix.md#CON06) | [S8](#S8) · [Q2](#Q2) |
| Q05 | [MORE02](./host-capability-matrix.md#MORE02) · [CON02](./host-capability-matrix.md#CON02) | [S8](#S8) · [Q1](#Q1) |
| Q06 | [CON03](./host-capability-matrix.md#CON03) · [CON06](./host-capability-matrix.md#CON06) | [Q2](#Q2) |
| R01 | [CON01](./host-capability-matrix.md#CON01) · [CON03](./host-capability-matrix.md#CON03) · [SYS03](./host-capability-matrix.md#SYS03) | [Q1](#Q1) · [Q2](#Q2) · [S1](#S1) |
| R02 | [CON02](./host-capability-matrix.md#CON02) | [Q1](#Q1) |
| R03 | [CON03](./host-capability-matrix.md#CON03) · [CON09](./host-capability-matrix.md#CON09) | [Q2](#Q2) · [Q1](#Q1) |
| R04 | [OPS01](./host-capability-matrix.md#OPS01) | [S9](#S9) |
| R05 | [OPS08](./host-capability-matrix.md#OPS08) · [OPS09](./host-capability-matrix.md#OPS09) · [SYS15](./host-capability-matrix.md#SYS15) · [SYS16](./host-capability-matrix.md#SYS16) · [EXT12](./host-capability-matrix.md#EXT12) | [S3](#S3) · [B1](#B1) · [S10](#S10) |
| R06 | [SYS15](./host-capability-matrix.md#SYS15) · [CON05](./host-capability-matrix.md#CON05) | [S3](#S3) · [Q2](#Q2) |
| R07 | [CON01](./host-capability-matrix.md#CON01) · [CON10](./host-capability-matrix.md#CON10) | [Q1](#Q1) · [Q4](#Q4) |
| R08 | [CON10](./host-capability-matrix.md#CON10) | [Q4](#Q4) |

## 双端现状反查

[代码] 下表由同一事实源生成；“接通”表示已找到源码调用链，不代表本轮桌面验证。只要行内仍有缺口，不得用它的某个局部“接通”宣称整个功能完工。现有具体方法/消费者/源码与缺口全部保留，不把目标操作当当前接口。

| 证据 | 能力/宿主 | Agent 当前 | 插件当前 | 消费者/缺口 | 模型 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| LIB01 | 枚举/查询书籍与书目元数据 / 实装 | 接通：list_books[全局] / get_book_overview[双域] | 接通：library.queries.books.list/get | 书架；RSS 订阅校验；Agent 读模型不含封面和原文件；字段不能借元数据查询全部泄露 | [D1](#D1) | [LIB](../apps/web/src/domain/library.ts) [LIBTOOLS](../packages/agent/src/tools/library-tools.ts) [LIBPORT](../apps/web/src/features/ai/agent/ports/library-port.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| LIB02 | 修改标题/作者 / 实装 | 接通：update_book | 接通：library.commands.books.editMetadata | 书架；Agent；已有单项写，批量与冲突另列 | [D1](#D1) | [LIB](../apps/web/src/domain/library.ts) [LIBUI](../apps/web/src/features/library/hooks/useLibraryCommands.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| LIB03 | 收藏/取消收藏 / 实装 | 接通：update_book.starred | 接通：library.commands.books.setStarred | 书架；Agent；按对象授权与写回执仍需基线回归 | [D1](#D1) | [LIB](../apps/web/src/domain/library.ts) [LIBUI](../apps/web/src/features/library/hooks/useLibraryCommands.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| LIB04 | 删除单本书 / 实装 | 接通：delete_book + 用户批准 | 接通：library.commands.books.remove | 书架；Agent；RSS；Agent 有批准环节；插件是已授权直接写，不等价于逐次批准 | [D1](#D1) | [LIB](../apps/web/src/domain/library.ts) [LIBUI](../apps/web/src/features/library/hooks/useLibraryCommands.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| LIB05 | 批量删除书籍 / 实装 | 部分：可逐个 delete_book，无批次契约 | 部分：可循环 remove，未开放 removeMany | 书架多选；循环单项不等于宿主批量语义；需原子性/部分成功契约 | [D1](#D1) | [LIB](../apps/web/src/domain/library.ts) [LIBUI](../apps/web/src/features/library/hooks/useLibraryCommands.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| LIB06 | 导入已有支持格式的书籍字节 / 实装 | 未接：无正式入口 | 部分：library.commands.books.importBook | 书架导入/拖放/系统打开；Agent 无导入工具；插件有字节入口，无完整进度/取消/FileRef | [D1](#D1) | [IMPORT](../apps/web/src/features/library/lib/book-import.ts) [LIB](../apps/web/src/domain/library.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) |
| LIB07 | 识别格式/DRM/损坏文件并报告 / 实装 | 未接：无正式入口 | 部分：importBook 间接触发 | 导入与阅读加载；不能由 BookFormat enum 推断任意文件可读 | [D1](#D1) | [IMPORT](../apps/web/src/features/library/lib/book-import.ts) [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [SESSION](../apps/web/src/features/reader/hooks/useReaderSession.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| LIB08 | 查询/读取书籍原文件与本地可用性 / 实装 | 未接：无正式入口 | 未接：无正式入口 | 阅读加载；备份；同步；当前 BookSummary 不提供源文件资源；不可开放任意路径 | [D1](#D1) · [S4](#S4) | [BLOB](../apps/web/src/platform/blob-store.ts) [SESSION](../apps/web/src/features/reader/hooks/useReaderSession.ts) [LIB](../apps/web/src/domain/library.ts) [API](../packages/plugin-types/src/index.ts) |
| LIB09 | 提取/显示封面与封面可用状态 / 实装 | 部分：present_books 间接显示书卡 | 未接：无正式入口 | 书架；Agent 书卡；封面后台补齐；Agent 书卡由宿主解析，模型/插件没有封面字节接口 | [D1](#D1) · [S4](#S4) | [ENRICH](../apps/web/src/features/library/lib/book-enrichment.ts) [LIB](../apps/web/src/domain/library.ts) [PRESENT](../packages/agent/src/tools/present-tools.ts) [API](../packages/plugin-types/src/index.ts) |
| LIB10 | 缺失封面/元数据后台补齐 / 实装 | 未接：无正式入口 | 未接：无正式入口 | scheduleCatchUpEnrichment / enrichFromOpenBook；宿主后台任务已存在；不是新增插件算法要求 | [D1](#D1) | [ENRICH](../apps/web/src/features/library/lib/book-enrichment.ts) [APP](../apps/web/src/App.tsx) [COREVENTS](../packages/core/src/events.ts) |
| LIB11 | 重复检测、同源书合并和 ID 重定向 / 实装 | 未接：无正式入口 | 未接：无正式入口 | 导入去重；同步后 reconcileDuplicateBooks；查询候选与合并结果映射未公开 | [D1](#D1) | [DEDUPE](../apps/web/src/platform/book-dedupe.ts) [LIB](../apps/web/src/domain/library.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) |
| LIB12 | 创建/幂等绑定虚拟书并更新标题 / 实装 | 扩展：RSS subscribe_feed[全局] | 接通：addVirtualBook，同 binding 更新标题 | RSS；不是所有虚拟书创建都自动成为 Agent 工具；仅 RSS 提供一例 | [D1](#D1) · [C2](#C2) | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [VIRTUAL](../apps/web/src/features/plugins/lib/virtual-books.ts) [RSSFEED](../plugins/rss-reader/src/feed.ts) [RSSTOOLS](../plugins/rss-reader/src/agent-tools.ts) |
| LIB13 | 移除插件自有虚拟书 / 部分 | 部分：delete_book 通用删除；无 RSS 退订工具 | 部分：removeVirtualBook | RSS 退订；书架删除后订阅清理；removeVirtualBook 捕获删除错误后仍解绑，不能算可靠删除完成 | [D1](#D1) · [C2](#C2) | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [RSSVIEWS](../plugins/rss-reader/src/views.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) |
| LIB14 | 虚拟内容修订/离线缓存/当前书刷新 / 部分 | 扩展：RSS refresh_feed[全局] | 部分：contentProviders.load + 私有缓存 | RSS；订阅缓存更新不是通用内容版本协议；在读书/旧位置失效未闭合 | [D1](#D1) · [C2](#C2) | [VIRTUAL](../apps/web/src/features/plugins/lib/virtual-books.ts) [RSSFEED](../plugins/rss-reader/src/feed.ts) [RSSVIEWS](../plugins/rss-reader/src/views.ts) [API](../packages/plugin-types/src/index.ts) |
| LIB15 | 列出集合及其成员 / 实装 | 接通：list_collections[全局] | 接通：library.queries.collections.list/booksIn | 书架；Agent；集合单归属模型保持不变 | [D1](#D1) | [LIB](../apps/web/src/domain/library.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| LIB16 | 创建/重命名集合 / 实装 | 接通：manage_collection[全局] | 接通：collections.create/rename | 书架；Agent；书内不注册全局集合管理工具是明确 scope 策略 | [D1](#D1) | [LIB](../apps/web/src/domain/library.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| LIB17 | 删除集合 / 实装 | 接通：delete_collection[全局] + 批准 | 接通：collections.remove | 书架；Agent；删除集合与删除其中书籍是不同操作 | [D1](#D1) | [LIB](../apps/web/src/domain/library.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| LIB18 | 批量分配/移出集合 / 实装 | 接通：manage_collection.assign[全局] | 接通：collections.assignBooks | 书架拖放/多选；Agent；移动书籍只是成员变更，不是文件移动 | [D1](#D1) | [LIB](../apps/web/src/domain/library.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| TXT01 | 读取抽取章节目录 / 实装 | 接通：get_toc | 接通：library.queries.books.getToc | Agent；抽取正文管线；同叫 TOC：模型输出不带 hrefs，插件也不带；不是原书完整目录 | [D1](#D1) | [TEXT](../apps/web/src/features/library/lib/book-text-store.ts) [TEXTPORT](../apps/web/src/features/ai/agent/ports/book-text-port.ts) [TEXTTOOLS](../packages/agent/src/tools/book-text-tools.ts) [LIB](../apps/web/src/domain/library.ts) |
| TXT02 | 读取原书分层导航目录及 href / 实装 | 接通：get_navigation_toc 返回分层目录/版本化 Location | 接通：library v1.1 books.getNavigationToc | 宿主目录；Agent；Jumper 章节/目录序号；ordinal 是深度优先目录序号，不是印刷章号；无位置标题返回 null；超大目录的模型输出窗口与全部格式验收仍需补齐 | [D1](#D1) | [LOCATIONSEARCH](../apps/web/src/features/library/lib/book-location-search.ts) [CONTENTSOURCE](../apps/web/src/features/library/lib/book-content-source.ts) [NAVTOOLS](../packages/agent/src/tools/navigation-tools.ts) [JUMPER](../plugins/jumper/src/views.ts) |
| TXT03 | 按抽取章节读正文/分段 / 实装 | 接通：read_chapter(part)，带剧透控制 | 接通：library.queries.books.getChapterText | Agent；章节摘要；插件整章字符串不含坐标/语言/版本；Agent 分段不是渲染分页 | [D1](#D1) | [TEXT](../apps/web/src/features/library/lib/book-text-store.ts) [TEXTTOOLS](../packages/agent/src/tools/book-text-tools.ts) [LIB](../apps/web/src/domain/library.ts) |
| TXT04 | 查询本地正文准备状态与文本存在性 / 实装 | 接通：get_book_text_status 双 scope；get_toc 空结果保留状态 | 接通：library 1.2+ queries.books.getTextState | Agent 正文工具；Text Desk 0.2；status 七态与 text 三态独立；查询不抽取/下载。ready 要求所有必需节成功且最终索引落盘；短正文 available 可有 0 章，不是 textless。v5 源 hash/失败集合/最终化标记；v3/v4 惰性失效，不采信旧终局。真实 macOS debug Agent/权限 Worker、FB2/空白 PDF、部分失败重试与缺源/换 hash 已验；任务控制见 TXT05，持久 setup 错误/虚拟书派生索引/全部格式与 packaged 跨平台另欠 | [D1](#D1) | [TEXT](../apps/web/src/features/library/lib/book-text-store.ts) [TEXTREPO](../apps/web/src/features/library/lib/book-text-repository.ts) [TEXTRECORD](../apps/web/src/features/library/lib/book-text-record.ts) [TEXTPORT](../apps/web/src/features/ai/agent/ports/book-text-port.ts) [TEXTTOOLS](../packages/agent/src/tools/book-text-tools.ts) [TEXTDESK](../plugins/text-desk/src/views.ts) [TEXTPROOF](../docs/evidence/book-text-state-2026-09-09.json) |
| TXT05 | 启动、重建、暂停让路正文抽取 / 实装 | 部分：prepare_book_text / get_book_text_tasks / cancel_book_text_task 双 scope | 部分：library 1.3 prepareText / cancelTextTask / getTextTask / listTextTasks / observeTextTask | Text Desk 0.2；Agent；阅读需求优先调度；显式请求有五态/递增 revision/进度/稳定错误，prepare 复用成功断点，rebuild 清派生索引重读，忙时拒绝而不抢占。每个 actor 的请求只释放自己的共享租约，末租约取消阻止晚结果发布，已派发读写/下载不回滚。插件任务限当前激活代，Agent 两 scope 共享进程所有者；16 活跃/64 保留/每任务 16 观察者，慢回调合并最新快照。回执不等于完成或已获得解析租约，Text Desk 显式刷新而非实时推送。原生 macOS debug 权限/共享取消/重建和双端已验；显式 pause/resume/优先级、耐久任务历史/超时、reader-demand-activity 公共事件、虚拟索引和打包跨平台仍缺 | [D1](#D1) | [TEXT](../apps/web/src/features/library/lib/book-text-store.ts) [TEXTREPO](../apps/web/src/features/library/lib/book-text-repository.ts) [TEXTEXTRACTION](../apps/web/src/features/library/lib/book-text-extraction.ts) [TEXTTASKS](../apps/web/src/features/library/lib/book-text-tasks.ts) [TEXTTASKTOOLS](../packages/agent/src/tools/book-text-task-tools.ts) [TEXTDESK](../plugins/text-desk/src/views.ts) [TEXTTASKPROOF](../docs/evidence/book-text-tasks-2026-09-09.json) [APPEVENTS](../apps/web/src/platform/app-events.ts) [SESSION](../apps/web/src/features/reader/hooks/useReaderSession.ts) |
| TXT06 | 当前书及跨书多查询正文检索 / 实装 | 接通：search_book_text，scope/剧透约束 | 未接：无正式入口 | Agent；结果为 snippet+章节 offset，不是精准可渲染范围；当前共享文本扫描而非通用 FTS API | [D1](#D1) | [TEXT](../apps/web/src/features/library/lib/book-text-store.ts) [TEXTPORT](../apps/web/src/features/ai/agent/ports/book-text-port.ts) [TEXTTOOLS](../packages/agent/src/tools/book-text-tools.ts) |
| TXT07 | 引擎全文精确搜索并返回 CFI / 部分 | 接通：find_book_locations + open_book(location)，保留原回合章节围栏 | 接通：library v1.1 books.searchLocations + reading v2 goTo | Jumper 正文搜索；Agent；隔离 Tauri FB2 Worker/实际端口通过；每页最多 50 命中/32 个扫描 section；cursor 绑定书/版本/查询/允许范围；未扫完不宣称 textless。仍缺单次 Worker 调用取消/超大 section 协作预算；PDF quote 已有实现和 DOM 测试，但真实前台绘制尚未通过 | [D1](#D1) | [LOCATIONSEARCH](../apps/web/src/features/library/lib/book-location-search.ts) [CONTENTSOURCE](../apps/web/src/features/library/lib/book-content-source.ts) [NAVTOOLS](../packages/agent/src/tools/navigation-tools.ts) [JUMPER](../plugins/jumper/src/views.ts) [NAVPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-reading-probe.ts) |
| TXT08 | 搜索分页、取消、背压和过期查询淘汰 / 待建 | 未接：无正式入口 | 未接：无正式入口 | 无完整公共实现；引擎局部 cancel 不等于端到端插件/Agent 任务协议 | [D1](#D1) | [ENGINE](../apps/web/foliate-js/src/view.ts) [API](../packages/plugin-types/src/index.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) |
| TXT09 | 读取当前可见文本/阅读游标 / 部分 | 部分：get_reading_session + 原有自动 grounding | 部分：reading.queries.session + observeSession | 书内 Agent；桌面 FB2 探针；重排正文已返回实际可见 Range 文本，限 12000 字符；PDF range 为空时 visibleText 仍为空，文本可用性分类待补 | [D2](#D2) | [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVADAPTER](../apps/web/src/features/reader/lib/reading-engine-adapter.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [GROUND](../packages/agent/src/runtime/grounding-context.ts) [API](../packages/plugin-types/src/index.ts) |
| TXT10 | 选区附近句段上下文 / 实装 | 自动：TurnAttachment / grounding context | 部分：selectionActions.run(input.context) | Ask AI；Dictionary；只在特定回调拿到，不代表任意范围读取 | [D2](#D2) | [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) [GROUND](../packages/agent/src/runtime/grounding-context.ts) [API](../packages/plugin-types/src/index.ts) [DICT](../plugins/dictionary/src/index.ts) |
| TXT11 | 书内脚注/链接目标解析与预览 / 实装 | 未接：无正式入口 | 未接：无正式入口 | ReaderFootnotePopover；DOM 与样式保持宿主所有；只开放语义目标 | [D1](#D1) · [S4](#S4) | [ENGINE](../apps/web/foliate-js/src/view.ts) [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [API](../packages/plugin-types/src/index.ts) |
| TXT12 | 书内图片读取与灯箱缩放预览 / 实装 | 未接：无正式入口 | 未接：无正式入口 | ReaderImageLightbox；灯箱存在不等于模型已有图像输入工具 | [D1](#D1) · [S4](#S4) | [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [BLOB](../apps/web/src/platform/blob-store.ts) [API](../packages/plugin-types/src/index.ts) |
| TXT13 | 统一位置/范围解析、校验、版本与失效 / 部分 | 部分：open_book(location) 接收共享版本化搜索/目录位置 | 部分：getNavigationToc/searchLocations → reading.goTo(Location) | Jumper/Agent/RSS；标注仍待统一 Range；文件 SHA-256 与虚拟内容摘要作为版本；来源 lease/前后校验、provider 代际失效已实现；Range 写入/跨模式位置/全部格式和并发生命周期验收仍未完整 | [D1](#D1) | [ENGINE](../apps/web/foliate-js/src/view.ts) [NAV](../apps/web/src/domain/reading-session-controller.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [API](../packages/plugin-types/src/index.ts) [CONTENTSOURCE](../apps/web/src/features/library/lib/book-content-source.ts) [NAVTOOLS](../packages/agent/src/tools/navigation-tools.ts) |
| READ01 | 打开书/恢复保存位置 / 实装 | 接通：open_book 等待共享控制器实际完成 | 接通：reading v2 openBook 返回 Promise<receipt> | 书架；Agent；RSS；桌面探针；源文件 hash 标识版本；无 hash 的虚拟内容为 session 版本；PDF 等待当前页绘制，后台 WebView 暂停绘制会超时，不冒充成功 | [D2](#D2) | [SESSION](../apps/web/src/features/reader/hooks/useReaderSession.ts) [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVADAPTER](../apps/web/src/features/reader/lib/reading-engine-adapter.ts) [NAVPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-reading-probe.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) |
| READ02 | 关闭当前书并返回书架 / 实装 | 接通：navigate_reading(close) 携带书籍/会话 guard | 接通：reading.commands.close(guard?) | 阅读关闭/完成页；Agent 桌面探针；等待关闭动画后的真实会话释放；旧 guard 拒绝关闭新书；取消不承诺撤销已发起的关闭 | [D2](#D2) | [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVTEST](../apps/web/src/domain/reading-session-controller.test.ts) [SESSION](../apps/web/src/features/reader/hooks/useReaderSession.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [API](../packages/plugin-types/src/index.ts) |
| READ03 | 按章节/标注/href/CFI 跳转 / 实装 | 部分：open_book 解析章节/标注并等待真实落点 | 部分：reading v2 goTo(cfi/href/contentVersion) | 阅读目录/标注；Agent；RSS 文章；无位置标注明确失败，缺失 href 与 stale 版本有错误码；正文搜索尚不产出可导航 Range，全部 fragment/CFI 失效边界仍需扩展验证 | [D2](#D2) | [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [NAVADAPTER](../apps/web/src/features/reader/lib/reading-engine-adapter.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-reading-probe.ts) |
| READ04 | 前后翻页、章节、书首书尾 / 实装 | 部分：navigate_reading(next/previous) | 部分：reading.commands.step(next/previous,guard?) | 键盘/页面按钮/滚轮；桌面探针；已接页面步进；章节步进与印刷页定位未接，宿主旧页面按钮仍有直接引擎路径 | [D2](#D2) | [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVADAPTER](../apps/web/src/features/reader/lib/reading-engine-adapter.ts) [SHORTCUT](../apps/web/src/features/settings/lib/shortcuts.ts) [API](../packages/plugin-types/src/index.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) |
| READ05 | 按进度/固定版式页索引定位 / 实装 | 部分：open_book(fraction,contentVersion?) | 部分：reading.commands.goTo({fraction,contentVersion?}) | 阅读进度拖动；两端桌面探针；0–1 进度已接并校验；固定版式页索引/印刷页标签/重排页数还需分开建模接线 | [D2](#D2) | [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVADAPTER](../apps/web/src/features/reader/lib/reading-engine-adapter.ts) [API](../packages/plugin-types/src/index.ts) |
| READ06 | 导航历史 back/forward 及可用性 / 部分 | 部分：navigate_reading(back/forward) + 快照可用性 | 部分：reading.commands.back/forward + snapshot.history | 共享阅读控制器；目录/标注/进度跳转；两端；成功后更新，最多 100 落点；失败不入历史、back/forward 不分支、新跳转截断 forward；引擎内部链接和全部 UI 入口还未统一历史 | [D2](#D2) | [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVTEST](../apps/web/src/domain/reading-session-controller.test.ts) [NAVPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-reading-probe.ts) [API](../packages/plugin-types/src/index.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) |
| READ07 | 统一当前书/位置/加载/历史快照 / 实装 | 接通：get_reading_session（书内 scope 不泄露其他书） | 接通：reading.queries.session() | 共享控制器；Agent；可中途启用的插件；revision/sessionId/bookId/status/location/history 已共享；2.1 新增 playback、2.2 新增 mode、2.3 新增版本化 mode.position（READ18/READ16）。2.5 新增 mode.availableModes；此行不代表正文 selection 已接通 | [D2](#D2) · [S11](#S11) | [NAV](../apps/web/src/domain/reading-session-controller.ts) [READING](../apps/web/src/domain/reading.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [API](../packages/plugin-types/src/index.ts) [NAVPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-reading-probe.ts) |
| READ08 | 会话开关/章节/进度事件 / 实装 | 自动：宿主 cursor/scope + 按需 session 查询 | 部分：reading.events.observeSession 立即快照并观察；旧 session 四事件已删除 | Dictionary 1.2 按需读取；阅读 Worker 探针；统一快照含 book/session/status/location/history/mode/playback/revision；旧 services.session.subscribe、类型和 App 三个广播 effect 均移除，session 2.0 仅元数据，旧 ^1 合约拒绝。Dictionary 显式 reading:read/library:read，迟启用和改名按需读取，跨书/重开竞态丢弃旧标题；查词缓存包含标题。macOS debug 已验无权限不可见、只读观察、迟启用、FB2/PDF 换书与关闭；origin/reason 及完整撤权/跨平台仍未完成。 | [D2](#D2) · [S11](#S11) | [NAV](../apps/web/src/domain/reading-session-controller.ts) [READING](../apps/web/src/domain/reading.ts) [API](../packages/plugin-types/src/index.ts) [DICTTOOLS](../plugins/dictionary/src/agent-tools.ts) [SESSIONBOUNDARY](../docs/evidence/reading-session-boundary-2026-09-09.json) |
| READ09 | 阅读沉浸/显示隐藏控制层 / 实装 | 接通：set_reader_controls + get_reading_session.controls | 接通：reading 2.6 setControls + session.controls/observeSession | 空格/内容点击/滚动隐藏；Agent；Listening Desk 0.8；同一控制器接收 UI 和双端意图，React DOM 提交才发布 visible 和完成回执，不等待 CSS 动画/屏幕栅格。无可用会话为 null，写要求 ready；带 book/session guard，插件生命周期与 Agent signal 取消，10 秒无提交超时，更新意图/退出使旧请求 superseded。取消仅丢弃未提交状态，不承诺撤销已呈现界面。只改 header/已选 docked panels 的显示，不改偏好、书页、历史、模式或音频。Listening Desk 按快照提供显式 show/hide 并在成功后关闭视图；不是所有面板选择 API。跨平台/packaged 仍未验。 | [D2](#D2) | [CONTROLS](../apps/web/src/features/reader/lib/reading-controls-controller.ts) [CONTROLSHOOK](../apps/web/src/features/reader/hooks/useReaderControls.ts) [NAV](../apps/web/src/domain/reading-session-controller.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [API](../packages/plugin-types/src/index.ts) [LISTENINGDESK](../plugins/listening-desk/src/views.ts) [CONTROLSPROOF](../docs/evidence/reader-controls-2026-09-09.json) |
| READ10 | 目录/注释/外观/聊天面板开关 / 实装 | 接通：get_reader_panels / set_reader_panel | 接通：services.ui 1.1 reader.snapshot/observe/setPanel | Reader header；Agent；Listening Desk 0.9；同一服务接收四面板显式开关；reading:read 才能查询/观察，reading:write 才能操作，零阅读授权没有 reader 接口。快照含 session/book/revision、open 与 visible，无面板内容；它描述已提交 UI，可能含待保存的乐观值，命令回执另等精确 SQLite 保存和新 DOM commit。打开会显示控制层；窄窗目录/聊天互斥单次保存，外观/注释为会话临时状态。新意图/旧会话 superseded，10 秒无提交 timeout，Agent signal/插件卸载取消，不撤销已派发写或已显示界面。面板/Ask AI 意图等待 ready，完成确认防止重开书重复消费；外观在 More 内仍可打开有限高可滚动 Dialog。隔离 macOS debug 已验双端、真实 Worker、SQLite 拒绝/回滚/重试、旧插件视图拒绝、600/1200 窗口及 PDF 外观呈现。不是动画/焦点/内容加载完成保证；单调用 Worker 取消、packaged/跨平台仍未验。滚轮 wheel-phase 已改为原生固定脚本投递当前文档、阅读器同步订阅/退订，移除异步 native listener 生命周期竞态；隔离桌面 20 次 FB2/PDF 重开无原异常，200 个退休监听不收回调，native eval 三阶段投递与退订已验。物理触控板输入/时序及 packaged 回归未验，不外推为全部 Tauri 事件无竞态。 | [S3](#S3) | [WORKSPACE](../apps/web/src/features/reader/components/ReaderWorkspace.tsx) [UI](../apps/web/src/state/ui.ts) [MENU](../apps/web/src/features/menus/lib/menu-registry.tsx) [API](../packages/plugin-types/src/index.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [PANELLAYOUT](../apps/web/src/features/reader/lib/reader-panel-layout.ts) [PANELHOOK](../apps/web/src/features/reader/hooks/useReaderPanels.ts) [PANELSERVICE](../apps/web/src/services/reader-panels.ts) [PANELPROOF](../docs/evidence/reader-panel-persistence-2026-09-09.json) [PANELSAPIPROOF](../docs/evidence/reader-panels-2026-09-09.json) [LISTENINGDESK](../plugins/listening-desk/src/views.ts) [WHEELPHASE](../apps/web/src/platform/wheel-phase.ts) [WHEELNATIVE](../apps/desktop/src-tauri/src/wheel_phase.rs) [WHEELPROOF](../docs/evidence/wheel-phase-lifetime-2026-09-09.json) |
| READ11 | 阅读面板尺寸/布局与焦点恢复 / 实装 | 未接：无正式入口 | 未接：无正式入口 | 聊天/目录 resize；阅读焦点；不能用插件任意 DOM 或抢焦点代替 | [S3](#S3) | [WORKSPACE](../apps/web/src/features/reader/components/ReaderWorkspace.tsx) [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) |
| READ12 | 固定版式自动适配；图片缩放/平移/旋转 / 实装 | 未接：无正式入口 | 未接：无正式入口 | 固定版式自动适配；图片灯箱交互；已核对图片灯箱缩放；不把它算作书页手动缩放控件 | [D2](#D2) | [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [ENGINE](../apps/web/foliate-js/src/view.ts) |
| READ13 | 读取/建立/清除文本选区 / 实装 | 部分：自动接收附件，无设置选区工具 | 部分：动作输入有选区，无通用 get/set/clear | 选择菜单；Agent 附件；Dictionary；固定版式的当前产品限制需按格式报告 | [D2](#D2) | [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [ENGINE](../apps/web/foliate-js/src/view.ts) [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) [API](../packages/plugin-types/src/index.ts) |
| READ14 | 临时范围强调/搜索标记及释放 / 引擎 | 未接：无正式入口 | 未接：无正式入口 | 文本单元 wash；引擎选区/overlayer；用户高亮和临时强调分离，不能写 annotation 充当搜索标记 | [D2](#D2) | [ENGINE](../apps/web/foliate-js/src/view.ts) [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [UNITS](../apps/web/src/features/reader/hooks/useTextUnitNavigator.ts) |
| READ15 | 贡献句子/段落等分段模式 / 实装 | 未接：无算法注册工具 | 接通：readerModes 1.1 register(text-unit-navigator)，同步或异步 segmentText | sentence-reader；隔离异步分段探针；每章至多 8 个在途 block，30 秒截止；失败不伪装空章，旧任务/同 index 新 Document 不回写，分段与 relocate 任一先后都能落点。真实 macOS debug 验证延迟/拒绝/退出；不是全内存配额或远端计算取消。只开放分段策略，非任意渲染器/解码器 | [D2](#D2) · [C2](#C2) | [API](../packages/plugin-types/src/index.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [SENTENCE](../plugins/sentence-reader/src/index.ts) [UNITS](../apps/web/src/features/reader/hooks/useTextUnitNavigator.ts) [UNITBUILD](../apps/web/src/features/reader/lib/text-unit-build.ts) [UNITINDEX](../apps/web/src/features/reader/lib/text-unit-index.ts) [UNITPROOF](../docs/evidence/reading-segmentation-2026-09-09.json) |
| READ16 | 启停模式/上下一单元/跟随/回当前 / 实装 | 部分：configure_reading_mode + navigate_reading(return-to-unit/next-unit/previous-unit) | 部分：reading 2.5 configureMode(selectModeKey)/returnToMode/stepMode + session.mode/observeSession | 文本单元工具栏；Agent；Listening Desk 模式/返回/步进；自动朗读；启停、unit 选择、状态与版本化 resting Location 已共享。2.5 新增 availableModes 与 selectModeKey；modeKey 仍是前置条件。保留失效提供者选择，不静默换到其他插件；取消撤回未完成选择，原生和 Listening Desk 均消费同一控制器。配置的书内状态与提供者偏好合并 SQLite 提交，回执等待该请求的精确写 Promise 和首次位置保存；失败保留 db code 并恢复先前选择，偏好回滚不再冒充新意图。配置成功后才派发匹配 revision/key/unit 的位置写，旧失败不污染新请求。步进从 resting 而非离开的 viewport 继续，跨空节/跳过非线性节，实际页面、分段、React 反馈和目标位置 SQLite 提交后返回 moved/start-of-book/end-of-book；不新增跳转历史。返回同样等待目标位置保存，成功才记历史。保存失败保留 db code；下一次明确动作可重试，同目标重写仍等最新回执。mode.ready 只表示索引完成，不表示已保存；位置/内容版本变化及退出取消等待。模式变更/新导航/取消阻止迟到成功，但不撤销已发生的页面移动；取消不是全部已提交提供者偏好的事务撤销。恢复校验 book/contentVersion/modeKey/unitId 并重解 CFI，不钳制旧 ordinal；无版本旧地址丢弃。隔离 macOS 已验正常/慢分段跨节、拒绝、取消、两端 SQLite 故障和恢复；空节/非线性与其他格式仍需补桌面证据。仍缺跟随；旧偏好迁移已并入配置原子提交，读设置无写副作用、既有值优先、不同提供者保留原记录；删除旧记录失败时两端收到 db code，三条记录均保留，重试可恢复。跨提供者取消补偿未闭合，短时 sessionTimer 不要求耐久调度 | [D2](#D2) · [C2](#C2) | [MODECONTROL](../apps/web/src/features/reader/lib/reading-mode-controller.ts) [MODEOWNER](../apps/web/src/features/reader/hooks/useReadingModeControl.ts) [UNITS](../apps/web/src/features/reader/hooks/useTextUnitNavigator.ts) [WORKSPACE](../apps/web/src/features/reader/components/ReaderWorkspace.tsx) [SHORTCUT](../apps/web/src/features/settings/lib/shortcuts.ts) [MODESTATE](../apps/web/src/features/reader/lib/text-unit-mode-state.ts) [MODETIMER](../apps/web/src/features/reader/hooks/useSessionTimer.ts) [MODEPROOF](../docs/evidence/reading-mode-2026-09-09.json) [MODERETURN](../docs/evidence/reading-mode-return-2026-09-09.json) [MODESTEP](../docs/evidence/reading-mode-step-2026-09-09.json) [MODEDURABILITY](../docs/evidence/reading-mode-durability-2026-09-09.json) [POSITIONDURABILITY](../docs/evidence/reading-position-durability-2026-09-09.json) [MODEMIGRATION](../docs/evidence/reading-mode-migration-2026-09-09.json) |
| READ17 | 列声音并合成音频的提供者 / 实装 | 部分：update_settings 可改 TTS 非敏感设置 | 接通：voiceProviders.register/listVoices/synthesize | tts；宿主系统语音回退；Agent 不能借设置接口声称已经触发朗读 | [D2](#D2) · [C3](#C3) | [TTS](../plugins/tts/src/index.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [API](../packages/plugin-types/src/index.ts) [AUDIO](../apps/web/src/features/reader/hooks/useReadAloud.ts) |
| READ18 | 开始/停止朗读、播放位置与 fallback 状态 / 实装 | 接通：control_read_aloud + get_reading_session.playback | 接通：reading 2.1 controlPlayback + session.playback/observeSession | 文本单元朗读按钮；Agent；Listening Desk；实际音频开始才回执；owner 取消/切书阻断迟到合成，系统 fallback 与单元 CFI 可观察。自动朗读消费公共 stepMode，等待真实下一单元才播，end-of-book 正常停止；单元位置保存失败停止自动朗读并保留 db code，不继续播下一段。停止/换声源取消在途步进，不被本次 React 落点反馈自我取消。35s advance 截止覆盖 30s 导航，不再用 6s 超时猜书尾。隔离 macOS Tauri 已验证；未验 release/Windows/Linux/远端 TTS。非逐字播放时间/暂停恢复。Listening Desk 为按需刷新快照。 | [D2](#D2) · [C3](#C3) | [PLAYBACK](../apps/web/src/features/reader/lib/read-aloud-controller.ts) [AUDIO](../apps/web/src/features/reader/hooks/useReadAloud.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [API](../packages/plugin-types/src/index.ts) [LISTENINGDESK](../plugins/listening-desk/src/views.ts) [PLAYBACKPROOF](../docs/evidence/reading-playback-2026-09-09.json) [MODESTEP](../docs/evidence/reading-mode-step-2026-09-09.json) [POSITIONDURABILITY](../docs/evidence/reading-position-durability-2026-09-09.json) |
| READ19 | 完成页、标记读完/撤销读完 / 实装 | 接通：update_book.finished | 接通：reading.commands.setFinished | 完成页；书架；Agent；状态写接通；导航到完成页是另一个呈现行为 | [D2](#D2) | [READING](../apps/web/src/domain/reading.ts) [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| READ20 | 跨书/并发导航的取消、序列化与回执 / 部分 | 部分：共享控制器 + Agent AbortSignal + 会话/书籍 guard | 部分：共享控制器 + 实例停用取消 + Promise 回执 | 两端 API 与部分 UI 跳转；新意图淘汰旧请求，同引擎串行、不同引擎互不阻塞，30s 截止；引擎本身无逐次 abort，插件尚无单次导航取消句柄；不能关闭完整 GAP | [D2](#D2) · [Q2](#Q2) | [READTOOLS](../packages/agent/src/tools/reader-tools.ts) [NAV](../apps/web/src/domain/reading-session-controller.ts) [NAVTEST](../apps/web/src/domain/reading-session-controller.test.ts) [NAVADAPTER](../apps/web/src/features/reader/lib/reading-engine-adapter.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) |
| ANN01 | 列出/按书按词按类型检索标注 / 实装 | 接通：get_annotations → 原生 keyset page；kind/query 过滤 | 接通：annotations.queries.list/page | 阅读注释；全局 Agent 注释；Agent；Annotation Desk；模型结果统一为 items/nextCursor/consistency；书内默认当前书、显式其他书沿用现有检索规则。Annotation Desk 使用每页 20 条的原生分页，筛选重置游标，不扫描全部标注。插件 legacy list 保留；分页契约见 ANN08 | [D3](#D3) | [ANNOT](../apps/web/src/domain/annotations.ts) [ANNDB](../apps/web/src/features/annotations/lib/annotation-db.ts) [LIBTOOLS](../packages/agent/src/tools/library-tools.ts) [ANNPORT](../apps/web/src/features/ai/agent/ports/annotations-port.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [DESK](../plugins/annotation-desk/src/views.ts) |
| ANN02 | 创建高亮 / 实装 | 接通：create_annotation(kind=highlight) | 接通：annotations.commands.createHighlight | 选择菜单；Agent；来源与 Range 校验仍受 TXT13 限制 | [D3](#D3) | [ANNOT](../apps/web/src/domain/annotations.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) |
| ANN03 | 创建下划线样式 / 实装 | 接通：create_annotation(style=underline) → 共享命令 | 接通：createHighlight(style=underline) | 选择菜单；Agent；桌面 Worker 探针；style 经 tool/port/事件持久化及 Worker 查询保真；默认 highlight，非法 style 拒绝。实机已验收落盘和回读，不代表锚定下划线的全部格式视觉验收 | [D3](#D3) | [ANNOT](../apps/web/src/domain/annotations.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [ANNPORT](../apps/web/src/features/ai/agent/ports/annotations-port.ts) [ANNPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-annotation-probe.ts) [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) [API](../packages/plugin-types/src/index.ts) |
| ANN04 | 高亮改色/删除 / 实装 | 接通：edit_annotation(expectedRevision) / delete_annotation+版本绑定批准 / apply_annotation_changes | 接通：recolorHighlight/removeHighlight；applyChanges 条件改色/样式/删除 | 标注菜单；Agent；Annotation Desk；桌面 Worker；新版 applyChanges 可同时改 color/style；Annotation Desk 用此接口批量改色/样式及确认删除。旧单项命令仍无调用者版本条件。高亮原文修改不开放 | [D3](#D3) | [ANNOT](../apps/web/src/domain/annotations.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [ANNBATCHTOOL](../packages/agent/src/tools/annotation-batch-tool.ts) [ANNMUTATIONS](../apps/desktop/src-tauri/src/storage/annotation_mutations.rs) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [DESKBATCH](../plugins/annotation-desk/src/batch.ts) |
| ANN05 | 创建/编辑/删除笔记 / 实装 | 接通：create/edit/delete_annotation | 接通：createNote/updateNote/removeNote；applyChanges 条件写 | NoteEditor；Agent；Annotation Desk 编辑/删除；可无位置笔记；Annotation Desk 不创建笔记。删除 Agent 批准和插件授权不是同一种策略 | [D3](#D3) | [ANNOT](../apps/web/src/domain/annotations.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [DESK](../plugins/annotation-desk/src/views.ts) |
| ANN06 | 读取/删除 ask 问题轨迹 / 实装 | 接通：get_annotations / delete_annotation+批准 | 接通：annotations v1.1 queries.get/list + commands.removeAsk | Agent；注释视图；隔离桌面 Worker；写权限包含受控删除，read 不导出 commands，createAsk 仍不开放。缺失/错误类型返回 annotations/not-found；实际 Agent 批准端口拒绝保留、批准删除已测，未代替聊天批准 UI 验收 | [D3](#D3) | [ANNOT](../apps/web/src/domain/annotations.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [ANNPORT](../apps/web/src/features/ai/agent/ports/annotations-port.ts) [ANNPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-annotation-probe.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| ANN07 | 自动记录书内问题轨迹 / 实装 | 自动：thread 轮末 recordAsk → createAsk | 未接：createAsk 为 agent-only | 书内 Agent；自动行为不算模型可以任意调用的写工具 | [D3](#D3) | [ANNOT](../apps/web/src/domain/annotations.ts) [THREAD](../packages/agent/src/runtime/thread.ts) [PORTS](../apps/web/src/features/ai/agent/ports/index.ts) |
| ANN08 | 按 ID 读取、分页、批量/版本冲突标注操作 / 部分 | 部分：get_annotations 精确查询附 revision；edit/delete 走 CAS；apply_annotation_changes 原子批次 | 部分：annotations v1.3 queries.get/page/inspect + commands.applyChanges | Agent 查询/条件修改/批准删除；Annotation Desk；桌面 Worker；分页 1–100 行、默认 20，live 非冻结快照。inspect 给本机版本令牌；applyChanges 对 1–100 个不同现有对象先验所有版本，再同一事务提交事件/投影/outbox，任一失败全回滚。支持笔记正文、高亮颜色/样式、三类删除。Annotation Desk 实机验证新鲜批次保存、过期批次不改任何项、冲突保留草稿；原生双连接同版本仅一方成功。旧单项命令/UI 未迁 CAS，离线跨设备仍沿用同步合并；超长读结果预算、Range 校验和远端失效仍未完成 | [D3](#D3) | [ANNDB](../apps/web/src/features/annotations/lib/annotation-db.ts) [ANNPAGES](../apps/desktop/src-tauri/src/storage/annotation_pages.rs) [ANNOT](../apps/web/src/domain/annotations.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [ANNBATCHTOOL](../packages/agent/src/tools/annotation-batch-tool.ts) [LIBTOOLS](../packages/agent/src/tools/library-tools.ts) [ANNMUTATIONS](../apps/desktop/src-tauri/src/storage/annotation_mutations.rs) [ANNMUTATIONPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-annotation-mutation-probe.ts) [API](../packages/plugin-types/src/index.ts) [DESKBATCH](../plugins/annotation-desk/src/batch.ts) [DESKPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-annotation-desk.ts) |
| ANN09 | 标注变化与远端失效观察 / 部分 | 自动：每轮读快照，不订阅工具 | 部分：annotations.events.subscribe | 宿主注释 revision；GAP09/GAP11；同步投影变化不等同本地领域广播 | [D3](#D3) | [EVENTROSTER](../apps/web/src/domain/events.ts) [EVENTS](../apps/web/src/platform/domain-events.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [SYNC](../apps/web/src/platform/sync/sync-scheduler.ts) |
| STAT01 | 单书/全库/总览已结算阅读统计 / 实装 | 接通：get_reading_stats | 接通：reading.queries.stats.forBook/list/overview | StatsWorkspace；Agent；已结算持久数据与当前会话 scratch 必须区分 | [D2](#D2) | [READING](../apps/web/src/domain/reading.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| STAT02 | 周月年/连续阅读/热图/时段/成就派生 / 实装 | 部分：get_reading_stats 格式化时长/活跃天等 | 部分：daily 可派生；BookStats 无小时分布 | 统计页；不是每一种图表都要新 host API；小时分布不是 daily 可以还原的数据 | [D2](#D2) | [STATS](../apps/web/src/features/stats/lib/reading-insights.ts) [STATUI](../apps/web/src/features/stats/components/StatsWorkspace.tsx) [READING](../apps/web/src/domain/reading.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) |
| STAT03 | 当前未结算时长/会话及精确观察时钟 / 实装 | 未接：无正式入口 | 未接：无正式入口 | 阅读计时与退出 flush；已有 reading_sessions_pending IPC，不在 Agent/插件统计读模型 | [D2](#D2) | [TIME](../apps/web/src/platform/reading-session.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) [READING](../apps/web/src/domain/reading.ts) |
| STAT04 | 计时/位置累积、小时结算和重启恢复 / 实装 | 未接：宿主自动采集 | 未接：宿主自动采集 | useReadingTimeTracker；底层 accrue/position/flush/import/genesis 不是插件写权限 | [D2](#D2) · [Q3](#Q3) | [TIME](../apps/web/src/platform/reading-session.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) |
| STAT05 | book.sessionRecorded 正式事件 / 实装 | 自动：下轮读统计，无模型事件订阅 | 部分：runtime roster 有，public union 无 | 领域订阅实现；公开类型漂移；不能把 legacy timeRecorded 当今天的实际事件 | [D2](#D2) · [Q3](#Q3) | [EVENTROSTER](../apps/web/src/domain/events.ts) [API](../packages/plugin-types/src/index.ts) [COREVENTS](../packages/core/src/events.ts) |
| UI01 | 书架/Agent/统计/设置与集合页面导航 / 实装 | 部分：open_book；present_books 仅书卡 | 部分：openBook；插件自己的 page | 主导航；命令面板；无通用 openSettings/openCollection/goStats；不公开 Router/Jotai | [S3](#S3) | [APP](../apps/web/src/App.tsx) [UI](../apps/web/src/state/ui.ts) [COMMAND](../apps/web/src/features/command/lib/build-commands.tsx) [API](../packages/plugin-types/src/index.ts) |
| UI02 | 书架搜索/布局/排序/分组/多选 / 实装 | 部分：settings 1.3 shelf.layout/group/sort；list_books 查询数据 | 部分：settings 1.3 shelf.* + 已结算 snapshot | 书架；Workspace Profiles；Agent 设置工具；布局/分组/排序已通过共享设置和 KV 回滚接到真实书架；Workspace Profiles 组合快照、私有文档与原子更新。搜索/当前集合/选择集仍未开放；多选不是批量删除授权 | [D5](#D5) · [S3](#S3) | [SHELF](../apps/web/src/features/shelf/lib/shelf-view.ts) [SHELFUI](../apps/web/src/features/shelf/components/Shelf.tsx) [COMMAND](../apps/web/src/features/command/lib/build-commands.tsx) [SHELFSETTINGS](../apps/web/src/domain/settings/shelf-preferences.ts) [WORKSPACEPROFILES](../plugins/workspace-profiles/src/profiles.ts) [WORKSPACEEVIDENCE](../docs/evidence/workspace-profiles-2026-09-09.json) |
| UI03 | 发现/执行宿主命令与可用条件 / 实装 | 未接：无正式入口 | 部分：commands.register 只贡献自己的命令 | 命令面板/快捷键；不能把菜单 ID 或命令 label 当稳定 RPC；需参数 schema、条件、回执 | [C1](#C1) · [S3](#S3) | [COMMAND](../apps/web/src/features/command/lib/build-commands.tsx) [SHORTCUT](../apps/web/src/features/settings/lib/shortcuts.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| UI04 | 快捷键查询、重绑、冲突与重置 / 实装 | 部分：get_settings/update_settings：shortcuts section | 部分：settings 1.5：key-chord 查询/重绑/null 恢复；默认 shortcut 贡献 | 快捷键设置页；Agent；Workspace Profiles 0.2 自身命令重绑；16 个内置、当前注册插件命令及未注册插件遗留覆盖按同一有效 binding 读写，default/override/availability/conflicted/conflicts 可查询；插件路径编码且精确授权，writable 按授权收窄，冲突引用按 read grant 过滤。整批最终态校验允许交换，失败不提交；null 删除覆盖，不表示禁用。实际 macOS 键盘验证 Agent 改搜索、Worker 交换搜索/设置、Workspace 表单改自己的命令并按新键打开；冲突保留表单与绑定并显示本地化稳定错误。原生设置页已统一域写，单项/全部重置等待提交，发出 user 来源事件；只读 atom 不再有直接整表 setter。停用命令遗留覆盖按授权可查/改/清，原生不可用分组可重置，真实 Worker 已验退休后修改与 SQLite 清理。激活冲突已统一裁决：全局、插件、阅读器按同一实时目录暂停所有冲突绑定，不依赖监听/注册顺序；停用或重绑自动恢复。原生页显示冲突，conflicted 保留给授权调用者而冲突路径仍按 grant 隐藏。实机已验搜索/插件重启冲突、正文 iframe 冲突/停用恢复与插件面板不误翻页。仍缺全来源 revision/origin；available 不代表当前焦点可执行。保留部分，不宣称 packaged/跨平台与完整按键路由已验 | [D5](#D5) · [C1](#C1) | [SHORTCUT](../apps/web/src/features/settings/lib/shortcuts.ts) [SHORTUI](../apps/web/src/features/settings/sections/ShortcutsPanel.tsx) [SHORTCUTCATALOG](../apps/web/src/features/settings/lib/shortcut-catalog.ts) [SHORTCUTSETTINGS](../apps/web/src/domain/settings/shortcut-preferences.ts) [SHORTCUTPROOF](../docs/evidence/keyboard-shortcuts-2026-09-09.json) [SHORTCUTEDITOR](../apps/web/src/features/settings/hooks/useShortcutPreferences.ts) [SHORTCUTEDITORPROOF](../docs/evidence/shortcut-editor-2026-09-09.json) [SHORTCUTDISPATCH](../apps/web/src/features/settings/lib/shortcut-dispatch.ts) [SHORTCUTDISPATCHPROOF](../docs/evidence/shortcut-dispatch-2026-09-09.json) [API](../packages/plugin-types/src/index.ts) |
| UI05 | 菜单可见/溢出位置及自定义重排 / 实装 | 接通：get_settings/update_settings menus.* | 接通：settings domain menus.* 按路径授权 | 菜单设置；插件 header/selection；可改布局不代表可调用菜单动作；具体 8 个路径另逐项列出 | [D5](#D5) · [C1](#C1) | [MENU](../apps/web/src/features/menus/lib/menu-registry.tsx) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) |
| CFG01 | 设置 discover/read/update 与动态选项 / 实装 | 接通：get_settings/update_settings；等待本地事务提交 | 接通：settings 1.5 snapshot/discover/read/update；原子保存与授权结果 | Agent；Theme Schedule；TTS options；Workspace Profiles；snapshot 等待此前命令/UI 写结算后一次读取，按路径授权过滤；单个命令跨 KV 记录原子提交；失败不发 settings.changed，下一命令基于已结算状态；结果快照按 read/write grant 过滤，writable 反映当前 actor 授权，discover 不泄露快捷键运行态。事务不包含密钥、远端漫游提交或尚未接通的效果；设置 API 接通不证明值有消费者 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [KV](../apps/web/src/platform/local-store.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) |
| CFG02 | 全局/本书/全书阅读设置覆盖 / 实装 | 接通：update_settings target | 接通：settings.commands.update target | AppearancePanel；Agent；all-books 写全局并更新 overrides，不等于清除所有覆盖 | [D5](#D5) · [V2](#V2) | [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [OVERRIDES](../apps/web/src/features/settings/lib/reader-overrides.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) |
| CFG03 | 清除覆盖/恢复默认/查询值来源 / 实装 | 未接：无正式入口 | 未接：无正式入口 | 阅读外观设置；当前 update 不能表达 inherit/delete override；不是写默认值可替代 | [D5](#D5) · [V2](#V2) | [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) [OVERRIDES](../apps/web/src/features/settings/lib/reader-overrides.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) |
| CFG04 | 阅读对齐 reading.textAlign / 实装 | 接通：get_settings/update_settings | 接通：settings 1.2；显式 global/book/all-books | 阅读设置/渲染；book/start/justify；与阅读外观同一覆盖规则，不是另造 CSS 接口 | [D5](#D5) · [V2](#V2) | [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) |
| CFG05 | 固定版式颜色 reading.fixedLayoutColor / 实装 | 接通：get_settings/update_settings | 接通：settings 1.2；显式 global/book/all-books | 固定版式外观；theme/original；不是 reading.theme 的同义项；仅固定版式内容消费 | [D5](#D5) · [V2](#V2) | [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) |
| CFG06 | 更新内容弹窗 general.whatsNewDialog / 实装 | 接通：get_settings/update_settings | 接通：settings 1.2；全局布尔字段 | GeneralPanel / useWhatsNewDialog；控制后续升级说明提示，不是立即打开更新弹窗或安装更新 | [D5](#D5) · [V2](#V2) | [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) [WHATSNEW](../apps/web/src/features/update/hooks/useWhatsNewDialog.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) |
| CFG07 | AI 提供商/端点/密钥配置 / 实装 | 部分：只读 provider/credentialConfigured；无密钥 | 部分：受权读非敏感存在状态；无宿主 key | AIConfigPanel；不开放：读取宿主密钥；不能把 readonly provider 算作可切换提供商 | [D5](#D5) · [S2](#S2) · [S3](#S3) · [V2](#V2) | [AICONFIG](../apps/web/src/features/ai/lib/ai-config.ts) [AICONFIGUI](../apps/web/src/features/settings/components/AIConfigPanel.tsx) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SECRETS](../apps/web/src/platform/secret-store.ts) |
| CFG08 | 模型目录刷新、连接测试与模型能力 / 实装 | 部分：设置 discover 给模型选项 | 部分：settings discover 动态选项 | AI 配置页；选择已缓存模型不等于能刷新/测试连接 | [D5](#D5) · [S3](#S3) · [S6](#S6) · [V2](#V2) | [MODELCATALOG](../apps/web/src/features/ai/lib/model-catalog.ts) [AICONFIGUI](../apps/web/src/features/settings/components/AIConfigPanel.tsx) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) |
| CFG09 | 插件非敏感设置的动态路径 / 实装 | 接通：plugins.<id>.<field> get/update_settings | 接通：自有路径默认授权；他者路径需 grant | TTS/RSS/Theme Schedule 等；插件启用/声明决定目录；secret/password 字段不暴露；配置不等于执行插件命令 | [D5](#D5) · [C1](#C1) · [V2](#V2) | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) |
| CFG10 | 设置变化事件/外部写入刷新 / 部分 | 自动：每次读当前目录/值；持久失败向工具拒绝 | 部分：提交事件 + KV 镜像/回滚失效通知 | Theme Schedule；插件设置视图；通用设置记录、书架布局/分组/排序、快捷键与菜单 base atom 跟随 KV，插件表单/模式/提供者订阅覆盖声明设置回滚；失效通知在 Worker 镜像观察之后分发。GAP03/09/11 仍缺全来源带 revision/origin 的领域广播、所有 UI 编辑草稿与异步效果验收；不是关闭完整 GAP | [D5](#D5) · [V2](#V2) · [Q3](#Q3) | [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [WORKER](../apps/web/src/features/plugins/runtime/plugin-sandbox.worker.ts) [KV](../apps/web/src/platform/local-store.ts) |
| CFG11 | 聊天/笔记内容字体：跟随阅读或独立字号/字体/行距 / 实装 | 接通：appearance.contentTypography.* | 接通：settings 1.2；四个全局字段 | AppearancePanel；聊天、笔记、插件 Markdown 与 composer；followReader/fontFamily/fontSize/lineSpacing；跟随全局 reader 而非本书 override；fontFamily=null 为应用字体，独立字段只在 followReader=false 生效；base atom 跟随 KV 回滚 | [D5](#D5) · [V2](#V2) | [TYPOGRAPHY](../apps/web/src/features/settings/lib/content-typography.ts) [TYPOGRAPHYUI](../apps/web/src/features/settings/sections/AppearancePanel.tsx) [TYPOGRAPHYEFFECT](../apps/web/src/features/settings/hooks/useContentTypography.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) |
| CFG12 | 新标注默认颜色 / 实装 | 接通：annotations.defaultColor | 接通：settings 1.2；annotations section | 一键高亮/下划线；recolor 更新后续默认色；yellow/green/blue/pink，默认 yellow；宿主动作即时读取当前偏好，不再捕获挂载时颜色；不重染已有标注 | [D5](#D5) · [V2](#V2) | [MARKPREFS](../apps/web/src/features/annotations/lib/annotation-prefs.ts) [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) |
| CFG13 | 软件更新通道 stable/beta / 实装 | 接通：general.updateChannel | 接通：settings 1.2；全局枚举字段 | AboutPanel；软件更新查询；设备本地且不漫游；已打开 About 控件跟随 KV 更新/回滚；修改通道只影响后续检查，不批准下载、安装或重启 | [D5](#D5) · [V2](#V2) | [UPDATECHANNEL](../apps/web/src/features/update/lib/update-channel.ts) [ABOUT](../apps/web/src/features/settings/sections/AboutPanel.tsx) [UPDATE](../apps/web/src/features/update/lib/software-update.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) |
| SET01 | general.startView / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) |
| SET02 | general.language / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) |
| SET03 | general.crashPrompt / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) |
| SET04 | general.launchAtStartup / 部分 | 部分：get_settings/update_settings | 部分：settings discover/read/update（需路径授权） | 仅设置页/设置存储/目录；效果未接；保存值有实现；全生产源码扫描未找到对应效果消费者。不能算行为已实现或端到端覆盖。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) |
| SET05 | general.fileAssociations / 部分 | 部分：get_settings/update_settings | 部分：settings discover/read/update（需路径授权） | 仅设置页/设置存储/目录；效果未接；保存值有实现；全生产源码扫描未找到对应效果消费者。不能算行为已实现或端到端覆盖。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) |
| SET06 | general.autoUpdate / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；实际消费者只控制自动检查，不表示无批准自动安装。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) |
| SET07 | appearance.theme / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET08 | appearance.motion / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET09 | reading.theme / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) |
| SET10 | reading.fontFamily / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) |
| SET11 | reading.fontSize / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) |
| SET12 | reading.fontWeight / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) |
| SET13 | reading.lineSpacing / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) |
| SET14 | reading.paragraphSpacing / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) |
| SET15 | reading.pageMargins / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) |
| SET16 | reading.readingMode / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) |
| SET17 | reading.fixedLayoutReadingMode / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) |
| SET18 | ai.preferences.features.explainSelection / 部分 | 部分：get_settings/update_settings | 部分：settings discover/read/update（需路径授权） | 仅设置页/设置存储/目录；效果未接；保存值有实现；全生产源码扫描未找到对应效果消费者。不能算行为已实现或端到端覆盖。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [AIPREFS](../apps/web/src/features/settings/lib/ai-preferences.ts) |
| SET19 | ai.preferences.features.defineTerm / 部分 | 部分：get_settings/update_settings | 部分：settings discover/read/update（需路径授权） | 仅设置页/设置存储/目录；效果未接；保存值有实现；全生产源码扫描未找到对应效果消费者。不能算行为已实现或端到端覆盖。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [AIPREFS](../apps/web/src/features/settings/lib/ai-preferences.ts) |
| SET20 | ai.preferences.features.translate / 部分 | 部分：get_settings/update_settings | 部分：settings discover/read/update（需路径授权） | 仅设置页/设置存储/目录；效果未接；保存值有实现；全生产源码扫描未找到对应效果消费者。不能算行为已实现或端到端覆盖。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [AIPREFS](../apps/web/src/features/settings/lib/ai-preferences.ts) |
| SET21 | ai.preferences.features.summarizeChapter / 部分 | 部分：get_settings/update_settings | 部分：settings discover/read/update（需路径授权） | 仅设置页/设置存储/目录；效果未接；保存值有实现；全生产源码扫描未找到对应效果消费者。不能算行为已实现或端到端覆盖。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [AIPREFS](../apps/web/src/features/settings/lib/ai-preferences.ts) |
| SET22 | ai.preferences.features.askConversation / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [AIPREFS](../apps/web/src/features/settings/lib/ai-preferences.ts) |
| SET23 | ai.preferences.buildMemory / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；实时控制宿主记忆构建：显式 remember、轮后抽取/强化/插件候选/旧历史领养/摘要、巩固、章节 digest/自动叙事分类及 onboarding seed 均受约束。关闭返回 ai/memory-disabled，取消在途模型调用和已排队任务，重开不复活旧任务。普通聊天/历史、旧记忆检索、用户删除和插件自有目标保存不受影响；重开后的新任务可处理保留历史。摘要写入/清除等待持久回执；已派发底层写不保证撤销。隔离 macOS debug 双端、真实 UI 聊天、候选入库、取消和 SQLite 失败已验；packaged/跨平台未验。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MEMORYPOLICY](../packages/agent/src/memory/build-policy.ts) [HOSTMEMORYPOLICY](../apps/web/src/features/ai/agent/memory-policy.ts) [READINGGOALS](../plugins/reading-goals/src/index.ts) [MEMORYPOLICYPROOF](../docs/evidence/memory-build-policy-2026-09-09.json) |
| SET24 | ai.preferences.sendHighlightedText / 部分 | 部分：get_settings/update_settings | 部分：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；已有真实 Agent 消费者：selection 关闭过滤自动附件与历史附件检索/匹配；任一文本开关关闭都移除可能重叠的 viewport；surrounding 关闭不装配 grounding。保留本地附件和手写问题，get_reading_session 同样过滤文本；切策略重建缓存上下文。收紧返回 ai/context-changed，取消在途/准备中回合和排队记忆任务，重开不复活旧请求。Agent 设置与授权 Worker 设置写入、四组合请求、SQLite 历史保留和在途传输取消已在隔离 macOS debug 验证。LLM 1.1 readingContext 已将结构化正文纳入同一过滤/取消，Dictionary 1.3 已迁移，必需字段被禁止时报 ai/context-withheld；双端三模式四组合、实际缓存/拒绝、重试及三并发取消有桌面证据。插件本地 selection/lookup 回调、任意自行组装 prompt/HTTP/TTS、独立正文/标注检索与旧回答/记忆/纪要不因此清除或禁用；完整隐私、packaged/跨平台仍未闭合，保留部分。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [READINGCONTEXTPOLICY](../packages/agent/src/runtime/reading-context-policy.ts) [HOSTREADINGCONTEXTPOLICY](../apps/web/src/features/ai/agent/reading-context-policy.ts) [READINGCONTEXTPROOF](../docs/evidence/reading-context-policy-2026-09-09.json) [STRUCTUREDREADING](../packages/agent/src/runtime/one-shot.ts) [STRUCTUREDREADINGPROOF](../docs/evidence/structured-reading-context-2026-09-09.json) [THREAD](../packages/agent/src/runtime/thread.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) |
| SET25 | ai.preferences.sendSurroundingContext / 部分 | 部分：get_settings/update_settings | 部分：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；已有真实 Agent 消费者：selection 关闭过滤自动附件与历史附件检索/匹配；任一文本开关关闭都移除可能重叠的 viewport；surrounding 关闭不装配 grounding。保留本地附件和手写问题，get_reading_session 同样过滤文本；切策略重建缓存上下文。收紧返回 ai/context-changed，取消在途/准备中回合和排队记忆任务，重开不复活旧请求。Agent 设置与授权 Worker 设置写入、四组合请求、SQLite 历史保留和在途传输取消已在隔离 macOS debug 验证。LLM 1.1 readingContext 已将结构化正文纳入同一过滤/取消，Dictionary 1.3 已迁移，必需字段被禁止时报 ai/context-withheld；双端三模式四组合、实际缓存/拒绝、重试及三并发取消有桌面证据。插件本地 selection/lookup 回调、任意自行组装 prompt/HTTP/TTS、独立正文/标注检索与旧回答/记忆/纪要不因此清除或禁用；完整隐私、packaged/跨平台仍未闭合，保留部分。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [READINGCONTEXTPOLICY](../packages/agent/src/runtime/reading-context-policy.ts) [HOSTREADINGCONTEXTPOLICY](../apps/web/src/features/ai/agent/reading-context-policy.ts) [READINGCONTEXTPROOF](../docs/evidence/reading-context-policy-2026-09-09.json) [STRUCTUREDREADING](../packages/agent/src/runtime/one-shot.ts) [STRUCTUREDREADINGPROOF](../docs/evidence/structured-reading-context-2026-09-09.json) [THREAD](../packages/agent/src/runtime/thread.ts) [READTOOLS](../packages/agent/src/tools/reader-tools.ts) |
| SET26 | ai.preferences.localOnly / 部分 | 部分：get_settings/update_settings | 部分：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；宿主模型调用已有实时执行策略：Agent smart/fast、后台补全、Worker llm.ask 普通/结构化/流式及连接测试同源拒绝 ai/local-only；进行中调用取消，迟到结果/重试被抑制，恢复只允许新调用。当前无本地模型后端，Custom loopback 也拒绝。隔离 macOS debug 双端/取消/持久失败回滚/原生连接 UI 已验；任意插件 HTTP、TTS、同步不受此策略约束，完整隐私边界与 packaged/跨平台仍未完成，保留部分。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [AIPREFS](../apps/web/src/features/settings/lib/ai-preferences.ts) [INFERENCEPOLICY](../packages/agent/src/models/inference-policy.ts) [HOSTINFERENCEPOLICY](../apps/web/src/features/ai/agent/inference-policy.ts) [INFERENCEEVIDENCE](../docs/evidence/inference-local-only-2026-09-09.json) |
| SET27 | ai.preferences.followStreaming / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [AIPREFS](../apps/web/src/features/settings/lib/ai-preferences.ts) |
| SET28 | ai.connection.configured / 实装 | 接通：get_settings | 接通：settings discover/read（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；只读状态，不返回密钥/端点凭据；不等于配置命令。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET29 | ai.connection.credentialConfigured / 实装 | 接通：get_settings | 接通：settings discover/read（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；只读状态，不返回密钥/端点凭据；不等于配置命令。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET30 | menus.primaryNav.visible / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；只影响菜单排列/显示，不调用菜单动作。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) |
| SET31 | menus.primaryNav.overflow / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；只影响菜单排列/显示，不调用菜单动作。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) |
| SET32 | menus.shelfHeader.visible / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；只影响菜单排列/显示，不调用菜单动作。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) |
| SET33 | menus.shelfHeader.overflow / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；只影响菜单排列/显示，不调用菜单动作。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) |
| SET34 | menus.readerHeader.visible / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；只影响菜单排列/显示，不调用菜单动作。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) |
| SET35 | menus.readerHeader.overflow / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；只影响菜单排列/显示，不调用菜单动作。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) |
| SET36 | menus.selection.visible / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；只影响菜单排列/显示，不调用菜单动作。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) |
| SET37 | menus.selection.overflow / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；只影响菜单排列/显示，不调用菜单动作。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MENUSTATE](../apps/web/src/features/menus/state/menu-config.ts) |
| SET38 | ai.connection.provider / 实装 | 接通：get_settings | 接通：settings discover/read（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；只读状态，不返回密钥/端点凭据；不等于配置命令。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET39 | ai.connection.primaryModel / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET40 | ai.connection.fastModel / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET41 | ai.connection.thinkingLevel / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET42 | ai.connection.fastThinkingLevel / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET43 | ai.connection.custom.endpointConfigured / 实装 | 接通：get_settings | 接通：settings discover/read（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；只读状态，不返回密钥/端点凭据；不等于配置命令。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET44 | ai.connection.custom.api / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET45 | ai.connection.custom.supportsThinking / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET46 | ai.connection.custom.maxOutputTokens / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET47 | reading.textAlign / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) |
| SET48 | reading.fixedLayoutColor / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [PREFS](../apps/web/src/features/settings/lib/reader-settings.ts) |
| SET49 | general.whatsNewDialog / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [GENERAL](../apps/web/src/features/settings/lib/general-settings.ts) |
| SET50 | appearance.contentTypography.followReader / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [TYPOGRAPHY](../apps/web/src/features/settings/lib/content-typography.ts) [TYPOGRAPHYEFFECT](../apps/web/src/features/settings/hooks/useContentTypography.ts) |
| SET51 | appearance.contentTypography.fontFamily / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [TYPOGRAPHY](../apps/web/src/features/settings/lib/content-typography.ts) [TYPOGRAPHYEFFECT](../apps/web/src/features/settings/hooks/useContentTypography.ts) |
| SET52 | appearance.contentTypography.fontSize / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [TYPOGRAPHY](../apps/web/src/features/settings/lib/content-typography.ts) [TYPOGRAPHYEFFECT](../apps/web/src/features/settings/hooks/useContentTypography.ts) |
| SET53 | appearance.contentTypography.lineSpacing / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [TYPOGRAPHY](../apps/web/src/features/settings/lib/content-typography.ts) [TYPOGRAPHYEFFECT](../apps/web/src/features/settings/hooks/useContentTypography.ts) |
| SET54 | annotations.defaultColor / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [MARKPREFS](../apps/web/src/features/annotations/lib/annotation-prefs.ts) [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) |
| SET55 | general.updateChannel / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UPDATECHANNEL](../apps/web/src/features/update/lib/update-channel.ts) [ABOUT](../apps/web/src/features/settings/sections/AboutPanel.tsx) |
| SET56 | shelf.layout / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET57 | shelf.group / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET58 | shelf.sort / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET59 | shortcuts.search / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET60 | shortcuts.settings / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET61 | shortcuts.new-conversation / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET62 | shortcuts.next-page / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET63 | shortcuts.prev-page / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET64 | shortcuts.next-chapter / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET65 | shortcuts.prev-chapter / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET66 | shortcuts.toggle-controls / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET67 | shortcuts.reader-mode-next-unit / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET68 | shortcuts.reader-mode-prev-unit / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET69 | shortcuts.selection-copy / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET70 | shortcuts.selection-highlight / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET71 | shortcuts.selection-underline / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET72 | shortcuts.selection-add-note / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET73 | shortcuts.selection-look-up / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| SET74 | shortcuts.selection-ask-ai / 实装 | 接通：get_settings/update_settings | 接通：settings discover/read/update（需路径授权） | 设置页；Agent；授权插件可调用（不代表每个插件实际调用）；目录有读写且存在产品消费者；仍受格式、配置、scope、授权与持久化契约约束。 | [D5](#D5) · [V2](#V2) | [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [SETDOMAIN](../apps/web/src/domain/settings/domain.ts) [SETTOOLS](../packages/agent/src/tools/settings-tools.ts) [UI](../apps/web/src/state/ui.ts) |
| AI01 | 读取书内/全局对话及搜索历史 / 实装 | 接通：search_conversation/get_recent_turns | 接通：conversations.queries getBookThread/listThreads/getThread | Agent；聊天历史；插件拿到 transcript 不等于自动得到画像/记忆；当前查询范围和列表量需约束 | [D4](#D4) | [CHATDOMAIN](../apps/web/src/domain/conversations.ts) [CHATPORT](../apps/web/src/features/ai/agent/ports/conversation-port.ts) [CHATTOOLS](../packages/agent/src/tools/conversation-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| AI02 | 创建/切换/清空全局线程和书内聊天 / 实装 | 未接：无正式入口 | 未接：无正式入口 | AgentWorkspace；ChatPanel；clearConversation 已有，但插件 conversations 无 commands；不可伪造 role 消息 | [D4](#D4) | [CHAT](../apps/web/src/features/ai/lib/conversation-store.ts) [AGENTUI](../apps/web/src/features/agent/components/AgentWorkspace.tsx) [CHATCONTROL](../apps/web/src/features/ai/hooks/useBookConversation.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) |
| AI03 | 发送/流式生成/停止/重试聊天回合 / 实装 | 自动：用户回合驱动 thread.run | 部分：llm.ask 是独立推理，不是向聊天发送 | 书内聊天；全局聊天；自动递归对话/伪造用户消息不开放；用户触发的发送和停止需意图契约 | [D4](#D4) | [THREAD](../packages/agent/src/runtime/thread.ts) [CHATCONTROL](../apps/web/src/features/ai/hooks/useBookConversation.ts) [CHATUI](../apps/web/src/features/ai/components/ChatPanel.tsx) [RUNTIME](../packages/agent/src/runtime/runtime.ts) [API](../packages/plugin-types/src/index.ts) |
| AI04 | 提问、选项澄清、批准/拒绝高风险动作 / 实装 | 接通：ask_user + InteractionPort | 部分：表单可收输入，无通用权限批准票据 | Agent question/permission cards；确认 UI 与授权决策分离；插件自画 Yes 按钮不是 host approval | [C4](#C4) · [S3](#S3) · [V1](#V1) · [Q1](#Q1) | [INTERACTION](../packages/agent/src/tools/interaction-tools.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) [API](../packages/plugin-types/src/index.ts) |
| AI05 | Agent 展示可点击书卡与词典卡 / 实装 | 接通：present_books[全局]；插件 tool details.wordCards | 部分：agentTools 固定 word-card details | Agent 书卡；Dictionary 单词卡；工具结果卡与 PluginView 协议不同，不能任意互换 | [C4](#C4) · [S3](#S3) · [V1](#V1) | [PRESENT](../packages/agent/src/tools/present-tools.ts) [EXTOOLS](../apps/web/src/features/plugins/runtime/plugin-tools.ts) [API](../packages/plugin-types/src/index.ts) [DICTTOOLS](../plugins/dictionary/src/agent-tools.ts) |
| AI06 | 一次性文本/结构化/流式 LLM 推理 / 实装 | 自动：Runtime ask + 线程推理 | 接通：services.llm 1.1 ask + readingContext/schema/onText | Dictionary 1.3；Agent 后台管线；readingContext 由宿主过滤并在收紧时取消普通/结构化/流式调用；必需正文被禁止时报 ai/context-withheld，非法结构报 ai/invalid-reading-context。Dictionary 本地缓存仍可读，外发不自行拼接选区。双端四组合、重试、并发取消已有 macOS debug 证据；任意 prompt 不做来源推断。仍无公开 AbortSignal/任务预算/用量回执 | [S6](#S6) | [RUNTIME](../packages/agent/src/runtime/runtime.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [API](../packages/plugin-types/src/index.ts) [DICT](../plugins/dictionary/src/index.ts) [STRUCTUREDREADING](../packages/agent/src/runtime/one-shot.ts) [STRUCTUREDREADINGPROOF](../docs/evidence/structured-reading-context-2026-09-09.json) |
| AI07 | 推理取消、超时、用量/预算/成本可见性 / 部分 | 部分：线程 abort；model API 内部控制 | 部分：ask 无公开取消/用量字段 | 聊天 Stop；模型错误处理；宿主线程停止不是所有插件推理任务的可取消协议 | [S6](#S6) · [Q2](#Q2) | [THREAD](../packages/agent/src/runtime/thread.ts) [RUNTIME](../packages/agent/src/runtime/runtime.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) |
| AI08 | 书内 scope/游标/选区自动 grounding / 实装 | 自动：thread + grounding-context | 部分：context/retrieval provider 能补充，不能覆写核心 | 书内 Agent；自动注入不等于独立工具；不允许插件注入更高优先级系统策略 | [C4](#C4) | [THREAD](../packages/agent/src/runtime/thread.ts) [GROUND](../packages/agent/src/runtime/grounding-context.ts) [EXTOOLS](../apps/web/src/features/plugins/runtime/plugin-tools.ts) |
| AI09 | 剧透边界、请求允许超前内容 / 实装 | 接通：read_chapter/search_book_text/query_book_graph + 批准 | 部分：book text domain 无同样的模型剧透审批 | 书内 Agent；访问权限不是剧透许可；插件提供上下文需要 provenance/fence 政策 | [C4](#C4) · [Q1](#Q1) | [SPOILER](../packages/agent/src/tools/spoiler-permission.ts) [TEXTTOOLS](../packages/agent/src/tools/book-text-tools.ts) [GRAPHTOOLS](../packages/agent/src/tools/graph-tools.ts) [LIB](../apps/web/src/domain/library.ts) |
| AI10 | 注册供模型使用的插件工具 / 实装 | 扩展：extraTools(scope) 进入真实 registry | 接通：agentTools.register | Dictionary 3 个；RSS 3 个；插件安装/启用后才存在；不能将拥有插件 UI 视为已经有 Agent 工具 | [C4](#C4) | [REGISTRY](../packages/agent/src/tools/registry.ts) [PORTS](../apps/web/src/features/ai/agent/ports/index.ts) [EXTOOLS](../apps/web/src/features/plugins/runtime/plugin-tools.ts) [DICTTOOLS](../plugins/dictionary/src/agent-tools.ts) [RSSTOOLS](../plugins/rss-reader/src/agent-tools.ts) |
| AI11 | 每轮上下文 provider / 实装 | 自动：plugin context provider 注入线程 | 接通：agentContextProviders.register | Reading Goals 按请求书籍 scope 提供阅读目标；真实 Worker 到受控推理服务已验；没有专属目标编辑工具，不等于任意上下文语义已验收 | [C4](#C4) | [EXTOOLS](../apps/web/src/features/plugins/runtime/plugin-tools.ts) [THREAD](../packages/agent/src/runtime/thread.ts) [API](../packages/plugin-types/src/index.ts) [READINGGOALS](../plugins/reading-goals/src/index.ts) [MEMORYPOLICYPROOF](../docs/evidence/memory-build-policy-2026-09-09.json) |
| AI12 | 按需插件检索 provider / 实装 | 扩展：自动生成 retrieve 工具 | 接通：agentRetrievalProviders.register | Dictionary saved-vocabulary；名称隔离/限量由 adapter 控制；查询结果不是可信指令 | [C4](#C4) | [EXTOOLS](../apps/web/src/features/plugins/runtime/plugin-tools.ts) [DICTTOOLS](../plugins/dictionary/src/agent-tools.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) |
| MEM01 | 查询长期记忆 / 实装 | 接通：search_memory | 未接：无正式入口 | Agent；没有 plugin memory domain；不能用 conversation 查询冒充记忆读取 | [D6](#D6) | [MEMTOOLS](../packages/agent/src/tools/memory-tools.ts) [MEMORYPORT](../apps/web/src/features/ai/agent/ports/memory-port.ts) [PORTS](../apps/web/src/features/ai/agent/ports/index.ts) [API](../packages/plugin-types/src/index.ts) |
| MEM02 | 显式记住事实/偏好 / 实装 | 接通：remember | 部分：只能贡献 memory candidates | Agent；不开放：插件直接写记忆投影或伪造强化次数 | [D6](#D6) · [C4](#C4) | [MEMTOOLS](../packages/agent/src/tools/memory-tools.ts) [MEMORYPORT](../apps/web/src/features/ai/agent/ports/memory-port.ts) [API](../packages/plugin-types/src/index.ts) |
| MEM03 | 轮后抽取/去重/强化记忆 / 实装 | 自动：thread 轮后抽取与 reinforce | 部分：memoryCandidateProviders.propose | Agent 后台；Reading Goals 用户选择后提议书内偏好；buildMemory 已约束抽取/强化/候选/摘要/巩固/digest；关闭取消在途和排队任务，重开只允许新任务。候选只经宿主裁决写入，不开放投影写；候选接受/拒绝的公共可观察回执仍缺，故插件保持部分。保留旧记忆和聊天；提交前已派发写不承诺撤销。 | [D6](#D6) · [C4](#C4) | [THREAD](../packages/agent/src/runtime/thread.ts) [MEMORYPORT](../apps/web/src/features/ai/agent/ports/memory-port.ts) [API](../packages/plugin-types/src/index.ts) [MEMORYPOLICY](../packages/agent/src/memory/build-policy.ts) [READINGGOALS](../plugins/reading-goals/src/index.ts) [MEMORYPOLICYPROOF](../docs/evidence/memory-build-policy-2026-09-09.json) |
| MEM04 | 记忆巩固、修订/替代/遗忘 / 实装 | 自动：maintenance → consolidateIfNeeded → applyMemoryChanges | 未接：无正式入口 | 空闲维护；不能沿用旧说明声称全部 consolidation 未实现；模型无独立遗忘工具 | [D6](#D6) | [MAINT](../apps/web/src/features/ai/agent/maintenance.ts) [CONSOLIDATE](../packages/agent/src/memory/consolidation.ts) [MEMORYPORT](../apps/web/src/features/ai/agent/ports/memory-port.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) |
| MEM05 | 用户反馈记忆质量/纠错 / 部分 | 内部：memory.feedback 事件/投影，未注册工具 | 未接：无正式入口 | 历史 genesis 回填；未见当前反馈 UI 入口；事件与投影存在不代表用户/Agent 可以触发；需来源与撤销语义 | [D6](#D6) | [COREVENTS](../packages/core/src/events.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) [MEMTOOLS](../packages/agent/src/tools/memory-tools.ts) |
| MEM06 | 读取用户画像并注入上下文 / 实装 | 自动：ProfilePort.read → thread prompt | 未接：无正式入口 | Agent system prompt；画像当前存 localKV；不是 profile.updated 的成熟投影 | [D6](#D6) | [PROFILEPORT](../apps/web/src/features/ai/agent/ports/profile-port.ts) [THREAD](../packages/agent/src/runtime/thread.ts) [PORTS](../apps/web/src/features/ai/agent/ports/index.ts) |
| MEM07 | Onboarding 访谈写入画像 / 部分 | 内部：onboarding.ts seed 可写端口；未见产品调用 | 未接：无正式入口 | 访谈提示词有；独立 seed 仅导出/测试；函数存在不能算完成的访谈→画像闭环 | [D6](#D6) · [B1](#B1) | [ONBOARD](../packages/agent/src/onboarding.ts) [PROFILEPORT](../apps/web/src/features/ai/agent/ports/profile-port.ts) [THREAD](../packages/agent/src/runtime/thread.ts) |
| MEM08 | profile.updated / entity.resolved / entity.merged 投影 / 占位 | 内部：事件类型/端口，并非完整实体整合 | 未接：无正式入口 | apply.rs 接受但返回无投影；宿主自身待实现，不应归为插件 API 单纯漏导出 | [D6](#D6) · [B1](#B1) | [COREVENTS](../packages/core/src/events.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) |
| MEM09 | 叙事性分类/重分类与图谱风格 / 实装 | 自动：digest pipeline 自动分类 | 未接：无正式入口 | 章节 digest 后台管线；narrative 与 expository 的 fence 不同；重分类后旧 flavor 懒重建 | [D6](#D6) | [MAINT](../apps/web/src/features/ai/agent/maintenance.ts) [RUNTIME](../packages/agent/src/runtime/runtime.ts) [COREVENTS](../packages/core/src/events.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) |
| MEM10 | 完成章节摘要、人物/概念图生成与补齐 / 实装 | 自动：digestBook/digestBookCatchUp + idle | 未接：无正式入口 | 阅读后 catch-up；空闲维护；没有公开任务进度/取消/重建入口；不能说只有函数没调用 | [D6](#D6) | [MAINT](../apps/web/src/features/ai/agent/maintenance.ts) [RUNTIME](../packages/agent/src/runtime/runtime.ts) [GRAPHP](../apps/web/src/features/ai/agent/ports/book-memory-port.ts) |
| MEM11 | 检索书内人物/关系/概念图 / 实装 | 接通：query_book_graph | 未接：无正式入口 | Agent；插件缺读图谱领域；原始 chapterDigests 列表不是完整安全查询 | [D6](#D6) | [GRAPHTOOLS](../packages/agent/src/tools/graph-tools.ts) [GRAPHP](../apps/web/src/features/ai/agent/ports/book-memory-port.ts) [API](../packages/plugin-types/src/index.ts) |
| MEM12 | 跨对话 insights 与滚动摘要 / 实装 | 接通：get_conversation_insights[全局]；rolling summary 自动 | 部分：可读 transcript，无 insights/summary 正式 API | 全局 Agent；长对话；不能将可重读对话当作已有相同摘要/洞见 | [D4](#D4) | [CHATTOOLS](../packages/agent/src/tools/conversation-tools.ts) [THREAD](../packages/agent/src/runtime/thread.ts) [CHATPORT](../apps/web/src/features/ai/agent/ports/conversation-port.ts) |
| MEM13 | 可版本化导出 context bundle / 待建 | 未接：无正式入口 | 未接：无正式入口 | 无正式 context bundle 产品能力；这是既定方向，不是已存在宿主能力；备份 JSON 不是 context bundle | [D6](#D6) · [B1](#B1) | [API](../packages/plugin-types/src/index.ts) [PORTS](../apps/web/src/features/ai/agent/ports/index.ts) [RUNTIME](../packages/agent/src/runtime/runtime.ts) [BACKUP](../apps/web/src/features/settings/lib/backup-io.ts) |
| EXT01 | 选择菜单动作/lookup/标注入口 / 实装 | 部分：选择附件可触发 Agent；非调用任意 action | 接通：selectionActions.register | Dictionary lookup-save；menu contribution 是入口位置，不提供跳转/搜索本体能力 | [C1](#C1) | [API](../packages/plugin-types/src/index.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [DICT](../plugins/dictionary/src/index.ts) [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) |
| EXT02 | 书架与阅读 header menu 入口 / 实装 | 未接：无正式入口 | 接通：headerActions.register(surface=shelf/reader) | Dictionary/RSS 书架入口；Jumper 阅读入口；Annotation Desk 双入口；Jumper 缺口不是 header 插槽，而是 TXT/D/任务语义；Annotation Desk 仅组合已有公开 API | [C1](#C1) | [API](../packages/plugin-types/src/index.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [MENU](../apps/web/src/features/menus/lib/menu-registry.tsx) [RSS](../plugins/rss-reader/src/index.ts) [DICT](../plugins/dictionary/src/index.ts) [DESK](../plugins/annotation-desk/src/views.ts) |
| EXT03 | 插件页面/对话框/视图结果与栈导航 / 实装 | 未接：模型不渲染 PluginView 树 | 部分：视图栈/嵌套对话框 lease；根加载与动作迟到淘汰 | Dictionary/RSS/Jumper/Annotation Desk；隔离桌面视图探针；push/back 保留父回调，replace/reset/关闭释放离栈回调；显式导航按 frame key 重置嵌套表单值/错误，普通根数据刷新保持已有草稿协调。Worker 退休关闭所属视图。Annotation Desk 实机复验冲突留草稿、显式刷新加载新值并清错误；仍不等于全部视觉与焦点验收。迟到 UI 淘汰不取消已发起的业务副作用，GAP06/10 未整体关闭 | [S3](#S3) · [V1](#V1) | [API](../packages/plugin-types/src/index.ts) [VIEWS](../apps/web/src/features/plugins/lib/plugin-view.ts) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [VIEWSESSION](../apps/web/src/features/plugins/lib/plugin-view-session.ts) [VIEWSOURCE](../apps/web/src/features/plugins/hooks/usePluginViewSource.ts) [VIEWPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-view-probe.ts) [DESKPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-annotation-desk.ts) |
| EXT04 | 列表、搜索、详情、Markdown、blocks 组合 / 实装 | 未接：无正式入口 | 接通：PluginView list/detail/markdown/blocks | Dictionary/RSS/Annotation Desk；宿主组件有 Table/Tree 不等于插件 schema 有；复杂数据视图另列 | [S3](#S3) · [V1](#V1) | [API](../packages/plugin-types/src/index.ts) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) [DICTVIEWS](../plugins/dictionary/src/views.ts) [RSSVIEWS](../plugins/rss-reader/src/views.ts) [DESK](../plugins/annotation-desk/src/views.ts) |
| EXT05 | 表单输入、动态选项、验证与提交 / 实装 | 部分：ask_user 固定 question 交互 | 接通：PluginFormView.onSubmit + submitMode=explicit/change | RSS 订阅/OPML粘贴；Dictionary；Annotation Desk 选中/确认/编辑；补齐静态 select、choice、checkbox、toggle、secret 的 fieldErrors 接线；选择/布尔控件有可访问错误描述。OPML 是文本粘贴而非通用选择文件服务 | [S3](#S3) · [V1](#V1) | [API](../packages/plugin-types/src/index.ts) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) [PLUGINFORM](../apps/web/src/features/plugins/components/PluginFormViewBody.tsx) [DICTVIEWS](../plugins/dictionary/src/views.ts) [RSSVIEWS](../plugins/rss-reader/src/views.ts) [DESKBATCH](../plugins/annotation-desk/src/batch.ts) |
| EXT06 | 大列表分页/虚拟化、Tree/Table/编辑器/图像资源 / 部分 | 未接：无正式入口 | 部分：list 已用 PluginVirtualRows；无通用分页/Tree/Table | 宿主 UI 库比 PluginView schema 更丰富；虚拟行已实现，不与分页混为一谈；不能开放 React/HTML/DOM 逃生口；表格/树等需 schema 与键盘契约 | [S3](#S3) · [V1](#V1) | [API](../packages/plugin-types/src/index.ts) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) |
| EXT07 | Toast、持久错误、进度/取消/确认交互 / 部分 | 部分：工具 error/interaction + streaming | 部分：showToast(string)；视图自建错误内容 | 插件 toast；Agent 工具输出；Toast string 不能表达 stable code/retryability；错误不得借 modal 中断用户 | [S3](#S3) · [V1](#V1) | [API](../packages/plugin-types/src/index.ts) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) [ERRORS](../packages/core/src/errors.ts) [INTERACTION](../packages/agent/src/tools/interaction-tools.ts) |
| EXT08 | 应用/阅读主题和字体贡献 / 实装 | 部分：settings 选择已声明主题/字体 | 接通：manifest themes/fonts | editorial-themes；能力 catalog 含 themes/fonts，ctx 无 register 是声明式设计而非漏实现 | [C5](#C5) · [V3](#V3) | [THEMES](../plugins/editorial-themes/manifest.json) [API](../packages/plugin-types/src/index.ts) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) |
| EXT09 | 词典查询/收藏/复习列表/CSV 导出 / 实装 | 扩展：lookup_word/get_vocabulary/save_word | 接通：Dictionary 私有 storage + LLM + views/export | Dictionary；Agent 无删词/CSV 导出工具；不应把词汇领域搬回宿主 | [C4](#C4) | [DICT](../plugins/dictionary/src/index.ts) [DICTTOOLS](../plugins/dictionary/src/agent-tools.ts) [DICTVIEWS](../plugins/dictionary/src/views.ts) [DICTEXPORT](../plugins/dictionary/src/export.ts) |
| EXT10 | RSS 订阅/刷新/退订/OPML/阅读文章 / 实装 | 扩展：list_feeds/subscribe_feed/refresh_feed[全局] | 接通：RSS 私有 collection + content provider | RSS；退订与 OPML 无 Agent 工具；刷新正在读的版本仍见 LIB14 | [C2](#C2) · [C4](#C4) | [RSS](../plugins/rss-reader/src/index.ts) [RSSTOOLS](../plugins/rss-reader/src/agent-tools.ts) [RSSVIEWS](../plugins/rss-reader/src/views.ts) [RSSFEED](../plugins/rss-reader/src/feed.ts) |
| EXT11 | 本地 marketplace 插件清单与启用状态 / 实装 | 未接：无正式入口 | 部分：ctx.manifest/capabilities 仅自己 | 插件管理页；不能将仓库里存在等于用户已安装/启用；本次未读取用户安装态 | [S10](#S10) | [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [MARKET](../apps/web/src/features/plugins/runtime/marketplace.ts) [API](../packages/plugin-types/src/index.ts) |
| EXT12 | 安装/授权/启停/更新/回滚/卸载插件 / 实装 | 未接：无正式入口 | 未接：无正式入口 | Plugins settings；不开放：插件静默授予自己权限/安装代码；Agent 操作也应经宿主批准 | [S10](#S10) | [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [MARKET](../apps/web/src/features/plugins/runtime/marketplace.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) |
| SYS01 | 插件隔离 KV 同步读与异步持久写 / 实装 | 扩展：通过插件工具间接使用，无 KV 工具 | 接通：storage v2 get/set/remove/flush/onChange；set/remove 返回持久 Promise | 全部有设置/状态插件；RSS 迁移等待 remove；已接顺序持久写、flush、镜像失败重基和 remote origin；相关故障单元测试通过，真实 Worker/Tauri 持久化与全生命周期 E2E 尚待验收，不据此关闭全部 GAP02/03 | [S1](#S1) | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [WORKER](../apps/web/src/features/plugins/runtime/plugin-sandbox.worker.ts) [KV](../apps/web/src/platform/local-store.ts) [DICT](../plugins/dictionary/src/index.ts) |
| SYS02 | 插件私有文档 collection CRUD/限量查询 / 实装 | 扩展：Dictionary/RSS 工具通过插件访问 | 接通：storage.collection put/get/delete/list | Dictionary words；RSS feeds；无游标/CAS/事务/全字段搜索；bookId/anchor 是索引不是自动删除所有权 | [S1](#S1) | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [DOCS](../apps/web/src/features/plugins/runtime/plugin-backend.ts) [API](../packages/plugin-types/src/index.ts) [DICT](../plugins/dictionary/src/index.ts) [RSS](../plugins/rss-reader/src/index.ts) |
| SYS03 | 插件 schema 迁移/快照/更新回滚 / 部分 | 未接：宿主管理安装生命周期 | 部分：migrate storage-only；quiesce/drain 后 snapshot；schemaVersion 等待持久 | RSS legacy feeds 迁移；插件更新；已修复健康检查失败误恢复与旧实例晚写丢失的时序；全局外部设置并发、KV/docs 联合恢复和真实 Tauri 更新故障 E2E 仍待验收，GAP01/02 不整体关闭 | [S1](#S1) | [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [WORKER](../apps/web/src/features/plugins/runtime/plugin-sandbox.worker.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) |
| SYS04 | 插件自有 secret get/set/remove / 实装 | 未接：不提供密钥读取工具 | 接通：services.secrets namespace | TTS；WebDAV；私有 secret 不等于可读宿主 AI key/同步解密 key | [S2](#S2) | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [SECRETS](../apps/web/src/platform/secret-store.ts) [TTS](../plugins/tts/src/index.ts) [WEBDAV](../plugins/webdav-sync/src/index.ts) |
| SYS05 | 插件数据导入导出/配额/同步策略 / 部分 | 扩展：仅插件自定义工具 | 部分：exportFile + 私有 CRUD；无通用配额/同步状态 | Dictionary CSV；RSS OPML；KV、plugin_docs、secrets、blob 的漫游/备份边界不同，不能统一宣称可同步 | [S1](#S1) | [API](../packages/plugin-types/src/index.ts) [DOCS](../apps/web/src/features/plugins/runtime/plugin-backend.ts) [ROAM](../apps/web/src/platform/roaming-preferences.ts) [BACKUP](../apps/web/src/features/settings/lib/backup-io.ts) |
| SYS06 | 原生网络 HTTP 请求与响应 / 实装 | 内部：推理端口/插件工具，无通用 fetch 工具 | 部分：services.network v1.1：Request/二进制/AbortSignal 跨桥；64 MiB/120s 边界 | RSS/TTS/WebDAV；隔离 Tauri wire probe；GAP04/05 的参数保真、预取消不发请求、运行中取消及停用中止原生连接已实测；仍需 Agent 受权网络入口、重定向策略及生产 CSP 验收，见 host-capability-delivery.md | [S5](#S5) | [HTTP](../apps/web/src/platform/http-client.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [WORKER](../apps/web/src/features/plugins/runtime/plugin-sandbox.worker.ts) [RSS](../plugins/rss-reader/src/index.ts) [TTS](../plugins/tts/src/index.ts) |
| SYS07 | 网络域名授权、预算、下载流和离线重试 / 部分 | 未接：无正式入口 | 部分：network permission 是大开关，无完整流/配额 | 宿主内部 HTTP；各插件自行缓存；不是给每个插件重新实现重试/缓存的理由；实时 socket 不算宿主当前产品能力 | [S5](#S5) | [API](../packages/plugin-types/src/index.ts) [HTTP](../apps/web/src/platform/http-client.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [CATALOG](../packages/core/src/capabilities.ts) |
| SYS08 | 剪贴板写文本 / 实装 | 未接：无复制工具 | 接通：services.clipboard.writeText | 选择复制；插件动作；写文本不含读剪贴板或图片 | [S7](#S7) | [API](../packages/plugin-types/src/index.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [TEXTACTIONS](../apps/web/src/features/reader/hooks/useReaderTextActions.ts) |
| SYS09 | 图片复制/导出原生图片资源 / 实装 | 未接：无正式入口 | 未接：无正式入口 | ReaderImageLightbox；二进制 exportFile 可保存已持有字节，但无书内图像资源查询/图片剪贴板 | [S4](#S4) · [S7](#S7) | [READER](../apps/web/src/features/reader/components/FoliateReaderView.tsx) [EXPORT](../apps/web/src/platform/export-file.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) |
| SYS10 | 保存文本/二进制文件与取消回执 / 实装 | 未接：无正式入口 | 接通：ui.exportFile(filename,content,mimeType) → boolean | Dictionary CSV；Annotation Desk 页内/选中项 JSON/CSV；原生保存；Annotation Desk 仅导出已观察项，非整库冻结快照；CSV 防公式执行、JSON 保留原文，不导出本机 revision。隔离 release .app 经 CUA 验证原生取消无成功提示、JSON/CSV 保存及文件解析，Unicode/引号/换行/BOM/公式前缀正确；尚未验证二进制、磁盘失败与多窗口保存，没有流式 FileRef | [S4](#S4) | [EXPORT](../apps/web/src/platform/export-file.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [API](../packages/plugin-types/src/index.ts) [DICTEXPORT](../plugins/dictionary/src/export.ts) [DESKEXPORT](../plugins/annotation-desk/src/export.ts) [DESKRELEASE](../docs/evidence/packaged-annotation-desk-2026-09-09.json) |
| SYS11 | 用户选文件/目录、拖放和流式文件句柄 / 实装 | 未接：无正式入口 | 未接：无正式入口 | 书籍导入；插件安装选择 ZIP；不能把导入字节 API 当作文件选择器；任意路径/FS 不开放 | [S4](#S4) | [PICKER](../apps/web/src/features/library/lib/pick-book-files.ts) [IMPORT](../apps/web/src/features/library/lib/book-import.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) |
| SYS12 | 打开外部 URL/系统关联打开/深链接路由 / 实装 | 部分：回答链接可由用户点击，无 opener 工具 | 未接：无正式入口 | 账号登录/购买链接；系统打开书籍；外部 URL 打开与注册任意协议不同；OAuth ticket 不给插件 | [S3](#S3) | [EXTERNAL](../apps/web/src/platform/external-link.ts) [APP](../apps/web/src/App.tsx) [RUST](../apps/desktop/src-tauri/src/lib.rs) |
| SYS13 | Blob 范围读取/流式读写/提交/中止 / 实装 | 内部：正文/推理端口间接用，不读任意 blob | 部分：导入/导出只支持持有的 bytes | 原书阅读；同步分片；封面；底层 get_blob/blob_write_* 不可直接暴露；跨线程大对象需 transferable/backpressure | [S4](#S4) | [BLOB](../apps/web/src/platform/blob-store.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) [API](../packages/plugin-types/src/index.ts) |
| SYS14 | 系统字体枚举和字体资产加载 / 实装 | 部分：settings discover reading.fontFamily | 部分：settings options + fonts manifest | 阅读字体选择；editorial-themes；列表选择已可组合，不需要插件访问系统字体目录 | [C5](#C5) · [V3](#V3) | [RUST](../apps/desktop/src-tauri/src/lib.rs) [SETTINGS](../apps/web/src/domain/settings/catalog.ts) [API](../packages/plugin-types/src/index.ts) |
| SYS15 | 原生日志/诊断包/崩溃报告导出与发送 / 实装 | 未接：无正式入口 | 未接：无正式入口 | 设置 Troubleshooting；CrashFollowUpPrompt；不得向任意插件暴露全量日志/凭据；发送需显式用户意图 | [S3](#S3) | [DIAG](../apps/web/src/features/settings/lib/diagnostics.ts) [ERRORS](../packages/core/src/errors.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) |
| SYS16 | 检查/下载/安装更新与重启 / 实装 | 未接：无正式入口 | 未接：无正式入口 | 软件更新页；autoUpdate 检查；不开放：插件静默执行更新/重启；appVersion 不是更新状态 | [S3](#S3) | [UPDATE](../apps/web/src/features/update/lib/software-update.ts) [APP](../apps/web/src/App.tsx) [RUST](../apps/desktop/src-tauri/src/lib.rs) [API](../packages/plugin-types/src/index.ts) |
| SYS17 | 窗口最小化/最大化/全屏/关闭/标题栏 / 实装 | 未接：无正式入口 | 未接：无正式入口 | Tauri window controls/macOS traffic lights；不开放任意窗口创建与 shell；关闭必须先等待持久化 flush | [S3](#S3) | [WINDOW](../apps/web/src/features/navigation/components/WindowCaptionControls.tsx) [APP](../apps/web/src/App.tsx) [RUST](../apps/desktop/src-tauri/src/lib.rs) |
| SYS18 | Android/iOS 遗留桥：状态栏/安全区/音量键/商店 / 非桌面 | 未接：无正式入口 | 未接：无正式入口 | cfg 分支或桌面 no-op；Android updater/book picker/background task 和 App Store storefront 不计为桌面插件缺口 | [B1](#B1) | [RUST](../apps/desktop/src-tauri/src/lib.rs) |
| OPS01 | 同步连接/断开/立即同步/状态与积压 / 实装 | 未接：无正式入口 | 部分：syncTransports 提供后端，不控制 scheduler | Data & Sync；传输插件是 engine 被调用的 port，不是可以控制整套 sync 的服务 | [S9](#S9) | [SYNC](../apps/web/src/platform/sync/sync-scheduler.ts) [SYNCCONNECT](../apps/web/src/platform/sync/connect.ts) [ACCOUNTUI](../apps/web/src/features/settings/sections/SyncAccountGroup.tsx) [API](../packages/plugin-types/src/index.ts) |
| OPS02 | 事件/Blob E2E 加解密、游标、去重/确认与重试 / 实装 | 未接：宿主内部同步 | 部分：只处理 SealedEventWire/密文字节 | Relay/WebDAV；不得通过插件改变确认语义或读取其他插件/账号明文 | [C5](#C5) · [S9](#S9) | [SYNCENGINE](../apps/web/src/platform/sync/sync-engine.ts) [SYNC](../apps/web/src/platform/sync/sync-scheduler.ts) [SYNCTRANSPORT](../apps/web/src/platform/sync/transport-registry.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) |
| OPS03 | 检查点/投影恢复/事件历史回填 / 实装 | 未接：宿主内部恢复 | 未接：无正式入口 | checkpoint maintain/publish/bootstrap；backfill；管理底层游标/投影不算通用插件写能力 | [S9](#S9) | [RUST](../apps/desktop/src-tauri/src/lib.rs) [SYNCENGINE](../apps/web/src/platform/sync/sync-engine.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) |
| OPS04 | WebDAV 等自定义密文 transport / 实装 | 部分：可改非敏感插件设置，不能连接 | 接通：syncTransports v2：register/open/session.close 与密文方法 | WebDAV 0.2.0；隔离 Tauri 原生 HTTP 探针；宿主按注册/engine generation 关闭会话，失配与迟到 open 也释放；5 秒 close 上限及错误仍释放回调。桌面已证并发取消/停用不再发请求；真实连接 UI、跨设备与换代失败回滚未完整验收，GAP14 不整项关闭 | [C5](#C5) · [S9](#S9) | [API](../packages/plugin-types/src/index.ts) [WEBDAV](../plugins/webdav-sync/src/index.ts) [SYNCTRANSPORT](../apps/web/src/platform/sync/transport-registry.ts) [SYNCSESSION](../apps/web/src/platform/sync/transport-session.ts) [SYNCCACHE](../apps/web/src/platform/sync/transport-session-cache.ts) [SYNCPROBE](../apps/web/src/features/plugins/runtime/fixtures/desktop-transport-probe.ts) |
| OPS05 | 偏好漫游/远端合并后的 UI 失效 / 部分 | 自动：下一轮读取投影/配置 | 部分：roaming KV 与 plugin docs 路径不等价 | 跨设备设置/书架/聊天刷新；GAP09：远端应用缺逐领域订阅广播；不得让插件 replay 原始事件补洞 | [S9](#S9) · [Q3](#Q3) | [ROAM](../apps/web/src/platform/roaming-preferences.ts) [SYNC](../apps/web/src/platform/sync/sync-scheduler.ts) [APPEVENTS](../apps/web/src/platform/app-events.ts) [DOCS](../apps/web/src/features/plugins/runtime/plugin-backend.ts) |
| OPS06 | 账号登录、连接 token、退出、删除账号 / 实装 | 未接：无正式入口 | 未接：无正式入口 | SyncAccountGroup；删除远端账号和删除本地数据不同；身份 token 不向模型/插件公开 | [S3](#S3) | [ACCOUNTUI](../apps/web/src/features/settings/sections/SyncAccountGroup.tsx) [SYNCCONNECT](../apps/web/src/platform/sync/connect.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) [EXTERNAL](../apps/web/src/platform/external-link.ts) |
| OPS07 | 套餐/用量/购买/账单管理 / 实装 | 未接：无正式入口 | 未接：无正式入口 | 购买/账单 portal；远端服务契约未在本次本地代码审计验证；不开放自动付款 | [S3](#S3) | [ACCOUNTUI](../apps/web/src/features/settings/sections/SyncAccountGroup.tsx) [EXTERNAL](../apps/web/src/platform/external-link.ts) |
| OPS08 | 备份导出与合并导入 / 部分 | 未接：无正式入口 | 未接：无正式入口 | DataSyncPanel；v1 仅 KV/books/collections/annotations/files；独立 ai_chat/memories/plugin_docs/secret/event-log 未枚举，不能称全量备份；全量内存 JSON | [S3](#S3) | [BACKUP](../apps/web/src/features/settings/lib/backup-io.ts) [DATAUI](../apps/web/src/features/settings/sections/DataSyncPanel.tsx) [RUST](../apps/desktop/src-tauri/src/lib.rs) |
| OPS09 | 删除本地全部数据 / 实装 | 未接：无正式入口 | 未接：无正式入口 | DELETE 文字确认；清空本地与删账号不同；私有卸载清理不能升级成全局清空 | [S3](#S3) · [B1](#B1) | [WIPE](../apps/web/src/features/settings/lib/delete-all-data.ts) [DATAUI](../apps/web/src/features/settings/sections/DataSyncPanel.tsx) [RUST](../apps/desktop/src-tauri/src/lib.rs) |
| OPS10 | 数据目录显示/Reveal / 占位 | 未接：无正式入口 | 未接：无正式入口 | disabled Reveal / PendingBadge；UI 占位不能计入宿主已实现，更不能计入 Agent 或插件覆盖 | [S3](#S3) · [B1](#B1) | [DATAUI](../apps/web/src/features/settings/sections/DataSyncPanel.tsx) |
| OPS11 | 事件写入、重建/验证投影、历史 genesis / 实装 | 内部：领域端口提交业务事件 | 部分：公开领域命令内部 commit | commit_events/rebuild_projections/verify_projections；不开放：任意 SQL/事件 append/投影写；旧日志未记录的变更不可凭空恢复 | [Q3](#Q3) · [B1](#B1) | [EVENTS](../apps/web/src/platform/domain-events.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) [RUST](../apps/desktop/src-tauri/src/lib.rs) |
| CON01 | 能力发现/版本/权限/依赖与安装同意 / 实装 | 部分：registry 按 scope 产工具；无完整 host 能力目录工具 | 接通：ctx.capabilities + manifest requires/permissions | 插件安装校验；工具构建；catalog 当前只列已公开 API，不自动覆盖 host UI/engine/native；新增宿主行为必须更新此表 | [Q1](#Q1) | [CATALOG](../packages/core/src/capabilities.ts) [API](../packages/plugin-types/src/index.ts) [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) |
| CON02 | 对象级授权/用户批准/来源与审计 / 部分 | 部分：book scope + destructive approval | 部分：domain permissions/settings path grants/plugin namespace | Agent 写工具；插件 manifest；域权限不是每个对象的授权；session metadata 默认开放需明确政策 GAP15 | [Q1](#Q1) | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [CATALOG](../packages/core/src/capabilities.ts) [ANNTOOLS](../packages/agent/src/tools/annotation-tools.ts) [SHELFTOOLS](../packages/agent/src/tools/shelf-tools.ts) |
| CON03 | 生命周期 staging/activate/deactivate 与资源释放 / 部分 | 自动：runtime invalidation/flush background | 部分：注册 scope、视图/transport session 回调 lease 与异步 cleanup 排空 | 插件启停/升级；Agent 运行时重建；视图移除或失效时释放局部回调，未消费/非法/迟到结果释放，旧 Worker 不关闭新实例对话框；停用退休 transport 后排空异步关闭及持久写。仍缺通用同 ID 换代失败回滚、其他 provider session/在途 effect 和真实连接全链路；GAP06/08/14 未整体关闭 | [Q2](#Q2) | [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [CALLBACKWIRE](../apps/web/src/features/plugins/runtime/plugin-callback-wire.ts) [LIFECYCLE](../apps/web/src/features/plugins/runtime/plugin-lifecycle.ts) [THREAD](../packages/agent/src/runtime/thread.ts) [SYNCSESSION](../apps/web/src/platform/sync/transport-session.ts) [VIEWSESSION](../apps/web/src/features/plugins/lib/plugin-view-session.ts) [VIEWSOURCE](../apps/web/src/features/plugins/hooks/usePluginViewSource.ts) |
| CON04 | 跨 Worker RPC 的类型、错误与资源额度 / 部分 | 扩展：插件 tool 也经过同一 worker bridge | 部分：describeContext + 无业务字段碰撞的 callback metadata + 有界图遍历 | 所有 Worker 插件及其 Agent 工具；__fn/__disposable 保持普通数据；编码/clone 失败回滚句柄；图深度/条目/单消息 callback 有界；GAP07/12/13/17 的全消息 schema/字节与存活资源总量、取消、错误码/崩溃路径仍需统一验收 | [Q2](#Q2) | [WORKER](../apps/web/src/features/plugins/runtime/plugin-sandbox.worker.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [CALLBACKWIRE](../apps/web/src/features/plugins/runtime/plugin-callback-wire.ts) [API](../packages/plugin-types/src/index.ts) [ERRORS](../packages/core/src/errors.ts) |
| CON05 | 稳定错误码/安全文案/可重试与降级状态 / 部分 | 部分：工具错误包装与产品错误表面 | 部分：桥会保留 code；非所有生命周期路径 | 宿主 AppError；插件 UI toast；错误字符串/空列表 fallback 不能算成功；消费者需明确 empty 与 failed | [Q2](#Q2) | [ERRORS](../packages/core/src/errors.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| CON06 | 长任务进度、取消、超时、并发与幂等 / 部分 | 部分：局部 thread abort/工具 sequential | 部分：局部请求 id/回调，无通用 TaskRef | 搜索/导入/LLM/同步等各自实现；重复业务实现的原因之一；只新增函数名不补任务契约仍会反复缺能力 | [Q2](#Q2) | [THREAD](../packages/agent/src/runtime/thread.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [API](../packages/plugin-types/src/index.ts) |
| CON07 | 领域事件的本地/远端/外部变化一致性 / 部分 | 自动：端口每轮读；runtime 配置失效 | 部分：domain subscribe / ignoreSelf / session | 本地 domain broadcasts；app invalidation；GAP09/11 与 STAT05；事件类型、实发事件、异步错误三处要同源 | [Q3](#Q3) | [EVENTROSTER](../apps/web/src/domain/events.ts) [APPEVENTS](../apps/web/src/platform/app-events.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [SYNC](../apps/web/src/platform/sync/sync-scheduler.ts) |
| CON08 | 事务/CAS/撤销/跨对象一致回执 / 部分 | 部分：单工具领域写/批准，无跨工具事务 | 部分：单域命令 Promise；无通用事务/CAS | 底层 commit_events 单 SQLite 事务；数据库事务存在不等于业务跨调用事务；undo 与导航 back 是两类能力 | [Q3](#Q3) | [EVENTS](../apps/web/src/platform/domain-events.ts) [APPLY](../apps/desktop/src-tauri/src/storage/apply.rs) [LIB](../apps/web/src/domain/library.ts) [ANNOT](../apps/web/src/domain/annotations.ts) [API](../packages/plugin-types/src/index.ts) |
| CON09 | 沙箱、权限撤销和 packaged CSP 验证 / 部分 | 扩展：插件工具间接承受同样沙箱风险 | 部分：Worker 响应独立 CSP + API gate | 安装信任边界；全部插件及插件 Agent 工具；macOS release 复现零权限插件经原型 fetch、子 blob Worker、HTTP 动态模块直接联网；已修复为 Worker 响应独立 CSP，三路复测均失败且服务器零新增请求，已授权宿主网络仍 200。开发响应共享策略，构建拒绝保护入口缺失/重复。Annotation Desk 正向安装/导出/卸载证据保留；直接消息/其余平台绕行、执行中撤权与 Windows/Linux 实机仍未验收，不宣称完整沙箱证明 | [Q1](#Q1) | [WORKER](../apps/web/src/features/plugins/runtime/plugin-sandbox.worker.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) [HOST](../apps/web/src/features/plugins/runtime/plugin-host.ts) [DESKRELEASE](../docs/evidence/packaged-annotation-desk-2026-09-09.json) [SANDBOXPOLICY](../apps/web/plugin-sandbox-policy.json) [SANDBOXNATIVE](../apps/desktop/src-tauri/src/plugin_sandbox_policy.rs) [SANDBOXBUILD](../apps/web/build/plugin-sandbox-policy.ts) [SANDBOXPROOF](../docs/evidence/packaged-sandbox-network-2026-09-09.json) |
| CON10 | 宿主-工具-插件覆盖门禁/契约测试 / 部分 | 部分：registry/tool-surface 测试覆盖当前工具 | 部分：capability catalog/ctx shape/marketplace checks | 现有测试；本次矩阵库存检查；GAP18：形状匹配不能证明语义/消费者/交付；本表盘点也不替代 E2E | [Q4](#Q4) | [CATALOG](../packages/core/src/capabilities.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) [API](../packages/plugin-types/src/index.ts) [WIRE](../apps/web/src/features/plugins/runtime/plugin-worker-host.ts) |
| CON11 | 任意 SQL/FS/shell/DOM、密钥、伪造历史 / 实装 | 未接：未注册这些工具 | 未接：不属于 public API | 宿主内部可能需要底层权力；拒绝原始权力不等于拒绝语义需求：用 ResourceRef/审批/领域命令替代 | [Q1](#Q1) · [B1](#B1) | [API](../packages/plugin-types/src/index.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) |
| CON12 | 新格式/OCR/实时协作/向量/任意编辑与新平台 / 待建 | 未接：无正式入口 | 未接：无正式入口 | 不计当前宿主对等开放率；不能承诺未来所有插件永不需要新 host；只能承诺当前能力闭包及其可组合范围 | [B1](#B1) | [API](../packages/plugin-types/src/index.ts) [RUNTIME](../packages/agent/src/runtime/runtime.ts) [ENGINE](../apps/web/foliate-js/src/view.ts) |
| MORE01 | 周期调度/启动补跑/失败记录 / 实装 | 扩展：RSS 工具可手动刷新；无调度工具 | 部分：manifest schedules + services.schedules.bind | RSS 每小时刷新；外部 Theme Schedule；最小 15 分钟、首轮 5 秒、每分钟扫描；触发时写 lastRun，不是成功时；关 App 不运行；无暂停/历史查询 | [S8](#S8) | [SCHED](../apps/web/src/features/plugins/runtime/plugin-scheduler.ts) [API](../packages/plugin-types/src/index.ts) [RSS](../plugins/rss-reader/src/index.ts) |
| MORE02 | 一次性延迟/短周期/空闲任务与自触发防环 / 部分 | 自动：maintenance 有 idle 策略，无通用调度工具 | 部分：Worker timer 可用，无宿主可恢复任务 | Theme Schedule 用 Worker clock；RSS 定时；setTimeout 不是可审计后台任务；ignoreSelf 不能阻止跨插件循环 | [S8](#S8) | [SCHED](../apps/web/src/features/plugins/runtime/plugin-scheduler.ts) [MAINT](../apps/web/src/features/ai/agent/maintenance.ts) [WORKER](../apps/web/src/features/plugins/runtime/plugin-sandbox.worker.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |
| MORE03 | 环境 locale/platform/timezone/在线/ready 快照 / 部分 | 部分：get_host_environment（全局/书内）+ 自动语言/日期上下文 | 部分：session 2.0 environment/observeEnvironment + ctx.appVersion/capabilities | Agent 查询；零权限 Worker 观察；Listening Desk 0.7 离线提示；共享 revision、runtime/platform/locale/timeZone/utcOffsetMinutes/networkHint；首次立即快照，语言/网络/焦点变化刷新，时区每 30 秒复核且每次查询刷新，末个观察者释放监听与 timer。网络仅 OS/WebView 提示，不证明 endpoint 可达、账号/模型就绪或格式可用；这些 availability 仍缺。无阅读/账号字段，不借内置服务绕过 reading 权限。Listening Desk 按需刷新离线提示，不阻止本地朗读。隔离 macOS debug 双端与真实 Worker 已验；旧 session 四阅读事件旁路已移除；packaged/跨平台/真实系统时区和网络切换未验。 | [S11](#S11) | [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [ENVIRONMENT](../apps/web/src/platform/host-environment.ts) [ENVTOOLS](../packages/agent/src/tools/environment-tools.ts) [ENVPROOF](../docs/evidence/host-environment-2026-09-09.json) [SESSIONBOUNDARY](../docs/evidence/reading-session-boundary-2026-09-09.json) [API](../packages/plugin-types/src/index.ts) [LISTENINGDESK](../plugins/listening-desk/src/views.ts) |
| MORE04 | 书籍/集合上下文菜单与 Agent header 插槽 / 实装 | 未接：无正式入口 | 部分：公开 header surface 仅 shelf/reader | 宿主上下文菜单/Agent header；宿主已有菜单不等于每处允许 plugin contribution | [C1](#C1) | [SHELFUI](../apps/web/src/features/shelf/components/Shelf.tsx) [AGENTUI](../apps/web/src/features/agent/components/AgentWorkspace.tsx) [MENU](../apps/web/src/features/menus/lib/menu-registry.tsx) [API](../packages/plugin-types/src/index.ts) |
| MORE05 | 贡献的动态 visible/enabled/checked 与自有视图刷新 / 部分 | 部分：工具按 scope 注册，无统一 enablement | 部分：静态注册/返回新 view，无通用状态流 | 宿主已有动态 UI 条件；静态入口与实时可用性分离；不允许 Worker 访问 UI store | [C1](#C1) · [V1](#V1) | [API](../packages/plugin-types/src/index.ts) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [REGISTRY](../packages/agent/src/tools/registry.ts) |
| MORE06 | 发现/复用类型化提供者与跨插件权限交集 / 部分 | 扩展：host 聚合各插件 tool/retrieval | 部分：阅读模式可发现/选择；无通用 provider discover/invoke | 宿主消费 voices/content/modes/tools/transports；注册、被宿主消费、被其他插件调用是三个方向；不开放任意字符串 RPC/他人 storage | [C4](#C4) · [S10](#S10) | [EXTOOLS](../apps/web/src/features/plugins/runtime/plugin-tools.ts) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) [SYNCTRANSPORT](../apps/web/src/platform/sync/transport-registry.ts) [API](../packages/plugin-types/src/index.ts) |
| MORE07 | 插件自有二进制资产与资源配额 / 部分 | 扩展：只经插件工具间接消费 | 部分：包内 assets 有；无可写私有 blob API | 主题字体包内资源；TTS 内存音频；包内静态资产、文档 JSON、运行期私有 blob 三者不可混算 | [S1](#S1) · [S4](#S4) | [BLOB](../apps/web/src/platform/blob-store.ts) [DOCS](../apps/web/src/features/plugins/runtime/plugin-backend.ts) [API](../packages/plugin-types/src/index.ts) [RUST](../apps/desktop/src-tauri/src/lib.rs) |
| MORE08 | 声明 UI 本地化、辅助技术、窄窗和输入焦点 / 实装 | 自动：宿主工具卡/聊天组件统一呈现 | 部分：PluginText + host renderer | 插件列表/表单；8 语言宿主；未做产品完整键盘/超长文本/全部 locale E2E；不能以类型齐全代替验收 | [V1](#V1) | [API](../packages/plugin-types/src/index.ts) [RENDER](../apps/web/src/features/plugins/components/PluginViewRenderer.tsx) [CTX](../apps/web/src/features/plugins/runtime/plugin-context.ts) |

## 完备声明与验证边界

能承诺的是：本次已识别的宿主行为、现有 catalog、旧验收条目都能在统一模型中找到 owner、双端 disposition 和边界。不能承诺未知源码行为已经被形式化穷尽，更不能承诺模型写完后任何插件无需宿主改动。只有目标原语真正实现、现有插件与 W01–W32 的相应成功/失败/并发/撤权路径通过，才可以对该范围承诺“新算法与组合不改宿主”。

[代码/验证] 生成器验证证据/当前 catalog/旧验收与场景映射无孤项、catalog 单一 owner、两端目标/验收存在、来源路径有效与生成文档一致；反例测试覆盖漏项、重复归属、无效引用和空契约。它不解析所有 UI 语义，也不证明设计正确性或 product E2E。

[环境] 本轮没有运行所有能力的真实 Tauri E2E、packaged CSP、跨设备同步、远端账号/支付/模型服务或用户插件安装态；已落地实现与 Jumper 等组合消费者的证据见执行账本，不把局部通过当作整体完成。静态 HTML 采用模板固定 CDN 字体/图标等资源，需要网络；无 Mermaid 图。文档浏览器验证只证明文档能读，不能证明产品能力。

### 可复现检查

```sh
bun scripts/build-host-capability-matrix.ts --check
bun scripts/build-host-capability-model.ts --check
bun test scripts/host-capability-model-check.test.ts
```

编写新宿主行为时要同时运行两套检查；新增未映射行为必须评审分类与 actor disposition，不能仅把新 ID 加入数组以消除报错。新增插件算法先尝试以上场景链；缺口报告需要给出无法组合的宿主事实/权力以及最小缺失契约，而不是插件名称。
