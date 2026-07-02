/**
 * Agent Workbench（dev-only）的状态编排：一个会话 = 内存 fixture 书架 +
 * AgentRuntime（@read-aware/agent）。聊天流、工具日志、记忆/ask-note 快照
 * 都在这里维护 —— 页面组件只做展示。产品集成走 ChatTransport，与本页无关。
 */
import { useCallback, useRef, useState } from "react";
import {
  createAgentRuntime,
  threadScopeKey,
  type AgentRuntime,
  type KnownProviderId,
  type MemoryRecord,
  type ThreadScope,
} from "@read-aware/agent";
import {
  createInMemoryDeps,
  type AskRecord,
  type InMemoryStores,
} from "@read-aware/agent/testing";
import type { AnnotationRecord, BookOverview } from "@read-aware/agent";
import type { Id } from "@read-aware/core";
import { getAIConfig } from "../../features/ai/lib/ai-config";
import type { ChatMessage } from "../../features/ai/lib/chat-types";

const LAB_BOOKS: BookOverview[] = [
  { id: "book-debt" as Id, title: "债：第一个五千年", author: "大卫·格雷伯", progressFraction: 0.42 },
  { id: "book-sapiens" as Id, title: "人类简史", author: "尤瓦尔·赫拉利", progressFraction: 0.9 },
  { id: "book-scale" as Id, title: "规模", author: "杰弗里·韦斯特", progressFraction: 0.05 },
];

const LAB_ANNOTATIONS: AnnotationRecord[] = [
  {
    id: "a1",
    bookId: "book-debt" as Id,
    kind: "highlight",
    text: "经济学教科书里的物物交换起源故事，在人类学的田野记录中从未被观察到。",
    chapter: "第二章",
    createdAt: "2026-06-20T10:00:00Z",
  },
  {
    id: "a2",
    bookId: "book-debt" as Id,
    kind: "highlight",
    text: "信用记账早于铸币数千年出现，货币首先是债务的度量单位。",
    chapter: "第三章",
    createdAt: "2026-06-21T10:00:00Z",
  },
  {
    id: "a3",
    bookId: "book-debt" as Id,
    kind: "note",
    text: "暴力与量化：把人从社会关系中抽离，才能被定价。",
    content: "和《人类简史》讲虚构故事的部分对照读",
    chapter: "第五章",
    createdAt: "2026-06-22T10:00:00Z",
  },
];

const LAB_PROFILE = "偏好第一性原理式的深入讲解，讨厌空话。";

export interface LabThread {
  key: string;
  label: string;
  scope: ThreadScope;
}

export const LAB_THREADS: LabThread[] = (
  [
    { label: "《债》书线程", scope: { kind: "book", bookId: "book-debt" as Id } },
    { label: "《人类简史》书线程", scope: { kind: "book", bookId: "book-sapiens" as Id } },
    { label: "全局线程", scope: { kind: "global" } },
  ] satisfies Omit<LabThread, "key">[]
).map((thread) => ({ ...thread, key: threadScopeKey(thread.scope) }));

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
  "zai-coding-cn": { smart: "glm-5-turbo", fast: "glm-4.5-air" },
};

function initialConfig(): LabConfig {
  const stored = getAIConfig();
  const provider: KnownProviderId =
    stored && stored.provider !== "custom" ? stored.provider : "zai-coding-cn";
  const defaults = MODEL_DEFAULTS[provider];
  return {
    provider,
    apiKey: stored?.apiKey ?? "",
    smart: stored?.model || defaults.smart,
    fast: defaults.fast,
  };
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
  const [messagesByThread, setMessagesByThread] = useState<Record<string, ChatMessage[]>>({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolLog, setToolLog] = useState<ToolLogEntry[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [asks, setAsks] = useState<AskRecord[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);

  const sessionRef = useRef<{ runtime: AgentRuntime; stores: InMemoryStores } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ensureSession = useCallback(() => {
    if (!sessionRef.current) {
      const { deps, stores } = createInMemoryDeps({
        books: LAB_BOOKS,
        annotations: LAB_ANNOTATIONS,
        profile: LAB_PROFILE,
      });
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
  }, []);

  const send = useCallback(
    (text: string) => {
      if (!text.trim() || isStreaming) return;
      if (!config.apiKey) {
        setError("先填 API key（或在 Settings → AI 配置后刷新本页）");
        return;
      }
      const active = LAB_THREADS.find((thread) => thread.key === threadKey);
      if (!active) return;
      void (async () => {
        const { runtime, stores } = ensureSession();
        const userMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          content: text,
          createdAt: new Date().toISOString(),
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
            signal: abort.signal,
          })) {
            if (chunk.type === "text") {
              accumulated += chunk.text;
              setStreamingText(accumulated);
            } else if (chunk.type === "status") {
              setStatus(chunk.status);
            } else {
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
            const assistantMessage: ChatMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: accumulated,
              createdAt: new Date().toISOString(),
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
            setMemories([...stores.memories]);
            setIsExtracting(false);
          });
        }
      })();
    },
    [config.apiKey, ensureSession, isStreaming, threadKey],
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
    send,
    stop,
    reset,
  };
}
