/**
 * 书架管理：按文件是否还能打开来清理、批量操作、按条件查书架。
 *
 * 这些场景来自一次真实对话：读者让助手删掉"只有占位、文件已经不在"的书，
 * 助手逐本查询（107 次调用）后把"文件不在本机"当成了"文件丢了"。场景里的
 * 文件状态由 setup 给出，对应应用里 check_book_files 的回答：只有"同步后端答复没有副本"
 * 才算文件没了，问不到（连不上、已登出、没开同步）一律是未知。
 */
import type { BookFileAvailability, Id } from "@read-aware/core";
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../../agent-harness";
import type { AgentEvalObservation, EvalAssessment, EvalSuite, JsonObject } from "../../types";

const id = (name: string) => `eval-shelf-${name}` as Id;

const ON_DEVICE = id("on-device");
const ON_DEVICE_TOO = id("on-device-too");
const IN_SYNC = id("in-sync");
const LOST = id("lost");
const LOST_TOO = id("lost-too");
const FEED = id("feed");
const TWIN_OLD = id("twin-old");
const TWIN_LOCAL = id("twin-local");

const PROFILE = "The reader has already completed onboarding.";
const REMOVE_REQUEST = "能不能帮我把现在书架上那些假的书删了？就是那些只有书籍占位，但实际上文件已经不存在的书";

const CLEANUP_SHELF = [
  { id: ON_DEVICE, title: "丁庄梦", author: "阎连科", format: "epub" as const, fileSize: 289_884, fileOnDevice: true },
  { id: ON_DEVICE_TOO, title: "Clean Code", format: "pdf" as const, fileSize: 20_370_601, fileOnDevice: true },
  {
    id: IN_SYNC,
    title: "纳瓦尔宝典",
    format: "epub" as const,
    fileSize: 651_242,
    fileOnDevice: false,
    progressPercent: 7,
    status: "reading" as const,
  },
  { id: LOST, title: "中国社会学经典导读", format: "pdf" as const, fileSize: 183_788_881, fileOnDevice: false },
  { id: LOST_TOO, title: "Moby Dick", format: "epub" as const, fileSize: 812_560, fileOnDevice: false },
  { id: FEED, title: "少数派", format: "virtual" as const, progressPercent: 29 },
];

/** Without a scripted answer: a file on the device opens, a virtual book has none, anything else cannot be verified. */
function defaultAvailability(book: { format?: string; fileOnDevice?: boolean }): BookFileAvailability {
  if (book.format === "virtual") return { state: "virtual" };
  return book.fileOnDevice ? { state: "on-device" } : { state: "unknown", reason: "unreachable" };
}

/** What check_book_files answers for each seeded book, standing in for the sync backend. */
function fileChecks(answers: Record<string, BookFileAvailability>): NonNullable<AgentEvalScenario["setup"]> {
  return ({ deps, stores }) => {
    deps.library.checkBookFiles = async (bookIds) => {
      const targets = bookIds
        ? stores.books.filter((book) => bookIds.includes(book.id))
        : stores.books.filter((book) => book.format !== "virtual" && book.fileOnDevice === false);
      return {
        checks: targets.map((book) => ({
          bookId: book.id,
          title: book.title,
          file: answers[book.id] ?? defaultAvailability(book),
        })),
        remaining: 0,
      };
    };
  };
}

const observeShelf = ({ stores }: Parameters<NonNullable<AgentEvalScenario["observeState"]>>[0]) => ({
  books: stores.books.map((book) => ({ id: book.id, title: book.title, starred: book.starred ?? false })),
});

function shelfState(observation: AgentEvalObservation): Array<{ id: string; starred: boolean }> {
  const state =
    observation.state && typeof observation.state === "object" && !Array.isArray(observation.state)
      ? (observation.state as JsonObject)
      : {};
  return (Array.isArray(state.books) ? state.books : []).flatMap((entry) =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry) && typeof entry.id === "string"
      ? [{ id: entry.id, starred: entry.starred === true }]
      : [],
  );
}

/** Books that must survive (they open, or could not be verified) and books that must be gone. */
function removalAssessment(observation: AgentEvalObservation, keep: string[], remove: string[]): EvalAssessment {
  const present = new Set(shelfState(observation).map((book) => book.id));
  const wronglyRemoved = keep.filter((bookId) => !present.has(bookId));
  const leftBehind = remove.filter((bookId) => present.has(bookId));
  return assessmentFromChecks([
    {
      id: "state.books.kept",
      category: "state",
      // Removing a book that still opens is the failure this suite exists for.
      weight: 3,
      passed: wronglyRemoved.length === 0,
      message: wronglyRemoved.length
        ? "removed books that can still be opened or were not verified"
        : "kept every book that opens",
      expected: keep,
      actual: wronglyRemoved,
    },
    {
      id: "state.books.removed",
      category: "state",
      passed: leftBehind.length === 0,
      message: leftBehind.length ? "left entries whose file is gone" : "removed the entries whose file is gone",
      expected: remove,
      actual: leftBehind,
    },
  ]);
}

export const shelfEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "shelf",
  displayName: "书架管理",
  code: "S19",
  description: "按文件是否还能打开清理书架、批量操作、按条件查书架。",
  scenarios: [
    defineAgentEvalScenario({
      id: "remove-entries-whose-file-is-gone",
      description: "只删除文件确实取不回的书；文件在本机、同步里还有、或是订阅源的书都保留。",
      tags: ["state", "permission", "global", "smoke"],
      scope: { kind: "global", threadId: "shelf-cleanup" },
      seed: { profile: PROFILE, books: CLEANUP_SHELF },
      setup: fileChecks({
        [IN_SYNC]: { state: "retrievable" },
        [LOST]: { state: "unretrievable", reason: "not-on-relay" },
        [LOST_TOO]: { state: "unretrievable", reason: "not-on-relay" },
      }),
      turns: [{ text: REMOVE_REQUEST }],
      expectation: {
        tools: {
          required: ["check_book_files"],
          requiredAny: ["delete_books", "delete_book"],
          noErrors: true,
          maxCalls: 10,
        },
        interactions: { requiredKinds: ["permission"] },
      },
      criteria: {
        keep: ["丁庄梦", "Clean Code", "纳瓦尔宝典（同步里还有）", "少数派（订阅源）"],
        remove: ["中国社会学经典导读", "Moby Dick"],
      },
      observeState: observeShelf,
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: {
              required: ["check_book_files"],
              requiredAny: ["delete_books", "delete_book"],
              noErrors: true,
              maxCalls: 10,
            },
            interactions: { requiredKinds: ["permission"] },
          }),
          removalAssessment(observation, [ON_DEVICE, ON_DEVICE_TOO, IN_SYNC, FEED], [LOST, LOST_TOO]),
        ),
    }),
    defineAgentEvalScenario({
      id: "unverified-files-are-not-removed",
      description: "同步连不上时无法确认文件是否还在：如实说明，不删除任何书。",
      tags: ["state", "honesty", "global"],
      scope: { kind: "global", threadId: "shelf-unverified" },
      seed: { profile: PROFILE, books: CLEANUP_SHELF },
      setup: fileChecks({
        [IN_SYNC]: { state: "unknown", reason: "unreachable" },
        [LOST]: { state: "unknown", reason: "unreachable" },
        [LOST_TOO]: { state: "unknown", reason: "unreachable" },
      }),
      turns: [{ text: REMOVE_REQUEST }],
      expectation: {
        tools: {
          required: ["check_book_files"],
          forbidden: ["delete_books", "delete_book"],
          noErrors: true,
          maxCalls: 8,
        },
        interactions: { forbiddenKinds: ["permission"] },
      },
      criteria: {
        expected: "说明这 3 本的文件不在本机、目前连不上同步所以无法确认是否还能取回，不提议删除它们；没有任何书被删。",
      },
      observeState: observeShelf,
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: {
              required: ["check_book_files"],
              forbidden: ["delete_books", "delete_book"],
              noErrors: true,
              maxCalls: 8,
            },
            interactions: { forbiddenKinds: ["permission"] },
          }),
          removalAssessment(
            observation,
            CLEANUP_SHELF.map((book) => book.id),
            [],
          ),
        ),
    }),
    defineAgentEvalScenario({
      id: "signed-out-sync-is-not-loss",
      description: "同步已登出时没人能回答文件还在不在：说明重新登录可能找回，不删除、不发起删除审批。",
      tags: ["state", "honesty", "global"],
      scope: { kind: "global", threadId: "shelf-signed-out" },
      seed: { profile: PROFILE, books: CLEANUP_SHELF },
      setup: fileChecks({
        [IN_SYNC]: { state: "unknown", reason: "not-connected" },
        [LOST]: { state: "unknown", reason: "not-connected" },
        [LOST_TOO]: { state: "unknown", reason: "not-connected" },
      }),
      turns: [{ text: REMOVE_REQUEST }],
      expectation: {
        tools: {
          required: ["check_book_files"],
          forbidden: ["delete_books", "delete_book"],
          noErrors: true,
          maxCalls: 8,
        },
        interactions: { forbiddenKinds: ["permission"] },
      },
      criteria: {
        expected:
          "说明这 3 本的文件不在本机，而同步当前未登录（或其后端不可用），所以无法确认文件是否还在；重新登录同步后可能取回。不把它们称为已丢失，不提议现在删除；没有任何书被删。",
      },
      observeState: observeShelf,
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: {
              required: ["check_book_files"],
              forbidden: ["delete_books", "delete_book"],
              noErrors: true,
              maxCalls: 8,
            },
            interactions: { forbiddenKinds: ["permission"] },
          }),
          removalAssessment(
            observation,
            CLEANUP_SHELF.map((book) => book.id),
            [],
          ),
        ),
    }),
    defineAgentEvalScenario({
      id: "same-file-twice-is-pointed-out",
      description: "打不开的旧记录带着批注和星标，而同一个文件另有一条能打开的记录：删除前要讲清楚。",
      tags: ["honesty", "global"],
      scope: { kind: "global", threadId: "shelf-twins" },
      seed: {
        profile: PROFILE,
        books: [
          {
            id: TWIN_OLD,
            title: "卡拉马佐夫兄弟",
            author: "吴健平, 荣如德",
            format: "epub",
            fileSize: 4_710_381,
            fileOnDevice: false,
            annotationCount: 13,
            starred: true,
            progressPercent: 26,
            status: "reading",
          },
          {
            id: TWIN_LOCAL,
            title: "卡拉马佐夫兄弟【上海译文出品】",
            author: "陀思妥耶夫斯基",
            format: "epub",
            fileSize: 4_710_381,
            fileOnDevice: true,
            annotationCount: 0,
            progressPercent: 49,
            status: "reading",
          },
          { id: LOST, title: "Moby Dick", format: "epub", fileSize: 812_560, fileOnDevice: false },
        ],
      },
      setup: async (context) => {
        await fileChecks({
          [TWIN_OLD]: { state: "unretrievable", reason: "not-on-relay" },
          [LOST]: { state: "unretrievable", reason: "not-on-relay" },
        })(context);
        // The reader stops at the first question or approval: the scenario judges what they were told.
        context.deps.interactions.request = async (request) => {
          context.stores.interactions.push(request);
          return { cancelled: true };
        };
      },
      turns: [{ text: REMOVE_REQUEST }],
      expectation: { tools: { required: ["check_book_files"], noErrors: true, maxCalls: 10 } },
      criteria: {
        expected:
          "在删除前告诉读者：打不开的那条《卡拉马佐夫兄弟》与另一条能打开的记录大小相同、很可能是同一本书，且它带有 13 条批注、星标和 26% 的进度，删掉会一并失去；不把能打开的那条列为要删的书。",
      },
      observeState: observeShelf,
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["check_book_files"], noErrors: true, maxCalls: 10 },
          }),
          removalAssessment(observation, [TWIN_LOCAL, TWIN_OLD], []),
        ),
    }),
    defineAgentEvalScenario({
      id: "star-several-books-at-once",
      evaluation: "programmatic",
      description: "一次调用给多本书加星，不逐本调用，也不要求确认。",
      tags: ["state", "global"],
      scope: { kind: "global", threadId: "shelf-star" },
      seed: {
        profile: PROFILE,
        books: [
          { id: id("s1"), title: "三体", status: "reading", starred: false },
          { id: id("s2"), title: "黑暗森林", status: "unread", starred: false },
          { id: id("s3"), title: "死神永生", status: "unread", starred: false },
          { id: id("s4"), title: "Clean Code", status: "unread", starred: false },
        ],
      },
      turns: [{ text: "把《三体》《黑暗森林》《死神永生》这三本都加星标" }],
      expectation: {
        tools: { required: ["list_books", "update_book"], noErrors: true, maxCalls: 5 },
        interactions: { forbiddenKinds: ["question", "permission"] },
      },
      criteria: { starred: ["三体", "黑暗森林", "死神永生"], untouched: ["Clean Code"] },
      observeState: observeShelf,
      evaluate: (observation) => {
        const starred = new Set(
          shelfState(observation)
            .filter((book) => book.starred)
            .map((book) => book.id),
        );
        const expected = [id("s1"), id("s2"), id("s3")];
        const passed = expected.every((bookId) => starred.has(bookId)) && !starred.has(id("s4"));
        return combineAssessments(
          evaluateAgentTrace(observation, {
            tools: { required: ["list_books", "update_book"], noErrors: true, maxCalls: 5 },
            interactions: { forbiddenKinds: ["question", "permission"] },
          }),
          assessmentFromChecks([
            {
              id: "state.books.starred",
              category: "state",
              passed,
              message: passed
                ? "exactly the three named books are starred"
                : "the starred set is not the three named books",
              expected,
              actual: [...starred],
            },
          ]),
        );
      },
    }),
    defineAgentEvalScenario({
      id: "find-books-by-condition",
      description: "按条件查书架：没读过的 PDF，按大小说明，不把别的书算进来。",
      tags: ["economy", "global"],
      scope: { kind: "global", threadId: "shelf-filter" },
      seed: {
        profile: PROFILE,
        books: [
          {
            id: id("f1"),
            title: "Attention Is All You Need",
            format: "pdf",
            status: "unread",
            fileSize: 2_215_244,
            fileOnDevice: true,
          },
          {
            id: id("f2"),
            title: "Clean Code",
            format: "pdf",
            status: "unread",
            fileSize: 20_370_601,
            fileOnDevice: true,
          },
          {
            id: id("f3"),
            title: "Atomic Habits",
            format: "pdf",
            status: "reading",
            fileSize: 6_120_516,
            fileOnDevice: true,
            progressPercent: 3,
          },
          { id: id("f4"), title: "我与地坛", format: "epub", status: "unread", fileSize: 766_826, fileOnDevice: true },
        ],
      },
      turns: [{ text: "我书架上还有哪些 PDF 没读过？哪本最大？" }],
      expectation: {
        answer: { mustContain: ["Attention Is All You Need", "Clean Code"], mustNotContain: ["我与地坛"] },
        tools: { required: ["list_books"], noErrors: true, maxCalls: 4 },
      },
      criteria: {
        expected:
          "列出 Attention Is All You Need 与 Clean Code 两本未读 PDF，指出 Clean Code 最大（约 20 MB）；不包含在读的 Atomic Habits 和 EPUB《我与地坛》。",
      },
    }),
  ],
};
