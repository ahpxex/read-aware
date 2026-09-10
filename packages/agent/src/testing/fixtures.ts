/**
 * 全套 RuntimeDeps 的内存假实现 —— 测试与 demo 用。
 * 行为刻意与目标语义对齐：记忆初始低置信、强化 +证据+置信、
 * 检索按 pinned/importance/recency 排序。
 */
import { annotationPageFixture } from "./annotation-pages";
import { createWorkspaceFixture } from "./workspace-fixture";
import { createAnnotationMutationFixture } from "./annotation-mutations";
import { createMemoryManagementFixture } from "./memory-management";
import { createBookClassificationFixture } from "./book-classification";
import { createBookMemoryFixture } from "./book-memory";
import { BookGraphTaskOwner } from "../memory/book-graph-tasks";
import { createMemoryMaintenanceFixture } from "./memory-maintenance";
import { AppError, normalizeUserProfileChange, userProfilePage, pageSettingOptions } from "@read-aware/core";
import type {
  BookStats,
  CollectionSummary,
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
import { createMemoryBookNavigation } from "./book-navigation";
import { createMemoryTextPreparation } from "./book-text-preparation";

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
  readerRequests: ReaderRequest[];
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
    revision: 0,
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
    revision: settings.revision,
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
  const annotationMutations = createAnnotationMutationFixture(annotations);
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

  const memoryManagement = createMemoryManagementFixture(stores.memories);
  const bookClassification = createBookClassificationFixture(books);
  const deps: RuntimeDeps = {
    downloadResource: async () => { throw new AppError("ui/unavailable", "Attach a download fixture"); },
    resources: () => ({
      pick: async () => ({ cancelled: true, resources: [] }), openBook: async () => null, openCover: async () => null,
      copyImage: async () => { throw new AppError("ui/unavailable", "Attach an image clipboard fixture"); },
      create: async () => { throw new AppError("ui/unavailable", "Attach a resource fixture"); },
      stat: async id => ({ id, name: "fixture.txt", mimeType: "text/plain", size: 4, state: "ready", source: "picked", expiresAt: Date.now() + 60000 }),
      read: async () => ({ data: new Uint8Array([116, 101, 115, 116]).buffer, nextOffset: 4, eof: true }),
      append: async () => { throw new AppError("ui/unavailable", "Attach a resource fixture"); },
      commit: async () => { throw new AppError("ui/unavailable", "Attach a resource fixture"); },
      save: async () => ({ saved: false }), release: async () => {},
    }),
    schedules: {
      list: async () => ({ schedules: [], total: 0, nextOffset: null }),
      control: async () => { throw new AppError("ui/unavailable", "Bind a schedule fixture"); },
    },
    maintenance: {
      snapshot: async () => ({ supported: false, phase: "idle", channel: "stable", checkedChannel: null,
        currentVersion: "0.5.4", availableVersion: null, progress: null, errorStage: null }),
      checkForUpdates: async () => { throw new AppError("ui/unavailable", "Attach an updater fixture"); },
      openSettings: async surface => ({ status: "opened", surface }),
    },
    diagnostics: {
      requestReport: async () => { throw new AppError("ui/unavailable", "Attach a diagnostic report fixture"); },
      verifyProjections: async () => { throw new AppError("ui/unavailable", "Attach a diagnostics fixture"); },
    },
    sync: {
      snapshot: async () => ({ revision: 0, supported: true, connectionBusy: false, state: "disabled", connected: false, backend: null,
        lastSyncAt: null, lastErrorCode: null, progress: null, cycleStartBacklog: null, lastCycle: null, backfillRemaining: 0 }),
      backlog: async () => ({ events: 0, blobs: 0 }), account: async () => null,
      requestSync: async () => { throw new AppError("ui/unavailable", "Connect a sync fixture"); },
      openSettings: async () => ({ status: "opened", surface: "dataSync" }),
      connectionOptions: async () => [],
      requestFlow: async () => { throw new AppError("ui/unavailable", "Attach a sync account flow fixture"); },
    },
    conversationControl: {
      turnRequests: async () => [],
      requestTurn: async request => ({ id: "request-fixture", target: request.target, action: request.action, status: "pending", createdAt: 0 }),
      cancelTurnRequest: async () => { throw new AppError("ui/invalid-target", "Attach a conversation request fixture"); },
      snapshot: async () => ({ revision: 0, selectedGlobalThreadId: "__global__", sessions: [] }),
      listThreads: async () => [],
      createThread: async () => ({ status: "completed", target: { kind: "global", id: `thread-${crypto.randomUUID()}` }, draft: true }),
      selectThread: async id => ({ status: "completed", target: { kind: "global", id } }),
      stop: async target => ({ status: "completed", target }),
      clear: async target => { stores.turns.delete(`${target.kind}:${target.id}`); return { status: "completed", target }; },
    },
    hostIO: {
      listPluginContributions: async () => ({ contributions: [], total: 0, offset: 0, nextOffset: null }),
      listPlugins: async () => ({ plugins: [], total: 0, offset: 0, nextOffset: null }),
      writeClipboard: async () => { throw new AppError("ui/unavailable", "Attach a clipboard fixture"); },
      exportFile: async () => false,
      openExternal: async () => { throw new AppError("ui/unavailable", "Attach an external browser fixture"); },
    },
    bookGraphTasks: new BookGraphTaskOwner(async () => { throw new AppError("ai/not-configured", "Attach a graph executor for task tests"); }, () => {}),
    bookClassification,
    memoryManagement,
    workspace: createWorkspaceFixture(),
    hostCommands: {
      list: async () => ({ version: 1, workspaceRevision: null, commands: [] }),
      execute: async () => { throw new Error("Host commands require an attached workspace fixture"); },
    },
    environment: { snapshot: async () => ({ revision: 1, runtime: "desktop", platform: "macos", locale: "en", timeZone: "UTC", utcOffsetMinutes: 0, networkHint: "unknown" }) },
    window: { snapshot: async () => ({ supported: false, revision: 1 }),
      control: async () => { throw new Error("Window controls require a native test adapter"); } },
    library: {
      listDuplicates: async () => ({ groups: [], total: 0, nextOffset: null }),
      previewMerge: async () => null,
      resolveBookId: async () => null,
      mergeDuplicates: async () => { throw new AppError("ui/unavailable", "Attach a merge fixture"); },
      getEnrichment: async () => { throw new AppError("ui/unavailable", "Attach an enrichment fixture"); },
      getContentState: async bookId => {
        if (!books.some(book => book.id === bookId)) throw new AppError("library/book-not-found", "Book not found");
        return { bookId, source: "file", availability: "local", sourceRevision: "fixture", contentVersion: "fixture" };
      },
      retryEnrichment: async () => { throw new AppError("ui/unavailable", "Attach an enrichment fixture"); },
      importResource: async () => { throw new AppError("ui/unavailable", "Attach an import resource fixture"); },
      listBookFormats: async () => [],
      inspectResource: async () => { throw new AppError("ui/unavailable", "Attach an inspection fixture"); },
      getReadingTime: async (query = {}) => ({ bookId: query.bookId ?? null, localDay: query.localDay ?? null,
        observedAtEpochMs: 0, settledMs: 0, pendingMs: 0, totalMs: 0, pendingBucketCount: 0, pending: [], nextCursor: null }),
      getReadingInsights: async (query = {}) => ({ bookId: query.bookId ?? null, source: "settled", asOfDay: query.asOfDay ?? "2026-09-09",
        period: query.period ?? "week", totalMs: 0, daysRead: 0, booksRead: 0, avgPerDayMs: 0, deltaRatio: null,
        bars: [], weekdayMs: Array(7).fill(0), allTimeHourlyMs: Array(24).fill(0),
        achievements: { totalMs: 0, currentStreak: 0, longestStreak: 0, bestDayMs: 0, bestDayKey: null, daysRead: 0,
          booksRead: 0, mostReadBookId: null, mostReadBookMs: 0, nextMilestoneMs: 3_600_000 } }),
      listBooks: async () => books,
      listBookRemovalCleanup: async () => ({ items: [], nextCursor: null }),
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
        if (!book) throw new Error(`unknown book id: ${bookId} — ids come from list_books; in a book thread just omit bookId for the current book, never guess from a title`);
        if (patch.title !== undefined) book.title = patch.title;
        if (patch.author !== undefined) book.author = patch.author;
        book.updatedAt = new Date().toISOString();
      },
      setBookStarred: async (bookId, starred) => {
        const book = books.find((entry) => entry.id === bookId);
        if (!book) throw new Error(`unknown book id: ${bookId} — ids come from list_books; in a book thread just omit bookId for the current book, never guess from a title`);
        book.starred = starred;
      },
      setBookFinished: async (bookId, finished) => {
        const book = books.find((entry) => entry.id === bookId);
        if (!book) throw new Error(`unknown book id: ${bookId} — ids come from list_books; in a book thread just omit bookId for the current book, never guess from a title`);
        book.status = finished ? "finished" : "reading";
      },
      classifyBookIfUnclassified: async (bookId, narrativity) => {
        const book = books.find((entry) => entry.id === bookId);
        if (!book) throw new Error(`unknown book id: ${bookId} — ids come from list_books; in a book thread just omit bookId for the current book, never guess from a title`);
        book.narrativity ??= narrativity;
        return book.narrativity;
      },
      removeBook: async (bookId) => {
        const index = books.findIndex((entry) => entry.id === bookId);
        if (index < 0) throw new Error(`unknown book id: ${bookId} — ids come from list_books; in a book thread just omit bookId for the current book, never guess from a title`);
        books.splice(index, 1);
      },
      removeBooks: async bookIds => {
        const ids = new Set(bookIds);
        for (let i = books.length - 1; i >= 0; i--) if (ids.has(books[i].id)) books.splice(i, 1);
        return { bookIds: [...ids], committed: true, files: { status: "released" } };
      },
      retryBookRemovalCleanup: async bookIds => ({ bookIds, files: books.some(book => bookIds.includes(book.id))
        ? { status: "pending", errorCode: "library/book-reappeared" } : { status: "released" } }),
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
      inspectAnnotation: async (id) => annotationMutations.inspect(id),
      applyChanges: async (changes, signal) => {
        if (signal?.aborted) throw new AppError("annotations/cancelled", "Cancelled before annotation commit");
        return annotationMutations.apply(changes);
      },
      pageAnnotations: async (input) => annotationPageFixture(annotations, input),
      getAnnotation: async (id) => annotations.find(annotation => annotation.id === id) ?? null,
      listAnnotations: async (filter) =>
        annotations.filter(
          (a) =>
            (!filter?.bookId || a.bookId === filter.bookId) &&
            (!filter?.kind || a.kind === filter.kind) &&
            (!filter?.query || annotationText(a).includes(filter.query)),
        ),
      createHighlight: async ({ bookId, text, anchor, chapter, color, style }) => {
        const now = new Date().toISOString();
        const highlight: AnnotationItem = {
          kind: "highlight",
          id: `annotation-${++annotationCounter}`,
          bookId,
          text,
          anchor,
          chapterHref: chapter,
          color: color ?? "yellow",
          style: style ?? "highlight",
          createdAt: now,
          updatedAt: now,
        };
        annotations.push(highlight);
        annotationMutations.touch(highlight.id);
        return highlight;
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
        annotationMutations.touch(note.id);
        return note;
      },
      recordAsk: async (input) => {
        stores.asks.push(input);
      },
    },
    reader: createMemoryReader(books[0]?.id, stores.readerRequests),
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
      searchTurns: async ({ queries, threadKey, limit, includeAttachments }) => {
        // 与产品端口同一套匹配核心（searchTurnRecords）——匹配语义在
        // 接缝两侧不许漂移，eval 不许替产品圆谎。
        const pool: Array<TurnRecord & { threadKey: string }> = [];
        for (const [key, list] of stores.turns) {
          if (threadKey && key !== threadKey) continue;
          for (const turn of list) pool.push({ ...turn, threadKey: key,
            attachments: includeAttachments === false ? undefined : turn.attachments });
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
      updateProfile: async (raw, signal) => {
        const input = normalizeUserProfileChange(raw);
        const captured = stores.profile.summary;
        await userProfilePage(captured, { expectedRevision: input.expectedRevision });
        const next = await userProfilePage(input.summary);
        signal?.throwIfAborted();
        if (stores.profile.summary !== captured) throw new AppError("memory/conflict", "Profile changed");
        stores.profile.summary = input.summary;
        return { changed: captured !== input.summary, revision: next.revision, persistence: "device-local" };
      },
      getProfileSummary: async () => stores.profile.summary,
      readProfile: async (query, signal) => {
        signal?.throwIfAborted();
        const page = await userProfilePage(stores.profile.summary, query);
        signal?.throwIfAborted();
        return page;
      },
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
      listMemories: async () => structuredClone(stores.memories.filter(isActive)),
      ...createMemoryMaintenanceFixture(stores.memories, memoryManagement),
    },
    bookText: {
      listReferences: async () => { throw new AppError("library/content-unavailable", "Fixture has no book reference documents"); },
      listImages: async () => { throw new AppError("library/content-unavailable", "Fixture has no book image documents"); },
      openImageResource: async () => { throw new AppError("library/content-unavailable", "Fixture has no book images"); },
      readReference: async () => { throw new AppError("library/content-unavailable", "Fixture has no book reference documents"); },
      preparation: createMemoryTextPreparation(stores.chapters),
      ...createMemoryBookNavigation(stores.chapters),
      getTextState: async bookId => {
        const chapters = stores.chapters.get(bookId);
        return { bookId, contentVersion: "fixture", status: chapters ? "ready" : "unprepared",
          text: chapters ? chapters.some(chapter => chapter.text.length > 0) ? "available" : "textless" : "unknown",
          chapterCount: chapters?.length ?? 0, progress: null };
      },
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
              : chapters.slice(0, Math.max(0, Math.floor(throughChapterIndex) + 1));
          for (const hit of searchChapters(searchable, queries, limit ?? 16)) {
            results.push({ bookId: id as Id, ...hit });
          }
        }
        return results.slice(0, limit ?? 16);
      },
    },
    bookMemory: createBookMemoryFixture(stores.chapterDigests, bookClassification),
    settings: {
      resetReading: async () => { throw new AppError("ui/unavailable", "Attach a reading reset fixture"); },
      getSettings: async (query) => querySettings(stores.settings, query),
      getSettingOptions: async query => {
        const snapshot = querySettings(stores.settings, { target: query.target });
        const setting = snapshot.settings.find(entry => entry.path === query.path);
        if (!setting) throw new AppError("settings/options-invalid", "Unknown fixture setting");
        return pageSettingOptions(setting.options ?? [], snapshot.revision, query);
      },
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
import { createMemoryReader, type ReaderRequest } from "./reader";
