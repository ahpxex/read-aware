/**
 * 全套 RuntimeDeps 的内存假实现 —— 测试与 demo 用。
 * 行为刻意与目标语义对齐：记忆初始低置信、强化 +证据+置信、
 * 检索按 pinned/importance/recency 排序。
 */
import type { Id } from "@read-aware/core";
import type {
  AnnotationRecord,
  BookOverview,
  ChapterRef,
  MemoryRecord,
  NewMemoryInput,
  RuntimeDeps,
  TurnRecord,
} from "../ports";

export interface ChapterSeed {
  title?: string;
  text: string;
}

export interface AskRecord {
  bookId: Id;
  question: string;
  anchor?: string;
  chapter?: string;
}

export interface InMemoryStores {
  turns: Map<string, TurnRecord[]>;
  insights: Map<string, string>;
  asks: AskRecord[];
  memories: MemoryRecord[];
  savedMemoryInputs: NewMemoryInput[];
  profile: { summary: string | undefined };
  /** bookId → 章节文本（正文抽取的模拟） */
  chapters: Map<string, ChapterSeed[]>;
}

export interface InMemorySeed {
  books?: BookOverview[];
  annotations?: AnnotationRecord[];
  profile?: string;
  memories?: MemoryRecord[];
  chapters?: Record<string, ChapterSeed[]>;
}

export function seedMemory(partial: Partial<MemoryRecord> & Pick<MemoryRecord, "id" | "scope" | "content">): MemoryRecord {
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
  const books = seed.books ?? [];
  const annotations = seed.annotations ?? [];
  const stores: InMemoryStores = {
    turns: new Map(),
    insights: new Map(),
    asks: [],
    memories: [...(seed.memories ?? [])],
    savedMemoryInputs: [],
    profile: { summary: seed.profile },
    chapters: new Map(Object.entries(seed.chapters ?? {})),
  };
  let memoryCounter = 0;
  const isActive = (memory: MemoryRecord) => (memory.status ?? "active") === "active";

  const deps: RuntimeDeps = {
    library: {
      listBooks: async () => books,
      getBook: async (id) => books.find((book) => book.id === id),
    },
    annotations: {
      listAnnotations: async (filter) =>
        annotations.filter(
          (a) =>
            (!filter?.bookId || a.bookId === filter.bookId) &&
            (!filter?.query ||
              a.text.includes(filter.query) ||
              (a.content?.includes(filter.query) ?? false)),
        ),
      recordAsk: async (input) => {
        stores.asks.push(input);
      },
    },
    conversations: {
      load: async (key) => stores.turns.get(key) ?? [],
      append: async (key, turn) => {
        const list = stores.turns.get(key) ?? [];
        list.push(turn);
        stores.turns.set(key, list);
      },
      searchTurns: async ({ query, threadKey, limit }) => {
        const matches: Array<TurnRecord & { threadKey: string }> = [];
        for (const [key, list] of stores.turns) {
          if (threadKey && key !== threadKey) continue;
          for (const turn of list) {
            if (turn.content.includes(query)) matches.push({ ...turn, threadKey: key });
          }
        }
        return matches.slice(0, limit ?? 20);
      },
      getInsights: async (key) => stores.insights.get(key),
      putInsights: async (key, summary) => {
        stores.insights.set(key, summary);
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
              (!filter.query || memory.content.includes(filter.query)),
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
                const winner = stores.memories.find((m) => m.id === change.byId);
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
        return chapters.map<ChapterRef>((chapter, index) => ({ index, title: chapter.title }));
      },
      getChapterText: async (bookId, chapterIndex) =>
        stores.chapters.get(bookId)?.[chapterIndex]?.text,
      searchText: async ({ query, bookId, limit }) => {
        const results: Array<{
          bookId: Id;
          chapterIndex: number;
          chapterTitle?: string;
          snippet: string;
        }> = [];
        for (const [id, chapters] of stores.chapters) {
          if (bookId && id !== bookId) continue;
          chapters.forEach((chapter, index) => {
            const at = chapter.text.indexOf(query);
            if (at === -1) return;
            results.push({
              bookId: id as Id,
              chapterIndex: index,
              chapterTitle: chapter.title,
              snippet: chapter.text.slice(Math.max(0, at - 60), at + query.length + 60),
            });
          });
        }
        return results.slice(0, limit ?? 8);
      },
    },
  };
  return { deps, stores };
}
