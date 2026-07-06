/**
 * Agent Lab 的状态编排：一个会话 = 真书书架（public/books 的公版书）+
 * AgentRuntime（@read-aware/agent）。聊天流、工具日志、记忆/ask-note 快照、
 * 阅读位置与引用选区都在这里维护 —— 页面组件只做展示。
 * 凭证由 vite.config.ts 从 pi CLI 注入（dev only）。
 */
import { useCallback, useRef, useState } from "react";
import {
  createAgentRuntime,
  threadScopeKey,
  type AgentRuntime,
  type AnnotationRecord,
  type BookOverview,
  type ConsolidationReport,
  type KnownProviderId,
  type MemoryRecord,
  type ThreadScope,
} from "@read-aware/agent";
import {
  createInMemoryDeps,
  type AskRecord,
  type ChapterSeed,
  type InMemoryStores,
} from "@read-aware/agent/testing";
import type { Id } from "@read-aware/core";
import type { ReaderPosition, ReaderQuote } from "./components/LabReader";
import { extractChapters } from "./lib/extract-text";

export interface LabBook extends BookOverview {
  /** public/ 下的真实 epub 路径 —— 阅读视图直接渲染它 */
  file: string;
}

/**
 * 真书书架（epub 在 public/books/，版权内容不入库 —— 见该目录 README）。
 * progressFraction 是活的：阅读视图 relocate 时原地更新，
 * agent 经 LibraryPort 看到的就是你真实读到的位置。
 */
const LAB_BOOKS: LabBook[] = [
  { id: "santi" as Id, title: "三体全集", author: "刘慈欣", progressFraction: 0, file: "/books/santi.epub" },
  {
    id: "cholera" as Id,
    title: "霍乱时期的爱情",
    author: "加西亚·马尔克斯",
    progressFraction: 0,
    file: "/books/cholera.epub",
  },
  {
    id: "rich-dad" as Id,
    title: "Rich Dad Poor Dad",
    author: "Robert T. Kiyosaki",
    progressFraction: 0,
    file: "/books/rich-dad-poor-dad.epub",
  },
  {
    id: "atomic-habits" as Id,
    title: "Atomic Habits",
    author: "James Clear",
    progressFraction: 0,
    file: "/books/atomic-habits.epub",
  },
];

const LAB_ANNOTATIONS: AnnotationRecord[] = [
  {
    id: "a1",
    bookId: "santi" as Id,
    kind: "highlight",
    text: "弱小和无知不是生存的障碍，傲慢才是。",
    chapter: "死神永生",
    createdAt: "2026-06-20T10:00:00Z",
  },
  {
    id: "a2",
    bookId: "santi" as Id,
    kind: "highlight",
    text: "失去人性，失去很多；失去兽性，失去一切。",
    chapter: "死神永生",
    createdAt: "2026-06-21T10:00:00Z",
  },
  {
    id: "a3",
    bookId: "santi" as Id,
    kind: "note",
    text: "把字刻在石头上。",
    content: "文明的信息载体越先进越脆弱——和《人类简史》的知识外包论对照",
    chapter: "死神永生",
    createdAt: "2026-06-22T10:00:00Z",
  },
  {
    id: "a4",
    bookId: "atomic-habits" as Id,
    kind: "highlight",
    text: "You do not rise to the level of your goals. You fall to the level of your systems.",
    chapter: "Chapter 1",
    createdAt: "2026-06-23T10:00:00Z",
  },
];

const LAB_PROFILE = "偏好第一性原理式的深入讲解，讨厌空话。";

export interface LabThread {
  key: string;
  label: string;
  scope: ThreadScope;
  book?: LabBook;
}

export const LAB_THREADS: LabThread[] = [
  ...LAB_BOOKS.map((book) => {
    const scope: ThreadScope = { kind: "book", bookId: book.id };
    return { key: threadScopeKey(scope), label: book.title, scope, book };
  }),
  { key: threadScopeKey({ kind: "global" }), label: "全局线程", scope: { kind: "global" } },
];

export const GLOBAL_THREAD_KEY = threadScopeKey({ kind: "global" });

export function annotationCount(bookId: Id): number {
  return LAB_ANNOTATIONS.filter((a) => a.bookId === bookId).length;
}

export interface LabConfig {
  provider: KnownProviderId;
  apiKey: string;
  smart: string;
  fast: string;
}

export const MODEL_DEFAULTS: Record<KnownProviderId, { smart: string; fast: string }> = {
  anthropic: { smart: "claude-sonnet-4-6", fast: "claude-haiku-4-5-20251001" },
  openai: { smart: "gpt-4o", fast: "gpt-4o-mini" },
  openrouter: { smart: "openai/gpt-4o", fast: "openai/gpt-4o-mini" },
  zai: { smart: "glm-5.2", fast: "glm-5.2" },
  "zai-coding-cn": { smart: "glm-5.2", fast: "glm-5.2" },
};

function initialConfig(): LabConfig {
  const devKeys = __LAB_DEV_KEYS__;
  const withKey = (Object.keys(MODEL_DEFAULTS) as KnownProviderId[]).find(
    (provider) => devKeys[provider],
  );
  const provider = withKey ?? "zai-coding-cn";
  return { provider, apiKey: devKeys[provider] ?? "", ...MODEL_DEFAULTS[provider] };
}

export interface LabMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 发送时引用的选区（展示用；runtime 会把它格式化进真正的消息） */
  quote?: string;
}

export interface ToolLogEntry {
  id: string;
  threadKey: string;
  tool: string;
  phase: "start" | "end";
  isError?: boolean;
  at: string;
}

export function useAgentLab() {
  const [config, setConfig] = useState<LabConfig>(initialConfig);
  const [threadKey, setThreadKey] = useState(LAB_THREADS[0].key);
  const [messagesByThread, setMessagesByThread] = useState<Record<string, LabMessage[]>>({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolLog, setToolLog] = useState<ToolLogEntry[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [asks, setAsks] = useState<AskRecord[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [pendingQuote, setPendingQuote] = useState<ReaderQuote | null>(null);
  const [insightsByThread, setInsightsByThread] = useState<Record<string, string>>({});
  const [chapterCounts, setChapterCounts] = useState<Record<string, number>>({});
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [lastConsolidation, setLastConsolidation] = useState<ConsolidationReport | null>(null);
  /** 书 id → 实时进度（驱动书架栏渲染；LAB_BOOKS 本体也同步原地更新给端口） */
  const [progressById, setProgressById] = useState<Record<string, number>>({});

  const sessionRef = useRef<{ runtime: AgentRuntime; stores: InMemoryStores } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const positionAnchors = useRef(new Map<string, string>());
  /** 正文抽取结果；会话创建时接到 stores.chapters 上，抽取先后无关紧要 */
  const chaptersRef = useRef(new Map<string, ChapterSeed[]>());
  const extracting = useRef(new Set<string>());

  const ensureSession = useCallback(() => {
    if (!sessionRef.current) {
      const { deps, stores } = createInMemoryDeps({
        books: LAB_BOOKS,
        annotations: LAB_ANNOTATIONS,
        profile: LAB_PROFILE,
      });
      // BookTextPort 读的是 stores.chapters —— 换成 lab 的真抽取结果容器
      stores.chapters = chaptersRef.current;
      const runtime = createAgentRuntime({
        deps,
        account: { kind: "api-key", provider: config.provider, apiKey: config.apiKey },
        models: { smart: config.smart, fast: config.fast },
      });
      sessionRef.current = { runtime, stores };
      setSessionStarted(true);
    }
    return sessionRef.current;
  }, [config]);

  /** 懒抽取：某本书第一次被打开时离屏抽正文，agent 随即可读章节。 */
  const ensureBookText = useCallback((book: LabBook) => {
    const key = String(book.id);
    if (chaptersRef.current.has(key) || extracting.current.has(key)) return;
    extracting.current.add(key);
    void (async () => {
      try {
        const response = await fetch(book.file);
        const chapters = await extractChapters(await response.blob(), book.file);
        chaptersRef.current.set(key, chapters);
        setChapterCounts((prev) => ({ ...prev, [key]: chapters.length }));
      } catch {
        // 抽取失败不影响其它功能；正文工具会如实报"未抽取"
      } finally {
        extracting.current.delete(key);
      }
    })();
  }, []);

  /** 巩固批处理：衰减、合并、矛盾、升格（doc §4 第 3 步）。 */
  const consolidate = useCallback(() => {
    const session = sessionRef.current;
    if (!session || isConsolidating) return;
    setIsConsolidating(true);
    void session.runtime
      .consolidate()
      .then((report) => {
        setLastConsolidation(report);
        setMemories([...session.stores.memories.filter((m) => (m.status ?? "active") === "active")]);
      })
      .catch(() => {})
      .finally(() => setIsConsolidating(false));
  }, [isConsolidating]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    sessionRef.current = null;
    setSessionStarted(false);
    setMessagesByThread({});
    setToolLog([]);
    setMemories([]);
    setAsks([]);
    setIsStreaming(false);
    setStreamingText("");
    setStatus(null);
    setError(null);
    setIsExtracting(false);
    setPendingQuote(null);
    setLastConsolidation(null);
  }, []);

  /** 阅读视图的 relocate 回传：更新实时进度 + 记住当前位置锚点。 */
  const reportPosition = useCallback((bookId: Id, position: ReaderPosition) => {
    const book = LAB_BOOKS.find((entry) => entry.id === bookId);
    if (book) book.progressFraction = position.fraction;
    if (position.cfi) positionAnchors.current.set(bookId, position.cfi);
    setProgressById((prev) => ({ ...prev, [bookId]: position.fraction }));
  }, []);

  const send = useCallback(
    (text: string) => {
      if (!text.trim() || isStreaming) return;
      if (!config.apiKey) {
        setError("没有可用的 API key —— 填一个，或先用 pi CLI 登录再重启 lab");
        return;
      }
      const active = LAB_THREADS.find((thread) => thread.key === threadKey);
      if (!active) return;
      const quote = pendingQuote;
      setPendingQuote(null);
      void (async () => {
        const { runtime, stores } = ensureSession();
        const userMessage: LabMessage = {
          id: crypto.randomUUID(),
          role: "user",
          content: text,
          quote: quote?.text,
        };
        setMessagesByThread((prev) => ({
          ...prev,
          [threadKey]: [...(prev[threadKey] ?? []), userMessage],
        }));
        setIsStreaming(true);
        setStreamingText("");
        setError(null);
        const abort = new AbortController();
        abortRef.current = abort;
        let accumulated = "";
        try {
          for await (const chunk of runtime.sendTurn(active.scope, {
            text,
            attachments: quote
              ? [{ text: quote.text, chapter: quote.chapter, anchor: quote.cfi }]
              : undefined,
            positionAnchor:
              active.scope.kind === "book"
                ? positionAnchors.current.get(active.scope.bookId)
                : undefined,
            signal: abort.signal,
          })) {
            if (chunk.type === "text") {
              accumulated += chunk.text;
              setStreamingText(accumulated);
            } else if (chunk.type === "status") {
              setStatus(chunk.status);
            } else if (chunk.type === "tool-step") {
              setToolLog((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  threadKey,
                  tool: chunk.tool,
                  phase: chunk.phase,
                  isError: chunk.isError,
                  at: new Date().toISOString(),
                },
              ]);
            }
          }
          if (accumulated) {
            const assistantMessage: LabMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: accumulated,
            };
            setMessagesByThread((prev) => ({
              ...prev,
              [threadKey]: [...(prev[threadKey] ?? []), assistantMessage],
            }));
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setIsStreaming(false);
          setStreamingText("");
          setStatus(null);
          setAsks([...stores.asks]);
          setIsExtracting(true);
          void runtime.flushBackgroundWork().then(() => {
            setMemories(stores.memories.filter((m) => (m.status ?? "active") === "active"));
            setInsightsByThread(Object.fromEntries(stores.insights));
            setIsExtracting(false);
          });
        }
      })();
    },
    [config.apiKey, ensureSession, isStreaming, pendingQuote, threadKey],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return {
    config,
    setConfig,
    sessionStarted,
    threads: LAB_THREADS,
    threadKey,
    setThreadKey,
    messages: messagesByThread[threadKey] ?? [],
    isStreaming,
    streamingText,
    status,
    error,
    toolLog,
    memories,
    asks,
    isExtracting,
    insights: insightsByThread[threadKey],
    pendingQuote,
    setPendingQuote,
    progressById,
    chapterCounts,
    isConsolidating,
    lastConsolidation,
    reportPosition,
    ensureBookText,
    consolidate,
    send,
    stop,
    reset,
  };
}
