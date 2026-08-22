/**
 * 套件注册表。两条正交的组织轴在此汇合：
 *
 *   组（group）——套件之上的运行/汇报单位：
 *     behavior  能力套件（合成 fixture 或横切行为）——见 ./behavior/index.ts
 *     realbook  真书套件（每书一个，内含专属场景与公共场景）——见 ./realbook/index.ts
 *
 *   suite id 保持稳定不变：它是 trend 文件（trend-<id>.json）、工件目录与
 *   viewer 路由的外键。新增套件时顺延 code（S01…只增不改），并归入一组。
 */
import { behaviorSuites, type BehaviorSuiteId } from "./behavior";
import { realbookSuites, type RealbookSuiteId } from "./realbook";

export const evalSuites = { ...behaviorSuites, ...realbookSuites } as const;

export type EvalSuiteId = keyof typeof evalSuites;

export type EvalSuiteGroupId = "behavior" | "realbook";

export interface EvalSuiteGroup {
  id: EvalSuiteGroupId;
  /** 组的一句定位（EVALS.md 与 CLI 报错都会引用）。 */
  description: string;
  suites: Readonly<Record<string, unknown>>;
  /** 组内套件 id 的稳定顺序。 */
  suiteIds: readonly EvalSuiteId[];
}

export const evalSuiteGroups = {
  behavior: {
    id: "behavior",
    description: "能力套件：合成 fixture 上的行为纪律（阅读、记忆、交互、工具、诚实性…）",
    suites: behaviorSuites,
    suiteIds: Object.keys(behaviorSuites) as BehaviorSuiteId[],
  },
  realbook: {
    id: "realbook",
    description: "真书套件：按书名组织，每本书同时覆盖专属能力与公共阅读行为",
    suites: realbookSuites,
    suiteIds: Object.keys(realbookSuites) as RealbookSuiteId[],
  },
} satisfies Record<EvalSuiteGroupId, EvalSuiteGroup>;

export function isEvalSuiteId(value: string): value is EvalSuiteId {
  return Object.prototype.hasOwnProperty.call(evalSuites, value);
}

export function isEvalSuiteGroupId(value: string): value is EvalSuiteGroupId {
  return Object.prototype.hasOwnProperty.call(evalSuiteGroups, value);
}

/** 组选择器（"behavior" / "realbook"）展开为组内套件 id。 */
export function suiteIdsOfGroup(group: EvalSuiteGroupId): readonly EvalSuiteId[] {
  return evalSuiteGroups[group].suiteIds;
}
