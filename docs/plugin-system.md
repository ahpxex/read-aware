# ReadAware — 插件系统（设计）

> **状态：** V1 已实现（2026-07-21）。§11 的五个阶段全部落地并经
> Tauri MCP 在运行中的桌面应用里实测（dev 构建；打包构建下的生产 CSP
> 尚待一次 `bun run build:desktop` 验证）。官方示例插件见
> `examples/plugins/`。参照模型：**Obsidian** 定插件的域与权限层
> （信任模型、manifest、分发、生命周期），**Raycast** 定插件的界面层
> （受限的 UI 词汇，一切插件界面都由应用的设计系统渲染）。

## 目录

1. [目标与非目标](#1-目标与非目标)
2. [信任模型：Obsidian 式，不做沙箱](#2-信任模型obsidian-式不做沙箱)
3. [插件形态：manifest + main.js](#3-插件形态manifest--mainjs)
4. [权限域](#4-权限域)
5. [挂载点矩阵](#5-挂载点矩阵)
6. [UI 词汇：Raycast 式受限视图](#6-ui-词汇raycast-式受限视图)
7. [摆放权：插件贡献能力，用户掌管布局](#7-摆放权插件贡献能力用户掌管布局)
8. [AI 扩展点：插件工具](#8-ai-扩展点插件工具)
9. [加载机制与 CSP](#9-加载机制与-csp)
10. [现有代码的改造点](#10-现有代码的改造点)
11. [实现阶段](#11-实现阶段)
12. [风险与开放问题](#12-风险与开放问题)

## 1. 目标与非目标

目标：

- 用户可以自己写插件、自己安装；官方也提供一批插件。
- 插件能贡献：Reader 选区动作、Reader 顶栏按钮、书架顶栏按钮/整页、
  命令面板命令、**AI agent 工具**（V1 就做，这是最重要的挂载点）。
- 插件界面永远看起来像原生功能 —— 观感由应用统治，插件只声明内容。

非目标（刻意不做）：

- 不做 VS Code 式的 extension host 进程隔离 / API 版本协商 / 市场审核。
- 不让插件渲染任意 React / 任意 HTML。
- V1 不做插件市场、不做自动更新（安装 = 选择本地文件夹 / zip）。
- 不把 iframe 内部 DOM、foliate 引擎内部结构暴露给插件。

## 2. 信任模型：Obsidian 式，不做沙箱

插件运行在主 webview 里，与应用同一个 JS 上下文。**不做沙箱是清醒的
取舍而不是偷懒**：插件的价值恰恰在于能读选中文本、读书籍数据、调 AI，
沙箱住它就废掉大半用处；而 VS Code / Obsidian / Raycast 三者实际上也都
不真正沙箱第三方代码。

约束手段分两层，诚实地说明各自的强度：

- **权限域（§4）是 API 级门控**：`ctx` 只暴露 manifest 声明且用户授予的
  能力面。它防的是插件*无意的*越权，防不了恶意代码（同上下文里恶意代码
  总能绕过 JS 门面）。
- **安装即信任**：安装非官方插件时给一次明确警告（Obsidian 同款文案
  策略——"社区插件可以读取你的数据，风险自担"）。这是真正的安全边界。

底线保障来自现有架构本身：Tauri capabilities 没开任意文件读写，所有
持久化走 IPC 且沙箱在 `<app_data>` 内 —— 插件再怎么越权也出不了这个圈。

## 3. 插件形态：manifest + main.js

一个插件 = 一个文件夹，放在 `<app_data>/plugins/<id>/` 下：

```
plugins/
  anki-sync/
    manifest.json
    main.js          # 单文件 ES module（作者自己打包）
```

`manifest.json`（Obsidian 式）：

```json
{
  "id": "anki-sync",
  "name": "Anki Sync",
  "version": "0.1.0",
  "minAppVersion": "0.3.0",
  "description": "把选中的生词发送到 Anki",
  "author": "…",
  "permissions": ["network", "reading-data", "ai"],
  "main": "main.js"
}
```

`main.js` 默认导出生命周期对象：

```ts
export default {
  activate(ctx: PluginContext): void | Promise<void>,
  deactivate?(): void | Promise<void>,
}
```

- `activate` 里通过 `ctx.register*` 注册贡献；每个注册返回 disposable，
  应用在禁用/卸载时统一回收（`deactivate` 只处理插件自己的外部资源）。
- 启用/禁用在设置页操作，即时生效，不要求重启。
- 官方插件与第三方插件走同一套机制、同一个 API —— 官方插件是 API 的
  第一批真实用户（dogfooding），不开后门。

**分发：插件市场（Raycast 模式）。** 社区插件收录在独立仓库
[`ahpxex/readaware-plugins`](https://github.com/ahpxex/readaware-plugins)：
插件代码直接住在仓库里，开发者以 Pull Request 提交/更新；CI
（`scripts/validate.mjs`）强制 registry ↔ manifest 一致性、id 形状、
权限白名单与文件存在性。应用内设置页分 **Installed / Marketplace**
两个标签：市场读仓库的 `registry.json` 索引
（raw.githubusercontent 优先，jsDelivr 镜像兜底），一键安装 = 前端
拉取插件文本文件 → Rust `plugins_install_files` 落盘（严格路径白名单）
→ 立即启用激活。安装前权限徽章先行可见。

## 4. 权限域

manifest 声明，安装时逐条展示给用户，设置页里可整体启停插件。
`storage`（命名空间 KV）不算权限，所有插件默认拥有。

| 权限域 | 授予的能力面 |
|---|---|
| `reading-data` | 读写阅读数据:书籍(读)、高亮/笔记(创建/删除)、内置生词本(读写,与阅读器词典同一份存储) |
| `library-write` | `ctx.library.importBook`(导入文件)+ **内容提供者**:`registerContentProvider` / `addVirtualBook` —— 虚拟书:书架条目由插件在打开时供给 HTML 章节,免转换,阅读/标注/进度全原生(RSS 即此路) |
| `network` | `ctx.fetch`（CSP `connect-src` 已含 `https:`，门控在 API 层） |
| `ai` | 注册 agent 工具（§8） |
| `dictionary` | 应用内置词典 `ctx.dictionary.lookUp`（与阅读器查词共享缓存；消耗用户 AI 额度） |
| `llm` | `ctx.llm.ask` —— 用用户配置的模型做一次性调用（fast 档,无线程无记忆无工具） |
| `clipboard` | 写剪贴板 |

**安装即明示**：所有安装路径（本地文件夹与市场）在复制任何文件、执行任何
代码之前，都会弹出确认对话框，逐条列出 manifest 声明的权限及其人话描述,
用户点「安装」才继续。这就是图 2 画的那道门,现已实装。

选区文本不设独立权限：选区动作被用户手动触发时天然获得当次选区，
这本身就是用户授权动作。

## 5. 挂载点矩阵

| 挂载点 | 插件注册什么 | 输入 | 允许的容器 |
|---|---|---|---|
| Reader 选区菜单 | 选区动作 | 选中文本 + CFI + 当前书元数据 | 无界面（执行 + Toast）／ Dialog |
| Reader 顶栏 | Icon button | 当前书元数据 | 仅 Popup（Popover） |
| 书架顶栏 | Icon button | — | Popup ／ Page |
| 命令面板 | （自动）所有插件动作自动注册进命令面板 | — | 随原动作 |
| AI agent | 工具 | agent 传入的参数 | 聊天内通用工具步呈现 |

容器语义：

- **Popup**：锚定在按钮上的 Popover，轻量、即开即关。
- **Dialog**：模态居中，紧凑、`max-h` 限高不溢出（沿用既有设计习惯）。
- **Page**：等同 Stats 那种整页 —— 占用顶部导航状态（`activeTopNav`），
  有明确返回；**不是**路由意义上的新页面。仅书架侧可用；阅读中不允许
  整页打断。
- 术语说明：Reader 内的挂载点是"选中文本后的动作菜单"
  （`ReaderSelectionMenu` / `ReaderAnnotationMenu` / `ReaderNavigatorBar`
  共享的那套动作），不是原生右键 contextmenu（应用里不存在后者）。

## 6. UI 词汇：Raycast 式受限视图

插件不写 JSX、不写 HTML。容器里的内容只能从三种视图声明里选，
全部由应用用 `@read-aware/ui` 渲染，观感永远原生：

- **Markdown 详情** —— 插件返回 Markdown 字符串，应用排版（复用聊天里
  现成的 `Markdown` 组件）。覆盖大半场景：查词、翻译、AI 生成内容、
  统计摘要。
- **列表** —— 条目数组 `{id, title, subtitle?, icon?, onSelect?}`；
  条目可下钻到另一个视图。
- **表单** —— 少量字段类型（文本、选择、开关）+ 提交动作；提交后可
  接一个结果视图。

配套约定：

- 视图可以链式：列表项 → Markdown 详情；表单提交 → Markdown 结果。
- 异步加载态（spinner / skeleton）由应用统一处理，插件只返回
  Promise。
- 图标只能按名字从 `@phosphor-icons/react` 选，不接受自绘 SVG
  （与图标规则一致）。
- 轻提示复用 `@read-aware/ui` 的 `Toast`。

插件作者失去"随便画界面"的自由，换来零设计成本与永远一致的观感 ——
对编辑式克制的设计方向，这个交换是划算的。

## 7. 摆放权：插件贡献能力，用户掌管布局

两层分离：

1. **插件声明**它提供哪些动作（装了插件，能力就存在）。
2. **用户决定**哪些动作以按钮形式钉在哪个顶栏、顺序如何。

规则：

- **设置 → Menus**：三个表面（书架顶栏、阅读器顶栏右簇、选区菜单）
  各有"显示 / 更多菜单"两个拖拽区，内建项与插件项同场排布——用户拖动
  决定顺序与去留，没放进一级的收进垂直三点溢出菜单。挂件类内建项
  （书架视图、阅读外观）只能排序不能收起。每表面可一键恢复默认。
- 新插件动作默认落在溢出区，安静登场；内建项默认全部一级。
- 所有插件动作无条件进命令面板 —— 它是"装了但没钉按钮"的动作的
  兜底入口（把 `buildCommands` 的闭合集合改成可追加注册表后近乎免费）。
- 钉选与排序持久化在应用侧（`localKV`），不归插件管。

## 8. AI 扩展点：插件工具

**V1 就做。** 这是长远看最有价值的挂载点：ReadAware 是 AI-native
阅读器，插件给 agent 提供工具（"查询我的 Anki 词库"、"读取我的豆瓣
标记"），比贡献按钮的天花板高得多。

现有形态恰好合拍（`packages/agent`）：agent 循环用
`AgentTool = {name, label, description, parameters, execute}`，每轮由
`buildThreadTools(scope, deps)` 组装；聊天 UI 已能通用渲染任意工具的
调用步骤（`tool-step` → `ChatToolStep`）。因此：

- 插件注册面：`ctx.ai.registerTool({name, label, description,
  parameters, execute})`，`parameters` 用纯 JSON Schema（TypeBox 产出的
  就是纯 JSON Schema 对象，内部兼容）。
- 命名空间：注册后实际工具名为 `plugin_<pluginId>_<name>`，杜绝与
  内置工具及其他插件冲突。
- 装配点：`buildThreadTools` 输出后追加"当前启用插件的工具"；插件
  启停触发 runtime 工具集刷新。
- 呈现：插件工具调用走现成的通用工具步 UI，用户在聊天里看得见
  "正在调用 × 插件的 × 工具"（与显式状态的架构哲学一致，不进
  `SUPPRESSED_TOOLS`）。
- 开关：设置页里按插件整体启停其工具；更细粒度（按书/按线程）留作
  后续。

**V1 只做 pull 不做 push**：工具是 agent 主动拉取的上下文源，已覆盖
绝大多数场景；"每轮自动注入上下文"的 push 式 context provider 涉及
提示组装管线（`context/`），留到有真实需求再开，避免第一版 API 面
过大收不回来。

## 9. 加载机制与 CSP

- 复用 foliate 已验证的范式：同源 ES module + 生产 CSP 下可行的加载
  路径，不用 `eval`、不用 inline script。
- 插件文件在 `<app_data>/plugins/` 下、不在 `'self'` 源内，需要一处
  有意的 CSP 决策：**Rust 侧注册自定义 URI scheme（如
  `raplugin://`）伺服插件目录，`script-src` 追加该 scheme**，前端
  `import("raplugin://<id>/main.js")` 动态加载。这是整个系统里唯一一处
  放宽安全姿态的地方，范围清晰可控。
- 备选（不推荐）：IPC 读文件 → Blob URL → `import()`，需要
  `script-src` 加 `blob:`，边界更模糊。
- 安装流程：设置页 → 选择文件夹 / zip（`dialog:allow-open` 已有）→
  Rust 命令校验 manifest 并拷入 `<app_data>/plugins/<id>/`。

## 10. 现有代码的改造点

调研结论（2026-07-21）：想挂载的位置目前全是硬编码 JSX，先做
"菜单数据化"，应用自己的菜单项先吃同一套贡献模型的狗粮。

| 现状 | 改造 |
|---|---|
| `ReaderShellOverlay` 顶栏按钮为独立 JSX + 回调 props | item 数组驱动 + 贡献点合并 |
| `ReaderSelectionMenu` / `ReaderAnnotationMenu` / `ReaderNavigatorBar` 三处共享动作但各自内联 | 统一的选区动作模型（声明式数组），三处消费同一数据 |
| `AppHeader` 桌面布局硬编码按钮（仅 `viewControl` / `actions` 两个 ReactNode 插槽） | header action 注册表；插件按钮与钉选/溢出规则在此落地 |
| `buildCommands` 返回闭合的 `CommandItem[]` | 改成可追加注册表；插件命令与自动注册在此接入 |
| 无贡献点存储 | Jotai atom 做贡献注册表（响应式增删，启停即生效） |
| `Toast`、`Markdown` 组件已存在 | 直接复用，无需新建 |

数据侧无需放宽任何东西：插件持久化 = `localKV` 加 `plugin:<id>:`
命名空间前缀（SQLite `app_kv` 表），不动 fs capability。

## 11. 实现阶段

全部属于 V1，仅为实施顺序：

1. **菜单数据化 + 贡献点注册表**（纯内部重构，无用户可见变化；独立
   成立，即使插件系统暂缓代码也变好）
2. **插件运行时**：manifest 校验、Rust scheme + 加载器、
   `activate/deactivate` 生命周期、权限域门控、设置页（安装/列表/
   启停/权限展示/钉选摆放）、命名空间 KV
3. **UI 词汇渲染器**：Popup / Dialog / Page 容器 + Markdown / 列表 /
   表单三种视图
4. **AI 工具挂载点**：`ctx.ai.registerTool` → `buildThreadTools`
   追加 + 启停刷新
5. **官方插件 × 2–3 + 插件模板仓库**：既是功能也是 API 的真实性
   检验（候选：导出 Markdown、查词典扩展、Anki 生词本）

## 12. 风险与开放问题

- **API 稳定性承诺**：一旦用户开始写插件，破坏性改动就有代价。V1 面
  宁小勿大，只加不减。
- **iframe 抽象泄漏**：选区事件横跨 foliate iframe 与主窗口两个时间
  原点；插件 API 必须停在"选区事件 + 文本 + CFI"层，绝不暴露 iframe
  DOM，否则引擎内部一动插件全崩。
- **插件自身设置**：插件大概率需要自己的配置项（如 Anki 地址）。
  倾向复用表单视图声明一节"插件设置"，V1 先不承诺。
- **插件 i18n**：插件字符串的多语言机制未定，V1 按插件自理。
- **更新机制**：V1 手动重装；后续再议版本检查。
- ~~**TypeScript 类型包**~~ **已落地**：`packages/plugin-types`
  （`@read-aware/plugin-types`）是插件 API 的唯一真源，应用 re-export
  它；市场仓库携带其声明镜像（`types/plugin-api.d.ts`）与 TS 模板
  （`template/`，`bun build src/main.ts` 产出 `main.js`）。**TypeScript
  是推荐的插件编写方式**，运行时装载的始终是构建产物 `main.js`；官方
  插件均以 TS 编写并连同构建产物一起提交,CI 对每个 PR 附加 `tsc
  --noEmit` 检查。
