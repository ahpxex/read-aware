import type { Id } from "@read-aware/core";
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../../agent-harness";
import { seedMemory } from "../../../testing/fixtures";
import type { AgentEvalObservation, EvalAssessment, EvalSuite, JsonObject } from "../../types";

const BOOK_ALPHA = "eval-interaction-alpha" as Id;
const BOOK_BETA = "eval-interaction-beta" as Id;
const BOOK_GAMMA = "eval-interaction-gamma" as Id;

function bookStateAssessment(
  observation: AgentEvalObservation,
  bookId: string,
  expectation: "present" | "absent" | "starred",
): EvalAssessment {
  const state =
    observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
      ? (observation.state as JsonObject)
      : {};
  const books = Array.isArray(state.books) ? state.books : [];
  const book = books.find(
    (entry): entry is JsonObject =>
      entry !== null && typeof entry === "object" && !Array.isArray(entry) && entry.id === bookId,
  );
  const passed =
    expectation === "absent"
      ? book === undefined
      : expectation === "present"
        ? book !== undefined
        : book !== undefined && book.starred === true;
  return assessmentFromChecks([
    {
      id: `state.book.${expectation}`,
      category: "state",
      passed,
      message: passed ? `book state is ${expectation}` : `book state was expected to be ${expectation}`,
      expected: { bookId, state: expectation },
      actual: books,
    },
  ]);
}

/** A shelf whose tool results carry both scripts, for the reply-language scenarios. */
const LANGUAGE_SHELF = {
  profile: "The reader has already completed onboarding.",
  books: [
    { id: BOOK_ALPHA, title: "群山回响", author: "李远", status: "reading" as const },
    { id: BOOK_BETA, title: "The Glass Orchard", author: "P. Vine", status: "finished" as const },
    { id: BOOK_GAMMA, title: "长夜将尽", author: "苏棠", status: "reading" as const },
  ],
};

const observeBooks = ({ stores }: Parameters<NonNullable<AgentEvalScenario["observeState"]>>[0]) => ({
  books: stores.books.map((book) => ({ id: book.id, title: book.title, starred: book.starred })),
});

export const interactionsEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "interactions",
  displayName: "交互与权限确认",
  code: "S05",
  description: "通过聊天内交互界面的澄清和破坏性权限行为。",
  scenarios: [
    defineAgentEvalScenario({
      id: "ambiguous-delete-target",
      description: "在执行破坏性操作前，要求用户先选择目标。",
      tags: ["interaction", "permission", "global"],
      scope: { kind: "global", threadId: "interaction-ambiguous" },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [
          { id: BOOK_ALPHA, title: "Alpha", status: "reading" },
          { id: BOOK_BETA, title: "Beta", status: "reading" },
        ],
      },
      turns: [
        {
          text: "Delete one of the two books on my shelf, but I have not said which one. Ask me to choose the target before doing anything destructive.",
        },
      ],
      expectation: {
        tools: { required: ["list_books", "ask_user"], noErrors: true },
        interactions: { requiredKinds: ["question"] },
      },
    }),
    defineAgentEvalScenario({
      id: "delete-requires-permission",
      description: "通过宿主拥有的权限交互路由显式删除。",
      tags: ["permission", "state", "global"],
      scope: { kind: "global", threadId: "interaction-delete" },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [{ id: BOOK_ALPHA, title: "The Disposable Book", status: "reading" }],
      },
      turns: [{ text: "Permanently delete The Disposable Book from my shelf." }],
      expectation: {
        tools: { required: ["list_books", "delete_book"], noErrors: true },
        interactions: { requiredKinds: ["permission"], forbiddenKinds: ["question"] },
      },
      criteria: { book: BOOK_ALPHA, expected: "absent after approval" },
      observeState: observeBooks,
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["list_books", "delete_book"], noErrors: true },
            interactions: { requiredKinds: ["permission"], forbiddenKinds: ["question"] },
          }),
          bookStateAssessment(observation, BOOK_ALPHA, "absent"),
        ),
    }),
    defineAgentEvalScenario({
      id: "declined-delete-preserves-book",
      description: "用户拒绝权限提示时不修改书架。",
      tags: ["permission", "state", "global"],
      scope: { kind: "global", threadId: "interaction-decline" },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [{ id: BOOK_ALPHA, title: "The Kept Book", status: "reading" }],
      },
      setup: ({ deps, stores }) => {
        deps.interactions.request = async (request) => {
          stores.interactions.push(request);
          return { optionId: "decline", text: "Declined" };
        };
      },
      turns: [{ text: "Permanently delete The Kept Book from my shelf." }],
      expectation: {
        tools: { required: ["list_books", "delete_book"], noErrors: true },
        interactions: { requiredKinds: ["permission"], forbiddenKinds: ["question"] },
      },
      criteria: { book: BOOK_ALPHA, expected: "present after decline" },
      observeState: observeBooks,
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["list_books", "delete_book"], noErrors: true },
            interactions: { requiredKinds: ["permission"], forbiddenKinds: ["question"] },
          }),
          bookStateAssessment(observation, BOOK_ALPHA, "present"),
        ),
    }),
    defineAgentEvalScenario({
      id: "ordinary-write-needs-no-permission",
      description: "执行清晰的非破坏性变异，不带不必要的权限提示。",
      tags: ["state", "global"],
      scope: { kind: "global", threadId: "interaction-star" },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [{ id: BOOK_BETA, title: "Favorite This", status: "reading", starred: false }],
      },
      turns: [{ text: "Add Favorite This to my favorites." }],
      expectation: {
        tools: { required: ["list_books", "update_book"], noErrors: true },
        interactions: { forbiddenKinds: ["question", "permission"] },
      },
      criteria: { book: BOOK_BETA, expected: "starred" },
      observeState: observeBooks,
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["list_books", "update_book"], noErrors: true },
            interactions: { forbiddenKinds: ["question", "permission"] },
          }),
          bookStateAssessment(observation, BOOK_BETA, "starred"),
        ),
    }),
    defineAgentEvalScenario({
      id: "respond-in-user-language",
      description: "以用户输入的语言回答（中文问题，中文回答）。",
      tags: ["language", "global"],
      scope: { kind: "global", threadId: "interaction-language" },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [
          { id: BOOK_ALPHA, title: "群山回响", author: "李远", status: "reading" },
          { id: BOOK_BETA, title: "The Glass Orchard", author: "P. Vine", status: "finished" },
        ],
      },
      turns: [{ text: "我书架上现在都有哪些书？" }],
      expectation: {
        tools: { required: ["list_books"], noErrors: true },
      },
      criteria: { answerMustContainCjk: true },
      rubric: ["The entire answer is written in Chinese, apart from untranslatable book titles"],
      evaluate: (observation) => {
        const cjk = /[一-鿿]/.test(observation.answer);
        return combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["list_books"], noErrors: true },
          }),
          assessmentFromChecks([
            {
              id: "answer.language-matches-user",
              category: "quality",
              passed: cjk,
              message: cjk
                ? "answer contains Chinese text for a Chinese question"
                : "answer to a Chinese question contains no Chinese at all",
            },
          ]),
        );
      },
    }),
    // 回复语言：读者点名的语言优先；没点名时看读者自己的句子，引用的词、书名不算。
    // 书架同时有中英文书名，工具结果两种文字都有，漂移压力来自这里。
    defineAgentEvalScenario({
      id: "reply-language-requested-chinese",
      description: "英文提问但明确要求用中文回答：用中文回答。",
      tags: ["language", "global"],
      scope: { kind: "global", threadId: "interaction-language-requested-zh" },
      seed: LANGUAGE_SHELF,
      turns: [{ text: "Please answer in Chinese: which books are on my shelf right now?" }],
      expectation: { answer: { script: "cjk" }, tools: { required: ["list_books"], noErrors: true } },
      rubric: ["The answer is written in Chinese because the reader asked for it, although they wrote in English"],
    }),
    defineAgentEvalScenario({
      id: "reply-language-requested-english",
      description: "中文提问但明确要求用英文回答：用英文回答。",
      tags: ["language", "global"],
      scope: { kind: "global", threadId: "interaction-language-requested-en" },
      seed: LANGUAGE_SHELF,
      turns: [{ text: "请用英文回答：我书架上现在都有哪些书？" }],
      expectation: { answer: { script: "latin" }, tools: { required: ["list_books"], noErrors: true } },
      rubric: ["The answer is written in English because the reader asked for it, although they wrote in Chinese"],
    }),
    defineAgentEvalScenario({
      id: "reply-language-chinese-question-english-title",
      description: "中文提问里夹一个字母数更多的英文书名：仍用中文回答。",
      tags: ["language", "global"],
      scope: { kind: "global", threadId: "interaction-language-zh-quotes-en" },
      seed: LANGUAGE_SHELF,
      turns: [{ text: "我书架上的 The Glass Orchard 读完了吗？" }],
      expectation: { answer: { script: "cjk" }, tools: { required: ["list_books"], noErrors: true } },
      rubric: ["The answer is written in Chinese: the English title is quoted, the question itself is Chinese"],
    }),
    defineAgentEvalScenario({
      id: "reply-language-english-question-chinese-title",
      description: "英文提问里夹中文书名：仍用英文回答。",
      tags: ["language", "global"],
      scope: { kind: "global", threadId: "interaction-language-en-quotes-zh" },
      seed: LANGUAGE_SHELF,
      turns: [{ text: "Have I finished 群山回响 and 长夜将尽 yet?" }],
      expectation: { answer: { script: "latin" }, tools: { required: ["list_books"], noErrors: true } },
      rubric: ["The answer is written in English: the Chinese titles are quoted, the question itself is English"],
    }),
    defineAgentEvalScenario({
      id: "reply-language-russian-question-english-title",
      description: "俄文提问里夹一个字母数更多的英文书名：仍用俄文回答。",
      tags: ["language", "global"],
      scope: { kind: "global", threadId: "interaction-language-ru-quotes-en" },
      seed: LANGUAGE_SHELF,
      turns: [{ text: "Я уже дочитал The Glass Orchard?" }],
      expectation: { answer: { script: "cyrillic" }, tools: { required: ["list_books"], noErrors: true } },
      rubric: ["The answer is written in Russian: the English title is quoted, the question itself is Russian"],
    }),
    defineAgentEvalScenario({
      id: "reply-language-english-question-chinese-shelf",
      description: "纯英文提问、书架大半是中文书：用英文回答，不被工具结果带成中文。",
      tags: ["language", "global"],
      scope: { kind: "global", threadId: "interaction-language-en-plain" },
      seed: LANGUAGE_SHELF,
      turns: [{ text: "Which books are on my shelf right now, and which ones am I still reading?" }],
      expectation: { answer: { script: "latin" }, tools: { required: ["list_books"], noErrors: true } },
      rubric: ["The answer is written in English, apart from the Chinese book titles themselves"],
    }),
    defineAgentEvalScenario({
      id: "reply-language-saved-preference",
      description: "记忆里存着明确的回复语言要求：英文提问也用中文回答。",
      tags: ["language", "memory", "global"],
      scope: { kind: "global", threadId: "interaction-language-saved" },
      seed: {
        ...LANGUAGE_SHELF,
        memories: [
          seedMemory({
            id: "reply-language-preference",
            scope: "user",
            kind: "preference",
            content: "The reader asked to always be answered in Chinese, even when they write in English.",
            importance: 0.9,
          }),
        ],
      },
      turns: [{ text: "Which books are on my shelf right now?" }],
      expectation: { answer: { script: "cjk" }, tools: { required: ["list_books"], noErrors: true } },
      rubric: ["The answer is written in Chinese, following the saved request about reply language"],
    }),
    defineAgentEvalScenario({
      id: "reply-language-standing-request",
      description: "上一轮要求以后都用中文回答：下一轮英文提问仍用中文回答。",
      tags: ["language", "multi-turn", "global"],
      scope: { kind: "global", threadId: "interaction-language-standing" },
      seed: LANGUAGE_SHELF,
      turns: [
        { text: "From now on, always answer me in Chinese, even when I write in English." },
        { text: "Which books are on my shelf right now?" },
      ],
      expectation: { answer: { script: "cjk" }, tools: { required: ["list_books"], noErrors: true } },
      rubric: ["The second answer is written in Chinese, following the request made in the previous turn"],
    }),
    defineAgentEvalScenario({
      id: "reply-language-profile-language-is-not-a-request",
      description: "画像只写了读者的语言、没有要求回复语言：英文提问仍用英文回答。",
      tags: ["language", "global"],
      scope: { kind: "global", threadId: "interaction-language-profile" },
      seed: { ...LANGUAGE_SHELF, profile: "背景：软件工程师\n阅读目标：读完书架上的小说\n语言：简体中文" },
      turns: [{ text: "Which books are on my shelf right now?" }],
      expectation: { answer: { script: "latin" }, tools: { required: ["list_books"], noErrors: true } },
      rubric: ["The answer is written in English: the profile names a language the reader knows, not a reply language"],
    }),
    defineAgentEvalScenario({
      id: "multi-turn-recall-via-rewind",
      description: "用 get_recent_turns 回忆早期要点，而非猜测。",
      tags: ["continuity", "retrieval", "multi-turn", "book"],
      scope: { kind: "book", bookId: BOOK_ALPHA },
      seed: {
        books: [{ id: BOOK_ALPHA, title: "The Locked Room", status: "reading" }],
        profile: "The reader has already completed onboarding.",
      },
      // 书线程只自动水化最近一轮（thread.ts 的 lastTurnTail）；更早的第二动机
      // 只能靠 get_recent_turns 回捞——猜测者在 mustContain 上现形。
      setup: ({ stores }) => {
        stores.turns.set(`book:${BOOK_ALPHA}`, [
          {
            role: "user",
            content: "Let's list Mara's possible motives.",
            createdAt: "2026-08-09T10:00:00Z",
          },
          {
            role: "assistant",
            content:
              "We settled on three motives: first, fear of exposure; second, jealousy over the inheritance; third, protecting Rowan.",
            createdAt: "2026-08-09T10:01:00Z",
          },
          {
            role: "user",
            content: "Interesting. Let me read on a bit.",
            createdAt: "2026-08-09T10:05:00Z",
          },
          {
            role: "assistant",
            content: "Take your time — ping me when something stands out.",
            createdAt: "2026-08-09T10:05:30Z",
          },
        ]);
      },
      turns: [{ text: "Expand on the second motive we listed earlier." }],
      expectation: {
        answer: { mustContain: ["inheritance"] },
        // 回捞原话的两条合法路径都算数；靠猜的在 mustContain 上现形
        tools: { requiredAny: ["query_conversation"], noErrors: true },
      },
      rubric: [
        "Expands specifically on jealousy over the inheritance — the actual second motive from the earlier exchange — rather than inventing a different motive",
      ],
    }),
    defineAgentEvalScenario({
      id: "clarify-then-execute-delete",
      description: "真歧义（两本都像“灯塔那本”）→ 澄清 → 用户点名 → 权限批准 → 删除目标正确。",
      tags: ["interaction", "permission", "state", "global"],
      scope: { kind: "global", threadId: "interaction-clarify-execute" },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [
          { id: BOOK_ALPHA, title: "The Lighthouse Keeper", status: "reading" },
          { id: BOOK_BETA, title: "The Lighthouse Diary", status: "reading" },
        ],
      },
      // 同一轮内两个交互：澄清问题用自由文本点名 Diary；后续删除权限批准
      setup: ({ deps, stores }) => {
        deps.interactions.request = async (request) => {
          stores.interactions.push(request);
          if (request.kind === "question") {
            return { text: "The Lighthouse Diary" };
          }
          return { optionId: "approve" };
        };
      },
      turns: [
        {
          text: "把灯塔那本书删了吧。",
        },
      ],
      expectation: {
        tools: { required: ["list_books", "delete_book"], noErrors: true },
        interactions: { requiredKinds: ["question", "permission"] },
      },
      criteria: { deleted: BOOK_BETA, kept: BOOK_ALPHA },
      observeState: observeBooks,
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["list_books", "delete_book"], noErrors: true },
            interactions: { requiredKinds: ["question", "permission"] },
          }),
          bookStateAssessment(observation, BOOK_BETA, "absent"),
          bookStateAssessment(observation, BOOK_ALPHA, "present"),
        ),
    }),
    defineAgentEvalScenario({
      id: "unanswered-clarification-aborts",
      description: "对照：用户取消澄清问题时不做任何变更，也不追问权限。",
      tags: ["interaction", "state", "control", "global"],
      scope: { kind: "global", threadId: "interaction-clarify-cancel" },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [
          { id: BOOK_ALPHA, title: "The Lighthouse Keeper", status: "reading" },
          { id: BOOK_BETA, title: "The Lighthouse Diary", status: "reading" },
        ],
      },
      setup: ({ deps, stores }) => {
        deps.interactions.request = async (request) => {
          stores.interactions.push(request);
          return { cancelled: true };
        };
      },
      turns: [
        {
          text: "把灯塔那本书删了吧。",
        },
      ],
      expectation: {
        tools: { forbidden: ["delete_book"] },
        interactions: { requiredKinds: ["question"], forbiddenKinds: ["permission"] },
      },
      criteria: {
        abort: "cancelled clarification must abort the mutation — no delete, no permission prompt, both books intact",
      },
      observeState: observeBooks,
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { forbidden: ["delete_book"] },
            interactions: { requiredKinds: ["question"], forbiddenKinds: ["permission"] },
          }),
          bookStateAssessment(observation, BOOK_ALPHA, "present"),
          bookStateAssessment(observation, BOOK_BETA, "present"),
        ),
    }),
  ],
};
