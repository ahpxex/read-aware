/**
 * 全套 RuntimeDeps 的内存假实现 —— 测试与 demo 用。
 * 行为刻意与目标语义对齐：记忆初始低置信、强化 +证据+置信、
 * 检索按 pinned/importance/recency 排序。
 */
import type {
  BookStats,
  CollectionSummary,
  HighlightColor,
  Id,
  StatsOverview,
} from "@read-aware/core";
import type {
  AnnotationItem,
  BookOverview,
  BookTextHit,
  ChapterDigest,
  ChapterRef,
  MemoryRecord,
  NewMemoryInput,
  RuntimeDeps,
  TurnRecord,
  UserInteractionRequest,
} from "../ports";
import type {
  AgentSettingChange,
  AgentSettingDescriptor,
  AgentSettingValue,
  AgentSettingsQuery,
  AgentSettingsSnapshot,
} from "../settings";
import { matchesMemoryQuery } from "../memory/query-match";
import { searchChapters, searchTurnRecords } from "../text/search";

/** 判别联合的可检索文本（fixtures 的 query 过滤用）。 */
function annotationText(a: AnnotationItem): string {
  return a.kind === "note" ? `${a.quotedText ?? ""} ${a.body}` : a.text;
}

export interface ChapterSeed {
  title?: string;
  text: string;
  /** 章节覆盖的 hrefs（阅读位置反查用,同 ChapterRef.hrefs） */
  hrefs?: string[];
}

export interface AskRecord {
  bookId: Id;
  question: string;
  anchor?: string;
  chapter?: string;
}

export interface InMemoryStores {
  books: BookOverview[];
  annotations: AnnotationItem[];
  collections: CollectionSummary[];
  bookStats: BookStats[];
  turns: Map<string, TurnRecord[]>;
  insights: Map<string, string>;
  asks: AskRecord[];
  memories: MemoryRecord[];
  savedMemoryInputs: NewMemoryInput[];
  profile: { summary: string | undefined };
  /** bookId → 章节文本（正文抽取的模拟） */
  chapters: Map<string, ChapterSeed[]>;
  /** bookId → 章节读毕纪要（book_memory 投影的模拟） */
  chapterDigests: Map<string, ChapterDigest[]>;
  interactions: UserInteractionRequest[];
  readerRequests: Array<
    | { type: "open"; bookId: Id }
    | { type: "goTo"; bookId?: Id; anchor?: string; chapterHref?: string }
  >;
  settings: AgentSettingsSnapshot;
}

export interface InMemorySeed {
  books?: BookOverview[];
  annotations?: AnnotationItem[];
  profile?: string;
  memories?: MemoryRecord[];
  /** threadKey → 既有转录（存量用户/旧 agent 场景：记忆管线上线前的历史对话）。 */
  turns?: Record<string, TurnRecord[]>;
  /** threadKey → 既有滚动摘要（缺失 + 有 turns = 待领养的旧线程）。 */
  insights?: Record<string, string>;
  chapters?: Record<string, ChapterSeed[]>;
  chapterDigests?: Record<string, ChapterDigest[]>;
  collections?: CollectionSummary[];
  bookStats?: BookStats[];
  statsOverview?: StatsOverview;
  settings?: AgentSettingsSnapshot;
}

function defaultSettings(): AgentSettingsSnapshot {
  return {
    target: { kind: "global" },
    overrides: [],
    settings: [
      {
        path: "general.startView",
        section: "general",
        label: "Start view",
        kind: "enum",
        value: "shelf",
        writable: true,
        options: [
          { value: "shelf", label: "Shelf" },
          { value: "resume", label: "Resume reading" },
        ],
        supportedTargets: ["global"],
      },
      {
        path: "appearance.theme",
        section: "appearance",
        label: "App theme",
        kind: "enum",
        value: "system",
        writable: true,
        options: [
          { value: "system", label: "System", source: "builtin" },
          {
            value: "light",
            label: "Light",
            source: "builtin",
            polarity: "light",
          },
          { value: "dark", label: "Dark", source: "builtin", polarity: "dark" },
        ],
        supportedTargets: ["global"],
      },
      {
        path: "reading.theme",
        section: "reading",
        label: "Page theme",
        kind: "enum",
        value: "warm",
        writable: true,
        options: [
          { value: "auto", label: "Automatic", source: "builtin" },
          {
            value: "light",
            label: "Light",
            source: "builtin",
            polarity: "light",
          },
          {
            value: "warm",
            label: "Warm",
            source: "builtin",
            polarity: "light",
          },
          { value: "dark", label: "Dark", source: "builtin", polarity: "dark" },
        ],
        supportedTargets: ["global", "all-books", "book"],
      },
      {
        path: "reading.fontFamily",
        section: "reading",
        label: "Font family",
        kind: "string",
        value: "curated:inter",
        writable: true,
        supportedTargets: ["global", "all-books", "book"],
      },
      {
        path: "reading.fontSize",
        section: "reading",
        label: "Font size",
        kind: "enum",
        value: "medium",
        writable: true,
        options: ["small", "medium", "large"].map((value) => ({
          value,
          label: value,
        })),
        supportedTargets: ["global", "all-books", "book"],
      },
      {
        path: "reading.readingMode",
        section: "reading",
        label: "Reading mode",
        kind: "enum",
        value: "paginated-double",
        writable: true,
        options: ["scroll", "paginated-single", "paginated-double"].map(
          (value) => ({ value, label: value }),
        ),
        supportedTargets: ["global", "all-books", "book"],
      },
      {
        path: "ai.preferences.followStreaming",
        section: "ai",
        label: "Follow streaming",
        kind: "boolean",
        value: false,
        writable: true,
        supportedTargets: ["global"],
      },
      {
        path: "ai.connection.configured",
        section: "ai",
        label: "Connection configured",
        kind: "boolean",
        value: false,
        writable: false,
      },
      {
        path: "ai.connection.credentialConfigured",
        section: "ai",
        label: "Credential configured",
        kind: "boolean",
        value: false,
        writable: false,
      },
    ],
  };
}

function validateFixtureSetting(
  setting: AgentSettingDescriptor,
  value: AgentSettingValue,
): void {
  if (value === null && !setting.nullable) {
    throw new Error(`${setting.path} cannot be null`);
  }
  if (value === null) return;
  if (setting.kind === "boolean" && typeof value !== "boolean") {
    throw new Error(`${setting.path} must be a boolean`);
  }
  if (setting.kind === "string" && typeof value !== "string") {
    throw new Error(`${setting.path} must be a string`);
  }
  if (setting.kind === "integer" && !Number.isInteger(value)) {
    throw new Error(`${setting.path} must be an integer`);
  }
  if (
    setting.kind === "enum" &&
    !setting.options?.some((option) => Object.is(option.value, value))
  ) {
    throw new Error(`${setting.path} has an unsupported value`);
  }
}

function applySettingChanges(
  current: AgentSettingsSnapshot,
  changes: AgentSettingChange[],
): { settings: AgentSettingsSnapshot; changed: AgentSettingChange[] } {
  const next = structuredClone(current);
  const byPath = new Map(
    next.settings.map((setting) => [setting.path, setting]),
  );
  const changed: AgentSettingChange[] = [];
  const seen = new Set<string>();

  for (const change of changes) {
    const setting = byPath.get(change.path);
    if (!setting?.writable || !setting.supportedTargets) {
      throw new Error(`unknown or read-only setting: ${change.path}`);
    }
    if (!change.target && setting.supportedTargets.length > 1) {
      throw new Error(
        `${change.path} requires an explicit target: ${setting.supportedTargets.join(", ")}`,
      );
    }
    const target = change.target ?? { kind: "global" as const };
    if (!setting.supportedTargets.includes(target.kind)) {
      throw new Error(`${change.path} does not support target ${target.kind}`);
    }
    const key = `${change.path}@${target.kind === "book" ? target.bookId : target.kind}`;
    if (seen.has(key)) throw new Error(`duplicate settings change: ${key}`);
    seen.add(key);
    validateFixtureSetting(setting, change.value);
    if (!Object.is(setting.value, change.value)) {
      setting.value = change.value;
      changed.push({ ...change, target });
    }
  }
  return { settings: next, changed };
}

function querySettings(
  settings: AgentSettingsSnapshot,
  query: AgentSettingsQuery = {},
): AgentSettingsSnapshot {
  const target = query.target ?? { kind: "global" as const };
  return {
    target,
    overrides:
      query.section && query.section !== "reading" ? [] : settings.overrides,
    settings: settings.settings.filter(
      (setting) =>
        (!query.section || setting.section === query.section) &&
        (target.kind === "global" ||
          setting.supportedTargets?.includes("book")),
    ),
  };
}

export function seedMemory(
  partial: Partial<MemoryRecord> &
    Pick<MemoryRecord, "id" | "scope" | "content">,
): MemoryRecord {
  return {
    kind: "fact",
    importance: 0.5,
    evidenceCount: 1,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...partial,
  };
}

export function createInMemoryDeps(seed: InMemorySeed = {}): {
  deps: RuntimeDeps;
  stores: InMemoryStores;
} {
  // 深拷贝：种子对象会被端口实现就地修改（starred、note.body、reinforce…），
  // 浅拷贝会让同一 seed 的多次 createInMemoryDeps（eval repetitions）互相污染
  const books = structuredClone(seed.books ?? []);
  const annotations = structuredClone(seed.annotations ?? []);
  const collections = structuredClone(seed.collections ?? []);
  const bookStats = structuredClone(seed.bookStats ?? []);
  const stores: InMemoryStores = {
    books,
    annotations,
    collections,
    bookStats,
    turns: new Map(
      Object.entries(structuredClone(seed.turns ?? {})).map(([key, list]) => [key, [...list]]),
    ),
    insights: new Map(Object.entries(structuredClone(seed.insights ?? {}))),
    asks: [],
    memories: structuredClone(seed.memories ?? []),
    savedMemoryInputs: [],
    profile: { summary: seed.profile },
    chapters: new Map(Object.entries(structuredClone(seed.chapters ?? {}))),
    chapterDigests: new Map(Object.entries(structuredClone(seed.chapterDigests ?? {}))),
    interactions: [],
    readerRequests: [],
    settings: structuredClone(seed.settings ?? defaultSettings()),
  };
  let memoryCounter = 0;
  let annotationCounter = annotations.length;
  let collectionCounter = collections.length;
  const isActive = (memory: MemoryRecord) =>
    (memory.status ?? "active") === "active";

  const deps: RuntimeDeps = {
    library: {
      listBooks: async () => books,
      getBook: async (id) => books.find((book) => book.id === id),
      listCollections: async () => collections,
      booksInCollection: async (collectionId) =>
        books
          .filter((book) => book.collectionId === collectionId)
          .map((book) => book.id),
      getBookStats: async (bookId) =>
        bookStats.find((stats) => stats.bookId === bookId),
      listBookStats: async () => bookStats,
      getStatsOverview: async () =>
        seed.statsOverview ?? {
          totalMs: bookStats.reduce((total, stats) => total + stats.totalMs, 0),
          daily: {},
          booksReading: bookStats.filter((stats) => stats.status === "reading")
            .length,
          booksFinished: bookStats.filter(
            (stats) => stats.status === "finished",
          ).length,
        },
      editBookMetadata: async (bookId, patch) => {
        const book = books.find((entry) => entry.id === bookId);
        if (!book) throw new Error(`unknown book: ${bookId}`);
        if (patch.title !== undefined) book.title = patch.title;
        if (patch.author !== undefined) book.author = patch.author;
        book.updatedAt = new Date().toISOString();
      },
      setBookStarred: async (bookId, starred) => {
        const book = books.find((entry) => entry.id === bookId);
        if (!book) throw new Error(`unknown book: ${bookId}`);
        book.starred = starred;
      },
      setBookFinished: async (bookId, finished) => {
        const book = books.find((entry) => entry.id === bookId);
        if (!book) throw new Error(`unknown book: ${bookId}`);
        book.status = finished ? "finished" : "reading";
      },
      setBookNarrativity: async (bookId, narrativity) => {
        const book = books.find((entry) => entry.id === bookId);
        if (!book) throw new Error(`unknown book: ${bookId}`);
        book.narrativity = narrativity;
      },
      removeBook: async (bookId) => {
        const index = books.findIndex((entry) => entry.id === bookId);
        if (index < 0) throw new Error(`unknown book: ${bookId}`);
        books.splice(index, 1);
      },
      createCollection: async (name) => {
        const collection: CollectionSummary = {
          id: `collection-${++collectionCounter}`,
          name,
          createdAt: new Date().toISOString(),
        };
        collections.push(collection);
        return collection;
      },
      renameCollection: async (collectionId, name) => {
        const collection = collections.find(
          (entry) => entry.id === collectionId,
        );
        if (!collection) throw new Error(`unknown collection: ${collectionId}`);
        collection.name = name;
      },
      removeCollection: async (collectionId) => {
        const index = collections.findIndex(
          (entry) => entry.id === collectionId,
        );
        if (index < 0) throw new Error(`unknown collection: ${collectionId}`);
        collections.splice(index, 1);
        for (const book of books) {
          if (book.collectionId === collectionId) book.collectionId = null;
        }
      },
      assignBooksToCollection: async (bookIds, collectionId) => {
        const ids = new Set(bookIds);
        for (const book of books) {
          if (ids.has(book.id)) book.collectionId = collectionId;
        }
      },
    },
    annotations: {
      listAnnotations: async (filter) =>
        annotations.filter(
          (a) =>
            (!filter?.bookId || a.bookId === filter.bookId) &&
            (!filter?.query || annotationText(a).includes(filter.query)),
        ),
      createHighlight: async ({ bookId, text, anchor, chapter, color }) => {
        const now = new Date().toISOString();
        const highlight: AnnotationItem = {
          kind: "highlight",
          id: `annotation-${++annotationCounter}`,
          bookId,
          text,
          anchor,
          chapterHref: chapter,
          color: color ?? "yellow",
          style: "highlight",
          createdAt: now,
          updatedAt: now,
        };
        annotations.push(highlight);
        return highlight;
      },
      recolorHighlight: async (highlightId, color: HighlightColor) => {
        const highlight = annotations.find((entry) => entry.id === highlightId);
        if (!highlight || highlight.kind !== "highlight") {
          throw new Error(`highlight not found: ${highlightId}`);
        }
        highlight.color = color;
        highlight.updatedAt = new Date().toISOString();
      },
      createNote: async ({ bookId, body, quotedText, anchor, chapter }) => {
        const now = new Date().toISOString();
        const note: AnnotationItem = {
          kind: "note",
          id: `annotation-${++annotationCounter}`,
          bookId,
          body,
          quotedText,
          anchor,
          chapterHref: chapter,
          createdAt: now,
          updatedAt: now,
        };
        annotations.push(note);
        return note;
      },
      updateNote: async (noteId, body) => {
        const note = annotations.find((entry) => entry.id === noteId);
        if (!note || note.kind !== "note")
          throw new Error(`note not found: ${noteId}`);
        note.body = body;
        note.updatedAt = new Date().toISOString();
      },
      removeAnnotation: async (annotationId) => {
        const index = annotations.findIndex(
          (entry) => entry.id === annotationId,
        );
        if (index < 0) throw new Error(`annotation not found: ${annotationId}`);
        annotations.splice(index, 1);
      },
      recordAsk: async (input) => {
        stores.asks.push(input);
      },
    },
    reader: {
      openBook: (bookId) =>
        stores.readerRequests.push({ type: "open", bookId }),
      goTo: (target) => stores.readerRequests.push({ type: "goTo", ...target }),
    },
    interactions: {
      request: async (request) => {
        stores.interactions.push(request);
        if (request.kind === "permission") {
          return { optionId: "approve", text: "Approved" };
        }
        const option = request.options[0];
        return { optionId: option?.id, text: option?.label };
      },
    },
    conversations: {
      load: async (key) => stores.turns.get(key) ?? [],
      append: async (key, turn) => {
        const list = stores.turns.get(key) ?? [];
        list.push(turn);
        stores.turns.set(key, list);
      },
      searchTurns: async ({ queries, threadKey, limit }) => {
        // 与产品端口同一套匹配核心（searchTurnRecords）——匹配语义在
        // 接缝两侧不许漂移，eval 不许替产品圆谎。
        const pool: Array<TurnRecord & { threadKey: string }> = [];
        for (const [key, list] of stores.turns) {
          if (threadKey && key !== threadKey) continue;
          for (const turn of list) pool.push({ ...turn, threadKey: key });
        }
        return searchTurnRecords(pool, queries, limit ?? 20);
      },
      getInsights: async (key) => stores.insights.get(key),
      putInsights: async (key, summary) => {
        stores.insights.set(key, summary);
      },
      clearInsights: async (key) => {
        stores.insights.delete(key);
      },
    },
    profile: {
      getProfileSummary: async () => stores.profile.summary,
      putProfileSummary: async (summary) => {
        stores.profile.summary = summary;
      },
    },
    memory: {
      searchMemories: async (filter) => {
        const scopes = new Set<string>(filter.scopes);
        return stores.memories
          .filter(
            (memory) =>
              isActive(memory) &&
              scopes.has(memory.scope) &&
              (!filter.query || matchesMemoryQuery(memory.content, filter.query)),
          )
          .sort(
            (a, b) =>
              Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
              b.importance - a.importance ||
              b.updatedAt.localeCompare(a.updatedAt),
          )
          .slice(0, filter.limit ?? 50);
      },
      saveMemory: async (input) => {
        stores.savedMemoryInputs.push(input);
        const now = new Date().toISOString();
        const record: MemoryRecord = {
          id: `mem-${++memoryCounter}`,
          scope: input.scope,
          kind: input.kind,
          content: input.content,
          // 初始低置信（doc §4）；显式 remember 比提炼略高
          importance: input.origin === "agent" ? 0.5 : 0.35,
          evidenceCount: 1,
          createdAt: now,
          updatedAt: now,
        };
        stores.memories.push(record);
        return record;
      },
      reinforceMemory: async (id) => {
        const memory = stores.memories.find((m) => m.id === id);
        if (!memory) return;
        memory.evidenceCount += 1;
        memory.importance = Math.min(1, memory.importance + 0.15);
        memory.updatedAt = new Date().toISOString();
      },
      listMemories: async () => stores.memories.filter(isActive),
      applyMemoryChanges: async (changes) => {
        const now = new Date().toISOString();
        for (const change of changes) {
          const memory = stores.memories.find((m) => m.id === change.id);
          if (!memory) continue;
          switch (change.type) {
            case "supersede":
              memory.status = "superseded";
              if (change.byId) {
                const winner = stores.memories.find(
                  (m) => m.id === change.byId,
                );
                if (winner) {
                  winner.evidenceCount += 1;
                  winner.importance = Math.min(1, winner.importance + 0.1);
                  winner.updatedAt = now;
                }
              }
              break;
            case "forget":
              memory.status = "forgotten";
              break;
            case "promote":
              memory.scope = change.scope;
              memory.updatedAt = now;
              break;
            case "decay":
              memory.importance = change.importance;
              break;
          }
        }
      },
    },
    bookText: {
      getToc: async (bookId) => {
        const chapters = stores.chapters.get(bookId) ?? [];
        return chapters.map<ChapterRef>((chapter, index) => ({
          index,
          title: chapter.title,
          chars: chapter.text.length,
          hrefs: chapter.hrefs,
        }));
      },
      getChapterText: async (bookId, chapterIndex) =>
        stores.chapters.get(bookId)?.[chapterIndex]?.text,
      searchText: async ({ queries, bookId, throughChapterIndex, limit }) => {
        const results: BookTextHit[] = [];
        for (const [id, chapters] of stores.chapters) {
          if (bookId && id !== bookId) continue;
          if (throughChapterIndex !== undefined && !bookId) {
            throw new Error("throughChapterIndex requires a specific book");
          }
          const searchable =
            throughChapterIndex === undefined
              ? chapters
              : chapters.slice(0, Math.max(0, Math.floor(throughChapterIndex)) + 1);
          for (const hit of searchChapters(searchable, queries, limit ?? 16)) {
            results.push({ bookId: id as Id, ...hit });
          }
        }
        return results.slice(0, limit ?? 16);
      },
    },
    bookMemory: {
      listDigests: async (bookId) => structuredClone(stores.chapterDigests.get(bookId) ?? []),
      saveDigest: async (bookId, digest) => {
        const digests = stores.chapterDigests.get(bookId) ?? [];
        const next = digests.filter((entry) => entry.chapterIndex !== digest.chapterIndex);
        next.push(structuredClone(digest));
        next.sort((a, b) => a.chapterIndex - b.chapterIndex);
        stores.chapterDigests.set(bookId, next);
      },
    },
    settings: {
      getSettings: async (query) => querySettings(stores.settings, query),
      updateSettings: async (changes) => {
        const result = applySettingChanges(stores.settings, changes);
        stores.settings = result.settings;
        return {
          changed: result.changed,
          settings: querySettings(stores.settings),
        };
      },
    },
  };
  return { deps, stores };
}
