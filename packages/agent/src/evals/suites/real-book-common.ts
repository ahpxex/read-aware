/**
 * 真书行为网格：同一组公共行为 × 注册表里的每一本书。各书的专属套件测
 * 它独有的角度（预训练剧透张力、手法目录、方法应用……），这里保证的是
 * 基础行为在所有书型上一致成立——话题检索不问坐标、选区讲解守住围栏、
 * 标注逐字保真、跨章会话能召回上一章聊过的主题、叙事书无游标时不泄漏。
 * 每本书一份配置，场景由工厂统一生成；断言素材全部从 fixture 文本实证。
 */
import { combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import { realBook, type RealBookFixture, type RealBookSlug } from "../book-fixtures";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../types";
import {
  cjkAnswerAssessment,
  coverageAssessment,
  fenceDisciplineAssessment,
  leakAssessment,
  noFenceAssessment,
} from "./real-book-helpers";
import { assessmentFromChecks } from "../assertions";

interface GridBookConfig {
  slug: RealBookSlug;
  /** 网格场景统一的读者位置与进度。 */
  readerChapter: number;
  progressPercent: number;
  /** 话题检索："这本书讲没讲 X"——目标内容在读者位置之前（叙事书收边后仍可命中）。 */
  topical: { question: string; anyOf: string[] };
  /** 选区讲解的取句章（读者位置之前）。karamazov 的专属套件已覆盖，跳过。 */
  selectionChapter?: number;
  /** 标注保真的取句章（读者位置之前）。 */
  annotationChapter: number;
  /** 跨章召回：turn1 在 firstChapter 聊一个主题，turn2 越到下一章用指代追问。 */
  crossing: { firstChapter: number; ask: string; followup: string; recallAnyOf: string[] };
  /** 叙事书专用：无游标 + 剧透敏感问题 → 不泄漏（词表实证晚于全书大半）。 */
  noCursor?: { question: string; leakWords: string[] };
  /** 语录定位（karamazov/santi 的专属套件已覆盖，其余书在网格里补齐）。 */
  quoteChapter?: number;
}

const GRID: GridBookConfig[] = [
  {
    slug: "karamazov",
    readerChapter: 35,
    progressPercent: 35,
    topical: {
      question: "这本书里有写到修道院的生活吗？主要在哪些章节？",
      anyOf: ["修道院"],
    },
    annotationChapter: 9,
    crossing: {
      firstChapter: 8,
      ask: "这一章里阿辽沙给你什么印象？",
      followup: "他后来为什么会去修道院？",
      recallAnyOf: ["阿辽沙"],
    },
    noCursor: {
      question: "伊万最后的结局是什么？",
      // 均实证首次出现晚于 35% 进度且不在目录题名里（与 karamazov 套件同源词表）。
      leakWords: ["塞维利亚", "红衣主教", "开庭", "庭审", "弑父"],
    },
  },
  {
    slug: "santi",
    readerChapter: 20,
    progressPercent: 10,
    topical: {
      question: "这套书里讲到量子力学相关的内容了吗？在哪儿讲的？",
      anyOf: ["量子"],
    },
    selectionChapter: 8,
    annotationChapter: 10,
    crossing: {
      firstChapter: 8,
      ask: "叶文洁在这一章里经历了什么？",
      followup: "她的这些经历会怎么影响她之后的选择？",
      // 正确答案很可能通篇用"她"回指——召回的证据是 ch8 的具体内容词，
      // 不是全名复现（实测模型答得完全在题上但只用代词）。
      recallAnyOf: ["叶文洁", "杨冬", "红岸"],
    },
    noCursor: {
      question: "地球文明最后的结局是什么？",
      // 实证首次出现：执剑人 #53、二向箔 #56、云天明 #52、归零者 #57；目录无。
      leakWords: ["执剑人", "二向箔", "云天明", "归零者"],
    },
  },
  {
    slug: "lebon",
    readerChapter: 12,
    progressPercent: 68,
    topical: {
      question: "书里讲到陪审团了吗？在哪一章？",
      anyOf: ["陪审"],
    },
    selectionChapter: 6,
    annotationChapter: 10,
    crossing: {
      firstChapter: 11,
      ask: "领袖说服群体的手段这一章讲了哪几种？",
      followup: "这些手段里哪一种最依赖威望？",
      recallAnyOf: ["断言", "重复", "传染"],
    },
    quoteChapter: 6,
  },
  {
    slug: "refactoring",
    readerChapter: 15,
    progressPercent: 60,
    topical: {
      question: "这本书讲怎么写测试吗？在哪一章？",
      anyOf: ["Building Tests", "测试"],
    },
    selectionChapter: 8,
    annotationChapter: 10,
    crossing: {
      firstChapter: 12,
      ask: "Extract Function 的要点是什么？",
      followup: "它和相反方向的那个手法是什么关系？",
      recallAnyOf: ["Extract Function", "Inline Function"],
    },
    quoteChapter: 10,
  },
  {
    slug: "berger",
    readerChapter: 5,
    progressPercent: 50,
    topical: {
      question: "书里有讲开放式问题吗？在哪部分讲的？",
      anyOf: ["开放式"],
    },
    selectionChapter: 4,
    annotationChapter: 4,
    crossing: {
      firstChapter: 4,
      ask: "做决策前书里说要先问自己哪几类问题？",
      followup: "把刚才那几类问题套在“要不要换工作”这个决定上，帮我写出来。",
      recallAnyOf: ["如果", "为什么", "假设"],
    },
    quoteChapter: 4,
  },
];

function cursorAt(book: RealBookFixture, chapterIndex: number, progressPercent: number) {
  const chapter = book.epub().chapters[chapterIndex];
  if (!chapter) throw new Error(`${book.spec.slug} fixture has no chapter ${chapterIndex}`);
  return {
    chapterIndex,
    chapterTitle: chapter.title,
    bookProgress: progressPercent / 100,
    chapterProgress: 0.3,
    visibleText: book.chapterViewport(chapterIndex),
  };
}

/** 选区游标：视口恰好截止在选区末尾（读者的确切当前位置）。 */
function selectionCursor(book: RealBookFixture, chapterIndex: number, selection: string) {
  const epub = book.epub();
  const chapter = epub.chapters[chapterIndex];
  if (!chapter) throw new Error(`${book.spec.slug} fixture has no chapter ${chapterIndex}`);
  const at = chapter.text.indexOf(selection);
  if (at < 0) {
    throw new Error(`${book.spec.slug} fixture lost the selection in chapter ${chapterIndex}`);
  }
  const end = at + selection.length;
  const charsBefore = epub.chapters
    .slice(0, chapterIndex)
    .reduce((sum, entry) => sum + entry.text.length, 0);
  const totalChars = epub.chapters.reduce((sum, entry) => sum + entry.text.length, 0);
  return {
    chapterIndex,
    chapterTitle: chapter.title,
    bookProgress: (charsBefore + end) / totalChars,
    chapterProgress: end / chapter.text.length,
    visibleText: chapter.text.slice(Math.max(0, end - 600), end),
  };
}

/** 书型分派的红线组合：叙事书查围栏纪律，说明书查围栏必须不存在。 */
function typeDiscipline(
  book: RealBookFixture,
  observation: AgentEvalObservation,
  ceiling: number,
): EvalAssessment {
  return book.spec.narrativity === "narrative"
    ? fenceDisciplineAssessment(observation, ceiling)
    : noFenceAssessment(observation);
}

type SetupContext = Parameters<NonNullable<AgentEvalScenario["setup"]>>[0];

function observeAnnotations({ stores }: SetupContext) {
  return stores.annotations.map((annotation) => ({
    kind: annotation.kind,
    text:
      annotation.kind === "highlight"
        ? annotation.text
        : annotation.kind === "note"
          ? annotation.body
          : "",
  }));
}

function highlightVerbatimAssessment(
  observation: AgentEvalObservation,
  chapterText: string,
): EvalAssessment {
  const state = Array.isArray(observation.state)
    ? (observation.state as Array<{ kind: string; text: string }>)
    : [];
  const highlights = state.filter((entry) => entry.kind === "highlight");
  const verbatim =
    highlights.length > 0 &&
    highlights.every((entry) => entry.text.length > 0 && chapterText.includes(entry.text));
  const hasNote = state.some((entry) => entry.kind === "note" && entry.text.length > 0);
  return assessmentFromChecks([
    {
      id: "state.highlight-verbatim",
      category: "state",
      passed: verbatim,
      message: verbatim
        ? "highlight text is a verbatim span of the chapter"
        : "highlight is missing or paraphrases the book text",
      actual: highlights.map((entry) => entry.text),
    },
    {
      id: "state.note-recorded",
      category: "state",
      passed: hasNote,
      message: hasNote ? "a note was recorded" : "no note was recorded",
    },
  ]);
}

function scenariosFor(config: GridBookConfig): AgentEvalScenario[] {
  const book = realBook(config.slug);
  const baseSeed = () => ({
    ...book.seed(config.progressPercent),
    ...(book.hasDigests()
      ? { chapterDigests: book.digestsSeed(config.readerChapter) }
      : {}),
  });
  const scope = { kind: "book", bookId: book.bookId } as const;
  const scenarios: AgentEvalScenario[] = [];

  // ── 话题检索：不问坐标、不走剧透仪式，答案落到本书内容。 ──
  scenarios.push(
    defineAgentEvalScenario({
      id: `${config.slug}-topical-lookup`,
      description: `Topical coverage lookup on ${config.slug}: search and cite, no position interrogation, no spoiler ceremony.`,
      tags: [config.slug, "real-book", "grid", "topical", "book"],
      scope,
      seed: baseSeed(),
      seedSummary: book.seedSummary(config.progressPercent),
      turns: [
        {
          text: config.topical.question,
          readingCursor: cursorAt(book, config.readerChapter, config.progressPercent),
        },
      ],
      expectation: {
        tools: { requiredAny: ["search_book_text", "get_toc", "read_chapter"], noErrors: true },
        interactions: { forbiddenKinds: ["question", "permission"] },
      },
      rubric: [
        "Answers with concrete chapter/section references from this book, without retelling unread plot events",
      ],
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: {
              requiredAny: ["search_book_text", "get_toc", "read_chapter"],
              noErrors: true,
            },
            interactions: { forbiddenKinds: ["question", "permission"] },
          }),
          coverageAssessment(
            observation,
            "answer.topic-coverage",
            config.topical.anyOf,
            1,
          ),
          typeDiscipline(book, observation, config.readerChapter),
          cjkAnswerAssessment(observation),
        ),
    }),
  );

  // ── 选区讲解：讲清读者选中的段落，叙事书不越界取材。 ──
  if (config.selectionChapter !== undefined) {
    const selection = book.pickSentence(config.selectionChapter);
    const chapterCeiling = config.selectionChapter;
    scenarios.push(
      defineAgentEvalScenario({
        id: `${config.slug}-selection-explain`,
        description: `Selected-passage explanation on ${config.slug}: grounded in the selection, boundary-safe.`,
        tags: [config.slug, "real-book", "grid", "selection", "book"],
        scope,
        seed: baseSeed(),
        seedSummary: book.seedSummary(config.progressPercent),
        turns: [
          {
            text: "这段话帮我讲讲，它到底在说什么？",
            attachments: [{ text: selection }],
            readingCursor: selectionCursor(book, config.selectionChapter, selection),
          },
        ],
        criteria: { selectionChapter: config.selectionChapter, selection },
        rubric: [
          "Explains THIS passage using its actual surrounding context, not a generic summary of the book",
        ],
        evaluate: (observation) =>
          combineAssessments(
            typeDiscipline(book, observation, chapterCeiling),
            cjkAnswerAssessment(observation),
          ),
      }),
    );
  }

  // ── 标注保真：高亮必须逐字，笔记必须落库。 ──
  {
    const sentence = book.pickSentence(config.annotationChapter);
    const chapterText = book.epub().chapters[config.annotationChapter]!.text;
    scenarios.push(
      defineAgentEvalScenario({
        id: `${config.slug}-annotate-verbatim`,
        description: `Highlight + note flow on ${config.slug}: verbatim highlight text, note recorded.`,
        tags: [config.slug, "real-book", "grid", "annotations", "state", "book"],
        scope,
        seed: baseSeed(),
        seedSummary: book.seedSummary(config.progressPercent),
        turns: [
          {
            text: "帮我把选中的这段话高亮，另外加一条笔记：这里值得回头再读。",
            attachments: [{ text: sentence }],
            readingCursor: selectionCursor(book, config.annotationChapter, sentence),
          },
        ],
        expectation: {
          tools: { required: ["create_annotation"], noErrors: true },
          interactions: { forbiddenKinds: ["question", "permission"] },
        },
        criteria: { annotationChapter: config.annotationChapter, sentence },
        observeState: observeAnnotations,
        evaluate: (observation) =>
          combineAssessments(
            evaluateAgentTrace(observation, {
              tools: { required: ["create_annotation"], noErrors: true },
              interactions: { forbiddenKinds: ["question", "permission"] },
            }),
            highlightVerbatimAssessment(observation, chapterText),
            typeDiscipline(book, observation, config.annotationChapter),
          ),
      }),
    );
  }

  // ── 跨章召回：换章重置上下文后，指代性追问仍能接上上一章的话题。 ──
  scenarios.push(
    defineAgentEvalScenario({
      id: `${config.slug}-crossing-recall`,
      description: `Chapter-crossing recall on ${config.slug}: a follow-up after the chapter boundary still resolves the prior topic.`,
      tags: [config.slug, "real-book", "grid", "multi-turn", "book"],
      scope,
      seed: baseSeed(),
      seedSummary: book.seedSummary(config.progressPercent),
      turns: [
        {
          text: config.crossing.ask,
          readingCursor: cursorAt(book, config.crossing.firstChapter, config.progressPercent),
        },
        {
          text: config.crossing.followup,
          readingCursor: cursorAt(
            book,
            config.crossing.firstChapter + 1,
            config.progressPercent,
          ),
        },
      ],
      criteria: {
        boundary: `turn 1 at chapter ${config.crossing.firstChapter}, turn 2 at ${config.crossing.firstChapter + 1} — context resets on chapter change, recall must survive`,
        recallAnyOf: config.crossing.recallAnyOf,
      },
      rubric: [
        "The follow-up answer stays on the topic established in turn 1 without asking the reader to repeat themselves",
      ],
      evaluate: (observation) =>
        combineAssessments(
          coverageAssessment(
            observation,
            "answer.crossing-recall",
            config.crossing.recallAnyOf,
            1,
          ),
          typeDiscipline(book, observation, config.crossing.firstChapter + 1),
          cjkAnswerAssessment(observation),
        ),
    }),
  );

  // ── 无游标 + 剧透敏感（叙事书）：位置不明时宁问勿泄。 ──
  const noCursor = config.noCursor;
  if (noCursor) {
    scenarios.push(
      defineAgentEvalScenario({
        id: `${config.slug}-no-cursor-caution`,
        description: `No-cursor spoiler caution on ${config.slug}: position unknown, ending question, nothing leaks.`,
        tags: [config.slug, "real-book", "grid", "spoiler", "no-cursor", "book"],
        scope,
        seed: baseSeed(),
        seedSummary: book.seedSummary(config.progressPercent),
        turns: [{ text: noCursor.question }],
        criteria: {
          rule: "no visible cursor + unknown current chapter → ask for the reader's position or refuse with a one-line caution; never retell the ending",
          leakWords: noCursor.leakWords,
        },
        rubric: [
          "Either asks where the reader currently is or gives a spoiler-cautious deferral — and reveals nothing about the ending either way",
        ],
        evaluate: (observation) =>
          combineAssessments(
            leakAssessment(observation, noCursor.leakWords),
            cjkAnswerAssessment(observation),
          ),
      }),
    );
  }

  // ── 语录定位（专属套件未覆盖的书）。 ──
  const quoteChapter = config.quoteChapter;
  if (quoteChapter !== undefined) {
    const quote = book.pickSentence(quoteChapter);
    scenarios.push(
      defineAgentEvalScenario({
        id: `${config.slug}-quote-locates`,
        description: `Verbatim quote location on ${config.slug}: names the chapter the quote lives in.`,
        tags: [config.slug, "real-book", "grid", "retrieval", "book"],
        scope,
        seed: baseSeed(),
        seedSummary: book.seedSummary(config.progressPercent),
        turns: [
          {
            text: `书里有这么一句："${quote}" 这是哪一章的？`,
            readingCursor: cursorAt(book, config.readerChapter, config.progressPercent),
          },
        ],
        expectation: {
          answer: { mustContain: [book.chapterTitleKey(quoteChapter)] },
          tools: { required: ["search_book_text"], noErrors: true },
        },
        rubric: ["Names the correct chapter by this edition's own title"],
        evaluate: (observation) =>
          combineAssessments(
            evaluateAgentTrace(observation, {
              answer: { mustContain: [book.chapterTitleKey(quoteChapter)] },
              tools: { required: ["search_book_text"], noErrors: true },
            }),
            typeDiscipline(book, observation, config.readerChapter),
            cjkAnswerAssessment(observation),
          ),
      }),
    );
  }

  return scenarios;
}

export const realBooksEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "realbooks",
  description:
    "The common behavior grid, generated over every registered real book (topical lookup, selection, annotation fidelity, chapter-crossing recall, no-cursor caution, quote location).",
  scenarios: GRID.flatMap(scenariosFor),
};
