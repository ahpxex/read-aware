# 宿主能力当前交接

更新时间：2026-09-19。清理前完整流水账保留在 Git 对象 `17860738`。

## 当前交接

- 阶段：C01–C09 实现冻结，进入集中真实验收。
- 范围：[九项验收清单与停止规则](host-capability-acceptance.md)。
- 实现判断：已命名的公共调用链已接；C04/C05 不再以“其他来源”“其他操作”继续
  扩张。验收复现的具体断点按 bug 修复，不重新开启全仓能力扫描。
- 2026-09-15：四个能力矩阵消费者夹具插件（书库、维护、记忆、正文）已从源码移除，
  它们从未随打包应用发布。矩阵中受影响行的插件消费者改记为“无插件消费者”，
  C06 的插件侧调用方随之退役，只保留 Agent `call_plugin_service` 路径；夹具代码和
  历史证据只在 Git 历史中。
- 2026-09-16：Listening Desk 插件整体移除（原生阅读器已提供播放/模式控制，Reading 2.5
  控制器仍由原生阅读器与 Agent 工具消费）；Annotation Desk 更名为 Annotations；Reading
  Goals、Workspace Profiles、Jumper 重写为单一任务界面，不再消费阅读时长/洞察统计、
  窗口/字体/快捷键/当前工作区观察及独立步进视图。矩阵中这些行的插件消费者改记为
  “无第一方插件消费者”，宿主能力本身未回退，被移除的插件侧证据只在 Git 历史中。
- 2026-09-19：Workspace Profiles 插件整体移除（源码、桌面探针与组合夹具一并删除）。
  矩阵中 UI02/CFG01/SYS02/CON08 等行的插件消费者改记为“无第一方插件消费者”，
  C07 的安装态预设场景随之退役；宿主能力本身未回退，插件侧证据只在 Git 历史中。
- 2026-10-14：设置目录新增 4 个设备本地、仅 global 的 `reading.pageTurn.*` 路径
  （点击翻页区与 Android 音量键翻页，settings 1.11，SET81–84），不扩大 C01–C09 范围；
  真实 Android 按键与触屏点击属于产品验收，不计入本清单。
- 下一步：依次执行 C01–C09 的组合场景，为每项给出通过、失败、外部阻塞或不适用。
- 完成边界：真实插件/Worker/Tauri 动作、回执及必要重读或重启；类型、单测、文档和
  commit 数不独立构成完成。

## 事实源

| 用途 | 文件 |
| --- | --- |
| 243 行现状、调用入口、消费者和边界 | [host-capability-matrix.data.ts](host-capability-matrix.data.ts) |
| Domain/Contribution/Service/Contract 责任模型 | [host-capability-model.data.ts](host-capability-model.data.ts) |
| 当前有限验收队列 | [host-capability-acceptance.md](host-capability-acceptance.md) |
| 真实桌面候选场景 | [host-capability-stage-three.md](host-capability-stage-three.md) |

生成的 `host-capability-matrix.{md,html}` 和 `host-capability-model.{md,html}` 是以上
数据源的可读输出，不是独立状态或待办来源。

## 历史恢复

清理前 3555 行的逐 commit 流水账没有继续留在工作树。需要追查旧实现或精确日志时：

```sh
git show 17860738:docs/host-capability-delivery.md
git log --follow -p -- docs/capabilities/host-capability-delivery.md
```

旧目标、专项验收报告和原始运行工件只保留在 Git 历史中，不再在 docs 维护。

## 维护规则

1. 本文件顶部只保留一条当前交接，不追加逐 commit 日记或 `/tmp` 日志路径。
2. 一组真实验收结束后，把结果、日期、环境和未验证边界写回对应文档，不追加原始运行工件。
3. 能力事实只改数据源；生成的 Markdown/HTML 由脚本刷新。
4. 新问题只有阻塞当前九项行为或有具体安全/正确性证据时才进入范围。
