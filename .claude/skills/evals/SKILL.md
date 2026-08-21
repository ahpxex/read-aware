---
name: evals
description: ReadAware agent eval 流水线：跑套件 → 在 eval viewer SPA（bun run eval:ui，S01…编号目录 + run 报告）里可视化 → 读趋势 → 修断言用 rescore 免费重评 → 新书/新场景入库规程。触发词："跑 eval"、"eval 一下"、"回归一下 agent"、"run evals"、"eval viewer"、"加个 eval 场景"、"S07.3"这类场景编号。
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
bun run eval:all --concurrency 4                 # 全量（~108 场景）
bun run eval:agent <suite> --judge               # 附加 LLM judge 评 rubric（另付 judge 模型费）
bun run eval:agent <suite> --gate                # 行为失败也变非零退出码（CI 用）
```

缺省即正确姿势：provider **openrouter**（模型钉 `deepseek/deepseek-v4-flash`，
CoreWeave 优先路由，key 在 `~/.pi/agent/auth.json`）、thinking **medium**、
单场景超时 **240s**。`--provider deepseek` 是旧直连路径；跨 provider/thinking
档位的结果**不可比**（trend 会标 INCOMPARABLE）。

## 可视化：eval viewer SPA

```sh
bun run eval:ui        # http://127.0.0.1:5199 （apps/eval-viewer，Vercel 文档风格）
```

- **Overview**：全部套件（S01…S17 编号）+ 最近 runs 列表。
- **Suite 页**：这个套件测什么、每个场景怎么测——读者原话轮次、确定性
  expectation、criteria、judge rubric、seed 世界态，全部可展开。
- **Run 页**：一次运行的完整报告——pass 率/费用/token 大盘、逐场景表、每个
  run 展开（checks 失败置顶带 expected/actual、完整对话、工具轨迹）、"只看
  失败"过滤。
- **引用坐标**：场景一律用 `S07.3` 这种编号沟通（套件 code + 套件内序号）；
  编号只增不改。用户报编号 → 在 viewer 的 Suite 页或 `evalSuites` 注册表
  按序号定位场景。
- 数据即 `.eval/` 工件目录（repo 根 + packages/agent 两处都扫）+ 从 agent 包
  实时加载的套件定义——**不跑 eval 也能浏览目录**。
- 跑完一个套件后：viewer 刷新即见新 run；终端仍打印 trend delta（`!` 前缀 =
  回归场景）。bundle 含书文本与模型输出——本地诊断工件，**不许 commit、不许外发**。

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
| karamazov / santi | 叙事真书：剧透围栏、版本保真、预训练知名度压力 |
| lebon / refactoring / berger | 说明文/技术书/工具书：概念图、双语纪律、方法应用 |
| realbooks | 行为网格：一张配置表 × 每本注册书自动生成（新书自动入网格） |
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
  `book-fixtures.ts` 注册表加 spec → `eval:digests <slug>` → 写专属套件；
  realbooks 网格自动覆盖它。
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
