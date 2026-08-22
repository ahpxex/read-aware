/**
 * 真书套件组：以**书本身**为身份轴，每本注册真书一个套件。每个套件同时
 * 包含这本书的专属场景（预训练剧透张力、手法目录、概念图谱……）与配置
 * 驱动生成的公共行为场景。真书 fixture 大、场景深、跑一轮贵，单独成组
 * 方便按书运行与按组看成本。
 */
import { bergerEvalSuite } from "./berger";
import { karamazovEvalSuite } from "./karamazov";
import { lebonEvalSuite } from "./lebon";
import { refactoringEvalSuite } from "./refactoring";
import { santiEvalSuite } from "./santi";

export const realbookSuites = {
  karamazov: karamazovEvalSuite,
  santi: santiEvalSuite,
  lebon: lebonEvalSuite,
  berger: bergerEvalSuite,
  refactoring: refactoringEvalSuite,
} as const;

export type RealbookSuiteId = keyof typeof realbookSuites;
