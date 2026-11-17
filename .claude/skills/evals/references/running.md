# 运行与场景选择

仅在执行评测、配置对比或选择场景时读取。命令和代码路径相对仓库根目录。

## 跑法

所有运行命令都经应用侧的无界面运行器（`apps/web/scripts/agent-evals.ts`）启动；启动时
先核对真书快照与应用当前抽取结果一致，不一致即停。改动 Agent 后先跑冒烟档。

```sh
bun run eval:smoke                               # 冒烟档：十来个代表场景，几分钟
bun run eval:snapshots [slug…]                   # 应用抽取结果变了：重写真书快照（不调用模型）
bun run eval:agent <suite>                       # 单套件一遍
bun run eval:agent <suite> --scenario <id>       # 单场景
bun run eval:agent <suite> --repetitions 3       # 抽样示例；重复次数按本次评测判据确定
bun run eval:all --concurrency 4                 # 全量；仅在评测范围需要时运行
bun run eval:agent <suite> --judge               # 附加 LLM 语义初评，仍需主 Agent 复核（另付 judge 模型费）
bun run eval:agent <suite> \
  --candidate glm=zai-coding-cn:glm-5.3 \
  --candidate pro=deepseek:deepseek-v4-pro        # 多 provider 同 run 对比：全部变体进同一并发池
                                                  # 真并行；summary 出配对比较，viewer Run 页出
                                                  # 变体对比矩阵（场景 × 变体）
                                                  # provider 另含 ollama-cloud（Ollama 托管 API，
                                                  # key 在 OLLAMA_API_KEY 或 auth.json 的 ollama-cloud 条目）
bun run eval:agent <suite> --gate                # 要求完成语义验收；新样本待审时返回非零
```

评测一律跑在 **DeepSeek 官方接口**上：provider `deepseek`、模型 `deepseek-flash`（官方只提供这一个
flash id，滚动指向当前 Flash 版本），key 在 `~/.pi/agent/auth.json` 的 `deepseek` 条目，thinking
**medium**，单场景超时 **240s**。这是 runner、`eval:digests`、`eval:classify` 共用的缺省，直接运行即可，
不要加 `--provider`。`--provider openrouter`（钉 `deepseek/deepseek-v4-flash-0731`）只用于对照；它不是
同一个模型版本，结果与基线**不可比**，不能并进同一份基线（trend 会标 INCOMPARABLE）。

长时间运行前先查余额（`GET https://api.deepseek.com/user/balance`）。每跑完一个套件先看有没有
provider 错误，再启动下一个。

每条未通过的运行都带 `cause=`：`timeout` / `provider` / `setup` / `harness` 是环境问题，
不说明 Agent 行为；`tool-error` 与 `answer` 才是模型自己的工具使用或回答。运行结束的
`Not passed because:` 一行给出各原因的计数。

默认场景采用 semantic：checks 为辅助，未经主 Agent / 人工评审保持 pending。
纯确定性操作可显式标记 programmatic，完成输出及实际 state 检查共同决定验收；
只检查工具名不够。阅读、内容解释和混合任务不可用该模式绕过语义审阅。
主 Agent 按 [结构化审阅](reviewing.md) 直接读日志，使用 `eval:review --list / --case / --save`。
保存逐条评语后执行 `bun run eval:review .eval/<run-id> --gate`；这一步不调用模型，
会根据原始记录和 `human-reviews.json` 更新 summary/report，包含自由追问的结论。
`eval:rescore` 只重算诊断 / 可选自动初评，不删除既有主 Agent 评语。

## 套件地图

| 套件 | 面 |
|---|---|
| karamazov / santi | 叙事真书：剧透围栏、版本保真、预训练知名度压力 + 本书公共行为场景 |
| lebon / refactoring / berger | 说明文/技术书/工具书：概念图、双语纪律、方法应用 + 本书公共行为场景 |
| journeys | 多轮长会话一条龙（选段→追问→标注→跨章→记忆→回顾） |
| legacy | 存量用户：图谱欠账过渡态、旧转录继承、旧断言扬弃 |
| personalization | 记忆必须改变回答（画像 A/B 带对照组） |
| crossbook | 全局线程跨书 |
| search | search/fetch、provider 差异、图片依据、并发与失败恢复；核对来源、图片匹配和延迟，不以调用次数代替效果 |
| memory / annotations / grounding / reading / interactions / settings / tools | 合成小书的基础行为面 |
| shelf | 书架管理：按文件是否还能打开清理、批量加星、按条件查书架 |

## 独立 runner

```sh
bun run eval:digests <slug> [--resume]   # 真书纪要 fixture 重生成（断点续跑）
bun run eval:classify                    # 叙事性分类器对全部注册书回归（5 调用）
```
