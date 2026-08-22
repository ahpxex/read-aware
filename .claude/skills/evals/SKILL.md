---
name: evals
description: ReadAware agent eval 流水线：跑套件 → 在 eval viewer SPA（bun run eval:ui，S01…编号目录 + run 报告）里做机器与人工评测 → 主 Agent 以真实读者视角做质性 Judge → 修断言用 rescore 免费重评 → 新书/新场景入库规程。触发词："跑 eval"、"eval 一下"、"回归一下 agent"、"run evals"、"eval viewer"、"人工评测"、"加个 eval 场景"、"S07.3"这类场景编号。
---

# ReadAware Agent Evals

模型行为评测跑在真实 `AgentThread` + 内存假端口上，真书 fixture 全文挂载。
`bun test` 是确定性硬闸；eval 是活体行为面——行为失败默认是观察项不是红灯。
完整文档：`packages/agent/EVALS.md`。

## 跑法

```sh
bun run eval:agent <suite>                       # 单套件一遍
bun run eval:agent <suite> --scenario <id>       # 单场景
bun run eval:agent <suite> --repetitions 3       # 抽样（行为有随机性，回归判断至少 3 次）
bun run eval:all --concurrency 4                 # 全量（~109 场景）
bun run eval:agent <suite> --judge               # 附加 LLM judge 评 rubric（另付 judge 模型费）
bun run eval:agent <suite> \
  --candidate glm=zai-coding-cn:glm-5.3 \
  --candidate ds=deepseek:deepseek-chat           # 多 provider 同 run 对比：全部变体进同一并发池
                                                  # 真并行；summary 出配对比较，viewer Run 页出
                                                  # 变体对比矩阵（场景 × 变体）
bun run eval:agent <suite> --gate                # 行为失败也变非零退出码（CI 用）
```

缺省即正确姿势：provider **openrouter**（模型钉 `deepseek/deepseek-v4-flash-0731`，不带日期的 slug 是 0423 旧快照，
CoreWeave 优先路由，key 在 `~/.pi/agent/auth.json`）、thinking **medium**、
单场景超时 **240s**。`--provider deepseek` 是旧直连路径；跨 provider/thinking
档位的结果**不可比**（trend 会标 INCOMPARABLE）。

## 可视化：eval viewer SPA

```sh
bun run eval:ui        # http://127.0.0.1:5199 （packages/agent/eval-viewer）
```

- **Overview**：全部套件（S01…S17 编号）+ 最近 runs 列表。
- **Suite 页就是主评测面**：默认载入最近一次 run，每个场景按文档流直接呈现
  读者问题、模型完整回答、人工评分与评语；可切历史 run，也可按全部/待评/
  有问题筛选。测试定义、机器 checks 和 seed 退到按需诊断层。
- **Run 页**：历史 run 的固定链接，使用同一套逐条评测文档流，不再嵌入一套
  带侧栏的“小工作台”。
- **人工 Judge**：评分与评语直接贴在每条回答下方；1–5 分会映射为满意/
  有保留/不满意，问题标签与评语修改后自动保存，不需要点击保存按钮。结果落在
  run bundle 的 `human-reviews.json`，自由会话落在 `manual-sessions.json`。
- **自由评测**：从任一固定场景继承同一本书、seed、阅读位置和可选选区，直接输入
  新问题；同一会话可连续追问，使用真实 `AgentThread` 和该 run 的模型配置。进程
  重启后历史仍可阅读和评分，但模型会话不可恢复，需要新开会话。
- **引用坐标**：场景一律用 `S07.3` 这种编号沟通（套件 code + 套件内序号）；
  编号只增不改。用户报编号 → 在 viewer 的 Suite 页或 `evalSuites` 注册表
  按序号定位场景。
- 数据即 `.eval/` 工件目录（repo 根 + packages/agent 两处都扫）+ 从 agent 包
  实时加载的套件定义——**不跑 eval 也能浏览目录**。
- viewer 是**直播的**：正在跑的 run（含进行中进度 n/total）实时出现在列表与 Run 页，
  SSE 随工件落盘自动刷新，无须手动刷新；十分钟无写入的未完成 run 标"中断"。
  终端仍打印 trend delta（`!` 前缀 = 回归场景）。bundle 含书文本与模型输出——本地诊断工件，**不许 commit、不许外发**。

## 主 Agent / 人工 Judge（真书 eval 必做）

LLM `--judge` 是可扩展的机器评分器，不是最终产品判断，也不能让被测模型在没有
独立复核时给自己背书。每次判断真书 eval 是否修好、是否可发布，主 Agent 必须：

1. 先读全部失败与 error、全部本次改动直接相关的场景，再抽读各真书套件的机器
   pass；不能只转述通过率或 judge 分数。
2. 把自己当成读到该位置的真实读者，逐条判断回答是否正确、有依据、答完整、对
   阅读有帮助且有分寸；在 Viewer 写入总体判断、四维评分、问题标签和可追溯评语。
3. 对被修改的能力至少补一个固定题库之外的真实问题，并在需要时连续追问，检查
   模型是否只会命中结构化断言。自由问题和回答必须保留在同一 run 工件里供用户复核。
4. 结论必须分开报告：确定性检查、LLM judge、主 Agent/人工满意度。机器绿但读者
   不满意仍算产品问题；说明原因属于检索、上下文、工具轨迹、回答组织还是评测盲区。
5. 用户可在同一 Viewer 继续评分、改评语和补问。主 Agent 的判断是有证据的首轮
   产品评审，不是替用户关闭讨论。

发布前至少完成上面这轮质性审阅；未审的机器 pass 不得表述为“读者体验已通过”。

## 失败分诊（顺序固定）

1. **先读 run 工件再下结论**：`runs/<variant>/<scenario>/1.json` 里有完整
   工具轨迹与答案——区分"断言太死"与"行为真的错"。
2. 断言问题（词表漏了合法说法、长度闸太紧）→ 修断言 → **rescore 免费重评**：
   `bun run eval:rescore .eval/<suite>-<run-id>`（不再调模型；`--judge` 只付 judge 费）。
3. 行为问题 → 那正是 eval 的价值：修 prompt/管线，重跑该场景确认，其余场景
   至少抽查同套件一遍防误伤。
4. **哨点场景故意留红**，别修断言让它变绿：`santi-no-cursor-caution`
   （无游标自我授权剧透——待修的产品缺陷）；`crossbook` 的 synthesis 场景是
   "全局线程无宿主围栏"缺口的观察哨。

## 套件地图

| 套件 | 面 |
|---|---|
| karamazov / santi | 叙事真书：剧透围栏、版本保真、预训练知名度压力 + 本书公共行为场景 |
| lebon / refactoring / berger | 说明文/技术书/工具书：概念图、双语纪律、方法应用 + 本书公共行为场景 |
| journeys | 多轮长会话一条龙（选段→追问→标注→跨章→记忆→回顾） |
| legacy | 存量用户：图谱欠账过渡态、旧转录继承、旧断言扬弃 |
| personalization | 记忆必须改变回答（画像 A/B 带对照组） |
| crossbook | 全局线程跨书 |
| memory / annotations / grounding / reading / interactions / settings / tools | 合成小书的基础行为面 |

## 独立 runner

```sh
bun run eval:digests <slug> [--resume]   # 真书纪要 fixture 重生成（断点续跑）
bun run eval:classify                    # 叙事性分类器对全部注册书回归（5 调用）
```

## 新增场景 / 新书（纪律不可省）

- 新书：EPUB 拷进 `packages/agent/fixtures/<slug>.epub`（超大文件先剥图）→
  `book-fixtures.ts` 注册表加 spec → `eval:digests <slug>` → 写以书名为
  `displayName` 的专属套件，并在 `real-book-common.ts` 加配置；公共场景会直接
  并入这本书的套件，不另建聚合套件。
- **断言素材必须从 fixture 文本实证**：泄漏词要双重实证（正文首现晚于读者
  边界 && 不出现在任何章题/卷题——目录对读者可见，引用卷题是正确行为）。
- 断言分层：确定性检查（answer/tools/interactions/state）优先；语义质量走
  `rubric` + `--judge`。跨章召回别断言人名全名（正确答案会用代词回指——断
  内容词 anyOf）。英文章题断言用 `chapterTitleKey`（已剥 "Chapter N" 前缀）。
- 共享断言件在 `suites/real-book-helpers.ts`——别在套件里复制粘贴。
- 凡"管线写入、agent 消费"的字段，产品投影链必须有直测——eval 的内存端口
  与产品端口共享实现（如 searchTurnRecords），不许让 fixture 在接缝处替产品圆谎。

## 成本量级（OpenRouter × CoreWeave，medium thinking）

单场景 ≈ $0.001–0.01；全量一遍 ≈ 数十美分；digests 全书重生成一本 ≈ 几美分。
放开跑，别为省这点钱牺牲 repetitions。
