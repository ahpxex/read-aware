# ReadAware — Agent 架构（设计）

> **状态：** 方向已定（2026-07-02），实现未开始。
> 基于 `CLAUDE.md` 的 AI 架构决策与 `docs/data-model.md` / `docs/sqlite-schema.sql`
> 的目标 schema。本文档中凡是提到"尚无生产者"的表或事件，本架构就是它们的生产者。

## 目录

1. [目标与非目标](#1-目标与非目标)
2. [SDK 选型：pi](#2-sdk-选型pi)
3. [线程模型：一个 agent，两种 scope](#3-线程模型一个-agent两种-scope)
4. [记忆：单库多 scope，线程间不同步](#4-记忆单库多-scope线程间不同步)
5. [运行时架构](#5-运行时架构)
6. [Agent 工具](#6-agent-工具)
7. [提问笔记（ask-note）：每个提问都留痕](#7-提问笔记ask-note每个提问都留痕)
8. [模型档位与 LLM 账户](#8-模型档位与-llm-账户)
9. [Onboarding 与 Context 页](#9-onboarding-与-context-页)
10. [单轮生命周期](#10-单轮生命周期)
11. [Schema 与事件增量](#11-schema-与事件增量)
12. [实现阶段](#12-实现阶段)
13. [风险与开放问题](#13-风险与开放问题)

## 1. 目标与非目标

Agentic reading 的具体含义：

- **每本书一个持久线程。** 用户的每个提问都会被提炼记忆，并在书中留下一个
  锚定的*提问笔记*（ask-note）。
- **所有书之上有一个全局线程**（即 Context 页）。它能回答任何一本书的细节、
  把多本书连接起来、得出跨书结论。
- **记忆共享且分 scope**，不在线程之间复制：全局线程学到的东西对每本书的
  线程立即可见，反之亦然。
- **Onboarding 播种用户画像**（认知背景、阅读偏好、讲解深度）；之后靠渐进式
  画像持续更新。

非目标（与 `CLAUDE.md` 一致）：不做多个用户可见的 agent，不把 transcript 当
记忆层，不在服务端放业务逻辑。LLM 推理保持远程；数据与检索保持在本地。

## 2. SDK 选型：pi

基于 [pi](https://github.com/badlogic/pi-mono) TypeScript agent 工具箱，只用
两个包：

| 包 | 用途 |
|---|---|
| `@earendil-works/pi-agent-core` | Agent 循环：`Agent` 类（`prompt()` / `abort()`）、工具调用、流式事件（`message_update`、`tool_execution_*`）、每轮 `transformContext()` 钩子、可序列化的消息状态 |
| `@earendil-works/pi-ai` | 统一多 Provider LLM API：流式输出、每个模型可自定义 `baseUrl` + headers、内置订阅类 Provider 的 OAuth 机制、明确支持浏览器环境 |

**不用** `pi-coding-agent`（CLI 层）和 `pi-tui`。所有代码以 TypeScript 跑在
Tauri webview 里 —— 符合两轴分离：数据 + 检索在本地，推理在远程。

pi 对我们的针对性契合点：

- `transformContext()` 正是"线程体验连续，但 prompt 不回放全量转录"的落点（§5）。
- 工具 = TypeBox schema + `execute()` —— 我们的检索工具就是跑在
  SQLite/IndexedDB 投影之上的纯本地函数。
- `pi-ai` 有官方的浏览器使用路径（显式传 `apiKey`）；现有的前端直连 BYOK 调用
  （`ai-service.ts`）已经证明 webview 里可行；Tauri HTTP 插件是 CORS 兜底。
- 每个模型可带自定义 `baseUrl`/headers，给将来的 ReadAware 订阅代理留了口，
  agent 代码不用改（§8）。

## 3. 线程模型：一个 agent，两种 scope

只有**一个核心 agent**，按线程 scope 实例化 —— 不是两个 agent：

```ts
type ThreadScope =
  | { kind: "book"; bookId: string }
  | { kind: "global"; threadId: string };
```

| | 书线程（每本书一个） | 全局线程（**多个**，用户自建） |
|---|---|---|
| UI 挂载点 | Reader 右侧面板（`ChatPanel`，不动） | Context 页（§9），AppHeader 线程弹层新建/切换 |
| System prompt 角色 | *这本书*里的阅读伴侣 | 整个书架的图书馆员 |
| 默认检索 scope | `book:<id>` + `user` + `global` | 全部 scope |
| 工具 | 同一套注册表，book scope 默认值 | 同一套注册表，跨书默认值 |
| Prompt 装配 | **无状态 + 一轮尾巴**（见 §5） | 线程内连续（水化 + 窗口化） |

其余一切共享：一套工具注册表、一个记忆库、一份用户画像、一套模型/账户配置。
差异只在上下文装配的默认值和 system prompt 里的角色framing。

**记忆不随线程分裂**：`user`/`global` scope 的记忆跨所有全局线程共享，
rolling summary 按线程各自维护。线程只是对话的容器，人格与积累靠记忆层 ——
新建线程 ≠ 失忆（§4 的不变式在多线程下原样成立）。

线程持久化沿用 `docs/data-model.md` §5.1 的定义
（`ai_conversations` / `ai_messages` / `ai_message_attachments`），加上 §11
描述的 scope 扩展。

## 4. 记忆：单库多 scope，线程间不同步

产品需求"子线程的记忆随全局线程的记忆更新"的实现方式是**不做任何传播机制**。
不变式：

> 记忆只存在于一个地方 —— 事件日志投影成的 `memories` 表 —— 且每条记忆都有
> scope：`user`（关于读者本人）、`book:<id>`（关于某一本书）、`global`
> （跨书结论）。**线程不拥有记忆，只按 scope 检索。**

推论：

- 全局线程写下的 `user` 或 `global` scope 记忆，对每本书线程的检索*自动*
  可见。零同步代码。
- 反方向 —— 同样重要 —— 由巩固管道完成：在某本书里浮现、但其实是关于读者
  本人的洞察（"总是追问概念的历史来源"），会从 `book:<id>` *升格*到
  `user`/`global` scope，通过 `memory.promoted` / `memory.superseded` 事件。
  这些事件类型在 `packages/core/src/events.ts` 里已经预留。

### 写管道（更难的那一半）

在每轮结束后**异步**执行 —— 绝不阻塞流式回复 —— 使用 `fast` 模型档位（§8）：

1. **逐轮提炼。** 对刚结束的这轮 exchange 抽取记忆候选 → `memory.promoted`
   事件，携带 `source_event_ids` 指回原始 `aiMessage.appended` 事件（可追溯、
   可重建）。提炼 prompt 刻意保守：不是每句话都值得成为记忆，门槛太低会把
   记忆库变成噪音。此外必须区分三类话语：**用户的自述、用户引用的书中内容、
   用户的假设性发言** —— 只有第一类能作为 `user` scope 记忆的证据。
2. **滚动线程摘要。** 更新该线程的 `conversation_insights` bundle。它同时是
   长线程压缩的输入（§5）。
3. **巩固（空闲/定时批处理）。** 去重 + 实体解析（`entities` /
   `entity_aliases`）、矛盾处理（`memory.superseded`）、衰减
   （`memory.forgotten`）、book→global 升格。
4. **检索打分。** 排序 = 文本相关性（FTS 命中）*加上* recency、importance、
   显式用户反馈（`memory.feedback`）、跨书重复出现 —— 按 `CLAUDE.md` 的要求。

### 置信度与就地归因

- **记忆带置信度与证据计数。** 单次言论产生的记忆初始置信度低、注入优先级
  低；跨对话反复出现（提炼命中已有记忆 → 证据 +1）才逐步强化 ——
  `memories.importance` 列即此语义。出现矛盾时先降置信，证据充分后才
  `memory.superseded`。错误记忆的伤害是乘性的（scope 越高污染面越大），
  这套机制是它的阻尼。
- **归因就地可见。** `memory-notice` chunk 不只在写入时出现：回答明显依赖
  某条记忆时，UI 可展开其来源（"基于：你在《…》的对话中提到过…"），就地
  修正即发 `memory.feedback` 事件 —— 把纠错回路从"去 Context 页翻透明面板"
  缩短到对话现场。透明面板（§9）仍是全量管理入口。

### 检索：结构化 + FTS + agent 迭代，默认不做向量（2026-07-02 决策）

检索 = SQLite 上的 scope + 全文检索（FTS）+ recency + importance
（`ix_memories_scope_book` 正是为此准备的）。**embedding 与 LanceDB 不在
默认架构里。** 理由是产品身份：ReadAware 不替用户读书，智能单位是用户的
阅读痕迹（标注、提问、记忆），不是书的语料 —— agent 对正文的访问天然是
锚点驱动（当前位置、选区、章节），不是语义查询驱动。语义召回的缺口由
agent 工程补：检索工具允许 agent 换措辞多次探查、看目录、按章节翻书。

砍掉向量的红利：桌面端少一个原生依赖，存储纯 SQLite（FTS5 内置），
新设备重放事件日志重建索引秒级、离线、零成本。

**升级阶梯保留**（向量从设计上就是派生索引，后加零迁移）：若 FTS + 迭代
检索被实践证明不够，第一步只 embed 记忆 + 标注（语料极小），第二步才是
全文 —— 预期走不到。中文 FTS 分词方案（trigram / jieba 类）是 Phase 2
落地时的必须决策。

## 5. 运行时架构

```
apps/web  features/ai （UI 不动）
   │  ChatTransport.sendTurn()            ← 现有 seam，唯一集成面
   ▼
packages/agent  @read-aware/agent （新包）
   ├─ transport/   PiChatTransport 适配器（启动时 setChatTransport() 一次）
   ├─ runtime/     pi Agent 封装：每个打开的线程一个 Agent 实例，
   │               消息从对话 store 水化；transformContext() 做窗口化
   ├─ context/     bundle 装配：user_profile_context、book_memory_context、
   │               reading_intent_context、conversation_insights_context
   ├─ tools/       检索工具（§6）
   ├─ memory/      写管道：逐轮提炼 + 后台巩固
   └─ models/      模型档位 + LLM 账户抽象（§8）
        │ emit DomainEvents（aiMessage.appended、note.created、memory.*）
        ▼
   事件日志 → 投影（ai_messages、notes、memories …）→ 检索
```

### Prompt 装配 ≠ 转录回放

线程*体验*上是连续的（UI 渲染全部持久化的 `ai_messages`），但每轮的 prompt
现场装配，两种 scope 走不同深度：

**书线程 —— 无状态 + 一轮尾巴**（memory-first 的终点形态）：

```
system prompt（角色 framing + 画像 + 记忆 + 滚动摘要）
+ 上一轮 user↔assistant 原文（"尾巴"——覆盖明显的 follow-up）
+ 当前这轮（+ 选区 attachment）
+ 循环过程中的工具结果
```

更早的历史一律不进 prompt：明显的追问几乎总指向紧邻的上一轮，一轮尾巴用
极小的固定成本覆盖它；真要翻旧账，agent 用 `get_recent_turns`（无查询词
倒带）/ `search_conversation`（原文检索）按需取。prompt 尺寸恒定、对
provider 缓存友好，且每个回答都基于新鲜检索而不是惯性上下文。

**全局线程 —— 线程内连续**：水化 + `windowByTurns` 窗口化 +
`elideStaleToolResults` 瘦身（用户自建的线程，线程内连续性是预期本身）。

Transcript 是原始事件；bundle 才是记忆层。这就是 `CLAUDE.md` 那条规则的
机械化落地。

### ChatTransport 演进

`ChatTurnRequest` 增加 `scope: ThreadScope`（全局线程没有 `bookId`）。
`ChatStreamChunk` —— 刻意设计为开放 union —— 按需增加变体：`tool-step`
（agent 正在搜记忆 / 读段落），之后再加 `citation` 和 `memory-notice`
（写入时"已记住：…"，引用时"基于记忆：…"，见 §4 的就地归因）。UI 可以
忽略未知 chunk 类型。

## 6. Agent 工具

一套注册表，两种 scope 共享；默认值随 scope 不同。所有工具都是投影之上的
本地函数 —— 不走网络。

| 工具 | 用途 |
|---|---|
| `search_memory(query, scope?, kinds?)` | 按 scope 检索记忆（§4） |
| `list_books(filter?)` | 书架总览：书名、作者、状态 |
| `get_book_overview(bookId)` | 元数据、目录、进度、阅读时长统计 |
| `get_annotations(bookId?, query?)` | 高亮 + 笔记（+ ask-note），可过滤 |
| `get_conversation_insights(bookId)` | 某书线程的滚动摘要 —— 全局线程"问某本书"的方式，而不是把子线程转录塞进上下文 |
| `get_recent_turns(n?, bookId?)` | 无查询词倒带：取最近 N 条原文。书线程无状态装配后，上下文只带一轮尾巴 —— 用户追问更早的内容时先倒带再回答 |
| `search_conversation(query, scope?)` | 历史对话原文检索（`ai_messages` 全文索引）——"你上次是怎么说的来着"必须靠原话回答，`search_memory` 只有提炼后的记忆点，没有原话 |
| `read_passage(bookId, anchor)` | 锚点附近的书籍正文（依赖文本抽取管道，§13） |
| `remember(content, scope, kind)` | 显式写记忆 → `memory.promoted` 事件，`actor: "agent"` —— "显式记忆写入"原则 |

## 7. 提问笔记（ask-note）：每个提问都留痕

**决策：书线程里的每个用户提问都生成一个 ask-note。**

- **锚定：** 带选区 attachment 的提问锚在选区的 `cfiRange`；自由提问锚在
  当前阅读位置。
- **建模：** 独立的标注类型（`type: "ask"`），*不*混入手写笔记。渲染上更
  安静，在所有标注出现的地方可过滤/可静音，和普通标注一样可删除。以
  `note.created` 事件发出，payload 带 `origin: "ask"` 字段（或者用专门的
  `ask.recorded` 事件 —— 实现时再定；投影层面反正都是 `notes` 表里的一行）。
- **历史备注：** 旧的 per-selection `ai-chat` 标注类型是在聊天重构时刻意
  删掉的。ask-note 不是那个模型的回归：它是单一持久对话的被动痕迹，不是
  按选区开线程。
- 全局线程的提问**不**生成 ask-note（没有可锚定的对象）。

## 8. 模型档位与 LLM 账户

两条正交的轴，都收在 `packages/agent/models/` 里：

### 模型档位（Model Roles）

Agent 代码永远不写死具体模型，只请求**档位**：

```ts
type ModelRole = "smart" | "fast";        // 无 embedding 档（§4：默认不做向量）
resolveModel(role): PiAiModel             // 从账户配置解析
```

| 档位 | 特征 | 工作负载 |
|---|---|---|
| `smart` | 慢、聪明、贵 | 聊天轮次（两种 scope）、onboarding 访谈、跨书综合、少数巩固冲突消解 |
| `fast` | 便宜、快 | 逐轮记忆提炼、滚动摘要、去重初筛、衰减打分、标题/标签 |

每个 provider 有默认映射（如 Anthropic → Claude Fable / Claude Haiku 档）；
两者都可在 Settings → AI 覆盖。记忆提炼**默认开启**，使用 `fast`，Settings
里有开关。

### LLM 账户（LlmAccount）

`ai_provider_configs`（schema §7）已经预期了多 provider 行；账户抽象把
*一行怎么认证*一般化：

```ts
type LlmAccount =
  | { kind: "api-key"; provider: ProviderId; keyRef: KeychainRef; baseUrl?: string }  // BYOK —— 现在
  | { kind: "oauth";   provider: ProviderId; tokenRef: KeychainRef }                  // OpenAI/Anthropic 订阅 —— 之后
  | { kind: "readaware"; sessionRef: KeychainRef }                                    // 我们自己的订阅 + LLM proxy —— 更晚，not now
```

- **BYOK（现在）：** 即今天已有的模式，按 `docs/data-model.md` §7 把 key
  迁移到 Keychain 引用。
- **订阅 OAuth（之后）：** `pi-ai` 已内置 OAuth 机制（OpenAI Codex /
  ChatGPT 订阅、GitHub Copilot、Vertex；Anthropic 订阅 OAuth 待验证 —— §13）。
  Tauri 通过 deep link 处理回调；token 存 OS keychain。
- **ReadAware 订阅（更晚，明确 not now）：** 我们自己的套餐，背后是
  `CLAUDE.md` 已经许可的 LLM proxy（"optionally, an LLM proxy"）。因为
  `pi-ai` 的模型可带自定义 `baseUrl` + headers，这只是新增一种 `LlmAccount`
  变体 —— agent 代码零改动。Proxy 保持哑计量中继；服务端不放业务逻辑。

模型档位从当前激活账户的模型目录里解析，所以切换账户永远不触及 agent 内部。

## 9. Onboarding 与 Context 页

### Context 页 = 全局线程的主场

现在的 `ContextWorkspace`（跨书标注平铺列表）是占位符；它将成为产品的第二
支柱：

- **主体：全局聊天线程** —— 复用 `ChatPanel` 的 transcript/composer 组件，
  `scope: { kind: "global" }`。
- **记忆透明面板：** 查看 / 修正 / 置顶 / 删除记忆（→ `memory.feedback`、
  `memory.forgotten` 事件），以及编辑画像。这既是信任功能，也是 `CLAUDE.md`
  要求的"显式用户反馈"检索信号的来源。`memories` 表的 status/pinned 列和
  索引已经为这个 UI 做了准备。
- 现有的跨书标注浏览作为次要 rail/tab 保留，并纳入 ask-note。

### Onboarding（混合式）

1. **结构化快选（约 30 秒）：** 阅读目标、领域背景、偏好的讲解深度、语言
   偏好。→ `profile.updated` 事件播种 `user_profile` + 若干 `user` scope
   种子记忆。
2. **Agent 引导的简短访谈：** 就跑*在 Context 页的全局线程里* —— 同时完成
   全局线程的首次亮相。`smart` 模型问 3–5 个开放问题（认知结构、喜欢怎样
   学习）；提炼管道把回答转成种子记忆。

可跳过、可从 Settings 重来。**Onboarding 只是种子，不是真相来源** ——
之后由提炼管道从实际行为里渐进式更新画像。

## 10. 单轮生命周期

以书线程一轮为例：

```
1. UI → PiChatTransport.sendTurn({scope: book, message, attachments})
2. runtime/ 水化该线程的 Agent（消息来自对话 store）
3. transformContext()：窗口化最近 N 轮 + 注入 bundles（§5）
4. pi agent 循环流式输出；按需触发工具（search_memory、read_passage …）
   → chunk 映射为 ChatStreamChunk（text | status | tool-step）
5. 本轮完成 → 同步持久化：
     aiMessage.appended（user + assistant）
     note.created {origin: "ask", anchor}          ← ask-note
6. 轮后异步（fast 模型，不阻塞，§4）：
     提炼 → memory.promoted …
     滚动摘要 → 更新 conversation_insights bundle
7. 空闲/定时：巩固批处理（去重、矛盾、衰减、升格）
```

全局线程的轮次相同，只是没有 ask-note，且检索默认全 scope。

## 11. Schema 与事件增量

相对 `docs/data-model.md` / `sqlite-schema.sql` 的增量（实现启动时合并回
那边）：

1. **`ai_conversations` 的 scope。** 目前 `UNIQUE(book_id)`，每本书一个线程。
   增加 `scope` 键（`book:<id>` | `global`），让全局线程成为一行；
   `aiConversation.*` / `aiMessage.appended` 的 payload 增加 scope 字段。
2. **Ask-note。** `note.created` payload 增加 `origin?: "user" | "ask"`
   （或新增 `ask.recorded` 事件）；`notes` 投影增加判别列。标注 UI 增加
   `ask` 类型 + 过滤器。
3. **`ai_provider_configs`。** 一般化为 `LlmAccount` 形态：`kind`
   （`api-key` | `oauth` | `readaware`）、keychain 引用，外加两列模型档位
   （`smart_model`、`fast_model`）。
4. **Memory 事件迎来第一批生产者。** `memory.promoted / revised /
   superseded / feedback / forgotten`、`profile.updated`、`entity.resolved /
   merged` —— 全部已在 `packages/core/src/events.ts` 声明。
5. **书籍正文抽取**（`read_passage` 与章节级 FTS 的前置条件）：导入时
   按章节抽取纯文本（foliate 离屏加载），经 blob registry 存储。需要单独
   一份小设计文档；当前 schema 未覆盖。
6. **`ai_messages` 全文索引。** `search_conversation` 工具需要在
   `ai_messages` 上建 FTS 索引。

## 12. 实现阶段

每个阶段都能独立交付可用的东西：

- **Phase 0 —— spike（数天）：** 在 webview 里用 pi-ai 对 BYOK 跑通流式调用
  （浏览器路径 + Tauri HTTP 兜底）；pi-agent-core 的 `transformContext` +
  一个自定义工具端到端；验证 pi-ai 对 Anthropic 订阅 OAuth 的支持现状。
- **Phase 1 —— 真·书线程：** `packages/agent` 骨架；`PiChatTransport` 替换
  mock；模型档位接现有 BYOK 配置；system prompt + bundles v0（画像占位 +
  近期标注）；先不写记忆。*交付：每本书真实的流式 AI 聊天。*
- **Phase 2 —— 记忆写路径：** 逐轮提炼（`fast`）、`memory.*` 事件生产者、
  `memories` 投影、结构化 `search_memory`（含中文 FTS 分词方案决策）、
  ask-note。*交付：agent 会记忆，提问留痕。*
- **Phase 3 —— 全局线程 + Context 页：** scope 扩展、Context 页聊天 + 记忆
  透明面板、跨书工具（`get_conversation_insights`、`list_books`）、滚动摘要。
  *交付：跨书对话。*
- **Phase 4 —— onboarding + 巩固：** 混合式 onboarding、渐进式画像、巩固
  批处理（去重/矛盾/衰减/升格）。
- **Phase 5 —— 纵深：** 文本抽取管道 → `read_passage` + 章节级 FTS +
  目录工具；订阅 OAuth 账户。

## 13. 风险与开放问题

- **书籍正文访问是真实缺口。** 抽取管道（§11.5）存在之前，agent 能看到的是
  元数据、标注和记忆 —— 不是正文。跨书回答会依赖用户高亮和提问过的内容。
- **pi-ai 的 Anthropic 订阅 OAuth** 未验证（OpenAI 订阅 OAuth 有文档）。
  如果缺失：自己实现 OAuth 流程、用自定义 headers 注入 token，或向上游贡献。
- **提炼质量闸门。** "每轮都提炼记忆"如果门槛低就是噪音；保守的提炼 prompt
  加巩固衰减是护栏，透明面板是用户的修正杠杆。这里预期需要反复调 prompt。
- **提炼花的是用户的 key。** 默认开 + `fast` 档位让单轮成本很小，但 BYOK
  下是真金白银；开关和可见的"已记住：…"chunk 保持诚实。
- **滚动摘要漂移。** 长线程通过摘要压缩；坏摘要会静默劣化线程。原始事件
  永久保留（它们是真相来源），所以摘要永远可以用更好的 prompt 重算。
- **模糊翻书的召回上限。** 无向量架构下，"记得书里讲过 X 但没划线"且措辞
  对不上时，FTS 会失手 —— 缓解靠 agent 多次改写探查 + 目录/章节结构。若
  实践证明不够，§4 的升级阶梯（先 embed 记忆+标注）是现成后路。
