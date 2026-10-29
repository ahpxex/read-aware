# ReadAware 文档

这里记录当前架构、功能契约、开发规范和能力状态。按要解决的问题进入，旧设计和
旧审计集中放在 [archive](./archive/README.md)，不作为当前状态或自动待办。

## 从哪里开始

| 想了解什么 | 入口 |
| --- | --- |
| AI 阅读助手怎么工作 | [Agent 架构](./architecture/agent-architecture.md) |
| 数据怎么保存、重建和同步 | [本地数据](./architecture/data-model.md) · [同步引擎](./architecture/sync-engine.md) |
| 插件能做什么、如何接入 | [插件简明说明](./plugins/plugin-system.html) · [完整契约](./plugins/plugin-system.md) |
| 当前能力工作还剩什么 | [九项集中验收](./capabilities/host-capability-acceptance.md) |
| 某个能力有没有接通 | [可筛选能力表](./capabilities/host-capability-matrix.html) · [文字版](./capabilities/host-capability-matrix.md) |
| 当前能力工作进行到哪一步 | [当前交接](./capabilities/host-capability-delivery.md) |

## 架构与数据

- [Agent 架构](./architecture/agent-architecture.md)：会话、上下文、模型、工具和后台记忆流程。
- [本地数据](./architecture/data-model.md)：事件、投影、本机状态、文件和数据库事实源。
- [同步引擎](./architecture/sync-engine.md)：加密传输、合并、文件、检查点和新设备引导。
- [画像与实体身份](./architecture/identity-and-profile.md)：画像投影、人物别名与合并、自动整理。
- [上下文包](./architecture/context-bundles.md)：有来源版本和授权边界的阅读上下文归档。

## 功能契约

- [阅读建档](./features/onboarding.md)：访谈、候选确认、画像与记忆共同保存。
- [本地 API 与 Agent Skill](./features/local-api.md)：其他 AI 通过本机只读 HTTP 访问阅读数据。
- [阅读 AI 动作](./features/reading-ai-actions.md)：解释、查词、翻译和章节总结。
- [完整备份](./features/full-backup.md)：数据覆盖、选择、合并及失败恢复。
- [桌面系统集成](./features/desktop-integration.md)：开机启动、文件关联和系统文件接收。

## 插件

- [插件系统](./plugins/plugin-system.md) / [网页简版](./plugins/plugin-system.html)：完整接口参考与简明模型。
- [延迟任务](./plugins/plugin-deferred-tasks.md)：周期及一次性任务的排队、取消和中断语义。
- [资源限制](./plugins/resource-limits.md)：Worker 通信、存活资源、网络流量和安全重试。

## 开发规范

- [项目开发约定](../AGENTS.md)：架构边界、UI、错误处理及交付规则统一维护在根目录。
- [多语言](./development/i18n.md)：文案、翻译、语言切换及格式化。
- [诊断与日志](./development/diagnostics.md)：本地日志、导出诊断包和主动报告。

## 能力与验收

| 文档 | 唯一职责 |
| --- | --- |
| [集中验收](./capabilities/host-capability-acceptance.md) | 当前执行范围、完成条件和停止规则 |
| [当前交接](./capabilities/host-capability-delivery.md) | 当前阶段、范围及下一步 |
| [能力矩阵](./capabilities/host-capability-matrix.md) / [HTML](./capabilities/host-capability-matrix.html) | 宿主、Agent、插件的行级接线和边界 |
| [责任模型](./capabilities/host-capability-model.md) / [HTML](./capabilities/host-capability-model.html) | 能力归属、目标契约和取舍 |
| [详细场景库](./capabilities/host-capability-stage-three.md) | 集中验收可引用的具体操作场景，不能自行扩大范围 |

## 示例与历史

- [卡拉马佐夫兄弟叙事图](./examples/karamazov-graph.html)：按阅读进度查看人物关系的交互示例。
- [历史档案](./archive/README.md)：旧设计、旧审计、旧验收计划及恢复原文的方法。

## 怎样维护

1. 当前契约按主题更新，不按日期另起状态说明；验证结果写回对应文档，注明日期和环境，不堆积原始运行工件。
2. 先更新已有文档。一个主题只有一个主要说明，其他地方用链接引用。
3. 能力事实改 [matrix.data.ts](./capabilities/host-capability-matrix.data.ts)，责任模型改
   [model.data.ts](./capabilities/host-capability-model.data.ts)，再运行对应生成器；不手改输出。
4. 数据库 schema 以运行时迁移为准；设计、源码接通、模型评测和真实运行证据分别标明。
5. 已被替代的设计或审计移到 archive 并登记替代入口；已合并文件删除，不留平行正文。
6. 移动文档时同时修正站内链接、代码中的文档引用和生成器路径。

```sh
bun scripts/build-host-capability-matrix.ts
bun scripts/build-host-capability-model.ts
bun scripts/build-host-capability-matrix.ts --check
bun scripts/build-host-capability-model.ts --check
bun run check:docs
```

盘点宿主/Agent/插件能力覆盖时手动运行 `bun run check:capabilities`，它核对能力矩阵
与代码库存并包含更广的契约与类型检查；它不是 CI 门禁，日常提交不保证矩阵同步。
普通文档整理只运行受影响的生成与链接检查。
