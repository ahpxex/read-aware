/**
 * 场景标签的封闭词汇表。标签回答"这个场景测的是什么/以什么形态测"，
 * 让 `--tag` 过滤、summary/trend 的 byTag 汇总与 EVALS.md 的分类法
 * 共用一套机器可读的语言。
 *
 * 三个维度：
 *   1. 能力轴（capability）——测什么行为能力
 *   2. 形态轴（modifier）——以什么形态测（对照、授权、多轮、线程作用域…）
 *   3. 书身份轴（开放）——真书 slug（来自 book-fixtures 注册表，不在此枚举）
 *
 * 套件 id 自身（reading/settings/tools…）不再作为标签：suite id 已经是
 * 场景 id 的命名空间，重复一遍只会稀释词汇表。新增标签 = 在此登记 +
 * 更新 EVALS.md 的词汇表章节 + suites.test.ts 自动收口。
 */

/** 能力轴：场景测的是 agent 的哪种行为能力。 */
export const EVAL_CAPABILITY_TAGS = [
  /** 剧透围栏纪律：守栏、显式授权跨栏、无游标时的谨慎。 */
  "spoiler",
  /** 阅读光标：页面级问题、光标刷新、prompt 前缀稳定性。 */
  "cursor",
  /** 检索与定位：topical 查询、语录定位、跨书定位、检索后作答。 */
  "retrieval",
  /** 轨迹经济：批量查询变体、定点读章、不扫描全书。 */
  "economy",
  /** 持久写入：设置、书架变更、标注逐字保真。 */
  "state",
  /** 记忆：写入 / 检索 / 应用 / 克制 / 透明。 */
  "memory",
  /** 破坏性权限流：请求、拒绝后保持、不滥请求。 */
  "permission",
  /** ask_user 澄清与其他聊天内交互面。 */
  "interaction",
  /** 跨轮/跨章/上下文重置后的召回。 */
  "continuity",
  /** 宿主卡片呈现与呈现克制。 */
  "presentation",
  /** 数据缺失时的诚实：不编造章节、时长、书目、记忆。 */
  "honesty",
  /** 用户语言应答与双语纪律。 */
  "language",
  /** 目录事实与导航（卷册结构、真实章数）。 */
  "toc",
  /** 章节纪要 / 概念图谱注入面（query_book_graph、概念背诵）。 */
  "digest",
  /** 安全边界：凭据不可达、插件工具作用域收敛。 */
  "security",
  /** 插件工具面：插件工具的暴露与执行（全局/书内作用域集成）。 */
  "tool-surface",
] as const;

/** 形态轴：能力的执行形态与场景事实。 */
export const EVAL_MODIFIER_TAGS = [
  /** 阴性对照：断言反向成立（无画像不得幻觉画像、隔书不得串味）。 */
  "control",
  /** 显式剧透授权（spoiler 的许可形态）。 */
  "grant",
  /** 读者已读完该书（无围栏语境）。 */
  "finished",
  /** 前向检索：越过当前光标找后续材料。 */
  "forward",
  /** 选区场景：带可见文本的选区讲解。 */
  "selection",
  /** 多轮场景。 */
  "multi-turn",
  /** 全局（Context 页）线程。 */
  "global",
  /** 书内线程。 */
  "book",
] as const;

export type EvalCapabilityTag = (typeof EVAL_CAPABILITY_TAGS)[number];
export type EvalModifierTag = (typeof EVAL_MODIFIER_TAGS)[number];

/** 封闭集（能力 ∪ 形态）；书身份轴单独校验。 */
export const EVAL_CLOSED_TAGS: readonly string[] = [
  ...EVAL_CAPABILITY_TAGS,
  ...EVAL_MODIFIER_TAGS,
];

/** 校验一组标签：封闭词 + （可选提供的）合法书 slug 集。返回违例描述。 */
export function invalidTags(
  tags: readonly string[],
  extraAllowed: readonly string[] = [],
): string[] {
  const closed = new Set([...EVAL_CLOSED_TAGS, ...extraAllowed]);
  const seen = new Set<string>();
  const violations: string[] = [];
  for (const tag of tags) {
    if (!closed.has(tag)) violations.push(`unknown tag ${JSON.stringify(tag)}`);
    if (seen.has(tag)) violations.push(`duplicate tag ${JSON.stringify(tag)}`);
    seen.add(tag);
  }
  return violations;
}
