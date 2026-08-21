/**
 * 跨书套件：全局（Context 页）线程跨真书工作。书线程测单书纪律，这里测
 * 只有全书架才暴露的行为——"哪本书说过这句话"的跨书定位、两本书的
 * 对读综合（含一个已知的开放张力：全局线程没有宿主围栏，未读完的叙事书
 * 只能靠提示词规则自律——泄漏检查在此是行为观察哨），以及基于书架
 * 实况的推荐（卡片呈现、不编造书目）。
 */
import { combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import { realBook } from "../book-fixtures";
import type { EvalSuite } from "../types";
import { cjkAnswerAssessment, leakAssessment } from "./real-book-helpers";

const kara = realBook("karamazov");
const santi = realBook("santi");
const lebon = realBook("lebon");
const fowler = realBook("refactoring");

/** 三体读者仍在第一部前段——全局线程的内容级泄漏标记（词表与 santi 套件同源）。 */
const SANTI_LEAK_WORDS = ["智子", "面壁计划", "罗辑", "宇宙社会学", "执剑人", "二向箔"];

function shelfSeed() {
  return {
    books: [
      { ...kara.seed(100, "finished").books![0]! },
      { ...santi.seed(10).books![0]! },
      { ...lebon.seed(68).books![0]! },
      { ...fowler.seed(60).books![0]! },
    ],
    chapters: {
      ...kara.seed(100).chapters,
      ...santi.seed(10).chapters,
      ...lebon.seed(68).chapters,
      ...fowler.seed(60).chapters,
    },
  };
}

function shelfSummary() {
  return {
    fixture: "4 real books (karamazov finished, santi 10%, lebon 68%, refactoring 60%)",
    books: [kara, santi, lebon, fowler].map((book) => book.seedSummary(0)),
  };
}

export const crossbookEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "crossbook",
  description: "Global-thread behaviors across a shelf of real books.",
  scenarios: [
    defineAgentEvalScenario({
      id: "which-book-said-it",
      description:
        "A half-remembered line is located across the whole shelf and attributed to the right book.",
      tags: ["crossbook", "real-book", "global", "retrieval"],
      scope: { kind: "global", threadId: "crossbook" },
      seed: shelfSeed(),
      seedSummary: shelfSummary(),
      turns: [
        {
          text: "我记得书架上哪本书里说过“群体喜爱幻想甚于真理”这类的话，是哪本？原话是怎么说的？",
        },
      ],
      expectation: {
        answer: { mustContain: ["乌合之众"] },
        tools: { required: ["search_book_text"], noErrors: true },
      },
      criteria: {
        source: "lebon chapter 10 — 群体总是喜爱幻想，甚于喜爱真理",
      },
      rubric: ["Quotes or closely paraphrases the actual line and names its chapter"],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["乌合之众"] },
            tools: { required: ["search_book_text"], noErrors: true },
          }),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "cross-book-synthesis-spoiler-safe",
      description:
        "Synthesizes Le Bon's crowd psychology with the Three-Body cult WITHOUT leaking beyond the reader's early Three-Body position (the global thread has no host fence — prompt discipline only).",
      tags: ["crossbook", "real-book", "global", "synthesis", "spoiler"],
      scope: { kind: "global", threadId: "crossbook" },
      seed: shelfSeed(),
      seedSummary: shelfSummary(),
      turns: [
        {
          text: "《乌合之众》讲的群体心理，和《三体》里我读到的那些狂热群众有什么呼应？从两本书里找点实际段落谈谈。注意我三体才刚开头。",
        },
      ],
      expectation: {
        tools: {
          requiredAny: ["search_book_text", "read_chapter"],
          noErrors: true,
        },
      },
      criteria: {
        knownGap:
          "the global thread arms no host fence; staying behind the santi cursor here is pure prompt discipline — this scenario is the watchpost for that gap",
        leakWords: SANTI_LEAK_WORDS,
      },
      rubric: [
        "Grounds the comparison in retrieved passages from both books and keeps every Three-Body reference within the opening chapters the reader has seen",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { requiredAny: ["search_book_text", "read_chapter"], noErrors: true },
          }),
          leakAssessment(observation, SANTI_LEAK_WORDS),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "shelf-grounded-recommendation",
      description:
        "A what-next recommendation stays on the actual shelf and renders books as cards.",
      tags: ["crossbook", "real-book", "global", "recommendation", "cards"],
      scope: { kind: "global", threadId: "crossbook" },
      seed: shelfSeed(),
      seedSummary: shelfSummary(),
      turns: [
        {
          text: "看看我书架上这几本和各自的进度，推荐我接下来优先读哪本？说说为什么。",
        },
      ],
      expectation: {
        tools: { required: ["list_books", "present_books"], noErrors: true },
        interactions: { forbiddenKinds: ["permission"] },
      },
      rubric: [
        "Recommends only from the four shelf books, reasons from their actual progress states, and presents the pick(s) as cards without re-listing them in prose",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["list_books", "present_books"], noErrors: true },
            interactions: { forbiddenKinds: ["permission"] },
          }),
          cjkAnswerAssessment(observation),
        ),
    }),
  ],
};
