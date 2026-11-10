# 历史档案

这里保留当时的设计、审查和验收范围。正文中的日期、版本、“尚未实现”“已经完成”
或“唯一权威”都是历史陈述，不能代表当前产品状态。归档时保留原文，只修正文件链接。
当前入口是 [文档目录](../README.md)，当前工作范围是 [集中验收](../capabilities/host-capability-acceptance.md)。

## 早期设计

| 档案 | 为什么归档 | 当前替代入口 |
| --- | --- | --- |
| [Agent 初始设计](./designs/agent-architecture.md) | 含“实现未开始”和早期阶段计划 | [当前 Agent 架构](../architecture/agent-architecture.md) |
| [数据模型初始设计](./designs/data-model.md) | 表结构、迁移版本和双写说明停留在旧实现 | [本地数据](../architecture/data-model.md) |
| [SQLite 目标草图](./designs/sqlite-schema.sql) | 已不是运行时 schema 的权威来源 | [原生迁移](../../crates/store/src/storage/schema.rs) |
| [同步初始设计及演进](./designs/sync-engine.md) | 含旧实施阶段、部署配置与历史性能数据 | [当前同步说明](../architecture/sync-engine.md) · [relay 配置](../../apps/relay/wrangler.jsonc) |

## 历史审查

| 档案 | 内容 |
| --- | --- |
| [0.3.0 架构审计](./reviews/review-0.3.0.html) | 插件隔离、密钥、事件写入等当时的发现与修复 |
| [插件系统审查](./reviews/plugin-system-review.html) | 2026-07-21 的插件能力和缺口快照 |
| [错误处理审查](./reviews/error-handling-review.html) | 统一错误码、日志和用户提示前的审计依据 |
| [架构与代码质量体检](./reviews/architecture-review-2026-09.html) | 2026-09-27 快速迭代后的分层、单体、契约与守门缺口快照及治理路线 |
| [阅读引擎体检](./reviews/reader-engine-audit-2026-11.html) | 2026-11-11 对阅读引擎与宿主集成的性能、状态机、竞态排查：31 条发现及建议的修复顺序，排查时未改代码 |
| [历史实施记录](./reviews/implementation-history.md) | 从根指令抽出的旧版本迁移背景 |
| [插件能力基线](./capabilities/plugin-capability-baseline.md) / [HTML](./capabilities/plugin-capability-baseline.html) | 原 129 项、32 个场景与 GAP 的历史契约，供生成器反查；不是当前待办 |

## 旧验收计划

- [2026-09-13 全量验证清单](./validation/host-capability-validation.md)
- [2026-09-13 固定 16 项目标](./validation/host-capability-validation-bounded-goal.md)

专项验收报告和原始运行工件已删除，只保留在 Git 历史中。
较早源码路径、章节编号、环境路径和部署状态可能已经失效；追查时结合对应 Git 版本。

## 本次合并与删除

2026-09-15 整理前基线：`17a3ad9e`。以下旧文件已合并后删除，契约正文保留在新入口：

| 原文件 | 合并后的入口 |
| --- | --- |
| `profile-entity-projections-design.md`、`entity-registry-contract.md`、`identity-consolidation.md` | [画像、身份与自动整理](../architecture/identity-and-profile.md) |
| `desktop-startup-design.md`、`file-associations-design.md` | [桌面系统集成](../features/desktop-integration.md) |
| `plugin-transport-budgets.md`、`network-transfers.md` | [资源限制与网络重试](../plugins/resource-limits.md) |

能力生成器中的旧优先级、旧插件消费者摘要和逐阶段实施结论已移除；当前接线由同一
行级数据源生成，避免两处重复维护。需要原文时直接查整理前提交，例如：

```sh
git show 17a3ad9e:docs/identity-consolidation.md
git show 17a3ad9e:docs/host-capability-matrix.md
git show 17a3ad9e:scripts/build-host-capability-model.ts
```
