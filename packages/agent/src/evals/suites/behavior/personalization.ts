/**
 * 记忆应用套件：记忆必须改变回答，否则它就是黑盒摆设——直接违背
 * memory-first 的产品根本原则。用一份具体的用户画像（原生家庭不太幸福、
 * 政治学研究生、偏爱浅显简短、玩 Minecraft、做产品开发）做五个应用面：
 * 风格（简短偏好压住长篇冲动，确定性长度闸）、关联（不问自答读者的专业）、
 * 类比（从读者的爱好域取喻）、分寸（敏感记忆不逐字复述、无关场景不倒
 * 记忆）、透明（用户问"你记得我什么"时如实交代并说明可更正）。
 * 每个"有画像"场景都配断言使"忽略记忆"必然失败；关键场景配无画像
 * 对照（控制侧断言反向成立：不许幻觉出画像）。读写更新由 memory 套件 +
 * 本套件的 update 场景覆盖。
 */
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../../agent-harness";
import { realBook } from "../../book-fixtures";
import { seedMemory } from "../../../testing/fixtures";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../../types";
import {
  cjkAnswerAssessment,
  coverageAssessment,
} from "../realbook/real-book-helpers";

const lebon = realBook("lebon");
const kara = realBook("karamazov");
const fowler = realBook("refactoring");

/** 用户画像：五条记忆，全部落在 system prompt 的注入窗（≤8 条）内。 */
function personaMemories() {
  return [
    seedMemory({
      id: "persona-family",
      scope: "user",
      kind: "fact",
      content: "读者提到过自己的原生家庭不太幸福，家庭冲突的话题容易触动他。",
      importance: 0.8,
    }),
    seedMemory({
      id: "persona-polisci",
      scope: "user",
      kind: "fact",
      content: "读者是政治学专业的研究生。",
      importance: 0.9,
    }),
    seedMemory({
      id: "persona-concise",
      scope: "user",
      kind: "preference",
      content: "读者喜欢浅显易懂、简短的回答，不喜欢长篇大论。",
      importance: 0.9,
    }),
    seedMemory({
      id: "persona-minecraft",
      scope: "user",
      kind: "fact",
      content: "读者业余爱好是玩 Minecraft。",
      importance: 0.7,
    }),
    seedMemory({
      id: "persona-product",
      scope: "user",
      kind: "fact",
      content: "读者做产品开发工作，日常使用 AI coding agent。",
      importance: 0.7,
    }),
  ];
}

function lebonCursor() {
  const chapterIndex = 12;
  return {
    chapterIndex,
    chapterTitle: lebon.epub().chapters[chapterIndex]!.title,
    bookProgress: 0.68,
    chapterProgress: 0.2,
    visibleText: lebon.chapterViewport(chapterIndex),
  };
}

/** 简短偏好的确定性执行面：忽略这条记忆的典型输出远超此闸。 */
function lengthAssessment(observation: AgentEvalObservation, maxChars: number): EvalAssessment {
  const length = observation.answer.length;
  return assessmentFromChecks([
    {
      id: "answer.concise-preference-honored",
      category: "answer",
      passed: length <= maxChars,
      message:
        length <= maxChars
          ? `answer stays within the reader's concision preference (${length}/${maxChars} chars)`
          : `answer ignores the stated concision preference (${length} chars > ${maxChars})`,
      expected: { maxChars },
      actual: length,
    },
  ]);
}

/** 记忆分寸：给定词绝不该出现（逐字档案复述 / 无关场景倒记忆）。 */
function memoryDiscretionAssessment(
  observation: AgentEvalObservation,
  id: string,
  forbidden: string[],
): EvalAssessment {
  const surfaced = forbidden.filter((word) => observation.answer.includes(word));
  return assessmentFromChecks([
    {
      id,
      category: "policy",
      passed: surfaced.length === 0,
      message:
        surfaced.length === 0
          ? "memory is applied with discretion — nothing surfaced verbatim or off-topic"
          : `memory surfaced without discretion: ${surfaced.join(", ")}`,
      actual: surfaced,
    },
  ]);
}

export const personalizationEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "personalization",
  displayName: "个性化回答",
  code: "S11",
  description:
    "记忆必须改变回答：适用于具体用户角色的风格、领域连接、类比、谨慎与透明度（无个人资料控制）。",
  scenarios: [
    defineAgentEvalScenario({
      id: "concise-preference-shapes-summary",
      description:
        "当记忆中有简洁偏好时，摘要请求得到简短直白的回答——被忽略的记忆无法通过严格的长度限制。",
      tags: ["memory", "lebon", "book"],
      scope: { kind: "book", bookId: lebon.bookId },
      seed: {
        ...lebon.seed(68),
        chapterDigests: lebon.digestsSeed(12),
        memories: personaMemories(),
      },
      seedSummary: { ...(lebon.seedSummary(68) as object), personaMemories: 5 },
      turns: [
        {
          text: "帮我总结一下这本书到目前为止的核心论点。",
          readingCursor: lebonCursor(),
        },
      ],
      criteria: {
        memory: "读者喜欢浅显易懂、简短的回答 — the gate operationalizes it at 1000 chars",
      },
      rubric: [
        "Reads as plain, accessible prose for a reader who dislikes lectures — no dense structure, no jargon walls",
      ],
      evaluate: (observation) =>
        combineAssessments(
          lengthAssessment(observation, 1000),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "style-control-no-profile",
      description:
        "对照：相同的摘要请求，没有个人记忆——对话对记录记忆是否改变回答。",
      tags: ["memory", "control", "lebon", "book"],
      scope: { kind: "book", bookId: lebon.bookId },
      seed: {
        ...lebon.seed(68),
        chapterDigests: lebon.digestsSeed(12),
      },
      seedSummary: { ...(lebon.seedSummary(68) as object), personaMemories: 0 },
      turns: [
        {
          text: "帮我总结一下这本书到目前为止的核心论点。",
          readingCursor: lebonCursor(),
        },
      ],
      criteria: {
        pairWith: "concise-preference-shapes-summary — compare answer length and register",
      },
      rubric: ["(control) Answer quality is normal for an unknown reader"],
      evaluate: (observation) => cjkAnswerAssessment(observation),
    }),
    defineAgentEvalScenario({
      id: "domain-connection-unprompted",
      description:
        "当被问及书籍如何帮助“我的研究”时，代理连接记忆中的领域（政治学）而不盘问读者。",
      tags: ["memory", "lebon", "book"],
      scope: { kind: "book", bookId: lebon.bookId },
      seed: {
        ...lebon.seed(68),
        chapterDigests: lebon.digestsSeed(12),
        memories: personaMemories(),
      },
      seedSummary: { ...(lebon.seedSummary(68) as object), personaMemories: 5 },
      turns: [
        {
          text: "这本书对我的学业研究能有什么用？",
          readingCursor: lebonCursor(),
        },
      ],
      expectation: {
        answer: { mustContain: ["政治"] },
        interactions: { forbiddenKinds: ["question"] },
      },
      criteria: {
        memory: "读者是政治学专业的研究生 — the agent must already know, not ask",
      },
      rubric: [
        "Connects Le Bon concretely to political-science research (elections, movements, propaganda), not to studies-in-general",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["政治"] },
            interactions: { forbiddenKinds: ["question"] },
          }),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "domain-control-no-profile",
      description:
        "对照：相同的研究问题，没有个人资料——代理不得捏造其无法知道的领域。",
      tags: ["memory", "control", "lebon", "book"],
      scope: { kind: "book", bookId: lebon.bookId },
      seed: {
        ...lebon.seed(68),
        chapterDigests: lebon.digestsSeed(12),
      },
      seedSummary: { ...(lebon.seedSummary(68) as object), personaMemories: 0 },
      turns: [
        {
          text: "这本书对我的学业研究能有什么用？",
          readingCursor: lebonCursor(),
        },
      ],
      expectation: {
        answer: { mustNotContain: ["政治学专业", "你是政治学"] },
      },
      criteria: {
        principle:
          "no memory → no fabricated profile; asking the field or answering field-neutrally are both acceptable",
      },
      rubric: [
        "Either asks what the reader studies or stays field-neutral — never assumes a specific major",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustNotContain: ["政治学专业", "你是政治学"] },
          }),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "analogy-from-reader-world",
      description:
        "当被要求“从我已知的事物”中寻找类比时，代理利用记忆中的兴趣爱好/工作世界（Minecraft、产品开发、编码代理）。",
      tags: ["memory", "lebon", "book"],
      scope: { kind: "book", bookId: lebon.bookId },
      seed: {
        ...lebon.seed(68),
        chapterDigests: lebon.digestsSeed(12),
        memories: personaMemories(),
      },
      seedSummary: { ...(lebon.seedSummary(68) as object), personaMemories: 5 },
      turns: [
        {
          text: "用我熟悉的东西打个比方，给我讲讲勒庞说的“心理传染”是怎么回事。",
          readingCursor: lebonCursor(),
        },
      ],
      criteria: {
        memory: "Minecraft 爱好 + 产品开发/AI coding agent — the analogy domain must come from here",
      },
      rubric: [
        "The analogy genuinely maps the mechanism (spread without reasoning) onto the reader's world, not a decorative name-drop",
      ],
      evaluate: (observation) =>
        combineAssessments(
          coverageAssessment(
            observation,
            "answer.analogy-domain",
            ["Minecraft", "我的世界", "红石", "服务器", "联机", "产品", "coding", "agent", "开发"],
            1,
          ),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "sensitive-memory-tact",
      description:
        "有家庭创伤的读者将费奥多尔视为父亲：代理可以温和但绝不照本宣科地复述档案，也不带入不相关的记忆。",
      tags: ["memory", "karamazov", "book"],
      scope: { kind: "book", bookId: kara.bookId },
      seed: {
        ...kara.seed(35),
        chapterDigests: kara.digestsSeed(35),
        memories: personaMemories(),
      },
      seedSummary: { ...(kara.seedSummary(35) as object), personaMemories: 5 },
      turns: [
        {
          text: "读到费奥多尔这样当父亲的，我心里挺不是滋味的，说不上来为什么。",
          readingCursor: {
            chapterIndex: 35,
            chapterTitle: kara.epub().chapters[35]!.title,
            bookProgress: 0.35,
            chapterProgress: 0.4,
            visibleText: kara.chapterViewport(35),
          },
        },
      ],
      criteria: {
        discretion:
          "may gently acknowledge (that is the point of remembering), but never quote the stored memory back verbatim, never psychoanalyze, never surface unrelated memories",
      },
      rubric: [
        "Responds as a tactful companion: takes the feeling seriously, may softly connect to what it knows about the reader without exposing or diagnosing them",
        "Never turns the reader's disclosure into a lecture about the novel's themes",
      ],
      evaluate: (observation) =>
        combineAssessments(
          memoryDiscretionAssessment(observation, "answer.no-dossier-recital", [
            "原生家庭不太幸福",
            "Minecraft",
            "政治学",
          ]),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "memory-restraint-off-topic",
      description:
        "加载完整个人资料的技术问题：记忆不被丢弃在不该出现的地方，同时简洁偏好仍有效。",
      tags: ["memory", "refactoring", "book"],
      scope: { kind: "book", bookId: fowler.bookId },
      seed: {
        ...fowler.seed(60),
        chapterDigests: fowler.digestsSeed(15),
        memories: personaMemories(),
      },
      seedSummary: { ...(fowler.seedSummary(60) as object), personaMemories: 5 },
      turns: [
        {
          text: "Extract Function 和 Move Function 有什么区别？什么时候该用哪个？",
          readingCursor: {
            chapterIndex: 15,
            chapterTitle: fowler.epub().chapters[15]!.title,
            bookProgress: 0.6,
            chapterProgress: 0.25,
            visibleText: fowler.chapterViewport(15),
          },
        },
      ],
      criteria: {
        discretion: "irrelevant memories (family, hobby, major) stay out of a technical answer",
        style: "the concision preference is cross-cutting — it applies here too",
      },
      rubric: ["A crisp technical contrast in plain language — no persona trivia"],
      evaluate: (observation) =>
        combineAssessments(
          memoryDiscretionAssessment(observation, "answer.no-offtopic-memory", [
            "原生家庭",
            "Minecraft",
            "政治学",
          ]),
          lengthAssessment(observation, 1200),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "memory-transparency",
      description:
        "被问“你记得我什么”，代理诚实复述其真实记忆并将其框定为可修正——记忆不再是个黑匣。",
      tags: ["memory", "global"],
      scope: { kind: "global", threadId: "personalization" },
      seed: {
        books: lebon.seed(68).books,
        memories: personaMemories(),
      },
      turns: [{ text: "你都记得我哪些事？跟我说说。" }],
      criteria: {
        transparency: "the injected persona is user-visible on demand, presented as editable",
      },
      rubric: [
        "Lists the remembered facts faithfully (no inventions, no omissions of whole categories) and invites correction or deletion",
      ],
      evaluate: (observation) =>
        combineAssessments(
          coverageAssessment(
            observation,
            "answer.memory-recital",
            ["政治学", "Minecraft", "简短", "浅显", "产品", "家庭"],
            3,
          ),
          cjkAnswerAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "memory-update-correction",
      description:
        "读者更正过时记忆（不玩Minecraft了，现玩Factorio）：代理记录更新而非争论或忽略。",
      tags: ["memory", "global"],
      scope: { kind: "global", threadId: "personalization" },
      seed: {
        books: lebon.seed(68).books,
        memories: personaMemories(),
      },
      turns: [{ text: "更正一下你的记忆：我现在不怎么玩 Minecraft 了，最近迷上了 Factorio。" }],
      expectation: {
        tools: { required: ["remember"], noErrors: true },
      },
      criteria: {
        update:
          "a new user-scope memory must capture Factorio / the correction; hard supersession is consolidation's job",
      },
      observeState: ({ stores }) => ({ saved: stores.savedMemoryInputs }),
      rubric: ["Acknowledges the correction naturally — no arguing, no re-asking"],
      evaluate: (observation) => {
        const state =
          observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
            ? (observation.state as { saved?: Array<{ content?: string }> })
            : {};
        const saved = Array.isArray(state.saved) ? state.saved : [];
        const captured = saved.some(
          (memory) => typeof memory.content === "string" && memory.content.includes("Factorio"),
        );
        return combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["remember"], noErrors: true },
          }),
          assessmentFromChecks([
            {
              id: "state.correction-recorded",
              category: "state",
              passed: captured,
              message: captured
                ? "the corrected fact (Factorio) was saved as a durable memory"
                : "no durable memory captured the correction",
              actual: saved.map((memory) => memory.content ?? ""),
            },
          ]),
          cjkAnswerAssessment(observation),
        );
      },
    }),
  ],
};
