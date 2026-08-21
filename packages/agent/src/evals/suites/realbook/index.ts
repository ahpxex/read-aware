/**
 * 真书套件组：以**书本身**为身份轴的套件——每本注册的真书一个专属套件
 * （测它独有的角度：预训练剧透张力、手法目录、概念图谱……），外加
 * realbooks 网格（公共行为 × 全部注册书，配置驱动生成）。真书 fixture
 * 大、场景深、跑一轮贵，单独成组方便按组运行与按组看成本。
 */
import { bergerEvalSuite } from "./berger";
import { karamazovEvalSuite } from "./karamazov";
import { lebonEvalSuite } from "./lebon";
import { refactoringEvalSuite } from "./refactoring";
import { santiEvalSuite } from "./santi";
import { realBooksEvalSuite } from "./real-book-common";

export const realbookSuites = {
  karamazov: karamazovEvalSuite,
  santi: santiEvalSuite,
  lebon: lebonEvalSuite,
  berger: bergerEvalSuite,
  refactoring: refactoringEvalSuite,
  // 网格殿后：它是"所有书的基础行为一致性"的总扫尾
  realbooks: realBooksEvalSuite,
} as const;

export type RealbookSuiteId = keyof typeof realbookSuites;
